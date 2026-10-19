"""Camera associations stay explicit and never mutate single-video geometry."""
import copy
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.delete_video import delete_video
from backend.app.main import app
from backend.app.multicam import (Camera, SessionCreate, SessionUpdate, create_session,
                                 get_session, list_sessions, update_session,
                                 validate_session_snapshot)
from backend.app.schema import MODELS, Operation


def uid():
    return str(uuid.uuid4())


@pytest.fixture
def cameras(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path / 'multicam.sqlite3')
    db.init()
    pid = uid()
    videos, tracks = [], []
    with db.transaction() as connection:
        connection.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', (pid, 'Shop', db.now()))
        for index in range(3):
            video_id, identity_id, segment_id, observation_id = (uid() for _ in range(4))
            video = {'id': video_id, 'project_id': pid, 'name': f'cam{index}.mp4', 'status': 'ready',
                     'width': 640, 'height': 360, 'frame_count': 100, 'nominal_fps': 25}
            connection.execute('INSERT INTO videos VALUES(?,?,?)', (video_id, pid, json.dumps(video)))
            identity = MODELS['identities'](id=identity_id, person_id=1, name='Local person').model_dump()
            segment = MODELS['segments'](id=segment_id, video_id=video_id, identity_uuid=identity_id, start=0).model_dump()
            observation = MODELS['observations'](id=observation_id, video_id=video_id, identity_uuid=identity_id,
                                                segment_id=segment_id, frame_index=0, person_visible=[10, 10, 50, 100]).model_dump(mode='json')
            for collection, value in [('identities', identity), ('segments', segment), ('observations', observation)]:
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (pid, collection, value['id'], json.dumps(value)))
            videos.append(video)
            tracks.append(identity_id)
    body = {'name': 'Shop morning', 'cameras': [{'id': uid(), 'name': f'Camera {index + 1}', 'video_id': video['id'], 'offset_seconds': index * 1.5} for index, video in enumerate(videos[:2])],
            'people': [], 'assignments': []}
    return pid, videos, tracks, body


def writable(session, **changes):
    return SessionUpdate(**{key: session[key] for key in ('revision', 'name', 'cameras', 'people', 'assignments')} | changes)


def shared(cameras):
    pid, videos, tracks, body = cameras
    person = {'id': uid(), 'person_id': 8, 'name': 'Visitor', 'color': '#fbbf24'}
    body = copy.deepcopy(body)
    body['people'] = [person]
    body['assignments'] = [{'video_id': videos[index]['id'], 'identity_uuid': tracks[index], 'person_uuid': person['id']} for index in range(2)]
    return create_session(pid, body)


def test_session_starts_with_no_inferred_links_and_does_not_change_old_workflow(cameras):
    pid, videos, tracks, body = cameras
    before = db.snapshot(pid)
    session = create_session(pid, body)
    assert session['mode'] == 'multicamera'
    assert session['revision'] == 0
    assert not session['people'] and not session['assignments']
    assert list_sessions(pid) == [session]
    assert get_session(session['id']) == session
    assert db.snapshot(pid) == before
    assert [person['person_id'] for person in before['state']['identities'].values()] == [1, 1, 1]
    with db.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0


def test_same_person_can_appear_in_two_cameras_and_offsets_reload(cameras):
    before = db.snapshot(cameras[0])
    session = shared(cameras)
    assert len(session['people']) == 1 and len(session['assignments']) == 2
    updated = update_session(session['id'], writable(session, cameras=[{**camera, 'offset_seconds': -2.75} for camera in session['cameras']]))
    assert updated['revision'] == 1
    assert all(camera['offset_seconds'] == -2.75 for camera in get_session(session['id'])['cameras'])
    assert db.snapshot(cameras[0]) == before
    with db.connect() as connection:
        event = json.loads(connection.execute('SELECT data FROM camera_session_events WHERE session_id=? AND revision=1', (session['id'],)).fetchone()['data'])
    assert event['before'] == session and event['after'] == updated


def test_unlink_and_snapshot_undo_keep_local_tracks_and_geometry(cameras):
    session = shared(cameras)
    before = db.snapshot(cameras[0])
    unlinked = update_session(session['id'], writable(session, assignments=session['assignments'][:1]))
    undone = update_session(session['id'], writable(session, revision=unlinked['revision']))
    assert undone['assignments'] == session['assignments']
    assert undone['revision'] == 2
    assert db.snapshot(cameras[0]) == before


def test_conflict_is_atomic_and_noop_preserves_revision(cameras):
    session = shared(cameras)
    assert update_session(session['id'], writable(session)) == session
    changed = update_session(session['id'], writable(session, name='New name'))
    with pytest.raises(db.Conflict) as error:
        update_session(session['id'], writable(session, name='Stale overwrite'))
    assert error.value.revision == 1
    assert get_session(session['id']) == changed


@pytest.mark.parametrize('mutation,expected', [
    (lambda body: body.update(cameras=body['cameras'][:1]), 'at least 2'),
    (lambda body: body['cameras'].append(copy.deepcopy(body['cameras'][0])), 'unique ID'),
    (lambda body: body['cameras'][1].update(video_id=body['cameras'][0]['video_id']), 'only once'),
    (lambda body: body['cameras'][1].update(name=body['cameras'][0]['name'].upper()), 'different name'),
    (lambda body: body['cameras'][1].update(video_id='foreign-video'), 'this project'),
    (lambda body: body.update(name=' \n '), 'name'),
])
def test_invalid_session_does_not_create_data(cameras, mutation, expected):
    pid, _, _, body = cameras
    mutation(body)
    with pytest.raises(ValueError, match=expected):
        create_session(pid, body)
    assert list_sessions(pid) == []


@pytest.mark.parametrize('offset', [float('nan'), float('inf'), float('-inf')])
def test_nonfinite_camera_offset_rejected(offset):
    with pytest.raises(ValueError):
        Camera(name='Camera', video_id='video', offset_seconds=offset)


@pytest.mark.parametrize('change,expected', [
    (lambda session: session['people'].append(copy.deepcopy(session['people'][0])), 'unique UUID'),
    (lambda session: session['people'][0].update(person_id=0), 'greater than 0'),
    (lambda session: session['people'][0].update(person_id=True), 'valid integer'),
    (lambda session: session['assignments'].append(copy.deepcopy(session['assignments'][0])), 'only one'),
    (lambda session: session['assignments'][0].update(person_uuid='missing'), 'does not exist'),
    (lambda session: session['assignments'][0].update(identity_uuid='missing'), 'does not exist'),
    (lambda session: session['assignments'][0].update(identity_uuid=session['assignments'][1]['identity_uuid']), 'that camera'),
    (lambda session: session['assignments'][0].update(video_id='outside'), 'camera in this session'),
])
def test_invalid_assignments_rejected_without_changing_snapshot(cameras, change, expected):
    session = shared(cameras)
    invalid = copy.deepcopy(session)
    change(invalid)
    with pytest.raises(ValueError, match=expected):
        update_session(session['id'], writable(invalid))
    assert get_session(session['id']) == session


def test_structural_validation_checks_project_and_does_not_infer_geometry(cameras):
    session = shared(cameras)
    project = db.snapshot(cameras[0])
    assert validate_session_snapshot(session, project) == session
    with pytest.raises(ValueError, match='different project'):
        validate_session_snapshot(session, {**project, 'id': uid()})
    # Local tracks can represent distinct classes of the same shared person.
    # Session association does not impose any bounding-box containment policy.
    local_id = uid()
    project['state']['identities'][local_id] = {**project['state']['identities'][cameras[2][0]], 'id': local_id, 'person_id': 2}
    project['state']['segments']['another'] = {'id': 'another', 'identity_uuid': local_id, 'video_id': cameras[1][0]['id'], 'start': 0, 'end': None}
    session['assignments'].append({'video_id': cameras[1][0]['id'], 'identity_uuid': local_id, 'person_uuid': session['people'][0]['id']})
    assert validate_session_snapshot(session, project) == session


def test_deleting_video_keeps_remaining_people_and_session_editable(cameras):
    pid, videos, _, _ = cameras
    session = shared(cameras)
    before_other = db.snapshot(pid)['state']['observations']
    delete_video(videos[0]['id'])
    remaining = get_session(session['id'])
    assert len(remaining['cameras']) == 1 and remaining['revision'] == 1
    assert remaining['people'] == session['people']
    assert remaining['assignments'] == session['assignments'][1:]
    assert validate_session_snapshot(remaining, db.snapshot(pid)) == remaining
    for key, observation in db.snapshot(pid)['state']['observations'].items():
        assert observation == before_other[key]
    edited = update_session(session['id'], writable(remaining, name='Waiting for replacement'))
    assert edited['name'] == 'Waiting for replacement'
    delete_video(videos[1]['id'])
    empty = get_session(session['id'])
    assert empty['cameras'] == [] and empty['assignments'] == []
    assert empty['people'] == session['people']
    assert update_session(session['id'], writable(empty, name='Saved identities'))['name'] == 'Saved identities'


def test_annotation_delete_and_undo_detach_then_restore_shared_assignment(cameras):
    pid, videos, tracks, _ = cameras
    session = shared(cameras)
    project = db.snapshot(pid)
    changes = [{'collection': collection, 'id': key, 'before': value, 'after': None}
               for collection, entities in project['state'].items() for key, value in entities.items()
               if value.get('identity_uuid') == tracks[0] or (collection == 'identities' and key == tracks[0])]
    deletion = Operation(id=uid(), base_revision=project['revision'], label='Delete local track', changes=changes)
    result = db.apply(pid, deletion)
    detached = get_session(session['id'])
    assert detached['assignments'] == session['assignments'][1:]
    assert detached['revision'] == 1
    assert validate_session_snapshot(detached, db.snapshot(pid)) == detached
    db.apply(pid, Operation(id=uid(), base_revision=result['revision'], label='Undo local deletion', compensates=deletion.id,
                           changes=[{**change, 'before': None, 'after': change['before']} for change in changes]))
    restored = get_session(session['id'])
    assert restored['revision'] == 2
    assert sorted(restored['assignments'], key=lambda a: a['identity_uuid']) == sorted(session['assignments'], key=lambda a: a['identity_uuid'])
    assert db.snapshot(pid)['state'] == project['state']
    with db.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM camera_session_detached_assignments').fetchone()[0] == 0


def test_renaming_local_numeric_id_does_not_change_shared_id(cameras):
    pid, _, tracks, _ = cameras
    session = shared(cameras)
    project = db.snapshot(pid)
    old = project['state']['identities'][tracks[0]]
    db.apply(pid, Operation(id=uid(), base_revision=project['revision'], label='Rename local track', changes=[{
        'collection': 'identities', 'id': tracks[0], 'before': old, 'after': {**old, 'person_id': 99},
    }]))
    assert get_session(session['id']) == session
    assert session['people'][0]['person_id'] == 8
    assert db.snapshot(pid)['state']['identities'][tracks[0]]['person_id'] == 99


def test_removing_shared_person_discards_detached_undo_link(cameras):
    pid, _, tracks, _ = cameras
    session = shared(cameras)
    project = db.snapshot(pid)
    changes = [{'collection': collection, 'id': key, 'before': value, 'after': None}
               for collection, entities in project['state'].items() for key, value in entities.items()
               if value.get('identity_uuid') == tracks[0] or (collection == 'identities' and key == tracks[0])]
    deletion = Operation(id=uid(), base_revision=project['revision'], label='Delete local track', changes=changes)
    result = db.apply(pid, deletion)
    detached = get_session(session['id'])
    update_session(session['id'], writable(detached, people=[], assignments=[]))
    db.apply(pid, Operation(id=uid(), base_revision=result['revision'], label='Undo local deletion', compensates=deletion.id,
                           changes=[{**change, 'before': None, 'after': change['before']} for change in changes]))
    restored = get_session(session['id'])
    assert restored['people'] == [] and restored['assignments'] == []
    assert validate_session_snapshot(restored, db.snapshot(pid)) == restored


def test_session_api_modes_invalid_fields_and_conflicts(cameras):
    pid, _, _, body = cameras
    with TestClient(app) as client:
        created = client.post(f'/api/projects/{pid}/camera-sessions', json=body)
        assert created.status_code == 201, created.text
        session = created.json()
        assert client.get(f'/api/projects/{pid}/camera-sessions').json() == [session]
        assert client.get(f'/api/camera-sessions/{session["id"]}').json() == session
        patch = writable(session, name='Updated').model_dump()
        saved = client.patch(f'/api/camera-sessions/{session["id"]}', json=patch)
        assert saved.status_code == 200
        stale = client.patch(f'/api/camera-sessions/{session["id"]}', json=patch)
        assert stale.status_code == 409 and stale.json()['revision'] == 1
        incomplete = {key: value for key, value in patch.items() if key != 'assignments'}
        assert client.patch(f'/api/camera-sessions/{session["id"]}', json=incomplete).status_code == 422
        assert client.post(f'/api/projects/{pid}/camera-sessions', json={**body, 'mode': 'single'}).status_code == 422
        assert client.get('/api/camera-sessions/missing').status_code == 404
