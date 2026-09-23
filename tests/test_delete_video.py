import json
import uuid
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import db
from backend.app import delete_video as deletion


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'db.sqlite3')
    monkeypatch.setattr(deletion, 'DATA', tmp_path / 'data')
    for name in ['frames', 'originals', 'exports']:
        (deletion.DATA / name).mkdir(parents=True)
    with TestClient(app) as client:
        yield client


def add_video(pid, source=None):
    vid = str(uuid.uuid4())
    data = {'id': vid, 'project_id': pid, 'name': 'clip.mp4', 'status': 'ready', 'frame_count': 24,
            'width': 640, 'height': 360, 'source': str(source) if source else str(deletion.DATA / 'originals' / (vid + '.mp4'))}
    with db.transaction() as c:
        c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(data)))
    return data


def test_delete_requires_confirmation_and_removes_app_data_not_original(client, tmp_path):
    pid = client.post('/api/projects', json={'name': 'Delete test'}).json()['id']
    video = add_video(pid); vid = video['id']
    original = tmp_path / 'my-original.mp4'; original.write_bytes(b'original')
    copied = deletion.DATA / 'originals' / (vid + '.mp4'); copied.write_bytes(original.read_bytes())
    frame_dir = deletion.DATA / 'frames' / vid; frame_dir.mkdir(); (frame_dir / '0.png').write_bytes(b'cache')
    export = deletion.DATA / 'exports' / 'test.json'; export.write_text('{}')
    with db.transaction() as c:
        c.execute('INSERT INTO frames VALUES(?,?,?)', (vid, 0, '{}'))
        c.execute('INSERT INTO exports VALUES(?,?,?)', ('export', pid, json.dumps({'path': str(export), 'settings': {'video_id': vid, 'format': 'annotations_json'}})))
    assert client.delete('/api/videos/' + vid).status_code == 422
    assert copied.exists()
    response = client.delete('/api/videos/' + vid + '?confirmed=true')
    assert response.status_code == 200 and not response.json()['project_deleted']
    assert original.read_bytes() == b'original'
    assert not copied.exists() and not frame_dir.exists() and not export.exists()
    assert client.get('/api/video-library').json() == []
    assert client.get('/api/projects/' + pid).json()['videos'] == {}
    assert client.delete('/api/videos/' + vid + '?confirmed=true').status_code == 404


def test_delete_preserves_other_video_shared_identity_and_external_source(client, tmp_path):
    pid = client.post('/api/projects', json={'name': 'Shared project'}).json()['id']
    original = tmp_path / 'external.mp4'; original.write_bytes(b'keep this')
    first, other = add_video(pid, original), add_video(pid)
    with db.transaction() as c:
        for identity in ['shared', 'only-first']:
            c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, 'identities', identity, json.dumps({'id': identity, 'person_id': None, 'name': identity})))
        for sid, who, vid in [('s1', 'shared', first['id']), ('s2', 'shared', other['id']), ('s3', 'only-first', first['id'])]:
            c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, 'segments', sid, json.dumps({'id': sid, 'identity_uuid': who, 'video_id': vid, 'start': 0, 'end': None, 'status': 'verified'})))
    before = client.get('/api/projects/' + pid).json()
    result = client.delete('/api/videos/' + first['id'] + '?confirmed=true')
    assert result.status_code == 200 and not result.json()['project_deleted']
    after = client.get('/api/projects/' + pid).json()
    assert list(after['videos']) == [other['id']]
    assert list(after['state']['identities']) == ['shared']
    assert after['state']['segments'] == {'s2': before['state']['segments']['s2']}
    assert after['revision'] == before['revision'] + 1
    assert original.read_bytes() == b'keep this'


def test_delete_waits_for_processing_and_exports(client):
    pid = client.post('/api/projects', json={'name': 'Busy project'}).json()['id']
    video = add_video(pid)
    with db.transaction() as c:
        c.execute('INSERT INTO jobs VALUES(?,?,?)', ('busy', pid, json.dumps({'id': 'busy', 'status': 'running', 'kind': 'export'})))
    assert client.delete('/api/videos/' + video['id'] + '?confirmed=true').status_code == 409
    assert len(client.get('/api/video-library').json()) == 1


def test_delete_last_video_keeps_project_event_stream(client):
    from starlette.websockets import WebSocketDisconnect
    pid = client.post('/api/projects', json={'name': 'Open stream'}).json()['id']
    video = add_video(pid)
    with client.websocket_connect('/api/projects/' + pid + '/events', headers={'origin': 'http://127.0.0.1:8765'}) as ws:
        assert ws.receive_json()['project_id'] == pid
        assert client.delete('/api/videos/' + video['id'] + '?confirmed=true').status_code == 200
        assert ws.receive_json()['project_id'] == pid
