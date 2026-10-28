"""Permanent project removal must be scoped, revision checked, and source safe."""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import db, delete_project as deletion
from backend.app.main import app
from backend.app.multicam import insert_session
from backend.app.schema import MODELS
from backend.app.video import new_job


def test_cancelled_export_finishing_after_project_deletion_leaves_no_orphans(client, monkeypatch):
    from backend.app import formats
    monkeypatch.setattr(formats, 'DATA', deletion.DATA)
    pid = project(client)
    job = new_job(pid, 'export')
    original_zip = formats.zipfile.ZipFile

    class DeleteBeforePublishing(original_zip):
        def __exit__(self, *args):
            result = super().__exit__(*args)
            db.job_update(job['id'], status='cancelled')
            deletion.delete_project(pid, 0)
            return result

    monkeypatch.setattr(formats.zipfile, 'ZipFile', DeleteBeforePublishing)
    formats.export_project(pid, {'format': 'native', 'include_videos': False}, job['id'])
    with db.connect() as connection:
        assert not connection.execute('SELECT * FROM exports WHERE project_id=?', (pid,)).fetchall()
        assert not connection.execute('SELECT * FROM jobs WHERE project_id=?', (pid,)).fetchall()
    assert not list((deletion.DATA / 'exports').iterdir())


def uid():
    return str(uuid.uuid4())


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'projects.sqlite3')
    monkeypatch.setattr(deletion, 'DATA', tmp_path / 'data')
    for folder in ('originals', 'frames', 'exports', 'reviews', 'validations', 'backups'):
        (deletion.DATA / folder).mkdir(parents=True)
    with TestClient(app) as connection:
        yield connection


def project(client, name='Delete project'):
    response = client.post('/api/projects', json={'name': name, 'classes': ['Person']})
    assert response.status_code == 200, response.text
    return response.json()['id']


def video(pid, source=None, status='ready'):
    vid = uid()
    if source is None:
        source = deletion.DATA / 'originals' / f'{vid}.mp4'
        source.write_bytes(b'app-owned source')
    row = {'id': vid, 'project_id': pid, 'name': source.name, 'source': str(source),
           'source_hash': 'a' * 64, 'status': status, 'width': 640, 'height': 360, 'frame_count': 3}
    with db.transaction() as c:
        c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(row)))
        for frame in range(3):
            c.execute('INSERT INTO frames VALUES(?,?,?)', (vid, frame, json.dumps({'frame_index': frame, 'seconds': frame / 25})))
    folder = deletion.DATA / 'frames' / vid
    folder.mkdir()
    (folder / '00000000.png').write_bytes(b'cached frame')
    return row


def remove(client, pid, revision=0):
    return client.delete(f'/api/projects/{pid}?confirmed=true&base_revision={revision}')


def test_deletion_removes_all_project_tables_and_managed_files_but_keeps_other_project(client):
    pid, other = project(client), project(client, 'Keep this project')
    cameras = [video(pid), video(pid)]
    survivor = video(other)
    before = client.get('/api/projects/' + other).json()
    exported = deletion.DATA / 'exports' / 'delivery.json'; exported.write_text('{}')
    review = deletion.DATA / 'reviews' / 'review'; review.mkdir(); (review / 'snapshot.json').write_text('{}')
    validation = deletion.DATA / 'validations' / 'proof'; validation.mkdir(); (validation / 'snapshot.json').write_text('{}')
    backup = deletion.DATA / 'backups' / 'user-saved.sqlite3'; backup.write_bytes(b'keep backup')
    with db.transaction() as c:
        identities = []
        for camera in cameras:
            ident, segment = uid(), uid(); identities.append(ident)
            values = {
                'identities': MODELS['identities'](id=ident, person_id=1, class_name='Person'),
                'segments': MODELS['segments'](id=segment, video_id=camera['id'], identity_uuid=ident, start=0),
                'observations': MODELS['observations'](id=uid(), video_id=camera['id'], identity_uuid=ident,
                    segment_id=segment, frame_index=0, boxes={'class:Person': [10, 10, 50, 100]}),
                'intervals': MODELS['intervals'](id=uid(), video_id=camera['id'], identity_uuid=ident, start=1, end=2, reason='unknown'),
                'reviews': MODELS['reviews'](id=camera['id'] + ':0', video_id=camera['id'], frame_index=0),
                'proposal_reviews': MODELS['proposal_reviews'](id=uid(), video_id=camera['id'], frame_index=0, proposal_id=uid(), reason='Incorrect'),
            }
            for collection, value in values.items():
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, collection, value.id, value.model_dump_json()))
            c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)', (uid(), camera['id'], 0, 'cache', '{}'))
            c.execute('INSERT INTO proposal_frames VALUES(?,?,?)', (camera['id'], 'cache', 0))
        link = MODELS['links'](id=uid(), source=identities[0], target=identities[1], relation='same', evidence_note='Reviewed')
        c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, 'links', link.id, link.model_dump_json()))
        session = insert_session(c, pid, {'name': 'Room', 'cameras': [
            {'name': f'Camera {number + 1}', 'video_id': camera['id'], 'offset_seconds': 0}
            for number, camera in enumerate(cameras)]})
        c.execute('INSERT INTO camera_session_events VALUES(?,?,?,?,?)', (uid(), session['id'], 0, '{}', db.now()))
        c.execute('INSERT INTO camera_session_detached_assignments VALUES(?,?,?,?)', (session['id'], cameras[0]['id'], identities[0], uid()))
        c.execute('INSERT INTO operations VALUES(?,?,?,?,?)', (uid(), pid, 0, json.dumps({'changes': []}), db.now()))
        c.execute('INSERT INTO project_settings_events VALUES(?,?,?,?,?,?)', (uid(), pid, 0, '{}', '{}', db.now()))
        c.execute('INSERT INTO exports VALUES(?,?,?)', (uid(), pid, json.dumps({'path': str(exported)})))
        for video_id in (cameras[0]['id'], session['id']):
            c.execute('INSERT INTO validations VALUES(?,?,?,?,?,?)', (uid(), pid, video_id, 0, '', json.dumps({'snapshot_path': str(validation / 'snapshot.json')})))
        job = {'id': uid(), 'project_id': pid, 'kind': 'review', 'status': 'completed', 'snapshot_path': str(review / 'snapshot.json')}
        c.execute('INSERT INTO jobs VALUES(?,?,?)', (job['id'], pid, json.dumps(job)))
        c.execute('CREATE TABLE IF NOT EXISTS restored_history(project_id TEXT PRIMARY KEY,data TEXT NOT NULL)')
        c.execute('INSERT INTO restored_history VALUES(?,?)', (pid, '{}'))
    result = remove(client, pid)
    assert result.status_code == 200, result.text
    assert result.json() == {'deleted': True, 'project_id': pid, 'cleanup_warning': None}
    assert client.get('/api/projects/' + pid).status_code == 404
    assert client.get('/api/projects/' + other).json() == before
    assert {row['id'] for row in client.get('/api/projects').json()} == {other}
    assert {row['id'] for row in client.get('/api/video-library').json()} == {survivor['id']}
    with db.connect() as c:
        for table in ('videos', 'entities', 'operations', 'jobs', 'exports', 'validations', 'project_settings_events', 'camera_sessions', 'restored_history'):
            assert c.execute(f'SELECT COUNT(*) FROM {table} WHERE project_id=?', (pid,)).fetchone()[0] == 0, table
        for table in ('camera_session_events', 'camera_session_detached_assignments'):
            assert c.execute(f'SELECT COUNT(*) FROM {table} WHERE session_id=?', (session['id'],)).fetchone()[0] == 0, table
        for camera in cameras:
            for table in ('frames', 'proposals', 'proposal_frames'):
                assert c.execute(f'SELECT COUNT(*) FROM {table} WHERE video_id=?', (camera['id'],)).fetchone()[0] == 0, table
        assert c.execute('PRAGMA foreign_key_check').fetchall() == []
    for camera in cameras:
        assert not (deletion.DATA / 'originals' / (camera['id'] + '.mp4')).exists()
        assert not (deletion.DATA / 'frames' / camera['id']).exists()
    assert not exported.exists() and not review.exists() and not validation.exists()
    assert backup.read_bytes() == b'keep backup'


def test_empty_project_requires_confirmation_and_current_revision(client):
    pid = project(client)
    assert client.delete(f'/api/projects/{pid}?base_revision=0').status_code == 422
    assert client.delete(f'/api/projects/{pid}?confirmed=true').status_code == 422
    assert client.delete(f'/api/projects/{pid}?confirmed=true&base_revision=-1').status_code == 422
    with db.transaction() as c:
        c.execute('UPDATE projects SET revision=2 WHERE id=?', (pid,))
    assert remove(client, pid, 0).status_code == 409
    assert client.get('/api/projects/' + pid).json()['revision'] == 2
    assert remove(client, pid, 2).status_code == 200
    assert remove(client, pid, 2).status_code == 404


@pytest.mark.parametrize('status', ['queued', 'running'])
def test_running_project_jobs_block_deletion_without_mutation(client, status):
    pid = project(client); camera = video(pid)
    job = {'id': uid(), 'project_id': pid, 'status': status, 'kind': 'export'}
    with db.transaction() as c:
        c.execute('INSERT INTO jobs VALUES(?,?,?)', (job['id'], pid, json.dumps(job)))
    before = client.get('/api/projects/' + pid).json()
    result = remove(client, pid)
    assert result.status_code == 409
    assert client.get('/api/projects/' + pid).json() == before
    assert (deletion.DATA / 'frames' / camera['id']).exists()


@pytest.mark.parametrize('target_key', ['target_project_id', 'restored_project_id'])
def test_restore_parent_job_blocks_deletion_between_video_index_jobs(client, target_key):
    pid = project(client); video(pid)
    job = {'id': uid(), 'project_id': 'native-import', 'status': 'running', 'kind': 'restore', target_key: pid}
    with db.transaction() as c:
        c.execute('INSERT INTO jobs VALUES(?,?,?)', (job['id'], 'native-import', json.dumps(job)))
    assert remove(client, pid).status_code == 409
    job['status'] = 'completed'
    with db.transaction() as c:
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps(job), job['id']))
    assert remove(client, pid).status_code == 200
    with db.connect() as c:
        assert c.execute('SELECT 1 FROM jobs WHERE id=?', (job['id'],)).fetchone() is None


def test_indexing_without_job_still_blocks_deletion(client):
    pid = project(client); video(pid, status='indexing')
    assert remove(client, pid).status_code == 409
    assert client.get('/api/projects/' + pid).status_code == 200


def test_job_sql_ownership_is_authoritative_for_old_rows_without_json_mirrors(client):
    pid = project(client); job_id = uid()
    with db.transaction() as c:
        c.execute('INSERT INTO jobs VALUES(?,?,?)', (job_id, pid, json.dumps({'status': 'running', 'kind': 'export'})))
    assert remove(client, pid).status_code == 409
    with db.transaction() as c:
        c.execute('UPDATE jobs SET data=? WHERE id=?', (json.dumps({'status': 'failed', 'kind': 'export'}), job_id))
    assert remove(client, pid).status_code == 200
    with db.connect() as c:
        assert c.execute('SELECT 1 FROM jobs WHERE id=?', (job_id,)).fetchone() is None


def test_external_sources_symlink_targets_and_cache_roots_are_preserved(client, tmp_path):
    pid = project(client)
    outside = tmp_path / 'external.mp4'; outside.write_bytes(b'user recording')
    direct = video(pid, outside)
    alias = deletion.DATA / 'originals' / 'linked.mp4'; alias.symlink_to(outside)
    video(pid, alias)
    video(pid, deletion.DATA / 'originals')
    outside_frames = tmp_path / 'external-frames'; outside_frames.mkdir(); (outside_frames / 'keep.png').write_bytes(b'user image')
    cached = deletion.DATA / 'frames' / direct['id']; (cached / '00000000.png').unlink(); cached.rmdir(); cached.symlink_to(outside_frames, target_is_directory=True)
    download = tmp_path / 'downloaded.json'; download.write_text('{"keep":true}')
    with db.transaction() as c:
        c.execute('INSERT INTO exports VALUES(?,?,?)', (uid(), pid, json.dumps({'path': str(download)})))
    assert remove(client, pid).status_code == 200
    assert outside.read_bytes() == b'user recording'
    assert (outside_frames / 'keep.png').read_bytes() == b'user image'
    assert download.read_text() == '{"keep":true}'
    assert (deletion.DATA / 'originals').is_dir()


def test_source_still_referenced_by_another_project_is_preserved(client):
    pid, keep = project(client), project(client, 'Other')
    shared = deletion.DATA / 'originals' / 'shared.mp4'; shared.write_bytes(b'shared recording')
    video(pid, shared)
    alias = deletion.DATA / 'originals' / 'second-name.mp4'; alias.symlink_to(shared)
    survivor = video(keep, alias)
    before = client.get('/api/projects/' + keep).json()
    assert remove(client, pid).status_code == 200
    assert shared.read_bytes() == b'shared recording' and alias.read_bytes() == b'shared recording'
    assert client.get('/api/projects/' + keep).json() == before
    assert (deletion.DATA / 'frames' / survivor['id']).is_dir()


def test_cleanup_failure_reports_warning_after_database_removal(client, monkeypatch):
    pid = project(client); video(pid)
    def locked(*args, **kwargs):
        raise PermissionError('File in use')
    monkeypatch.setattr(deletion.shutil, 'rmtree', locked)
    result = remove(client, pid)
    assert result.status_code == 200
    assert 'cached files' in result.json()['cleanup_warning']
    assert client.get('/api/projects/' + pid).status_code == 404


def test_project_delete_notifies_open_stream_and_closes_normally(client):
    pid = project(client)
    with client.websocket_connect('/api/projects/' + pid + '/events', headers={'origin': 'http://127.0.0.1:8765'}) as ws:
        assert ws.receive_json()['project_id'] == pid
        assert remove(client, pid).status_code == 200
        for _ in range(5):
            event = ws.receive_json()
            if event.get('project_deleted'):
                break
        assert event == {'project_id': pid, 'project_deleted': True}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1000


def test_background_jobs_cannot_be_queued_for_deleted_project(client):
    pid = project(client)
    assert remove(client, pid).status_code == 200
    with pytest.raises(KeyError, match='Project not found'):
        new_job(pid, 'export')
    with db.connect() as c:
        assert c.execute('SELECT 1 FROM jobs WHERE project_id=?', (pid,)).fetchone() is None
