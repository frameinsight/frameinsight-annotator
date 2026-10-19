"""Cross-camera delivery preserves local IDs, timing, and independent old exports."""
import copy
import gzip
import json
import uuid

import pytest

from backend.app import db, multicam_delivery as delivery
from backend.app.annotation_export import annotation_document
from backend.app.formats import native_manifest
from backend.app.multicam import SessionUpdate, get_session, insert_session, list_sessions, update_session
from backend.app.restore import restore_camera_sessions
from backend.app.schema import MODELS, Operation


def uid():
    return str(uuid.uuid4())


@pytest.fixture
def camera_project(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'camera-delivery.sqlite3')
    monkeypatch.setattr(delivery, 'DATA', tmp_path)
    db.init()
    pid = uid()
    cameras, identities = [], []
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at,classes,class_colors) VALUES(?,?,?,?,?)',
                  (pid, 'Camera delivery', db.now(), json.dumps(['Person']), json.dumps({'Person': '#22d3ee'})))
        for ordinal in range(3):
            vid, ident, segment = uid(), uid(), uid()
            cameras.append(vid); identities.append(ident)
            video = {'id': vid, 'project_id': pid, 'name': f'camera-{ordinal}.mp4', 'width': 160, 'height': 120,
                     'frame_count': 4, 'status': 'ready', 'source_hash': f'{ordinal+1:064x}', 'source': f'/source-{ordinal}.mp4', 'nominal_fps': 25}
            c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(video)))
            for n in range(4):
                timestamp = 100 + ordinal * 100 + n * (40 + ordinal*10)
                frame = {'frame_index': n, 'pts': timestamp, 'time_base_num': 1, 'time_base_den': 1000, 'seconds': timestamp/1000,
                         'decode_state': 'ready', 'key_frame': n == 0}
                c.execute('INSERT INTO frames VALUES(?,?,?)', (vid, n, json.dumps(frame)))
            identity = MODELS['identities'](id=ident, person_id=1, box_styles={'class:Person': {'class_name': 'Person', 'color': '#22d3ee'}}).model_dump(mode='json')
            seg = MODELS['segments'](id=segment, video_id=vid, identity_uuid=ident, start=0, end=3).model_dump(mode='json')
            for collection, row in [('identities', identity), ('segments', seg)]:
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, collection, row['id'], json.dumps(row)))
            for n in (0, 1, 3):
                observation = MODELS['observations'](id=uid(), video_id=vid, identity_uuid=ident, segment_id=segment, frame_index=n,
                                                    boxes={'class:Person': [10+n, 15, 60+n, 100]}).model_dump(mode='json')
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, 'observations', observation['id'], json.dumps(observation)))
        person = uid()
        session = insert_session(c, pid, {'name': 'Shop morning',
            'cameras': [{'name': f'Camera {n+1}', 'video_id': vid, 'offset_seconds': n * .5} for n, vid in enumerate(cameras[:2])],
            'people': [{'id': person, 'person_id': 7, 'name': 'Person 7', 'color': '#a3e635'}],
            'assignments': [{'video_id': vid, 'identity_uuid': ident, 'person_uuid': person} for vid, ident in zip(cameras[:2], identities[:2])]})
    return pid, cameras, identities, session


def checked(session, revision=0):
    report = delivery.validate_session(session['id'], delivery.SessionValidation(revision=session['revision'], project_revision=revision, visual_confirmed=True))
    assert report['passed'], report
    return report


def doc(session, pid):
    with db.transaction():
        return delivery.session_document(session, db.snapshot(pid))


def test_export_preserves_local_ids_adds_shared_ids_and_normalized_time(camera_project):
    pid, videos, identities, session = camera_project
    single_before = annotation_document(pid, videos[0])
    report = checked(session)
    assert not report['warnings']  # simultaneous views in different cameras are valid
    result = delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id'], filename='Shop morning'))
    response = delivery.download_session_export(result['export_id'])
    document = json.loads(response.path.read_text())
    assert result['filename'] == 'Shop morning.json'
    assert 'attachment' in response.headers['content-disposition']
    assert document['format'] == delivery.FORMAT and document['schema_version'] == 1
    assert document['media_included'] is False and document['history_included'] is False
    annotations = document['annotations']
    assert set(annotations['videos']) == set(videos[:2]) and videos[2] not in annotations['frames']
    assert len(annotations['state']['identities']) == 2
    assert annotations['frames'][videos[0]] == single_before['frames'][videos[0]]
    assert annotations['frames'][videos[0]][0]['pts'] == 100
    assert annotations['frames'][videos[1]][0]['pts'] == 200
    assert not {'operations', 'detector'} & annotations.keys()
    rows = annotations['annotation_index']
    assert {row['person_id'] for row in rows} == {1}
    assert {row['shared_person_id'] for row in rows} == {7}
    assert len({row['person_uuid'] for row in rows}) == 1
    first = [row for row in rows if row['frame_index'] == 0]
    assert {row['session_timestamp_seconds'] for row in first} == {0, .5}
    assert delivery.structural_report(document)['passed']
    single_after = annotation_document(pid, videos[0])
    single_before.pop('exported_at'); single_after.pop('exported_at')
    assert single_before == single_after
    assert all('shared_person_id' not in row for row in single_after['annotation_index'])


def test_validation_requires_visual_confirmation_and_correct_revisions(camera_project):
    pid, _, _, session = camera_project
    with pytest.raises(ValueError, match='Review'):
        delivery.validate_session(session['id'], delivery.SessionValidation(revision=0, project_revision=0))
    with pytest.raises(db.Conflict):
        delivery.validate_session(session['id'], delivery.SessionValidation(revision=0, project_revision=10, visual_confirmed=True))
    with pytest.raises(ValueError, match='session changed'):
        delivery.validate_session(session['id'], delivery.SessionValidation(revision=10, project_revision=0, visual_confirmed=True))
    with pytest.raises(ValueError, match='Validate'):
        delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=uid()))


def test_session_edit_invalidates_export_proof_and_download(camera_project):
    pid, _, _, session = camera_project
    report = checked(session)
    result = delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id']))
    update_session(session['id'], SessionUpdate(**{**{key: session[key] for key in ('revision', 'name', 'cameras', 'people', 'assignments')}, 'name': 'Renamed session'}))
    with pytest.raises(ValueError, match='session changed'):
        delivery.download_session_export(result['export_id'])


def test_local_annotation_edit_invalidates_session_proof(camera_project):
    pid, _, identities, session = camera_project
    report = checked(session)
    old = db.snapshot(pid)['state']['identities'][identities[0]]
    db.apply(pid, Operation(id=uid(), base_revision=0, label='Rename', changes=[{'collection': 'identities', 'id': old['id'], 'before': old, 'after': {**old, 'name': 'Changed'}}]))
    with pytest.raises(db.Conflict):
        delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id']))


def test_same_revision_timing_edit_cannot_bypass_proof(camera_project):
    pid, videos, _, session = camera_project
    report = checked(session)
    db.update_video(videos[0], source_hash='f'*64)
    with pytest.raises(ValueError, match='changed'):
        delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id']))


def test_roundtrip_remaps_every_identity_and_preserves_existing_tracks(camera_project):
    pid, videos, identities, session = camera_project
    document = doc(session, pid)
    before = db.snapshot(pid)
    imported = delivery.import_session_document(pid, document, {v: v for v in videos[:2]}, 0)
    after = db.snapshot(pid)
    assert after['revision'] == 1
    for collection, rows in before['state'].items():
        assert all(after['state'][collection][key] == row for key, row in rows.items())
    assert len(after['state']['identities']) == 5
    restored = imported['session']
    assert restored['id'] != session['id']
    assert restored['people'][0]['id'] != session['people'][0]['id']
    assert restored['people'][0]['person_id'] == 7
    assert len({a['person_uuid'] for a in restored['assignments']}) == 1
    new_ids = {a['identity_uuid'] for a in restored['assignments']}
    assert not new_ids & set(identities)
    assert {after['state']['identities'][i]['person_id'] for i in new_ids} == {2}
    assert checked(restored, 1)['passed']
    assert len(list_sessions(pid)) == 2


def test_roundtrip_to_new_project_keeps_local_numbers(camera_project):
    pid, videos, _, session = camera_project
    document = doc(session, pid)
    mapping, new_pid = {}, uid()
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at,classes) VALUES(?,?,?,?)', (new_pid, 'Imported', db.now(), '[]'))
        for old in videos[:2]:
            vid = uid(); mapping[old] = vid
            original = document['annotations']['videos'][old]
            c.execute('INSERT INTO videos VALUES(?,?,?)', (vid, new_pid, json.dumps({**original, 'id': vid, 'project_id': new_pid})))
            for frame in document['annotations']['frames'][old]:
                c.execute('INSERT INTO frames VALUES(?,?,?)', (vid, frame['frame_index'], json.dumps(frame)))
    result = delivery.import_session_document(new_pid, document, mapping, 0)
    restored = result['session']
    assert {camera['video_id'] for camera in restored['cameras']} == set(mapping.values())
    assert {p['person_id'] for p in db.snapshot(new_pid)['state']['identities'].values()} == {1}
    exported = doc(restored, new_pid)
    assert len(exported['annotations']['annotation_index']) == len(document['annotations']['annotation_index'])
    assert {r['shared_person_id'] for r in exported['annotations']['annotation_index']} == {7}
    assert delivery.structural_report(exported)['passed']


@pytest.mark.parametrize('failure', ['mapping', 'duplicate_target', 'hash', 'ledger', 'dimensions', 'identity', 'shared_index'])
def test_invalid_import_is_atomic(camera_project, failure):
    pid, videos, _, session = camera_project
    document = doc(session, pid)
    mapping = {v: v for v in videos[:2]}
    if failure == 'mapping': mapping.pop(videos[1])
    elif failure == 'duplicate_target': mapping[videos[1]] = videos[0]
    elif failure == 'hash': document['annotations']['videos'][videos[1]]['source_hash'] = 'f'*64
    elif failure == 'ledger':
        with db.transaction() as c:
            c.execute('DELETE FROM frames WHERE video_id=? AND frame_index=3', (videos[1],))
    elif failure == 'dimensions': document['annotations']['videos'][videos[1]]['width'] = 161
    elif failure == 'identity': document['session']['assignments'][0]['identity_uuid'] = uid()
    elif failure == 'shared_index': document['annotations']['annotation_index'][0]['shared_person_id'] = 800
    before = db.snapshot(pid)
    with pytest.raises(ValueError):
        delivery.import_session_document(pid, document, mapping, 0)
    assert db.snapshot(pid) == before
    assert len(list_sessions(pid)) == 1


def test_unassigned_and_same_camera_overlap_are_review_warnings(camera_project):
    pid, videos, identities, session = camera_project
    unassigned = copy.deepcopy(session); unassigned['assignments'].pop()
    report = delivery.structural_report(doc(unassigned, pid))
    assert report['passed'] and report['warnings'][0]['code'] == 'unassigned_track'
    document = doc(session, pid)
    result = delivery.import_session_document(pid, document, {v: v for v in videos[:2]}, 0)
    new_assignment = result['session']['assignments'][0]
    overlapping = copy.deepcopy(session)
    overlapping['assignments'].append({**new_assignment, 'person_uuid': session['people'][0]['id']})
    report = delivery.structural_report(doc(overlapping, pid))
    assert report['passed'] and any(w['code'] == 'same_camera_overlap' for w in report['warnings'])


def test_gzip_and_duplicate_json_key_rejection(camera_project):
    pid, _, _, session = camera_project
    document = doc(session, pid)
    assert delivery.read_session_json(gzip.compress(json.dumps(document).encode())) == document
    with pytest.raises(ValueError, match='Duplicate'):
        delivery.read_session_json(b'{"format":1,"format":2}')
    with pytest.raises(ValueError):
        delivery.read_session_json(b'{"format":')


def test_native_backup_and_restore_preserve_sessions_without_touching_single_video(camera_project):
    pid, videos, _, session = camera_project
    project = db.snapshot(pid)
    manifest = native_manifest(project)
    assert manifest['camera_sessions'] == [session]
    with db.transaction() as c:
        restored = restore_camera_sessions(c, pid, manifest['camera_sessions'], {v: v for v in videos})[0]
    assert restored['id'] != session['id']
    assert restored['people'][0]['person_id'] == session['people'][0]['person_id']
    assert restored['assignments'][0]['identity_uuid'] == session['assignments'][0]['identity_uuid']
    assert db.snapshot(pid) == project


def test_http_preview_validate_download_and_explicit_import(camera_project):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    pid, videos, _, session = camera_project
    client = TestClient(app)
    report = client.post(f'/api/camera-sessions/{session["id"]}/validate', json={'revision': 0, 'project_revision': 0, 'visual_confirmed': True})
    assert report.status_code == 200, report.text
    prepared = client.post(f'/api/camera-sessions/{session["id"]}/export', json={'revision': 0, 'project_revision': 0, 'validation_id': report.json()['validation_id'], 'filename': 'Morning <cameras>'})
    assert prepared.status_code == 200, prepared.text
    downloaded = client.get(prepared.json()['download_url'])
    assert downloaded.status_code == 200 and downloaded.headers['content-type'] == 'application/json'
    assert 'Morning%20_cameras_.json' in downloaded.headers['content-disposition']
    raw = downloaded.content
    preview = client.post(f'/api/projects/{pid}/camera-sessions/import/preview', files={'file': ('session.json', raw, 'application/json')})
    assert preview.status_code == 200, preview.text
    assert preview.json()['name'] == session['name']
    assert {c['video_id'] for c in preview.json()['cameras']} == set(videos[:2])
    imported = client.post(f'/api/projects/{pid}/camera-sessions/import',
                           data={'project_revision': '0', 'video_mapping': json.dumps({v: v for v in videos[:2]})}, files={'file': ('session.json', raw, 'application/json')})
    assert imported.status_code == 200, imported.text
    assert imported.json()['session']['id'] != session['id']
    assert imported.json()['project_revision'] == 1


def test_import_empty_camera_session_and_unused_class_catalog(camera_project):
    pid, videos, _, session = camera_project
    # Genuine unannotated recordings can be synchronized/exported before tracking.
    with db.transaction() as c:
        c.execute('DELETE FROM entities WHERE project_id=?', (pid,))
        c.execute('UPDATE projects SET classes=?,class_colors=? WHERE id=?', (json.dumps(['Person', 'Bag']), json.dumps({'Person': '#22d3ee', 'Bag': '#a3e635'}), pid))
    empty = copy.deepcopy(session); empty['people'] = []; empty['assignments'] = []
    document = doc(empty, pid)
    result = delivery.import_session_document(pid, document, {v: v for v in videos[:2]}, 0)
    assert result['session']['people'] == [] and result['session']['assignments'] == []
    assert db.snapshot(pid)['classes'] == ['Person', 'Bag']


def test_backups_restore_sessions_referencing_remapped_videos(camera_project):
    pid, videos, _, session = camera_project
    source = db.snapshot(pid)
    mapping, target_pid = {}, uid()
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', (target_pid, 'Restored', db.now()))
        for vid in videos:
            new = uid(); mapping[vid] = new
            c.execute('INSERT INTO videos VALUES(?,?,?)', (new, target_pid, json.dumps({**source['videos'][vid], 'id': new, 'project_id': target_pid})))
        for collection, values in source['state'].items():
            for key, value in values.items():
                value = copy.deepcopy(value)
                if 'video_id' in value: value['video_id'] = mapping[value['video_id']]
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (target_pid, collection, key, json.dumps(value)))
        restored = restore_camera_sessions(c, target_pid, [session], mapping)[0]
    assert restored['project_id'] == target_pid
    assert {camera['video_id'] for camera in restored['cameras']} == {mapping[vid] for vid in videos[:2]}
    assert {assignment['video_id'] for assignment in restored['assignments']} == {mapping[vid] for vid in videos[:2]}
    assert get_session(session['id']) == session


def test_download_rejects_modified_export_and_proof_from_other_session(camera_project):
    pid, videos, _, session = camera_project
    report = checked(session)
    with db.transaction() as c:
        another = insert_session(c, pid, {key: session[key] for key in ('name', 'cameras', 'people', 'assignments')})
    with pytest.raises(ValueError, match='Validate'):
        delivery.export_session(another['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id']))
    result = delivery.export_session(session['id'], delivery.SessionExport(revision=0, project_revision=0, validation_id=report['validation_id']))
    response = delivery.download_session_export(result['export_id'])
    response.path.write_text('{}')
    with pytest.raises(ValueError, match='file changed'):
        delivery.download_session_export(result['export_id'])


def test_validation_does_not_impose_visual_or_image_boundary_assumptions(camera_project):
    pid, _, _, session = camera_project
    with db.transaction() as c:
        row = c.execute("SELECT id,data FROM entities WHERE project_id=? AND collection='observations' LIMIT 1", (pid,)).fetchone()
        observation = json.loads(row['data'])
        observation['boxes']['class:Person'] = [-20, -10, 190, 180]
        c.execute("UPDATE entities SET data=? WHERE project_id=? AND collection='observations' AND id=?", (json.dumps(observation), pid, row['id']))
    assert checked(session)['passed']
    document = doc(session, pid)
    imported = delivery.import_session_document(pid, document, {camera['video_id']: camera['video_id'] for camera in session['cameras']}, 0)
    assert imported['summary']['tracks'] == 2


def test_native_export_freezes_annotations_and_session_links_together(camera_project, monkeypatch):
    import threading
    import zipfile
    from backend.app import formats
    from backend.app.video import new_job
    pid, videos, _, session = camera_project
    monkeypatch.setattr(formats, 'DATA', delivery.DATA)
    (delivery.DATA / 'exports').mkdir(exist_ok=True)
    original_manifest = formats.native_manifest
    started, saved = threading.Event(), threading.Event()
    failures = []
    identity, segment = uid(), uid()
    def write_track_and_assignment():
        started.set()
        try:
            person = MODELS['identities'](id=identity, person_id=8).model_dump(mode='json')
            seg = MODELS['segments'](id=segment, identity_uuid=identity, video_id=videos[0], start=0).model_dump(mode='json')
            db.apply(pid, Operation(id=uid(), base_revision=0, label='Concurrent new track', changes=[
                {'collection': collection, 'id': value['id'], 'before': None, 'after': value}
                for collection, value in [('identities', person), ('segments', seg)]]))
            current = get_session(session['id'])
            content = {key: current[key] for key in ('revision', 'name', 'cameras', 'people', 'assignments')}
            content['assignments'].append({'video_id': videos[0], 'identity_uuid': identity, 'person_uuid': session['people'][0]['id']})
            update_session(session['id'], SessionUpdate(**content))
        except Exception as error:
            failures.append(error)
        finally:
            saved.set()
    thread = threading.Thread(target=write_track_and_assignment)
    def interleaved_manifest(project):
        thread.start()
        assert started.wait(2)
        # With the former split reads, this edit commits before the session read,
        # yielding a backup whose assignment points at a missing local identity.
        saved.wait(.3)
        return original_manifest(project)
    monkeypatch.setattr(formats, 'native_manifest', interleaved_manifest)
    job = new_job(pid, 'export')
    formats.export_project(pid, {'format': 'native'}, job['id'])
    thread.join(5)
    assert saved.is_set() and not failures
    result = db.job_get(job['id'])
    assert result['status'] == 'completed', result
    with db.connect() as c:
        path = json.loads(c.execute('SELECT data FROM exports WHERE id=?', (result['export_id'],)).fetchone()['data'])['path']
    with zipfile.ZipFile(path) as archive:
        backup = json.loads(archive.read('native/project.json'))
    from backend.app.multicam import validate_session_snapshot
    validate_session_snapshot(backup['camera_sessions'][0], backup)
    assert identity not in backup['state']['identities']
    assert len(backup['camera_sessions'][0]['assignments']) == 2
    assert identity in db.snapshot(pid)['state']['identities']
    assert len(get_session(session['id'])['assignments']) == 3


@pytest.mark.parametrize('status,source_hash', [('indexing', 'a'*64), ('failed', 'a'*64), ('cancelled', 'a'*64), ('ready', None)])
def test_native_backup_rejects_incomplete_recordings(camera_project, monkeypatch, status, source_hash):
    from backend.app import formats
    from backend.app.video import new_job
    pid, videos, _, _ = camera_project
    monkeypatch.setattr(formats, 'DATA', delivery.DATA)
    db.update_video(videos[1], status=status, source_hash=source_hash)
    before = db.snapshot(pid)
    job = new_job(pid, 'export')
    formats.export_project(pid, {'format': 'native'}, job['id'])
    result = db.job_get(job['id'])
    assert result['status'] == 'failed'
    assert 'Finish preparing every video' in result['error']
    assert db.snapshot(pid) == before
    with db.connect() as c:
        assert not c.execute('SELECT 1 FROM exports WHERE project_id=?', (pid,)).fetchone()
