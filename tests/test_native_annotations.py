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
