import copy
import json
import uuid
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.formats import export_project
from backend.app.main import app
from backend.app.schema import MODELS, Operation
from backend.app.video import new_job
from test_domain import project, seeded


def test_annotation_json_preserves_every_saved_collection_and_history_without_media(project):
    p,v,i,s,o=seeded(project)
    p['state']['identities'][i].update(class_name='Worker',color='#ff7700')
    p['state']['observations'][o].update(person_ext=None, full_quality='unknown', occluded=None, truncated=None,
        provenance={'person_visible': {'origin':'interpolated','human_corrected':True,'proposal_id':None}},
        evidence_note='Correction: head and shoulder only — visible evidence')
    gap_id=str(uuid.uuid4())
    p['state']['intervals'][gap_id]=MODELS['intervals'](id=gap_id,video_id=v,identity_uuid=i,start=110,end=120,reason='occlusion',evidence_note='Behind wall').model_dump()
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(p['id'],col,key,json.dumps(value)))
        c.execute('INSERT INTO frames VALUES(?,?,?)',(v,99,json.dumps({'frame_index':99,'pts':3300,'time_base_num':1,'time_base_den':1000,'seconds':3.3,'key_frame':False,'decode_state':'ready'})))
        proposal={'id':'proposal','video_id':v,'frame_index':99,'geometry':'person_visible','confidence':.85,'box':[20,20,90,100],'cache_key':'cache'}
        c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)',('proposal',v,99,'cache',json.dumps(proposal)))
        c.execute('INSERT INTO proposal_frames VALUES(?,?,?)',(v,'cache',99))
    old=copy.deepcopy(p['state']['observations'][o]);updated={**old,'person_visible':[21,20,90,100]}
    db.apply(p['id'],Operation(id=str(uuid.uuid4()),base_revision=0,label='Correct visible box',changes=[{'collection':'observations','id':o,'before':old,'after':updated}]))
    current=db.snapshot(p['id'])
    # Document construction remains media-free; final delivery separately requires
    # the full-video review proof exercised in test_review_delivery.py.
    document=json.loads(json.dumps(annotation_document(p['id']),allow_nan=False))
    assert document['format']=='frameinsight.annotations' and document['media_included'] is False
    assert document['state']==current['state'] and document['videos']==current['videos']
    assert document['project']['revision']==1 and document['summary']['whole_frames_checked']==0
    annotation=document['annotation_index'][0]
    assert annotation['class_name']=='Worker' and annotation['color']=='#ff7700'
    assert document['conventions']['active_classes']==['Worker']
    assert annotation['box_xywh']==[21,20,69,80] and annotation['timestamp_seconds']==3.3
    assert annotation['annotation_type']=='keyframe' and annotation['origin']=='interpolated' and annotation['human_corrected']
    assert document['operations'][0]['changes'][0]['before']==old
    assert document['operations'][0]['recorded_at'] and document['operations'][0]['revision']==1
    assert document['detector']['proposals']==[proposal] and document['detector']['processed_frames'][0]['frame_index']==99



def test_empty_annotations_and_unannotated_frames_are_not_invented(project):
    p,v=project;doc=annotation_document(p['id'])
    assert doc['annotation_index']==[] and doc['summary']['visible_boxes']==0
    assert doc['frames'][v]==[] and doc['state']['reviews']=={}
    assert doc['conventions']['active_classes']==['person_visible']


def test_uncorrected_interpolation_and_unknown_timestamp_remain_explicit(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o]
    obs.update(person_ext=None,provenance={'person_visible':{'origin':'interpolated','proposal_id':None,'human_corrected':False}})
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(p['id'],col,key,json.dumps(value)))
    row=annotation_document(p['id'])['annotation_index'][0]
    assert row['annotation_type']=='interpolated' and row['timestamp_seconds'] is None
    assert not row['protected_from_interpolation']
