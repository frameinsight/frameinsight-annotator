"""Sequential decode ledger + lossless PNG cache. No timestamp-based approximate seeks."""
import hashlib
import json
import os
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
import av
from .config import DATA
from .db import transaction, update_video, job_update, job_get, now
POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix='index')

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while block := f.read(4 * 1024 * 1024): h.update(block)
    return h.hexdigest()

def new_job(project_id, kind, **extra):
    data = {'id': str(uuid.uuid4()), 'project_id': project_id, 'kind': kind, 'status': 'queued', 'progress': 0, 'error': None, 'created_at': now(), **extra}
    with transaction() as c: c.execute('INSERT INTO jobs VALUES(?,?,?)', (data['id'], project_id, json.dumps(data)))
    return data

def import_video(pid, source, name=None):
    vid = str(uuid.uuid4())
    target = DATA / 'originals' / (vid + source.suffix.lower())
    # Preserve the source; indexing and hashing happen off the API request path.
    video = {'id': vid, 'project_id': pid, 'name': name or source.name, 'source': str(target), 'source_hash': None, 'width': 0, 'height': 0, 'frame_count': 0, 'nominal_fps': 0, 'status': 'indexing', 'stream_index': 0, 'decoder': f'PyAV {av.__version__}', 'session': pid}
    with transaction() as c: c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(video)))
    job = new_job(pid, 'index', video_id=vid)
    POOL.submit(index_video, vid, source, target, job['id'])
    return {'video_id': vid, 'job_id': job['id']}

def index_video(vid, source, target, jid):
    cache = DATA / 'frames' / vid
    cache.mkdir(exist_ok=True)
    try:
        job_update(jid, status='running', phase='Copying video')
        if target.exists() and os.path.samefile(source, target):
            raise ValueError('Source video and app-owned copy must be different files')
        digest = hashlib.sha256()
        # Copy and hash in one pass rather than reading the entire recording twice.
        with open(source, 'rb') as incoming, open(target, 'wb') as outgoing:
            while block := incoming.read(4 * 1024 * 1024):
                outgoing.write(block)
                digest.update(block)
        digest = digest.hexdigest()
        job_update(jid, phase='Preparing exact frames')
        with av.open(str(target)) as container:
            stream = container.streams.video[0]
            width, height = stream.codec_context.width, stream.codec_context.height
            update_video(vid, width=width, height=height, nominal_fps=float(stream.average_rate or 0), stream_index=stream.index, source_hash=digest)
            count = 0
            pending = []
            last_flush = time.monotonic()
            def flush():
                nonlocal last_flush
                if not pending: return
                # A frame is advertised only after its PNG and ledger row exist.
                with transaction() as c:
                    c.executemany('INSERT OR REPLACE INTO frames VALUES(?,?,?)', pending)
                    row = c.execute('SELECT data FROM videos WHERE id=?', (vid,)).fetchone()
                    data = json.loads(row['data'])
                    data['frame_count'] = count
                    c.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(data), vid))
                pending.clear()
                job_update(jid, progress=count, total=stream.frames or None)
                last_flush = time.monotonic()
            for i, frame in enumerate(container.decode(stream)):
                if i % 20 == 0 and job_get(jid)['status'] == 'cancelled':
                    flush()
                    update_video(vid, status='cancelled'); return
                if frame.width != width or frame.height != height: raise ValueError('Video changes dimensions mid-stream; split it into constant-size clips first')
                path = cache / f'{i:08d}.png'
                tmp = path.with_suffix('.tmp')
                frame.to_image().save(tmp, format='PNG', compress_level=1)
                os.replace(tmp, path)
                tb = frame.time_base or stream.time_base
                data = {'frame_index': i, 'pts': frame.pts, 'time_base_num': tb.numerator, 'time_base_den': tb.denominator, 'seconds': float(frame.pts * tb) if frame.pts is not None else None, 'key_frame': frame.key_frame, 'decode_state': 'ready'}
                pending.append((vid, i, json.dumps(data)))
                count = i + 1
                if len(pending) >= 32 or time.monotonic() - last_flush >= .5: flush()
            flush()
            if not count: raise ValueError('The selected stream contains no decodable frames')
            update_video(vid, status='ready', frame_count=count)
            job_update(jid, status='completed', progress=count, total=count)
    except Exception as e:
        update_video(vid, status='failed', error=str(e))
        job_update(jid, status='failed', error=str(e))
