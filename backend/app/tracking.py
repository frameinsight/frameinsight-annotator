"""Chronological tracking, separate from annotation state and human identities."""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path

from . import db
from .config import DATA, MODELS, safe_path
from .video import sha256

TRACKING_VERSION = 'person-tracks-v1'
DEFAULT_MODEL = 'yolo26m.pt'
OFFICIAL_MODELS = {'yolo26m.pt': 'YOLO26 medium', 'yolo26s.pt': 'YOLO26 small'}
REID_MODEL = 'yolo26n-cls.pt'
TRACKERS = ('botsort', 'tracktrack')


def model_file(name):
    # Public assistance accepts only these official person detectors, not arbitrary
    # URLs/checkpoints. The separate expert detector API retains explicit mapping.
    if name not in OFFICIAL_MODELS and name != REID_MODEL:
        raise ValueError('Choose an official model listed in Detect & track')
    MODELS.mkdir(parents=True, exist_ok=True)
    path = MODELS / name
    if not path.is_file():
        from ultralytics.utils.downloads import attempt_download_asset
        attempt_download_asset(str(path), repo='ultralytics/assets', release='v8.4.0')
    return safe_path(name, MODELS)


def request_key(video, settings):
    # Includes source/video ownership, model bytes when present, exact settings,
    # and implementation version. A newly replaced checkpoint invalidates cache.
    path = MODELS / settings['model']
    reid = MODELS / REID_MODEL
    payload = {'video_id': video['id'], 'source': video.get('source_hash'),
               'stream': video.get('stream_index', 0), 'settings': settings,
               'model': sha256(path) if path.is_file() else None,
               'reid': sha256(reid) if settings.get('reid') and reid.is_file() else None,
               'version': TRACKING_VERSION}
    try: payload['ultralytics'] = importlib.metadata.version('ultralytics')
    except importlib.metadata.PackageNotFoundError: payload['ultralytics'] = None
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def cache_key(video, settings, digest, reid_digest):
    return hashlib.sha256(json.dumps({'video': video['id'], 'source': video['source_hash'],
        'stream': video.get('stream_index', 0), 'settings': settings, 'model': digest,
        'reid': reid_digest, 'version': TRACKING_VERSION,
        'ultralytics': importlib.metadata.version('ultralytics')}, sort_keys=True).encode()).hexdigest()


def tracker_config(settings, reid_path=None):
    from ultralytics.utils import ROOT, YAML
    config = YAML.load(ROOT / 'cfg' / 'trackers' / (settings['tracker'] + '.yaml'))
    config.update(with_reid=settings.get('reid', True), model=str(reid_path) if reid_path else 'auto')
    # Keep low-confidence detections available for recovery. Display confidence
    # belongs to the viewer; it never changes this tracking floor.
    config.update(track_low_thresh=settings['confidence'])
    folder = DATA / 'tracking-configs'
    folder.mkdir(exist_ok=True)
    key = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    path = folder / (key + '.yaml')
    YAML.save(path, config)
    return path


class PersonTracker:
    """Keep every detector candidate, including those not yet assigned a track.

    Ultralytics' default postprocess replaces detections with confirmed tracks and
    drops unconfirmed candidates. We use its start/setup hooks and tracker's
    documented box-index output to preserve the original detection coordinates.
    """
    def __init__(self, model_path, config_path, settings):
        from ultralytics import YOLO
        self.model = YOLO(str(model_path))
        self.settings = settings
        self.config_path = config_path
        self.records = []
        self.started = False
        names = self.model.names
        self.classes = [int(k) for k, name in names.items() if str(name).lower() == 'person']
        if not self.classes: raise ValueError('The detector has no person class')
        self.model.add_callback('on_predict_start', self._start)
        self.model.add_callback('on_predict_postprocess_end', self._associate)

    def _start(self, predictor):
        from ultralytics.trackers.track import on_predict_start
        on_predict_start(predictor, persist=True)
        if not self.started:
            # Some tracker constructors do not reset their process-global ID
            # counter. An unrelated earlier video must never affect this pass.
            for tracker in predictor.trackers: tracker.reset()
            self.started = True

    def _associate(self, predictor):
        tracker = predictor.trackers[0]
        cls = type(tracker)
        extras = cls.compute_frame_extras(predictor) if hasattr(cls, 'compute_frame_extras') else None
        self.records = []
        for i, result in enumerate(predictor.results):
            det = result.boxes.cpu().numpy()
            kwargs = {'feats': getattr(result, 'feats', None)}
            if extras is not None: kwargs['dets_del'] = extras[i]
            tracks = tracker.update(det, result.orig_img, **kwargs)
            rows = [{'box': b.xyxy[0].tolist(), 'confidence': float(b.conf.item()),
                     'class_id': int(b.cls.item()), 'track_id': None} for b in det]
            for track in tracks:
                index = int(track[-1])
                if 0 <= index < len(rows):
                    rows[index]['track_id'] = str(int(track[4]))
                else:
                    # TrackTrack may recover a candidate from its secondary NMS.
                    rows.append({'box': track[:4].tolist(), 'confidence': float(track[5]),
                                 'class_id': int(track[6]), 'track_id': str(int(track[4]))})
            self.records.append({'path': result.path, 'shape': tuple(result.orig_shape), 'rows': rows})

    def frame(self, path):
        self.model.predict(str(path), conf=self.settings['confidence'], imgsz=self.settings['imgsz'],
                           device=self.settings['device'], classes=self.classes, verbose=False,
                           tracker=str(self.config_path), mode='track', batch=1, save=False,
                           # FP32 is intentional. FP16 on some GTX cards silently
                           # yields empty detections for this detector/torch build.
                           quantize=None)
        if len(self.records) != 1: raise ValueError('Tracker did not return exactly one source frame')
        return self.records[0]


def issue_for(previous, current):
    reasons = []
    if current['confidence'] < .4: reasons.append('Low detection confidence')
    if previous:
        delta = current['frame_index'] - previous['frame_index']
        if delta > 1: reasons.append('Reappeared after missing detections; confirm identity')
        a, b = previous['box'], current['box']
        ac = ((a[0]+a[2])/2, (a[1]+a[3])/2)
        bc = ((b[0]+b[2])/2, (b[1]+b[3])/2)
        diagonal = max(1, math.hypot(a[2]-a[0], a[3]-a[1]))
        if math.dist(ac, bc) > diagonal * .65 * min(delta, 3): reasons.append('Sudden position change')
        ratio = ((b[2]-b[0])*(b[3]-b[1])) / max(1, (a[2]-a[0])*(a[3]-a[1]))
        if ratio > 2.5 or ratio < .4: reasons.append('Sudden box size change')
    return '; '.join(reasons)


def flag_overlaps(proposals):
    for i, a in enumerate(proposals):
        if not a.get('track_id'): continue
        for b in proposals[i+1:]:
            if not b.get('track_id') or a['track_id'] == b['track_id']: continue
            x, y = a['box'], b['box']
            intersection = max(0, min(x[2], y[2])-max(x[0], y[0])) * max(0, min(x[3], y[3])-max(x[1], y[1]))
            area = min((x[2]-x[0])*(x[3]-x[1]), (y[2]-y[0])*(y[3]-y[1]))
            if intersection / max(1, area) >= .6:
                reason = 'People overlap; check identity through the crossing'
                for p in (a, b):
                    if reason not in p.get('track_issue', ''):
                        p['track_issue'] = '; '.join(filter(None, (p.get('track_issue'), reason)))


def finish_job(jid, **updates):
    # A cancellation arriving with the final GPU result wins over completion.
    with db.transaction() as c:
        row = c.execute('SELECT data FROM jobs WHERE id=?', (jid,)).fetchone()
        if not row: return
        job = json.loads(row['data'])
        if job['status'] == 'cancelled': return
        job.update(status='completed', updated_at=db.now(), **updates)
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(job), jid))


def run_tracking_job(job, adapter_factory=PersonTracker):
    from .worker import proposal_identifier
    jid, vid, settings = job['id'], job['video_id'], dict(job['settings'])
    with db.connect() as c:
        row = c.execute('SELECT data FROM videos WHERE id=?', (vid,)).fetchone()
        if not row: raise ValueError('Video was deleted')
        video = json.loads(row['data'])
    if video.get('status') != 'ready': raise ValueError('Wait for exact-frame indexing to finish')
    db.job_update(jid, phase='Loading person detector and appearance model')
    path = model_file(settings['model'])
    reid_path = model_file(REID_MODEL) if settings.get('reid', True) else None
    digest, reid_digest = sha256(path), sha256(reid_path) if reid_path else None
    key = cache_key(video, settings, digest, reid_digest)
    if db.job_get(jid)['status'] == 'cancelled': return
    with db.connect() as c:
        done = c.execute('SELECT COUNT(*) FROM proposal_frames WHERE video_id=? AND cache_key=?', (vid, key)).fetchone()[0]
    total = video['frame_count']
    db.job_update(jid, cache_key=key, request_key=request_key(video, settings), total=total, model_hash=digest,
                  reid_hash=reid_digest, adapter_version=TRACKING_VERSION)
    if done == total:
        finish_job(jid, progress=total, cached_frames=total, phase='Cached tracks ready')
        return
    # Always reset stateful inference to frame zero. Reuse is allowed only for a
    # complete pass; partial per-frame caching cannot restore tracker memory.
    adapter = adapter_factory(path, tracker_config(settings, reid_path), settings)
    db.job_update(jid, progress=0, phase='Detecting and tracking every frame in order', restarted_from_frame=0)
    previous = {}
    for frame_index in range(total):
        if db.job_get(jid)['status'] == 'cancelled': return
        source = DATA / 'frames' / vid / f'{frame_index:08d}.png'
        output = adapter.frame(source)
        if Path(output['path']).resolve() != source.resolve() or output['shape'] != (video['height'], video['width']):
            raise ValueError('Tracker output does not match the exact source-frame ledger')
        proposals = []
        for n, row in enumerate(output['rows']):
            if not all(math.isfinite(x) for x in [*row['box'], row['confidence']]): continue
            coords = [max(0., min(video['width'] if i % 2 == 0 else video['height'], x)) for i, x in enumerate(row['box'])]
            if coords[0] >= coords[2] or coords[1] >= coords[3]: continue
            raw_track = row.get('track_id')
            track_id = f'{key[:16]}:{raw_track}' if raw_track is not None else None
            p = {'id': proposal_identifier(vid, key, frame_index, n), 'video_id': vid,
                 'frame_index': frame_index, 'geometry': 'person_visible', 'box': coords,
                 'confidence': row['confidence'], 'class_id': row['class_id'], 'class_name': 'person',
                 'cache_key': key, 'track_id': track_id, 'model_hash': digest,
                 'adapter_version': TRACKING_VERSION, 'tracker': settings['tracker']}
            reason = issue_for(previous.get(track_id), p) if track_id else 'Detection not linked to a track yet'
            if reason: p['track_issue'] = reason
            if track_id: previous[track_id] = p
            proposals.append(p)
        flag_overlaps(proposals)
        with db.transaction() as c:
            # Cancellation or deletion during a slow GPU frame cannot resurrect
            # proposals for a removed video or mark a cancelled pass completed.
            current = c.execute('SELECT data FROM jobs WHERE id=?', (jid,)).fetchone()
            if not current or json.loads(current['data'])['status'] == 'cancelled': return
            if not c.execute('SELECT 1 FROM videos WHERE id=?', (vid,)).fetchone(): return
            c.execute('DELETE FROM proposals WHERE video_id=? AND cache_key=? AND frame_index=?', (vid, key, frame_index))
            for p in proposals:
                c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)', (p['id'], vid, frame_index, key, json.dumps(p)))
            c.execute('INSERT OR IGNORE INTO proposal_frames VALUES(?,?,?)', (vid, key, frame_index))
        db.job_update(jid, progress=frame_index + 1)
    finish_job(jid, phase='Tracks ready for review', progress=total)


def track_summary(proposals, total):
    tracks = {}
    for p in sorted(proposals, key=lambda p: p['frame_index']):
        tid = p.get('track_id')
        if tid is None: continue
        t = tracks.setdefault(tid, {'id': tid, 'start': p['frame_index'], 'end': p['frame_index'], 'count': 0, 'issues': []})
        t['end'] = p['frame_index']; t['count'] += 1
        if p.get('track_issue'): t['issues'].append({'frame_index': p['frame_index'], 'reason': p['track_issue']})
    for t in tracks.values():
        if t['end'] < total - 1:
            t['issues'].append({'frame_index': t['end'] + 1, 'reason': 'Track ends here; check for a missed person or an exit'})
    return list(tracks.values())
