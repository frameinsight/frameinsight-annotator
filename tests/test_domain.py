import copy
import json
import uuid
import pytest
from backend.app import db
from backend.app.schema import Operation, Observation, validate_state, issues, MODELS

def uid():return str(uuid.uuid4())
@pytest.fixture
def project():
    db.init();pid=uid();vid=uid()
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'test',db.now()))
        video={'id':vid,'name':'fixture','width':640,'height':360,'frame_count':200,'status':'ready','nominal_fps':29.97,'source_hash':'fixture'}
        c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps(video)))
    return db.snapshot(pid),vid

def seeded(project):
    p,v=project;i=uid();s=uid();o=uid()
    d=p['state'];d['identities'][i]=MODELS['identities'](id=i,person_id=17).model_dump()
    d['segments'][s]=MODELS['segments'](id=s,video_id=v,identity_uuid=i,start=0).model_dump()
    d['observations'][o]=Observation(id=o,video_id=v,frame_index=99,identity_uuid=i,segment_id=s,person_ext=[10,10,100,200],person_visible=[20,20,90,100],full_quality='estimated',occluded=True,truncated=False).model_dump(mode='json')
    return p,v,i,s,o

def test_containment_draft_preserved_and_approval_blocked(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o];obs['person_visible'][0]=0
    validate_state(p['state'],p['videos']);assert 'B extends outside A' in issues(obs)
    obs['review_state']='approved'
    with pytest.raises(ValueError,match='outside'):validate_state(p['state'],p['videos'])
    assert obs['person_ext']==[10,10,100,200] and obs['person_visible'][0]==0

def test_unknown_full_is_valid_visible_observation(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o]
    obs.update(person_ext=None,full_quality='unknown',evidence_note='Only head visible; no supported posture',review_state='approved')
    validate_state(p['state'],p['videos']);assert not issues(obs)
    obs['evidence_note']=''
    with pytest.raises(ValueError,match='note'):validate_state(p['state'],p['videos'])

def test_gap_100_through_179_excludes_boxes(project):
    p,v,i,s,o=seeded(project);d=p['state'];gid=uid()
    d['intervals'][gid]=MODELS['intervals'](id=gid,video_id=v,identity_uuid=i,start=100,end=179,reason='occlusion').model_dump()
    validate_state(d,p['videos'])
    for f in (100,120,179):
        d['observations'][o]['frame_index']=f
        with pytest.raises(ValueError,match='gap'):validate_state(d,p['videos'])
    d['observations'][o]['frame_index']=180;validate_state(d,p['videos'])

def test_duplicate_identity_and_numeric_ids(project):
    p,v,i,s,o=seeded(project);d=p['state'];j=uid();d['identities'][j]={'id':j,'person_id':17,'name':''}
    with pytest.raises(ValueError,match='already assigned'):validate_state(d,p['videos'])
    del d['identities'][j];second=copy.deepcopy(d['observations'][o]);second['id']=uid();d['observations'][second['id']]=second
    with pytest.raises(ValueError,match='Two observations'):validate_state(d,p['videos'])

def test_completeness_requires_all_approved_and_explicit_check(project):
    p,v,i,s,o=seeded(project);d=p['state'];rid=f'{v}:99';d['reviews'][rid]=MODELS['reviews'](id=rid,video_id=v,frame_index=99,complete=True).model_dump()
    with pytest.raises(ValueError,match='Confirm'):validate_state(d,p['videos'])
    d['reviews'][rid]['checked_all_people']=True
    with pytest.raises(ValueError,match='invalid observations'):validate_state(d,p['videos'])
    d['observations'][o]['review_state']='approved';validate_state(d,p['videos'])

def test_operations_idempotence_conflicts_and_undo(project):
    p,v=project;i=uid();value={'id':i,'person_id':None,'name':'Draft'}
    op=Operation(id=uid(),base_revision=0,label='new',changes=[{'collection':'identities','id':i,'before':None,'after':value}])
    assert db.apply(p['id'],op)['revision']==1
    assert db.apply(p['id'],op)['duplicate']
    with pytest.raises(db.Conflict):db.apply(p['id'],op.model_copy(update={'id':uid()}))
    undo=Operation(id=uid(),base_revision=1,label='undo',compensates=op.id,changes=[{'collection':'identities','id':i,'before':value,'after':None}])
    db.apply(p['id'],undo);assert not db.snapshot(p['id'])['state']['identities']
    with pytest.raises(ValueError,match='reused'):db.apply(p['id'],op.model_copy(update={'label':'tampered'}))

def test_invalid_coordinates_and_unresolved_segment(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o]
    for box in ([0,0,0,20],[-1,0,20,30],[0,0,641,30],[0,0,float('nan'),40]):
        obs['person_ext']=box
        with pytest.raises(ValueError,match='boundaries'):validate_state(p['state'],p['videos'])
    obs['person_ext']=[10,10,100,200];obs['review_state']='approved';p['state']['segments'][s]['status']='unresolved'
    with pytest.raises(ValueError,match='identity'):validate_state(p['state'],p['videos'])

def test_equal_boxes_count_one_person(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o];obs.update(person_visible=obs['person_ext'][:],geometry_link='equal',occluded=False,full_quality='observed',review_state='approved')
    validate_state(p['state'],p['videos']);assert len(p['state']['identities'])==1 and len(p['state']['observations'])==1

def test_numeric_id_rename_after_100_observations_keeps_one_identity(project):
    from backend.app.formats import cvat_xml
    from xml.etree import ElementTree as ET
    p,v,i,s,o=seeded(project);base=p['state']['observations'].pop(o)
    for f in range(100):
        key=uid();p['state']['observations'][key]={**base,'id':key,'frame_index':f}
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(p['id'],col,key,json.dumps(value)))
    old=p['state']['identities'][i];new={**old,'person_id':42}
    db.apply(p['id'],Operation(id=uid(),base_revision=0,label='Assign ID after 100 observations',changes=[{'collection':'identities','id':i,'before':old,'after':new}]))
    renamed=db.snapshot(p['id']);assert len(renamed['state']['identities'])==1
    root=ET.fromstring(cvat_xml(renamed,v));assert len(root.findall('track'))==2
    assert all(a.text=='42' for a in root.findall('.//attribute[@name="person_id"]'))
    assert all(o['identity_uuid']==i for o in renamed['state']['observations'].values())

def test_visible_only_approval_accepts_optional_metadata_and_retains_legacy_a(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o]
    obs.update(person_ext=None,full_quality='unknown',occluded=None,truncated=None,evidence_note='',review_state='approved')
    validate_state(p['state'],p['videos'],visible_only=True)
    obs['person_ext']=[30,30,40,40]  # historical A need not contain the current B
    validate_state(p['state'],p['videos'],visible_only=True)
    obs['person_visible']=None
    validate_state(p['state'],p['videos'],visible_only=True)  # An extended-only box is valid in the simplified paired workflow.
    obs['person_ext']=None
    with pytest.raises(ValueError,match='Missing box'):validate_state(p['state'],p['videos'],visible_only=True)
    obs['person_visible']=[-1,0,10,10]
    with pytest.raises(ValueError):validate_state(p['state'],p['videos'],visible_only=True)

def test_visible_frame_check_does_not_require_individual_approvals(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o]
    obs.update(person_ext=None,full_quality='unknown',occluded=None,truncated=None,review_state='draft')
    rid=f'{v}:99'
    p['state']['reviews'][rid]=MODELS['reviews'](id=rid,video_id=v,frame_index=99,complete=True,checked_all_people=True).model_dump()
    validate_state(p['state'],p['videos'],visible_only=True)
    p['state']['segments'][s]['status']='unresolved'
    with pytest.raises(ValueError,match='identities'):validate_state(p['state'],p['videos'],visible_only=True)
    p['state']['segments'][s]['status']='verified';obs['person_visible']=None
    with pytest.raises(ValueError,match='invalid'):validate_state(p['state'],p['videos'],visible_only=True)
