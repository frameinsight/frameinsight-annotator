import copy
import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.annotation_import import router
from backend.app.schema import MODELS, Operation
from test_domain import project, seeded


def uid():
    return str(uuid.uuid4())


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({'detail': str(error)}, status_code=422)

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({'detail': str(error)}, status_code=404)

    @app.exception_handler(db.Conflict)
    async def conflict(request, error):
        return JSONResponse({'detail': 'Revision conflict', 'revision': error.revision}, status_code=409)

    with TestClient(app) as connection:
        yield connection


def save_fixture(p):
    with db.transaction() as connection:
        for collection, values in p['state'].items():
            for key, value in values.items():
                connection.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], collection, key, json.dumps(value)))


def target_for(p, v):
    pid, vid = uid(), uid()
    video = {**p['videos'][v], 'id': vid, 'project_id': pid}
    with db.transaction() as connection:
        connection.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)', (pid, 'Import destination', db.now()))
        connection.execute('INSERT INTO videos VALUES(?,?,?)', (vid, pid, json.dumps(video)))
    return db.snapshot(pid), vid


def upload(client, target, document, **query):
    p, v = target
    raw = document if isinstance(document, bytes) else json.dumps(document).encode()
    return client.post(f"/api/projects/{p['id']}/imports/annotations", params={'video_id': v, **query}, files={'file': ('annotations.json', raw, 'application/json')})


def document_for(project):
    p, v, identity, segment, observation = seeded(project)
    save_fixture(p)
    return annotation_document(p['id'], v), p, v, identity, segment, observation


def test_roundtrip_pair_late_entry_gaps_collision_preview_and_atomic_undo(project, client):
    p, v, identity, segment, observation = seeded(project)
    d = p['state']
    person = d['identities'][identity]
    person['box_styles'] = {'person_visible': {'class_name': 'person_visible', 'color': '#00ccff'}, 'person_ext': {'class_name': 'person_extended', 'color': '#ff9911'}}
    d['segments'][segment].update(start=50, end=90)
    template = d['observations'].pop(observation)
    for frame in (50, 60, 80, 90):
        key = uid()
        d['observations'][key] = {**copy.deepcopy(template), 'id': key, 'frame_index': frame,
            'review_state': 'approved' if frame == 50 else 'draft',
            'provenance': {'person_visible': {'origin': 'model', 'proposal_id': 'source-proposal', 'human_corrected': True},
                           'person_ext': {'origin': 'copied_track', 'proposal_id': None, 'human_corrected': False}}}
    gap = uid()
    d['intervals'][gap] = MODELS['intervals'](id=gap, video_id=v, identity_uuid=identity, start=61, end=79, reason='occlusion', evidence_note='Behind the wall').model_dump(mode='json')
    # A later-created person starts at frame 1, independently of the first track.
    second, second_segment, second_observation = uid(), uid(), uid()
    d['identities'][second] = MODELS['identities'](id=second, person_id=18).model_dump(mode='json')
    d['segments'][second_segment] = MODELS['segments'](id=second_segment, video_id=v, identity_uuid=second, start=1, end=15).model_dump(mode='json')
    d['observations'][second_observation] = {**copy.deepcopy(template), 'id': second_observation, 'identity_uuid': second, 'segment_id': second_segment, 'frame_index': 1}
    save_fixture(p)
    document = annotation_document(p['id'], v)

    target = target_for(p, v)
    target_p, target_v, existing_person, existing_segment, existing_observation = seeded(target)
    old = target_p['state']['observations'][existing_observation]
    old['frame_index'] = 50
    review = target_v + ':50'
    target_p['state']['reviews'][review] = MODELS['reviews'](id=review, video_id=target_v, frame_index=50, complete=True, checked_all_people=True).model_dump(mode='json')
    save_fixture(target_p)
    before = db.snapshot(target_p['id'])
    preview = upload(client, target, document)
    assert preview.status_code == 200, preview.text
    report = preview.json()
    assert report['preview'] and report['imported_people'] == 2 and report['imported_boxes'] == 10 and report['imported_observations'] == 5
    assert report['person_id_remaps'][0]['from'] == 17 and report['person_id_remaps'][0]['to'] not in (17, 18)
    assert report['warnings'] and db.snapshot(target_p['id']) == before

    committed = upload(client, target, document, preview=False, base_revision=report['revision'], import_token=report['import_token'])
    assert committed.status_code == 200, committed.text
    result = committed.json()
    assert result['revision'] == 1 and not result['duplicate']
    after = db.snapshot(target_p['id'])
    assert after['state']['identities'][existing_person] == before['state']['identities'][existing_person]
    assert after['state']['observations'][existing_observation] == old
    assert after['state']['reviews'][review]['complete'] is False
    imported = [value for key, value in after['state']['identities'].items() if key != existing_person]
    main = next(value for value in imported if value.get('box_styles') == person['box_styles'])
    assert main['person_id'] == report['person_id_remaps'][0]['to']
    rows = sorted((value for value in after['state']['observations'].values() if value['identity_uuid'] == main['id']), key=lambda value: value['frame_index'])
    assert [row['frame_index'] for row in rows] == [50, 60, 80, 90]
    assert all(row['video_id'] == target_v and row['person_visible'] == template['person_visible'] and row['person_ext'] == template['person_ext'] for row in rows)
    assert rows[0]['review_state'] == 'draft' and rows[0]['provenance']['person_visible']['proposal_id'] == 'source-proposal'
    assert all(row['provenance']['person_ext']['origin'] == 'copied_track' for row in rows)
    new_gap = next(iter(after['state']['intervals'].values()))
    assert (new_gap['start'], new_gap['end'], new_gap['identity_uuid']) == (61, 79, main['id'])
    exported_again = annotation_document(target_p['id'], target_v)
    assert len(exported_again['annotation_index']) == 12
    assert {row['class_name'] for row in exported_again['annotation_index'] if row['identity_uuid'] == main['id']} == {'person_visible', 'person_extended'}

    retry = upload(client, target, document, preview=False, base_revision=report['revision'], import_token=report['import_token'])
    assert retry.status_code == 200 and retry.json()['duplicate'] is True
    assert db.snapshot(target_p['id']) == after
    operation = result['operation']
    db.apply(target_p['id'], Operation(id=uid(), base_revision=after['revision'], label='Undo annotation import', compensates=operation['id'], changes=[{**change, 'before': change['after'], 'after': change['before']} for change in operation['changes']]))
    assert db.snapshot(target_p['id'])['state'] == before['state']


@pytest.mark.parametrize('corruption', ['hash', 'width', 'frame_count', 'outside', 'nonfinite', 'fractional_frame', 'numeric_string', 'duplicate_observation', 'duplicate_person_id', 'missing_segment', 'index_only_edit', 'wrong_version'])
def test_rejected_import_does_not_change_destination(project, client, corruption):
    document, p, v, identity, segment, observation = document_for(project)
    target = target_for(p, v)
    if corruption == 'hash': document['videos'][v]['source_hash'] = 'wrong-video'
    if corruption == 'width': document['videos'][v]['width'] += 1
    if corruption == 'frame_count': document['videos'][v]['frame_count'] += 1
    if corruption == 'outside': document['state']['observations'][observation]['person_visible'][0] = -1
    if corruption == 'nonfinite': document['state']['observations'][observation]['person_visible'][0] = float('nan')
    if corruption == 'fractional_frame': document['state']['observations'][observation]['frame_index'] = 99.5
    if corruption == 'numeric_string': document['state']['identities'][identity]['person_id'] = '17'
    if corruption == 'duplicate_observation':
        key = uid(); document['state']['observations'][key] = {**document['state']['observations'][observation], 'id': key}
    if corruption == 'duplicate_person_id':
        key = uid(); document['state']['identities'][key] = {**document['state']['identities'][identity], 'id': key}
    if corruption == 'missing_segment': document['state']['segments'] = {}
    if corruption == 'index_only_edit': document['annotation_index'][0]['box_xyxy'] = [1, 1, 10, 10]
    if corruption == 'wrong_version': document['schema_version'] = 3
    before = db.snapshot(target[0]['id'])
    response = upload(client, target, document)
    assert response.status_code == 422, response.text
    assert db.snapshot(target[0]['id']) == before


@pytest.mark.parametrize('raw', [b'', b'{broken', b'{"format":"frameinsight.annotations","format":"frameinsight.annotations"}', b'[]', b'{"format":"frameinsight.annotations","schema_version":2,"state":{"value":Infinity}}'])
def test_invalid_json_is_atomic(project, client, raw):
    before = db.snapshot(project[0]['id'])
    response = upload(client, project, raw)
    assert response.status_code == 422
    assert db.snapshot(project[0]['id']) == before


def test_stale_preview_and_changed_upload_rejected(project, client):
    document, p, v, identity, segment, observation = document_for(project)
    target = target_for(p, v)
    report = upload(client, target, document).json()
    changed = copy.deepcopy(document)
    changed['exported_at'] = 'changed'
    response = upload(client, target, changed, preview=False, base_revision=report['revision'], import_token=report['import_token'])
    assert response.status_code == 422 and 'changed since preview' in response.json()['detail']
    other = uid()
    db.apply(target[0]['id'], Operation(id=uid(), base_revision=0, label='Concurrent person', changes=[{'collection': 'identities', 'id': other, 'before': None, 'after': {'id': other, 'person_id': 20}}]))
    before = db.snapshot(target[0]['id'])
    response = upload(client, target, document, preview=False, base_revision=report['revision'], import_token=report['import_token'])
    assert response.status_code == 409 and db.snapshot(target[0]['id']) == before


def test_legacy_v1_preserves_original_geometry_and_style(project, client):
    document, p, v, identity, segment, observation = document_for(project)
    document['schema_version'] = 1
    document['state']['identities'][identity].update(class_name='person extended', color='#123abc')
    target = target_for(p, v)
    preview = upload(client, target, document)
    assert preview.status_code == 200, preview.text
    report = preview.json()
    assert any('Legacy schema v1' in warning for warning in report['warnings'])
    response = upload(client, target, document, preview=False, base_revision=report['revision'], import_token=report['import_token'])
    assert response.status_code == 200, response.text
    imported = db.snapshot(target[0]['id'])['state']
    assert next(iter(imported['identities'].values()))['class_name'] == 'person extended'
    assert next(iter(imported['identities'].values()))['color'] == '#123abc'
    obs = next(iter(imported['observations'].values()))
    assert obs['person_visible'] == document['state']['observations'][observation]['person_visible']
    assert obs['person_ext'] == document['state']['observations'][observation]['person_ext']


def test_upload_size_limit_is_reported(project, client, monkeypatch):
    from backend.app import annotation_import
    monkeypatch.setattr(annotation_import, 'MAX_UPLOAD_BYTES', 10)
    response = upload(client, project, b'{"long":"upload"}')
    assert response.status_code == 413
    assert db.snapshot(project[0]['id'])['revision'] == 0


def test_legacy_missing_person_id_has_canonical_undo_values(project, client):
    document, p, v, identity, segment, observation = document_for(project)
    document['schema_version'] = 1
    document['state']['identities'][identity] = {'id': identity, 'class_name': 'Legacy person', 'color': '#123456'}
    target = target_for(p, v)
    before = db.snapshot(target[0]['id'])['state']
    preview = upload(client, target, document).json()
    response = upload(client, target, document, preview=False, base_revision=preview['revision'], import_token=preview['import_token'])
    assert response.status_code == 200, response.text
    operation = response.json()['operation']
    state = db.snapshot(target[0]['id'])['state']
    for change in operation['changes']:
        # Frontend undo checks JSON.stringify equality, including object key order.
        assert json.dumps(change['after']) == json.dumps(state[change['collection']][change['id']])
    db.apply(target[0]['id'], Operation(id=uid(), base_revision=1, label='Undo legacy import', compensates=operation['id'], changes=[{**change, 'before': change['after'], 'after': change['before']} for change in operation['changes']]))
    assert db.snapshot(target[0]['id'])['state'] == before


@pytest.mark.parametrize('origin', ['model_track', 'copied_track', 'interpolated', 'model', 'copied', 'manual'])
def test_export_protection_matches_interpolation_for_starting_boxes(project, origin):
    p, v, identity, segment, observation = seeded(project)
    template = p['state']['observations'].pop(observation)
    cases = [(False, False), (True, False), (False, True)]
    for frame, (corrected, approved) in enumerate(cases):
        key = uid()
        p['state']['observations'][key] = {**copy.deepcopy(template), 'id': key, 'frame_index': frame,
            'review_state': 'approved' if approved else 'draft', 'person_ext': None,
            'provenance': {'person_visible': {'origin': origin, 'proposal_id': 'source-proposal' if origin.startswith('model') else None, 'human_corrected': corrected}}}
    save_fixture(p)
    rows = annotation_document(p['id'], v)['annotation_index']
    assert rows[0]['protected_from_interpolation'] is (origin not in ('model_track', 'copied_track', 'interpolated'))
    assert rows[1]['protected_from_interpolation'] is True
    assert rows[2]['protected_from_interpolation'] is True
    assert rows[0]['annotation_type'] == ('interpolated' if origin == 'interpolated' else 'keyframe')
    assert all(row['origin'] == origin for row in rows)
