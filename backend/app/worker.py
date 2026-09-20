"""One spawned, resident model process; proposals never modify annotation entities."""
import hashlib
import json
import multiprocessing as mp
import queue
import uuid
from pathlib import Path
from .config import DATA, MODELS, safe_path
from .db import connect, transaction, job_get, job_update
from .video import sha256, new_job
ADAPTER_VERSION = 'ultralytics-original-xyxy-v1'

def proposal_identifier(video_id, cache_key, frame_index, candidate_index):
    # Two imports of identical footage share content hashes but not ownership.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'{video_id}:{cache_key}:{frame_index}:{candidate_index}'))

class Worker:
    def __init__(self):
        self.ctx = mp.get_context('spawn')
        self.queue = self.ctx.Queue(maxsize=4)
        self.process = None
    def start(self):
        if not self.process or not self.process.is_alive():
            self.process = self.ctx.Process(target=run_worker, args=(self.queue,), daemon=True)
            self.process.start()
    def enqueue(self, pid, vid, settings):
        safe_path(settings['model'], MODELS)
        self.start()
        job = new_job(pid, 'proposals', video_id=vid, settings=settings)
        try: self.queue.put_nowait(job['id'])
        except queue.Full:
            job_update(job['id'], status='failed', error='Proposal queue is full (4 jobs). Wait or cancel a queued job.')
        return job_get(job['id'])
    def status(self):
        alive=bool(self.process and self.process.is_alive())
        if self.process and not alive:
            with transaction() as c:
                for row in c.execute('SELECT id,data FROM jobs').fetchall():
                    j=json.loads(row['data'])
                    if j['kind']=='proposals' and j['status']=='running':
                        j.update(status='failed',error='GPU worker exited unexpectedly. Manual edits and cached proposals are safe; restart the pass.')
                        c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(j),row['id']))
        return {'running':alive,'pid':self.process.pid if alive else None}

    def stop(self):
        if self.process and self.process.is_alive():
            self.process.terminate(); self.process.join(5)
        with transaction() as c:
            rows = c.execute('SELECT id,data FROM jobs').fetchall()
            for row in rows:
                j = json.loads(row['data'])
                if j['kind'] == 'proposals' and j['status'] in ('running', 'queued'):
                    j.update(status='failed', error='Worker stopped; existing proposals remain available. Start a new pass to resume cached work.')
                    c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(j), row['id']))
        self.queue = self.ctx.Queue(maxsize=4)

def run_worker(work_queue):
    model = None; loaded = None
    while True:
        jid = work_queue.get()
        try:
            job = job_get(jid)
            if job['status'] == 'cancelled': continue
            job_update(jid, status='running', phase='Loading trusted model')
            from ultralytics import YOLO
            import torch
            settings = job['settings']
            path = safe_path(settings['model'], MODELS)
            digest = sha256(path)
            if loaded != digest:
                model = YOLO(str(path)); loaded = digest
            names = {str(k): v for k, v in model.names.items()}
            mapping = settings['class_mapping']
            if set(mapping) != set(names): raise ValueError(f'Class mapping must explicitly cover model classes: {names}')
            if any(v not in ('person_ext', 'person_visible', 'ignore') for v in mapping.values()): raise ValueError('Invalid geometry class mapping')
            device = settings['device']
            if device != 'cpu' and not torch.cuda.is_available(): raise ValueError('CUDA unavailable. Select CPU explicitly or repair the GPU installation.')
            with connect() as c: video = json.loads(c.execute('SELECT data FROM videos WHERE id=?', (job['video_id'],)).fetchone()['data'])
            if video['status'] != 'ready': raise ValueError('Wait for exact-frame indexing to finish before starting the detector pass')
            cache_key = hashlib.sha256(json.dumps({'source': video['source_hash'], 'stream': video['stream_index'], 'model': digest, 'settings': settings, 'names': names, 'adapter': ADAPTER_VERSION}, sort_keys=True).encode()).hexdigest()
            total = video['frame_count']; batch_size = settings['batch_size']
            with connect() as c:
                done = {r['frame_index'] for r in c.execute('SELECT frame_index FROM proposal_frames WHERE video_id=? AND cache_key=?', (video['id'], cache_key))}
            ledger = [n for n in range(total) if n not in done]; retry_count = 0
            job_update(jid, total=total, progress=len(done), cached_frames=len(done), cache_key=cache_key, class_names=names, phase=f'Inference on {device}')
            while ledger:
                job = job_get(jid)
                if job['status'] == 'cancelled': break
                priority = job.get('priority_frame')
                if priority in ledger: ledger.remove(priority); ledger.insert(0, priority)
                batch = ledger[:batch_size]
                paths = [str(DATA / 'frames' / video['id'] / f'{f:08d}.png') for f in batch]
                try:
                    results = model.predict(paths, conf=settings['confidence'], imgsz=settings['imgsz'], device=device, verbose=False, agnostic_nms=False)
                except torch.cuda.OutOfMemoryError:
                    if batch_size <= 1 or retry_count >= 3: raise
                    batch_size = max(1, batch_size // 2); retry_count += 1
                    torch.cuda.empty_cache()
                    job_update(jid, effective_batch_size=batch_size, memory_retries=retry_count)
                    continue
                if len(results) != len(batch): raise ValueError('Detector output count differs from exact input-frame ledger')
                with transaction() as c:
                    for frame_index, result in zip(batch, results, strict=True):
                        expected = DATA / 'frames' / video['id'] / f'{frame_index:08d}.png'
                        if Path(result.path).resolve() != expected.resolve() or tuple(result.orig_shape) != (video['height'], video['width']):
                            raise ValueError('Detector output path or image dimensions disagree with the source-frame ledger')
                        for n, box in enumerate(result.boxes):
                            class_id = int(box.cls.item()); geometry = mapping[str(class_id)]
                            if geometry == 'ignore': continue
                            coords = box.xyxy[0].tolist()
                            coords = [max(0, min(video['width'] if i % 2 == 0 else video['height'], x)) for i, x in enumerate(coords)]
                            if coords[0] >= coords[2] or coords[1] >= coords[3]: continue
                            ident = proposal_identifier(video['id'], cache_key, frame_index, n)
                            p = {'id': ident, 'video_id': video['id'], 'frame_index': frame_index, 'geometry': geometry, 'box': coords, 'confidence': float(box.conf.item()), 'class_id': class_id, 'class_name': names[str(class_id)], 'cache_key': cache_key, 'model_hash': digest, 'adapter_version': ADAPTER_VERSION}
                            c.execute('INSERT OR REPLACE INTO proposals VALUES(?,?,?,?,?)', (ident, video['id'], frame_index, cache_key, json.dumps(p)))
                        c.execute('INSERT OR IGNORE INTO proposal_frames VALUES(?,?,?)', (video['id'], cache_key, frame_index))
                done.update(batch); del ledger[:len(batch)]
                job_update(jid, progress=len(done), effective_batch_size=batch_size)
            else: job_update(jid, status='completed', phase='Cached proposals ready')
        except Exception as e:
            job_update(jid, status='failed', error=f'{type(e).__name__}: {e}')
