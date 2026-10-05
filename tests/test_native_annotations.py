import copy
import json
import uuid
import pytest
from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.annotation_import import preview
from backend.app.schema import MODELS, Operation
from test_delete_video import client, add_video


@pytest.fixture
def exported(client):
    p = client.post('/api/projects', json={'name': 'Source', 'classes': ['Visible', 'Extended']}).json()
    v = add_video(p['id'])
    db.update_video(v['id'], source_hash='same-video')
    identity = MODELS['identities'](id='who', person_id=7, box_styles={
        'class:Visible': {'class_name': 'Visible', 'color': '#38bdf8'},
        'class:Extended': {'class_name': 'Extended', 'color': '#a3e635'}})
    segment = MODELS['segments'](id='segment', video_id=v['id'], identity_uuid='who', start=0, end=23)
    entities = [('identities', identity), ('segments', segment)]
    for f in (0, 1, 10):
        entities.append(('observations', MODELS['observations'](id=str(f), video_id=v['id'], identity_uuid='who', segment_id='segment', frame_index=f,
            boxes={'class:Visible': [1, 2, 30, 40], 'class:Extended': [1, 2, 30, 60]},
            provenance={g: {'origin': 'interpolated' if f == 1 else 'manual', 'human_corrected': False} for g in ('class:Visible', 'class:Extended')})))
    entities.append(('intervals', MODELS['intervals'](id='gap', video_id=v['id'], identity_uuid='who', start=12, end=18, geometry='class:Visible', reason='unknown')))
    db.apply(p['id'], Operation(id=str(uuid.uuid4()), base_revision=0, label='Seed', changes=[{'collection': col, 'id': row.id, 'before': None, 'after': row.model_dump(mode='json')} for col, row in entities]))
    document = annotation_document(p['id'], v['id'])
    target = client.post('/api/projects', json={'name': 'Destination', 'classes': ['Visible', 'Extended']}).json()
    video = add_video(target['id'])
    db.update_video(video['id'], source_hash='same-video')
    return document, db.snapshot(target['id']), video['id']


def inspect(doc, p, v):
    return preview(json.dumps(doc).encode(), 'export.json', p, v, 'frameinsight')


def test_round_trip_preserves_boxes_ids_classes_provenance_and_gaps(exported):
    doc, p, v = exported
    result = inspect(doc, p, v)
    assert result['mapping'] == [{'source': 7, 'track_id': 7}]
    assert result['summary']['boxes'] == 6
    assert db.snapshot(p['id']) == p
    db.apply(p['id'], Operation(id='import', base_revision=p['revision'], label='Import JSON', changes=result['changes']))
    again = annotation_document(p['id'], v)
    fields = ['frame_index', 'track_id', 'class_name', 'box_xyxy', 'color', 'origin', 'human_corrected', 'annotation_type']
    def comparable(document):
        return sorted([tuple(json.dumps(row[k]) for k in fields) for row in document['annotation_index']])
    assert comparable(again) == comparable(doc)
    gap = next(iter(again['state']['intervals'].values()))
    assert (gap['start'], gap['end'], gap['geometry']) == (12, 18, 'class:Visible')
    assert set(again['state']['identities']).isdisjoint(doc['state']['identities'])
    inverse = [{**c, 'before': c['after'], 'after': None} for c in result['changes']]
    db.apply(p['id'], Operation(id='undo', base_revision=1, label='Undo', compensates='import', changes=inverse))
    assert db.snapshot(p['id'])['state'] == p['state']


@pytest.mark.parametrize('damage,match', [
    ('hash', 'SHA-256'), ('size', 'dimensions'), ('missing-id', 'numeric ID'),
    ('identity', 'Missing identity'), ('duplicate', 'same identity'), ('gap', 'gap'), ('format', 'version'),
])
def test_rejects_invalid_or_wrong_video_without_mutation(exported, damage, match):
    doc, p, v = exported
    source = next(iter(doc['videos'].values()))
    if damage == 'hash': source['source_hash'] = 'different'
    if damage == 'size': source['width'] += 1
    if damage == 'missing-id': doc['state']['identities']['who']['person_id'] = None
    if damage == 'identity': doc['state']['observations']['0']['identity_uuid'] = 'absent'
    if damage == 'duplicate': doc['state']['observations']['duplicate'] = {**doc['state']['observations']['0'], 'id': 'duplicate'}
    if damage == 'gap': doc['state']['intervals']['gap']['start'] = 0
    if damage == 'format': doc['schema_version'] = 99
    with pytest.raises(ValueError, match=match): inspect(doc, p, v)
    assert db.snapshot(p['id']) == p


def test_existing_ids_are_remapped_and_import_endpoint_is_read_only(exported, client):
    doc, p, v = exported
    db.apply(p['id'], Operation(id='existing', base_revision=0, label='Existing', changes=[{'collection':'identities','id':'existing','before':None,'after':MODELS['identities'](id='existing',person_id=7).model_dump(mode='json')}]))
    p = db.snapshot(p['id'])
    response = client.post(f'/api/projects/{p["id"]}/imports/annotations/preview?video_id={v}',files={'file':('export.json',json.dumps(doc))},data={'format':'frameinsight'})
    assert response.status_code == 200, response.text
    assert response.json()['mapping'] == [{'source':7,'track_id':1}]
    assert db.snapshot(p['id']) == p


def test_native_import_keeps_id_used_only_in_another_video(exported):
    doc, p, v = exported
    other = add_video(p['id'])['id']
    rows = [('identities', MODELS['identities'](id='other', person_id=7)),
            ('segments', MODELS['segments'](id='other', video_id=other, identity_uuid='other', start=0))]
    db.apply(p['id'], Operation(id='other', base_revision=0, label='Other video', changes=[
        {'collection': col, 'id': row.id, 'before': None, 'after': row.model_dump(mode='json')} for col, row in rows]))
    p = db.snapshot(p['id'])
    result = inspect(doc, p, v)
    assert result['mapping'] == [{'source': 7, 'track_id': 7}]
    db.apply(p['id'], Operation(id='import', base_revision=p['revision'], label='Import', changes=result['changes']))
    assert next(iter(annotation_document(p['id'], v)['state']['identities'].values()))['person_id'] == 7


def test_replace_is_video_scoped_preserves_ids_and_undo_restores_every_entity(exported):
    doc, p, v = exported
    imported = inspect(doc, p, v)
    db.apply(p['id'], Operation(id='first', base_revision=0, label='Seed', changes=imported['changes']))
    before = db.snapshot(p['id'])
    who = imported['changes'][0]['id']
    other = add_video(p['id'])['id']
    # An old cross-video identity must survive, with its other video untouched.
    rows = [('segments', MODELS['segments'](id='shared-segment', video_id=other, identity_uuid=who, start=0)),
            ('observations', MODELS['observations'](id='other-box', video_id=other, identity_uuid=who, segment_id='shared-segment', frame_index=0, boxes={'class:Visible':[3,4,30,40]})),
            ('identities', MODELS['identities'](id='only-here', person_id=8)),
            ('segments', MODELS['segments'](id='only-here', video_id=v, identity_uuid='only-here', start=0)),
            ('links', MODELS['links'](id='link', source=who, target='only-here', relation='different', evidence_note='test')),
            ('reviews', MODELS['reviews'](id='review', video_id=v, frame_index=0)),
            ('reviews', MODELS['reviews'](id='other-review', video_id=other, frame_index=0))]
    db.apply(p['id'], Operation(id='shared', base_revision=before['revision'], label='Shared', changes=[
        {'collection':col,'id':row.id,'before':None,'after':row.model_dump(mode='json')} for col,row in rows]))
    before = db.snapshot(p['id'])
    result = preview(json.dumps(doc).encode(), 'labels.json', before, v, 'frameinsight', mode='replace')
    assert result['mapping'] == [{'source':7,'track_id':7}]
    assert result['replaced'] == {'tracks':2,'boxes':6}
    assert db.snapshot(p['id']) == before  # confirmation/preview is read-only
    db.apply(p['id'], Operation(id='replace', base_revision=before['revision'], label='Replace', changes=result['changes']))
    after = db.snapshot(p['id'])
    assert after['state']['identities'][who] == before['state']['identities'][who]
    for col, key in [('segments','shared-segment'), ('observations','other-box'), ('reviews','other-review')]:
        assert after['state'][col][key] == before['state'][col][key]
    assert 'only-here' not in after['state']['identities'] and not after['state']['links']
    assert 'review' not in after['state']['reviews']
    assert len([o for o in after['state']['observations'].values() if o['video_id'] == v]) == 3
    inverse = [{**c,'before':c['after'],'after':c['before']} for c in result['changes']]
    db.apply(p['id'], Operation(id='undo-replace', base_revision=after['revision'], label='Undo', compensates='replace', changes=inverse))
    assert db.snapshot(p['id'])['state'] == before['state']
    db.apply(p['id'], Operation(id='redo-replace', base_revision=after['revision']+1, label='Redo', compensates='undo-replace', changes=result['changes']))
    assert db.snapshot(p['id'])['state'] == after['state']


def test_replace_preview_validates_before_mutation_and_rejects_stale_apply(exported, client):
    doc, p, v = exported
    route = f'/api/projects/{p["id"]}/imports/annotations/preview?video_id={v}'
    def request(document, mode='replace', format='frameinsight'):
        return client.post(route, files={'file':('labels.json',json.dumps(document))},data={'format':format,'mode':mode})
    invalid = copy.deepcopy(doc); invalid['state']['identities']['who']['person_id'] = None
    assert request(invalid).status_code == 422
    assert request(doc, 'unknown').status_code == 422
    assert request(doc, format='yolo').status_code == 422
    assert db.snapshot(p['id']) == p
    result = request(doc).json()
    assert result['mode'] == 'replace'
    initial = inspect(doc, p, v)
    db.apply(p['id'], Operation(id='competing', base_revision=0, label='Another edit', changes=initial['changes']))
    state = db.snapshot(p['id'])['state']
    response = client.post(f'/api/projects/{p["id"]}/operations',json={'id':'stale','base_revision':0,'label':'Replace','changes':result['changes']})
    assert response.status_code == 409
    assert db.snapshot(p['id'])['state'] == state
