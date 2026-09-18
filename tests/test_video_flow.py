import json
import uuid
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import db
from backend.app.annotation_export import annotation_document
from backend.app.schema import MODELS,Operation
from test_domain import project,seeded


@pytest.fixture(autouse=True)
def isolated_database(tmp_path,monkeypatch):
    monkeypatch.setattr(db,'DB',tmp_path/'video-flow.sqlite3')
    db.init()

def test_classes_are_validated_persisted_and_can_be_added():
    with TestClient(app) as client:
        response=client.post('/api/projects',json={'name':'Video classes','classes':[' Worker ','Customer']})
        assert response.status_code==200
        p=response.json();assert p['classes']==['Worker','Customer']
        for classes in ([''],['x','x'],['a'*81]):assert client.post('/api/projects',json={'name':'Invalid','classes':classes}).status_code==422
        assert client.post('/api/projects/'+p['id']+'/classes',json={'name':' Visitor '}).json()['classes']==['Worker','Customer','Visitor']
        assert client.post('/api/projects/'+p['id']+'/classes',json={'name':'Visitor'}).json()['classes']==['Worker','Customer','Visitor']
        assert client.get('/api/projects/'+p['id']).json()['classes']==['Worker','Customer','Visitor']


def test_finish_requires_confirmation_current_revision_and_ready_video(project):
    p,v=project
    with TestClient(app) as client:
        assert client.post('/api/videos/'+v+'/finish',json={'confirmed':False,'revision':0}).status_code==422
        assert client.post('/api/videos/'+v+'/finish',json={'confirmed':True,'revision':1}).status_code==409
        r=client.post('/api/videos/'+v+'/finish',json={'confirmed':True,'revision':0});assert r.status_code==200
        assert r.json()['finished_revision']==0
        assert next(x for x in client.get('/api/video-library').json() if x['id']==v)['finished']
        # Finishing never fabricates per-frame review decisions.
        assert client.get('/api/projects/'+p['id']).json()['state']['reviews']=={}
        i=str(uuid.uuid4());value={'id':i,'person_id':None,'name':'Person'}
        db.apply(p['id'],Operation(id=str(uuid.uuid4()),base_revision=0,label='Edit after finish',changes=[{'collection':'identities','id':i,'before':None,'after':value}]))
        assert not next(x for x in client.get('/api/video-library').json() if x['id']==v)['finished']
        db.update_video(v,status='indexing')
        assert client.post('/api/videos/'+v+'/finish',json={'confirmed':True,'revision':1}).status_code==422


def test_selected_video_json_excludes_other_video_annotations_and_history(project):
    p,v,i,s,o=seeded(project)
    other=str(uuid.uuid4());other_person=str(uuid.uuid4());other_segment=str(uuid.uuid4());other_obs=str(uuid.uuid4())
    with db.transaction() as c:
        c.execute('INSERT INTO videos VALUES(?,?,?)',(other,p['id'],json.dumps({**p['videos'][v],'id':other})))
        for col,rows in p['state'].items():
            for key,value in rows.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(p['id'],col,key,json.dumps(value)))
    changes=[]
    for col,value in [('identities',MODELS['identities'](id=other_person,person_id=99).model_dump()),('segments',MODELS['segments'](id=other_segment,video_id=other,identity_uuid=other_person,start=0).model_dump()),('observations',MODELS['observations'](id=other_obs,video_id=other,identity_uuid=other_person,segment_id=other_segment,frame_index=5,person_visible=[1,1,20,30]).model_dump(mode='json'))]:changes.append({'collection':col,'id':value['id'],'before':None,'after':value})
    db.apply(p['id'],Operation(id=str(uuid.uuid4()),base_revision=0,label='Other video',video_id=other,changes=changes))
    doc=annotation_document(p['id'],v)
    assert list(doc['videos'])==[v] and list(doc['state']['observations'])==[o]
    assert list(doc['state']['identities'])==[i] and doc['operations']==[]
    assert doc['video_scope']==v and not doc['media_included']
