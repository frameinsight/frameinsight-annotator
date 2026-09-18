import json,uuid
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import db
from backend.app.schema import MODELS,Operation

def test_local_only_hosts_origins_and_traversal():
    with TestClient(app) as client:
        assert client.get('/api/projects',headers={'Host':'attacker.example'}).status_code==403
        assert client.post('/api/projects',json={'name':'bad'},headers={'Origin':'https://attacker.example'}).status_code==403
        pid=client.post('/api/projects',json={'name':'API test'}).json()['id']
        assert client.post(f'/api/projects/{pid}/videos/local',json={'path':'/etc/passwd'}).status_code==422
        assert client.get('/api/videos/missing/metadata').status_code==404
        assert client.get('/api/worker').json()['running'] is False

def test_late_proposal_cannot_overwrite_human_geometry():
    db.init();pid=str(uuid.uuid4());vid=str(uuid.uuid4());ident=str(uuid.uuid4());seg=str(uuid.uuid4());obs=str(uuid.uuid4())
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'late proposal',db.now()));c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps({'id':vid,'width':640,'height':360,'frame_count':2})))
    changes=[]
    for col,value in [('identities',MODELS['identities'](id=ident)),('segments',MODELS['segments'](id=seg,video_id=vid,identity_uuid=ident,start=0)),('observations',MODELS['observations'](id=obs,video_id=vid,frame_index=0,identity_uuid=ident,segment_id=seg,person_ext=[10,10,80,200]))]:changes.append({'collection':col,'id':value.id,'before':None,'after':value.model_dump(mode='json')})
    db.apply(pid,Operation(id=str(uuid.uuid4()),base_revision=0,label='manual draw',changes=changes))
    proposal={'id':str(uuid.uuid4()),'box':[1,2,50,120]}
    with db.transaction() as c:c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)',(proposal['id'],vid,0,'model-key',json.dumps(proposal)))
    assert db.snapshot(pid)['state']['observations'][obs]['person_ext']==[10,10,80,200]

def test_approved_edit_requires_downgrade_and_exact_compensation():
    from test_domain import seeded
    db.init();pid=str(uuid.uuid4());vid=str(uuid.uuid4())
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'approval',db.now()));c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps({'id':vid,'width':640,'height':360,'frame_count':200})))
    p,v,i,s,o=seeded((db.snapshot(pid),vid));p['state']['observations'][o]['review_state']='approved'
    # Seed fixture directly: new identity plus approval in one app command is intentionally not allowed.
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,key,json.dumps(value)))
    old=p['state']['observations'][o];new={**old,'person_ext':[5,5,100,200]}
    import pytest
    with pytest.raises(ValueError,match='downgrade'):db.apply(pid,Operation(id=str(uuid.uuid4()),base_revision=0,label='bad approved edit',changes=[{'collection':'observations','id':o,'before':old,'after':new}]))

def test_reject_proposal_is_separate_undoable_and_frame_bound():
    db.init();pid=str(uuid.uuid4());vid=str(uuid.uuid4());proposal_id=str(uuid.uuid4())
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'reject proposal',db.now()));c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps({'id':vid,'width':640,'height':360,'frame_count':3})));c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)',(proposal_id,vid,1,'model',json.dumps({'id':proposal_id})))
    value={'id':proposal_id,'proposal_id':proposal_id,'video_id':vid,'frame_index':1,'decision':'rejected','reason':'Static doorway curtain, not a person'}
    op=Operation(id=str(uuid.uuid4()),base_revision=0,label='reject',changes=[{'collection':'proposal_reviews','id':proposal_id,'before':None,'after':value}]);db.apply(pid,op)
    assert not db.snapshot(pid)['state']['observations']
    undo=Operation(id=str(uuid.uuid4()),base_revision=1,label='undo reject',compensates=op.id,changes=[{'collection':'proposal_reviews','id':proposal_id,'before':value,'after':None}]);db.apply(pid,undo)
    assert not db.snapshot(pid)['state']['proposal_reviews']
    value['frame_index']=2
    import pytest
    with pytest.raises(ValueError,match='original video/frame'):db.apply(pid,Operation(id=str(uuid.uuid4()),base_revision=2,label='wrong frame',changes=[{'collection':'proposal_reviews','id':proposal_id,'before':None,'after':value}]))
