"""Frame storage is disposable; immutable source coordinates and annotation data are not."""
import io
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import av
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend.app import db, main, video, frame_cache


@pytest.fixture
def cached_video(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'cache.sqlite3')
    for module in (main, video, frame_cache):
        monkeypatch.setattr(module, 'DATA', tmp_path)
    (tmp_path / 'frames').mkdir()
    db.init()
    frame_cache._ACTIVITY.clear()
    source, target = tmp_path / 'source.mkv', tmp_path / 'copy.mkv'
    with av.open(str(source), 'w') as output:
        stream = output.add_stream('ffv1', rate=25)
        stream.width, stream.height, stream.pix_fmt = 48, 32, 'bgr0'
        for index in range(12):
            for packet in stream.encode(av.VideoFrame.from_image(Image.new('RGB', (48, 32), (index * 20, 10, 30)))):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)
    pid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with db.transaction() as connection:
        connection.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', (pid, 'Keep annotations', db.now()))
        connection.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps({'id':vid, 'project_id':pid, 'status':'indexing', 'source':str(target), 'frame_count':0})))
        # Saved annotation/history bytes are compared directly: cache management
        # must not touch these records or the project's annotation revision.
        connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, 'identities', 'person', json.dumps({'id':'person','person_id':7})))
        connection.execute('INSERT INTO operations VALUES(?,?,?,?,?)', ('saved-history', pid, 1, '{"changes":[]}', db.now()))
    job = video.new_job(pid, 'index', video_id=vid)
    video.index_video(vid, source, target, job['id'])
    assert db.job_get(job['id'])['status'] == 'completed'
    return pid, vid, source, target


def saved_records(pid, vid):
    with db.connect() as connection:
        return [list(map(tuple, connection.execute(sql, values).fetchall())) for sql, values in (
            ('SELECT * FROM entities WHERE project_id=?', (pid,)),
            ('SELECT * FROM operations WHERE project_id=?', (pid,)),
            ('SELECT * FROM frames WHERE video_id=? ORDER BY frame_index', (vid,)),
            ('SELECT * FROM projects WHERE id=?', (pid,)))]


def wait_job(jid):
    until = time.monotonic() + 10
    while time.monotonic() < until:
        job = db.job_get(jid)
        if job['status'] not in ('queued','running'):
            return job
        time.sleep(.02)
    raise AssertionError('Frame regeneration did not finish')


def test_clear_and_reopen_preserve_every_annotation_and_exact_source_index(cached_video):
    pid, vid, source, target = cached_video
    before = saved_records(pid, vid)
    originals = (source.read_bytes(), target.read_bytes())
    with TestClient(main.app) as client:
        info = client.get(f'/api/videos/{vid}/frame-cache').json()
        assert info['bytes'] > 0 and info['cached_frames'] == 12 and info['can_clear']
        assert client.delete(f'/api/videos/{vid}/frame-cache').status_code == 422
        cleared = client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true')
        assert cleared.status_code == 200
        assert cleared.json()['bytes_freed'] == info['bytes']
        assert saved_records(pid, vid) == before
        assert (source.read_bytes(), target.read_bytes()) == originals
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['bytes'] == 0
        prepared = client.post(f'/api/videos/{vid}/frame-cache/prepare').json()
        assert prepared['rebuilding']
        assert wait_job(prepared['job_id'])['status'] == 'completed'
        assert saved_records(pid, vid) == before
        assert (source.read_bytes(), target.read_bytes()) == originals
        for index in (0, 5, 11):
            response = client.get(f'/api/videos/{vid}/frames/{index}')
            assert response.status_code == 200
            with Image.open(io.BytesIO(response.content)) as image:
                assert image.getpixel((20, 20)) == (index * 20, 10, 30)
        assert client.post(f'/api/videos/{vid}/frame-cache/prepare').json()['rebuilding'] is False


def test_open_video_activity_and_background_jobs_prevent_clearing(cached_video):
    pid, vid, _, _ = cached_video
    with TestClient(main.app) as client:
        assert client.post('/api/frame-cache/activity', json={'client_id':'tab1','video_ids':[vid]}).status_code == 200
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['active']
        assert client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true').status_code == 409
        client.post('/api/frame-cache/activity', json={'client_id':'tab1','video_ids':[]})
        job = video.new_job(pid, 'export', settings={})
        assert client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true').status_code == 409
        db.job_update(job['id'], status='completed')
        assert client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true').status_code == 200


def test_missing_source_cannot_destroy_remaining_decoded_frames(cached_video):
    _, vid, _, target = cached_video
    target.unlink()
    with TestClient(main.app) as client:
        response = client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true')
        assert response.status_code == 409 and 'source' in response.json()['detail'].lower()
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['cached_frames'] == 12


def test_changed_source_never_realigns_saved_annotations(cached_video):
    pid, vid, _, target = cached_video
    before = saved_records(pid, vid)
    with TestClient(main.app) as client:
        client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true')
        target.write_bytes(target.read_bytes() + b'changed')
        prepared = client.post(f'/api/videos/{vid}/frame-cache/prepare').json()
        job = wait_job(prepared['job_id'])
        assert job['status'] == 'failed' and 'source video has changed' in job['error']
        assert saved_records(pid, vid) == before
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['cached_frames'] == 0


def test_concurrent_prepare_requests_share_a_single_rebuild(cached_video, monkeypatch):
    pid, vid, _, _ = cached_video
    submitted = []
    monkeypatch.setattr(video.POOL, 'submit', lambda *args: submitted.append(args))
    frame_cache.clear_cache(vid)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: frame_cache.prepare_cache(vid), range(8)))
    assert all(result['rebuilding'] for result in results)
    assert len(submitted) == 1
    with db.connect() as connection:
        jobs = [json.loads(row['data']) for row in connection.execute('SELECT data FROM jobs WHERE project_id=?', (pid,))]
    assert len([job for job in jobs if job['kind']=='frame-cache']) == 1


def test_stale_browser_lease_expires(cached_video, monkeypatch):
    _, vid, _, _ = cached_video
    clock = [1000.]
    monkeypatch.setattr(frame_cache.time, 'monotonic', lambda: clock[0])
    frame_cache.activity('crashed-tab', [vid])
    assert frame_cache.cache_info(vid)['active']
    clock[0] += 46
    assert frame_cache.clear_cache(vid)['cleared']


def test_frame_request_after_clear_schedules_rebuild_without_missing_frame_failure(cached_video):
    _, vid, _, _ = cached_video
    frame_cache.clear_cache(vid)
    with TestClient(main.app) as client:
        response = client.get(f'/api/videos/{vid}/frames/5')
        assert response.status_code == 409
        assert response.headers['retry-after'] == '1'
        with db.connect() as connection:
            jobs = [json.loads(row['data']) for row in connection.execute('SELECT data FROM jobs')]
        job = next(job for job in jobs if job['kind']=='frame-cache')
        assert wait_job(job['id'])['status'] == 'completed'
        assert client.get(f'/api/videos/{vid}/frames/5').status_code == 200


def test_corrupt_saved_ledger_is_rejected_without_replacing_it(cached_video):
    pid, vid, _, _ = cached_video
    frame_cache.clear_cache(vid)
    with db.transaction() as connection:
        row = json.loads(connection.execute('SELECT data FROM frames WHERE video_id=? AND frame_index=0', (vid,)).fetchone()['data'])
        row['pts'] = 99999
        connection.execute('UPDATE frames SET data=? WHERE video_id=? AND frame_index=0', (json.dumps(row), vid))
    before = saved_records(pid, vid)
    prepared = frame_cache.prepare_cache(vid)
    job = wait_job(prepared['job_id'])
    assert job['status'] == 'failed' and 'saved source ledger' in job['error']
    assert saved_records(pid, vid) == before


def test_replaced_source_before_clear_keeps_last_valid_frames(cached_video):
    pid, vid, _, target = cached_video
    before = saved_records(pid, vid)
    frames = {path.name:path.read_bytes() for path in (frame_cache.DATA / 'frames' / vid).glob('*.png')}
    target.write_bytes(b'The source recording was replaced')
    with TestClient(main.app) as client:
        response = client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true')
        assert response.status_code == 409
        assert 'source video has changed' in response.json()['detail']
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['cached_frames'] == 12
    assert saved_records(pid, vid) == before
    assert {path.name:path.read_bytes() for path in (frame_cache.DATA / 'frames' / vid).glob('*.png')} == frames


def test_source_changed_after_hash_before_clear_is_rejected(cached_video, monkeypatch):
    pid, vid, _, target = cached_video
    before = saved_records(pid, vid)
    verify = frame_cache._verify_source_before_clear

    def replace_after_verification(record):
        verified = verify(record)
        target.write_bytes(b'Changed after hashing but before deletion lock')
        return verified

    monkeypatch.setattr(frame_cache, '_verify_source_before_clear', replace_after_verification)
    with TestClient(main.app) as client:
        response = client.delete(f'/api/videos/{vid}/frame-cache?confirmed=true')
        assert response.status_code == 409
        assert 'changed while' in response.json()['detail']
        assert client.get(f'/api/videos/{vid}/frame-cache').json()['cached_frames'] == 12
    assert saved_records(pid, vid) == before


def test_hash_does_not_hold_database_transaction_lock(cached_video, monkeypatch):
    _, vid, _, _ = cached_video
    original_hash = video.sha256

    def checked_hash(path):
        # A different thread can save/read while the original is hashed.
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(lambda: (db.LOCK.acquire(timeout=.5), db.LOCK.release()))
            assert future.result()[0]
        return original_hash(path)

    monkeypatch.setattr(video, 'sha256', checked_hash)
    assert frame_cache.clear_cache(vid)['cleared']


@pytest.mark.parametrize('entrypoint', ['prepare', 'frame'])
def test_interrupted_directory_clear_recovers_when_database_still_says_ready(cached_video, entrypoint):
    pid, vid, _, _ = cached_video
    before = saved_records(pid, vid)
    folder = frame_cache.DATA / 'frames' / vid
    detached = folder.with_name(f'.cleared-{vid}-{uuid.uuid4()}')
    folder.rename(detached)
    # Simulate power loss after rename, before SQL commit: old status persisted.
    assert db.snapshot(pid)['videos'][vid]['frame_cache_status'] == 'ready'
    with TestClient(main.app) as client:
        if entrypoint == 'prepare':
            response = client.post(f'/api/videos/{vid}/frame-cache/prepare')
            assert response.status_code == 200 and response.json()['rebuilding']
        else:
            response = client.get(f'/api/videos/{vid}/frames/5')
            assert response.status_code == 409
        with db.connect() as connection:
            jobs = [json.loads(row['data']) for row in connection.execute('SELECT data FROM jobs')]
        job = next(job for job in jobs if job['kind']=='frame-cache')
        assert wait_job(job['id'])['status'] == 'completed'
        assert client.get(f'/api/videos/{vid}/frames/5').status_code == 200
    assert saved_records(pid, vid) == before
    assert not detached.exists()
