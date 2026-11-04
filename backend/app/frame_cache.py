"""Disposable exact-frame storage; annotation state and source ledgers stay intact."""
import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import HTTPException
from . import db
from .config import DATA

_ACTIVITY = {}
_ACTIVITY_LOCK = threading.RLock()
_ACTIVITY_TTL = 45


def activity(client_id, video_ids):
    # Leases expire after a crashed/closed browser, and never become saved data.
    with db.LOCK, _ACTIVITY_LOCK:
        now = time.monotonic()
        for key, (_, expires) in list(_ACTIVITY.items()):
            if expires < now:
                del _ACTIVITY[key]
        if video_ids:
            _ACTIVITY[client_id] = (set(video_ids), now + _ACTIVITY_TTL)
        else:
            _ACTIVITY.pop(client_id, None)
    return {'ok': True}


def _active(vid):
    with _ACTIVITY_LOCK:
        return any(vid in ids and expires > time.monotonic() for ids, expires in _ACTIVITY.values())


def _video(connection, vid):
    row = connection.execute('SELECT project_id,data FROM videos WHERE id=?', (vid,)).fetchone()
    if not row:
        raise KeyError('Video not found')
    return row['project_id'], json.loads(row['data'])


def cache_path(vid, data_root=None):
    # Imported IDs are normally UUIDs. Never let a restored identifier escape.
    root = Path(data_root or DATA) / 'frames'
    path = root / vid
    if path.parent != root or path.is_symlink():
        raise ValueError('Invalid frame-cache directory')
    return path


def cache_info(vid, data_root=None):
    with db.connect() as connection:
        _, video = _video(connection, vid)
    folder = cache_path(vid, data_root)
    size = count = 0
    try:
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.name.endswith('.png') and entry.is_file(follow_symlinks=False):
                    try:
                        size += entry.stat(follow_symlinks=False).st_size
                        count += 1
                    except FileNotFoundError:
                        pass
    except FileNotFoundError:
        pass  # An atomic clear may have just moved this directory.
    return {'video_id': vid, 'bytes': size, 'cached_frames': count,
            'state': video.get('frame_cache_status', 'ready'),
            'active': _active(vid), 'can_clear': video.get('status') == 'ready' and not _active(vid) and count > 0}


def _source_stamp(path):
    # Follow a source symlink for reading only; no source path is ever removed.
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def _verify_source_before_clear(video):
    from .video import sha256
    source = Path(video.get('source', ''))
    try:
        if not source.is_file():
            raise OSError('Source file is unavailable')
        before = _source_stamp(source)
        digest = sha256(source)
        after = _source_stamp(source)
    except OSError as error:
        raise HTTPException(409, 'The source video is unavailable. Restore it before clearing frames so this video can be reopened safely.') from error
    if not video.get('source_hash') or digest != video['source_hash'] or before != after:
        raise HTTPException(409, 'The source video has changed or cannot be verified. Restore the original source before clearing frames; your cached frames and annotations have been kept.')
    return source, after


def clear_cache(vid, data_root=None):
    folder = cache_path(vid, data_root)
    detached = folder.with_name(f'.cleared-{vid}-{uuid.uuid4()}')
    moved = False
    size = 0
    with db.connect() as connection:
        _, source_video = _video(connection, vid)
    # Hashing a long recording must not block frame requests or annotation saves.
    source, source_stamp = _verify_source_before_clear(source_video)
    try:
        # The same transaction lock protects job registration and exact frame reads.
        # Rename is atomic; slow directory removal happens after releasing SQLite.
        with db.transaction() as connection:
            pid, video = _video(connection, vid)
            jobs = [json.loads(row['data']) for row in connection.execute('SELECT data FROM jobs WHERE project_id=?', (pid,))]
            if video.get('status') != 'ready' or any(job.get('status') in ('queued', 'running') for job in jobs):
                raise HTTPException(409, 'Wait for video processing or exports to finish before clearing frame storage.')
            if _active(vid):
                raise HTTPException(409, 'This video is open in an annotation workspace. Close it in every tab, then clear its frame storage.')
            info = cache_info(vid, data_root)
            size = info['bytes']
            try:
                unchanged = (video.get('source') == source_video.get('source')
                             and video.get('source_hash') == source_video.get('source_hash')
                             and _source_stamp(source) == source_stamp)
            except OSError:
                unchanged = False
            if not unchanged:
                raise HTTPException(409, 'The source video changed while its integrity was being checked. No cached frames were removed. Restore the original source and try again.')
            if folder.exists():
                os.replace(folder, detached)
                moved = True
            video.update(frame_cache_status='cleared', frame_cache_bytes=0)
            connection.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(video), vid))
    except Exception:
        if moved and detached.exists() and not folder.exists():
            os.replace(detached, folder)
        raise
    warning = None
    if moved:
        try:
            shutil.rmtree(detached)
        except OSError:
            warning = 'The cache was detached, but some old frame files remain in the app cache because they are still in use.'
    return {'video_id': vid, 'cleared': True, 'bytes_freed': size if warning is None else 0, 'cleanup_warning': warning,
            'bytes': 0, 'cached_frames': 0, 'state': 'cleared', 'active': False, 'can_clear': False}


def prepare_cache(vid, data_root=None):
    from .video import POOL
    with db.transaction() as connection:
        pid, video = _video(connection, vid)
        state = video.get('frame_cache_status')
        missing_ready_cache = video.get('status') == 'ready' and video.get('frame_count', 0) > 0 and not cache_path(vid, data_root).exists()
        if state not in ('cleared', 'rebuilding', 'failed') and not missing_ready_cache:
            return {'video_id': vid, 'status': video['status'], 'rebuilding': False}
        if state == 'rebuilding' and video.get('status') == 'indexing':
            return {'video_id': vid, 'status': 'indexing', 'rebuilding': True}
        if not Path(video.get('source', '')).is_file():
            raise HTTPException(409, 'The source video is unavailable. Restore the original file before reopening this video.')
        video.update(status='indexing', frame_cache_status='rebuilding')
        video.pop('error', None)
        connection.execute('UPDATE videos SET data=? WHERE id=?', (json.dumps(video), vid))
        job = {'id': str(uuid.uuid4()), 'project_id': pid, 'kind': 'frame-cache', 'video_id': vid,
               'status': 'queued', 'progress': 0, 'error': None, 'created_at': db.now()}
        connection.execute('INSERT INTO jobs VALUES(?,?,?)', (job['id'], pid, json.dumps(job)))
    POOL.submit(rebuild_cache, vid, job['id'], data_root)
    return {'video_id': vid, 'status': 'indexing', 'rebuilding': True, 'job_id': job['id']}


def _remove_detached_caches(folder):
    # A process crash can leave a renamed directory behind. Only remove these
    # app-owned siblings once a complete replacement has been verified.
    prefix = f'.cleared-{folder.name}-'
    for candidate in folder.parent.iterdir():
        if not candidate.name.startswith(prefix) or candidate.is_symlink():
            continue
        try:
            if str(uuid.UUID(candidate.name[len(prefix):])) != candidate.name[len(prefix):]:
                continue
            if candidate.is_dir():
                shutil.rmtree(candidate)
        except (ValueError, OSError):
            pass


def rebuild_cache(vid, jid, data_root=None):
    import av
    from .video import sha256
    folder = cache_path(vid, data_root)
    try:
        db.job_update(jid, status='running', phase='Rebuilding exact frames')
        with db.connect() as connection:
            _, video = _video(connection, vid)
            ledger = {row['frame_index']: json.loads(row['data']) for row in connection.execute('SELECT frame_index,data FROM frames WHERE video_id=?', (vid,))}
        source = Path(video['source'])
        if not video.get('source_hash') or sha256(source) != video['source_hash']:
            raise ValueError('The source video has changed. Restore the original source; existing annotations have been kept.')
        folder.mkdir(parents=True, exist_ok=True)
        total_bytes = count = 0
        with av.open(str(source)) as container:
            stream = next((stream for stream in container.streams.video if stream.index == video.get('stream_index', 0)), None)
            if stream is None:
                raise ValueError('The original video stream is unavailable')
            for index, frame in enumerate(container.decode(stream)):
                if index % 20 == 0 and db.job_get(jid)['status'] == 'cancelled':
                    raise ValueError('Frame preparation was cancelled. Reopen the video to try again.')
                saved = ledger.get(index)
                tb = frame.time_base or stream.time_base
                if (saved is None or frame.width != video['width'] or frame.height != video['height']
                        or frame.pts != saved.get('pts') or tb.numerator != saved.get('time_base_num')
                        or tb.denominator != saved.get('time_base_den')):
                    raise ValueError('Decoded frames no longer match the saved source ledger. Existing annotations have been kept.')
                path = folder / f'{index:08d}.png'
                temporary = path.with_suffix('.tmp')
                frame.to_image().save(temporary, format='PNG', compress_level=1)
                os.replace(temporary, path)
                total_bytes += path.stat().st_size
                count = index + 1
                if count % 32 == 0:
                    db.job_update(jid, progress=count, total=video['frame_count'])
            if count != video['frame_count'] or count != len(ledger):
                raise ValueError('Decoded frame count differs from the saved video. Existing annotations have been kept.')
        _remove_detached_caches(folder)
        db.update_video(vid, status='ready', frame_cache_status='ready', frame_cache_bytes=total_bytes)
        db.job_update(jid, status='completed', progress=count, total=count)
    except Exception as error:
        db.update_video(vid, status='failed', frame_cache_status='failed', error=str(error))
        db.job_update(jid, status='failed', error=str(error))
