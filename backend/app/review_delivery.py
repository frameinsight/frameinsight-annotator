"""Revision-bound annotation validation; rendered video review is optional."""
import hashlib
import json
import os
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageFont
from . import db
from .annotation_export import annotation_document
from .config import DATA, safe_path
from .review_validation import validate_document, LIMITATION
from .video import sha256

from .version import APP_VERSION
POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix='video-review')


def fingerprint(document):
    videos = {vid: {k: v.get(k) for k in ('id', 'width', 'height', 'frame_count', 'source_hash', 'stream_index', 'status')} for vid, v in document['videos'].items()}
    semantic = {'state': document['state'], 'videos': videos, 'frames': document['frames'],
                'classes': document['classes'], 'class_colors': document['class_colors'], 'project': document['project']}
    return hashlib.sha256(json.dumps(semantic, sort_keys=True, allow_nan=False).encode()).hexdigest()


def live_fingerprint(c, pid, vid, project=None, ledger=None):
    """Hash saved state directly: operation history does not affect freshness.

    The full frozen export still preserves history. Rebuilding that export for a
    freshness check can parse hundreds of megabytes unnecessarily.
    """
    project = project if project is not None else db.get_state(c, pid)
    ledger = ledger if ledger is not None else [json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index', (vid,))]
    return fingerprint({'state': project['state'], 'videos': {vid: project['videos'][vid]}, 'frames': {vid: ledger},
                        'classes': project['classes'], 'class_colors': project['class_colors'],
                        'project': {k: project[k] for k in ('id', 'name', 'revision', 'created_at')}})


def get_review(jid):
    job = db.job_get(jid)
    if job.get('kind') != 'review': raise ValueError('This job is not an annotated video review')
    return job


def read_document(job):
    path = safe_path(job['snapshot_path'], DATA)
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != job['snapshot_hash']: raise ValueError('The annotation snapshot has changed. Validate again.')
    return json.loads(raw)


def verify_source(document):
    for video in document['videos'].values():
        source = Path(video['source'])
        if not source.is_file() or sha256(source) != video.get('source_hash'):
            raise ValueError('The source video is missing or differs from its indexed hash. Reimport the original video.')


def current_matches(job, c=None):
    if job.get('app_version') != APP_VERSION: return False
    context = c or db.connect()
    try:
        if c is None: context.execute('BEGIN')
        row = context.execute('SELECT revision FROM projects WHERE id=?', (job['project_id'],)).fetchone()
        if not row or row['revision'] != job['revision']: return False
        return live_fingerprint(context, job['project_id'], job['video_id']) == job['fingerprint']
    except (ValueError, KeyError): return False
    finally:
        if c is None: context.close()


def create_review(vid, revision):
    jid = str(uuid.uuid4()); folder = DATA / 'reviews' / jid
    with db.transaction() as c:
        row = c.execute('SELECT project_id FROM videos WHERE id=?', (vid,)).fetchone()
        if not row: raise KeyError('Video not found')
        project = db.get_state(c, row['project_id'])
        if project['revision'] != revision: raise db.Conflict(project['revision'])
        if project['videos'][vid]['status'] != 'ready': raise ValueError('Wait for source indexing before creating a review')
        document = annotation_document(project['id'], vid)
        document['app_version'] = APP_VERSION
        document['conventions']['delivery'] = 'This immutable document is the source of the full annotated video review. Final delivery adds the revision-bound validation report.'
        raw = json.dumps(document, ensure_ascii=False, allow_nan=False, sort_keys=True)
        folder.mkdir(parents=True)
        path = folder / 'annotations.json'; path.write_text(raw, encoding='utf-8')
        job = {'id': jid, 'kind': 'review', 'project_id': project['id'], 'video_id': vid,
               'revision': revision, 'status': 'queued', 'progress': 0, 'total': project['videos'][vid]['frame_count'],
               'error': None, 'created_at': db.now(), 'snapshot_path': str(path), 'snapshot_hash': sha256(path),
               'fingerprint': live_fingerprint(c, project['id'], vid, project, document['frames'][vid]), 'video_path': str(folder / 'review.mp4'),
               'video_url': f'/api/reviews/{jid}/video', 'metadata_url': f'/api/reviews/{jid}', 'app_version': APP_VERSION}
        c.execute('INSERT INTO jobs VALUES(?,?,?)', (jid, project['id'], json.dumps(job)))
    POOL.submit(render_review, jid)
    return job


def update_review(jid, **updates):
    with db.transaction() as c:
        row = c.execute('SELECT data FROM jobs WHERE id=?', (jid,)).fetchone()
        if not row: return False
        job = json.loads(row['data'])
        if job['status'] == 'cancelled': return False
        job.update(**updates, updated_at=db.now())
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(job), jid))
    return True


def review_metadata(jid):
    job = get_review(jid); document = read_document(job)
    ledger = document['frames'][job['video_id']]
    times = [f.get('seconds') for f in ledger]
    offset = times[0] if times and times[0] is not None else 0
    return {'review_job_id': jid, 'revision': job['revision'], 'video_id': job['video_id'],
            'status': job['status'], 'stale': not current_matches(job), 'frame_count': len(ledger),
            'frame_timestamps': [t-offset if t is not None else None for t in times],
            'source_timestamp_offset': offset, 'duration_seconds': job.get('duration_seconds'),
            'rendered_frames': job.get('rendered_frames', 0), 'video_url': job['video_url'],
            'audio_included': False, 'snapshot_hash': job['snapshot_hash'], 'error': job.get('error')}


def draw_annotations(image, rows, font):
    """Source pixel geometry is never scaled or filtered by editor visibility."""
    draw = ImageDraw.Draw(image)
    width, height = image.size
    line = max(2, round(min(width, height) / 360))
    label_counts = defaultdict(int)
    for index, row in enumerate(rows):
        box = row['box_xyxy']; color = row.get('color', '#22d3ee')
        draw.rectangle(tuple(box), outline=color, width=line)
        person = row.get('person_id')
        label = f'Track {person if person is not None else "UNASSIGNED"} | {row["class_name"]}'
        bounds = draw.textbbox((0, 0), label, font=font)
        tw, th = bounds[2]-bounds[0]+8, bounds[3]-bounds[1]+8
        x = min(max(0, box[0]), max(0, width-tw))
        # Stack class labels of a shared track on alternating box edges.
        ordinal = label_counts[row.get('identity_uuid')]
        label_counts[row.get('identity_uuid')] += 1
        y = box[1]-th*(ordinal//2+1) if ordinal % 2 == 0 else box[3]+th*(ordinal//2)
        y = min(max(0, y), max(0, height-th))
        draw.rectangle((x, y, min(width, x+tw), y+th), fill='#101820', outline=color, width=1)
        draw.text((x+4, y+4-bounds[1]), label, font=font, fill=color)
    return image


def render_review(jid):
    partial = None
    try:
        job = get_review(jid)
        if not update_review(jid, status='running', phase='Preparing full annotated video'): return
        document = read_document(job); vid = job['video_id']; video = document['videos'][vid]
        ledger = document['frames'][vid]
        if len(ledger) != video['frame_count']: raise ValueError('Source frame ledger is incomplete. Reindex the video.')
        source = Path(video['source'])
        if not source.is_file() or sha256(source) != video.get('source_hash'):
            raise ValueError('The source video is missing or differs from its indexed hash. Reimport the original video.')
        per_frame = defaultdict(list)
        for row in document['annotation_index']: per_frame[row['frame_index']].append(row)
        font = ImageFont.load_default(size=max(12, round(min(video['width'], video['height']) / 55)))
        path = Path(job['video_path']); partial = path.with_suffix('.partial.mp4')
        frame_count = 0; source_times = []; source_durations = []
        with av.open(str(source)) as container:
            stream = next((s for s in container.streams.video if s.index == video.get('stream_index', 0)), None)
            if stream is None: raise ValueError('Indexed source video stream is missing')
            tb = stream.time_base
            rate = Fraction(stream.average_rate or str(video.get('nominal_fps') or 25)).limit_denominator(100000)
            with av.open(str(partial), 'w', format='mp4', options={'movflags': '+faststart'}) as output:
                encoded = output.add_stream('libx264', rate=rate)
                encoded.width = video['width'] + video['width'] % 2
                encoded.height = video['height'] + video['height'] % 2
                encoded.pix_fmt = 'yuv420p'; encoded.time_base = tb; encoded.codec_context.time_base = tb
                encoded.options = {'crf': '20', 'preset': 'fast', 'bf': '0', 'threads': '2'}
                origin = None
                # Use exact rational durations for every packet, including the last
                # frame: nominal FPS is never substituted for a VFR frame interval.
                packet_durations = {}
                for n, frame in enumerate(container.decode(stream)):
                    if n >= len(ledger): raise ValueError('Source contains more frames than its indexed ledger')
                    if db.job_get(jid)['status'] == 'cancelled': return
                    f = ledger[n]
                    if frame.pts is None or frame.time_base is None: raise ValueError('Source frame has no timestamp; cannot build exact review timing')
                    timestamp = frame.pts * frame.time_base
                    expected = Fraction(f['pts'] * f['time_base_num'], f['time_base_den'])
                    if timestamp != expected or (frame.width, frame.height) != (video['width'], video['height']):
                        raise ValueError(f'Source frame {n} differs from the indexed frame ledger')
                    if origin is None: origin = timestamp
                    source_times.append(timestamp-origin)
                    duration = frame.duration * frame.time_base if frame.duration else None
                    if n+1 < len(ledger):
                        nxt = ledger[n+1]; duration = Fraction(nxt['pts'] * nxt['time_base_num'], nxt['time_base_den']) - timestamp
                    elif duration is None or duration <= 0:
                        end = (stream.start_time or 0) * tb + stream.duration * tb if stream.duration else None
                        duration = end-timestamp if end is not None and end > timestamp else (source_times[-1]-source_times[-2] if n else 1/rate)
                    if duration <= 0: raise ValueError('Source timestamps are not strictly increasing')
                    source_durations.append(duration)
                    image = draw_annotations(frame.to_image().convert('RGB'), per_frame.get(n, []), font)
                    if image.size != (encoded.width, encoded.height):
                        padded = Image.new('RGB', (encoded.width, encoded.height)); padded.paste(image, (0, 0)); image = padded
                    out_frame = av.VideoFrame.from_image(image)
                    out_frame.time_base = tb; out_frame.pts = int((timestamp-origin)/tb); out_frame.duration = int(duration/tb)
                    packet_durations[out_frame.pts] = out_frame.duration
                    for packet in encoded.encode(out_frame):
                        packet.duration = packet_durations[packet.pts]
                        output.mux(packet)
                    frame_count = n+1
                    if n % 5 == 0 and not update_review(jid, progress=frame_count, rendered_frames=frame_count, phase='Rendering every source frame and saved box'): return
                for packet in encoded.encode():
                    packet.duration = packet_durations[packet.pts]
                    output.mux(packet)
        if frame_count != len(ledger): raise ValueError('Source contains fewer frames than its indexed ledger')
        if not update_review(jid, phase='Verifying rendered frame count and timestamps', progress=frame_count): return
        with av.open(str(partial)) as check:
            actual = [frame.pts * frame.time_base for frame in check.decode(check.streams.video[0])]
            render_time_base = check.streams.video[0].time_base
            render_duration = check.streams.video[0].duration * render_time_base
        if actual != source_times: raise ValueError('Rendered video frame timestamps do not match the source')
        expected_duration = source_times[-1] + source_durations[-1]
        if abs(render_duration-expected_duration) > render_time_base: raise ValueError('Rendered video lost the final frame duration')
        os.replace(partial, path); partial = None
        update_review(jid, status='completed', progress=frame_count, rendered_frames=frame_count,
                      duration_seconds=float(expected_duration), video_hash=sha256(path), video_bytes=path.stat().st_size,
                      phase='Full annotated video ready', stale=not current_matches(job), timing_verified=True)
    except Exception as e:
        update_review(jid, status='failed', error=str(e))
    finally:
        if partial: partial.unlink(missing_ok=True)


def validate_review(vid, revision, review_job_id, visual_confirmed, coverage):
    if not visual_confirmed: raise ValueError('Watch the complete annotated video and confirm visual review first')
    if coverage not in ('all_people', 'selected_people'): raise ValueError('Choose the annotation coverage')
    job = get_review(review_job_id)
    if job['video_id'] != vid: raise ValueError('This review belongs to another video')
    with db.connect() as c:
        project = db.get_state(c, job['project_id'])
        if revision != project['revision']: raise db.Conflict(project['revision'])
    if revision != job['revision'] or not current_matches(job): raise ValueError('This review is stale. Save and generate a new review after your edits.')
    if job['status'] != 'completed' or not job.get('timing_verified'): raise ValueError('Wait for a complete verified review video')
    rendered = safe_path(job['video_path'], DATA)
    if sha256(rendered) != job.get('video_hash'): raise ValueError('The rendered review video changed. Generate it again.')
    document = read_document(job)
    verify_source(document)
    report = validate_document(document)
    report.update(validation_id=str(uuid.uuid4()), review_job_id=review_job_id, revision=revision,
                  video_id=vid, project_id=job['project_id'], coverage=coverage, visual_confirmed=True,
                  created_at=db.now(), snapshot_hash=job['snapshot_hash'], review_video_hash=job['video_hash'], app_version=APP_VERSION)
    report['checks'].append({'name': 'Every source frame rendered with exact timestamps', 'passed': job.get('rendered_frames') == job['total'] and bool(job.get('timing_verified'))})
    if not report['checks'][-1]['passed']:
        report['errors'].append({'code': 'incomplete_review', 'message': 'The annotated review does not contain every source frame.'}); report['passed'] = False
    with db.transaction() as c:
        current = db.get_state(c, job['project_id'])
        if current['revision'] != revision: raise db.Conflict(current['revision'])
        if not current_matches(job, c): raise ValueError('Annotations changed during validation. Generate a new review.')
        c.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', (report['validation_id'], job['project_id'], vid, revision, review_job_id, json.dumps(report)))
        if report['passed']:
            video = current['videos'][vid]
            video.update(finished_revision=revision, finished_at=db.now(), validation_id=report['validation_id'],
                         review_job_id=review_job_id, coverage=coverage, finish_confirmation='Visual review confirmed for '+coverage)
            c.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(video), vid))
    return report


def validate_annotations(vid, revision, visual_confirmed, coverage):
    """Validate a frozen annotation document without reading or encoding media."""
    if not visual_confirmed:
        raise ValueError('Confirm that your annotations are ready to validate')
    if coverage not in ('all_people', 'selected_people'):
        raise ValueError('Choose the annotation coverage')
    with db.transaction() as connection:
        row = connection.execute('SELECT project_id FROM videos WHERE id=?', (vid,)).fetchone()
        if not row:
            raise KeyError('Video not found')
        project = db.get_state(connection, row['project_id'])
        if project['revision'] != revision:
            raise db.Conflict(project['revision'])
        document = annotation_document(project['id'], vid)
        expected_fingerprint = live_fingerprint(connection, project['id'], vid, project, document['frames'][vid])
    document['conventions']['delivery'] = 'Annotation-only snapshot validated for JSON structure and internal consistency. No media was rendered or included.'
    report = validate_document(document)
    validation_id = str(uuid.uuid4())
    report.update(validation_id=validation_id, mode='structural', revision=revision,
                  video_id=vid, project_id=project['id'], coverage=coverage, visual_confirmed=True,
                  created_at=db.now(), app_version=APP_VERSION)
    folder = DATA / 'validations' / validation_id
    path = folder / 'annotations.json'
    raw = None
    if report['passed']:
        raw = json.dumps(document, ensure_ascii=False, allow_nan=False, sort_keys=True).encode('utf-8')
        report.update(snapshot_path=str(path), snapshot_hash=hashlib.sha256(raw).hexdigest(), fingerprint=expected_fingerprint)
        folder.mkdir(parents=True)
        path.write_bytes(raw)
    try:
        with db.transaction() as connection:
            current = db.get_state(connection, project['id'])
            if current['revision'] != revision:
                raise db.Conflict(current['revision'])
            if live_fingerprint(connection, project['id'], vid, current) != expected_fingerprint:
                raise ValueError('Annotations changed during validation. Save and validate again.')
            connection.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', (validation_id, project['id'], vid, revision, '', json.dumps(report)))
            if report['passed']:
                video = current['videos'][vid]
                video.pop('review_job_id', None)
                video.update(finished_revision=revision, finished_at=db.now(), validation_id=validation_id,
                             coverage=coverage, finish_confirmation='Annotations confirmed for '+coverage)
                connection.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(video), vid))
    except Exception:
        if raw is not None:
            path.unlink(missing_ok=True)
            folder.rmdir()
        raise
    return report


def validation_proof(pid, settings, c=None):
    vid, revision = settings.get('video_id'), settings.get('revision')
    validation_id, review_id = settings.get('validation_id'), settings.get('review_job_id')
    if not vid or not validation_id or type(revision) is not int:
        raise ValueError('Save and pass annotation validation before exporting annotation JSON. Project backups are available at any time.')
    context = c or db.connect()
    try:
        row = context.execute('SELECT data FROM validations WHERE id=? AND project_id=? AND video_id=?', (validation_id, pid, vid)).fetchone()
        if not row: raise ValueError('Validation proof was not found for this video')
        report = json.loads(row['data'])
        if report.get('mode') == 'structural':
            if report.get('app_version') != APP_VERSION or not report['passed'] or report['revision'] != revision or report['project_id'] != pid or report['video_id'] != vid:
                raise ValueError('Validation proof does not match this export')
            project = db.get_state(context, pid)
            if project['revision'] != revision:
                raise db.Conflict(project['revision'])
            if live_fingerprint(context, pid, vid, project) != report['fingerprint']:
                raise ValueError('Validation is stale. Save and validate again after your edits.')
            read_document(report)  # Verify only the immutable annotation snapshot.
            return report, report
        if not review_id:
            raise ValueError('This older validation needs its review ID. Validate annotations again.')
        job = get_review(review_id)
        if report.get('app_version') != APP_VERSION or not report['passed'] or report['revision'] != revision or report['review_job_id'] != review_id or job['project_id'] != pid or job['video_id'] != vid or job['revision'] != revision:
            raise ValueError('Validation proof does not match this export')
        project = db.get_state(context, pid)
        if project['revision'] != revision: raise db.Conflict(project['revision'])
        if not current_matches(job, context): raise ValueError('Validation is stale. Generate and validate a new review after your edits.')
        if job['status'] != 'completed' or job['snapshot_hash'] != report['snapshot_hash'] or job.get('video_hash') != report['review_video_hash']:
            raise ValueError('Review proof is incomplete or does not match validation')
        if sha256(safe_path(job['snapshot_path'],DATA)) != job['snapshot_hash']:
            raise ValueError('The review snapshot has changed. Generate a new review.')
        verify_source({'videos':{vid:project['videos'][vid]}})
        return job, report
    finally:
        if c is None: context.close()


def validated_document(pid, settings):
    job, report = validation_proof(pid, settings)
    document = read_document(job)
    document['validation'] = report
    document['conventions']['scope'] = ('Annotator confirmed every person in the video.' if report['coverage'] == 'all_people' else 'Selected people only; no claim that every person in the video is annotated.')
    document['conventions']['validation_limitation'] = LIMITATION
    return document
