import json
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend.app import assistance, db, tracking
from backend.app.video import new_job


@pytest.fixture
def setup(monkeypatch, tmp_path):
    db.init()
    pid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    video = {'id': vid, 'project_id': pid, 'name': 'tracking fixture', 'width': 640,
             'height': 360, 'frame_count': 6, 'status': 'ready', 'source_hash': 'fixture-hash'}
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', (pid, 'assistance test', db.now()))
        c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(video)))
    for name in (*tracking.OFFICIAL_MODELS, tracking.REID_MODEL):
        (tmp_path / name).write_text('trusted test artifact ' + name)
    monkeypatch.setattr(tracking, 'MODELS', tmp_path)
    monkeypatch.setattr(assistance, 'MODELS', tmp_path)
    monkeypatch.setattr(tracking, 'model_file', lambda name: tmp_path / name)
    monkeypatch.setattr(tracking, 'tracker_config', lambda settings, reid: tmp_path / 'config.yaml')
    monkeypatch.setattr(tracking.importlib.metadata, 'version', lambda package: 'test-version')
    monkeypatch.setattr(assistance, 'runtime_status', lambda: {'available': True, 'gpu': 'Test GPU', 'trackers': ['botsort', 'tracktrack']})

    class Worker:
        def enqueue(self, project_id, video_id, settings):
            return new_job(project_id, 'proposals', video_id=video_id, settings=settings)
    app = FastAPI()
    app.state.assistance_worker = Worker()
    app.include_router(assistance.router)
    @app.exception_handler(ValueError)
    async def bad(request, e): return JSONResponse({'detail': str(e)}, status_code=422)
    @app.exception_handler(KeyError)
    async def missing(request, e): return JSONResponse({'detail': str(e)}, status_code=404)
    with TestClient(app) as client:
        yield client, pid, vid, video


def test_status_and_reject_unsupported_checkpoint_or_invalid_settings(setup):
    client, _, vid, _ = setup
    status = client.get('/api/assist/status').json()
    assert status['available'] and status['default_model'] == 'yolo26m.pt'
    assert all(m['installed'] for m in status['models'])
    for body in ({'model': '../../untrusted.pt'}, {'tracker': 'invented'}, {'imgsz': 641}, {'confidence': .9}):
        assert client.post(f'/api/videos/{vid}/assist', json=body).status_code == 422


def test_absent_ai_runtime_does_not_break_status_or_manual_use(setup, monkeypatch):
    client, _, vid, _ = setup
    monkeypatch.setattr(assistance, 'runtime_status', lambda: {'available': False, 'gpu': None, 'error': 'AI dependencies missing'})
    assert client.get('/api/assist/status').json()['available'] is False
    assert client.post(f'/api/videos/{vid}/assist', json={}).status_code == 422
    assert client.get(f'/api/videos/{vid}/tracks').json()['tracks'] == []


class FakeTracker:
    seen = []
    def __init__(self, path, config, settings):
        self.seen = []
        type(self).seen = self.seen
    def frame(self, path):
        frame = int(path.stem)
        self.seen.append(frame)
        rows = [{'box': [10+frame, 10, 50+frame, 100], 'confidence': .8, 'class_id': 0, 'track_id': '1'}]
        if frame >= 3:
            rows.append({'box': [200, 20, 240, 110], 'confidence': .7, 'class_id': 0, 'track_id': '2'})
        return {'path': str(path), 'shape': (360, 640), 'rows': rows}


def test_whole_video_order_late_entry_cache_reuse_and_annotation_isolation(setup):
    client, pid, vid, _ = setup
    before = db.snapshot(pid)
    job = client.post(f'/api/videos/{vid}/assist', json={}).json()
    assert job['settings']['device'] == '0' and job['settings']['confidence'] == .1
    assert client.post(f'/api/videos/{vid}/assist', json={}).json()['id'] == job['id']
    db.job_update(job['id'], priority_frame=5, status='running')
    tracking.run_tracking_job(db.job_get(job['id']), FakeTracker)
    assert FakeTracker.seen == list(range(6))  # UI priority cannot reorder stateful inference.
    summary = client.get(f'/api/videos/{vid}/tracks').json()
    assert summary['complete'] and summary['processed_frames'] == 6
    assert [(t['start'], t['end'], t['count']) for t in summary['tracks']] == [(0, 5, 6), (3, 5, 3)]
    late = summary['tracks'][1]
    detail = client.get(f'/api/videos/{vid}/tracks/{late["id"]}', params={'cache_key': summary['cache_key']}).json()
    assert [p['frame_index'] for p in detail['proposals']] == [3, 4, 5]
    again = client.post(f'/api/videos/{vid}/assist', json={}).json()
    assert again['id'] == job['id'] and again['reused']
    assert db.snapshot(pid) == before


def test_cancel_mid_frame_is_not_written_and_restart_replays_from_zero(setup):
    client, _, vid, _ = setup
    job = client.post(f'/api/videos/{vid}/assist', json={}).json()
    class CancelTracker(FakeTracker):
        def frame(self, path):
            output = super().frame(path)
            if path.stem == '00000002': db.job_update(job['id'], status='cancelled')
            return output
    tracking.run_tracking_job(job, CancelTracker)
    assert db.job_get(job['id'])['status'] == 'cancelled'
    with db.connect() as c:
        assert [r[0] for r in c.execute('SELECT DISTINCT frame_index FROM proposals WHERE video_id=? ORDER BY frame_index', (vid,))] == [0, 1]
    resumed = client.post(f'/api/videos/{vid}/assist', json={}).json()
    assert resumed['id'] != job['id']
    tracking.run_tracking_job(resumed, FakeTracker)
    assert FakeTracker.seen == [0, 1, 2, 3, 4, 5]
    assert client.get(f'/api/videos/{vid}/tracks').json()['complete']


def test_cache_is_scoped_to_video_and_changed_model_bytes(setup):
    client, _, vid, video = setup
    job = client.post(f'/api/videos/{vid}/assist', json={}).json()
    first = tracking.request_key(video, job['settings'])
    assert tracking.request_key({**video, 'id': 'other-video'}, job['settings']) != first
    (tracking.MODELS / 'yolo26m.pt').write_text('new weights')
    assert tracking.request_key(video, job['settings']) != first


def test_review_flags_for_gap_size_jump_and_low_confidence():
    old = {'frame_index': 1, 'box': [0, 0, 20, 100], 'confidence': .9}
    new = {'frame_index': 8, 'box': [300, 0, 400, 250], 'confidence': .2}
    reason = tracking.issue_for(old, new)
    assert 'Reappeared' in reason and 'position' in reason and 'size' in reason and 'confidence' in reason


def test_overlap_review_aid_and_cancel_wins_over_completion(setup):
    client, _, vid, _ = setup
    rows = [{'track_id': 'one', 'box': [10, 10, 100, 100]},
            {'track_id': 'two', 'box': [20, 10, 110, 100]},
            {'track_id': 'three', 'box': [200, 20, 240, 100]}]
    tracking.flag_overlaps(rows)
    assert 'overlap' in rows[0]['track_issue'] and 'overlap' in rows[1]['track_issue']
    assert 'track_issue' not in rows[2]
    job = client.post(f'/api/videos/{vid}/assist', json={}).json()
    db.job_update(job['id'], status='cancelled')
    tracking.finish_job(job['id'], progress=6)
    assert db.job_get(job['id'])['status'] == 'cancelled'


def test_mismatched_exact_frame_output_rejected(setup):
    client, _, vid, _ = setup
    job = client.post(f'/api/videos/{vid}/assist', json={}).json()
    class WrongFrame(FakeTracker):
        def frame(self, path): return {**super().frame(path), 'path': str(path.with_name('00000005.png'))}
    with pytest.raises(ValueError, match='exact source-frame'):
        tracking.run_tracking_job(job, WrongFrame)
    with db.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM proposals WHERE video_id=?', (vid,)).fetchone()[0] == 0
