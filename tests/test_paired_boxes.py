import copy
import json
import uuid
import pytest
from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.schema import validate_state, Operation
from test_domain import project, seeded


def persist(p):
    with db.transaction() as c:
        for col, entities in p['state'].items():
            for key, value in entities.items():
                c.execute('INSERT INTO entities VALUES(?,?,?,?)', (p['id'], col, key, json.dumps(value)))


def test_export_pairs_geometry_and_keeps_per_type_labels_and_keyframes(project):
    p, v, i, s, oid = seeded(project)
    p['state']['identities'][i]['box_styles'] = {
        'person_visible': {'class_name': 'Visible worker', 'color': '#123456'},
        'person_ext': {'class_name': 'Full worker', 'color': '#abcdef'}}
    o = p['state']['observations'][oid]
    o['provenance'] = {'person_visible': {'origin': 'manual', 'human_corrected': False, 'proposal_id': None},
                       'person_ext': {'origin': 'interpolated', 'human_corrected': False, 'proposal_id': None}}
    persist(p)
    doc = annotation_document(p['id'], v)
    assert doc['schema_version'] == 3 and doc['media_included'] is False
    visible, extended = doc['annotation_index']
    assert visible['identity_uuid'] == extended['identity_uuid'] == i
    assert visible['person_id'] == extended['person_id'] == 17
    assert visible['observation_id'] == extended['observation_id'] == oid
    assert visible['box_type'] == 'person_visible' and visible['class_name'] == 'Visible worker'
    assert extended['box_type'] == 'person_extended' and extended['class_name'] == 'Full worker'
    assert visible['annotation_type'] == 'keyframe' and extended['annotation_type'] == 'interpolated'
    assert extended['color'] == '#abcdef' and extended['box_xyxy'] == o['person_ext']
    assert doc['frame_annotations'][0]['boxes'] == {'person_visible': o['person_visible'], 'person_ext': o['person_ext']}
    assert doc['summary']['people'] == 1 and doc['summary']['extended_boxes'] == 1


def test_extended_box_is_not_visible_evidence_and_visible_gap_does_not_forbid_it(project):
    p, v, i, s, oid = seeded(project)
    o = p['state']['observations'][oid];o['person_visible'] = None
    p['state']['intervals']['g'] = {'id':'g','video_id':v,'identity_uuid':i,'start':90,'end':110,
        'reason':'unknown','evidence_note':'','geometry':'person_visible'}
    validate_state(p['state'], p['videos'], visible_only=True)
    persist(p)
    doc = annotation_document(p['id'], v)
    assert doc['annotation_index'][0]['visibility'] == 'not_visible'
    assert doc['annotation_index'][0]['box_type'] == 'person_extended'
    assert all(row['status'] == 'not_visible' for row in doc['visibility_intervals'])
    p['state']['intervals']['g']['geometry'] = 'person_ext'
    with pytest.raises(ValueError, match='gap'):
        validate_state(p['state'], p['videos'], visible_only=True)


def test_scoped_gap_operation_and_undo_preserve_both_boxes_and_style(project):
    p, v, i, s, oid = seeded(project);persist(p)
    old = copy.deepcopy(p['state']['observations'][oid]);new = copy.deepcopy(old)
    new['person_visible'] = None
    gap = {'id':'g','video_id':v,'identity_uuid':i,'start':99,'end':99,'reason':'unknown','evidence_note':'','geometry':'person_visible'}
    op = Operation(id=str(uuid.uuid4()),base_revision=0,label='Delete visible only',changes=[
        {'collection':'observations','id':oid,'before':old,'after':new},
        {'collection':'intervals','id':'g','before':None,'after':gap}])
    db.apply(p['id'],op)
    assert db.snapshot(p['id'])['state']['observations'][oid]['person_ext'] == old['person_ext']
    inverse = [{'collection':ch.collection,'id':ch.id,'before':ch.after,'after':ch.before} for ch in op.changes]
    db.apply(p['id'],Operation(id=str(uuid.uuid4()),base_revision=1,label='Undo',compensates=op.id,changes=inverse))
    assert db.snapshot(p['id'])['state'] == p['state']
