import copy
import json
import uuid
import zipfile
from xml.etree import ElementTree as ET
import pytest
from backend.app import db
from backend.app.formats import cvat_xml,parse_cvat,yolo_rows,export_project
from backend.app.video import new_job
from backend.app.schema import MODELS
from test_domain import project,seeded

def test_yolo_dual_equal_keeps_distinct_classes_and_pair(project):
    p,v,i,s,o=seeded(project);obs=p['state']['observations'][o];obs['person_visible']=obs['person_ext'][:]
    text,pairs=yolo_rows([obs],640,360,'dual_class');rows=text.strip().splitlines()
    assert rows[0].startswith('0 ') and rows[1].startswith('1 ')
    assert rows[0][1:]==rows[1][1:] and pairs[0]['observation_id']==pairs[1]['observation_id']
    cx,cy,w,h=map(float,rows[0].split()[1:]);assert abs((cx-w/2)*640-10)<1e-5

def test_cvat_round_trip_unknown_and_outside_markers(project):
    p,v,i,s,o=seeded(project);d=p['state'];first=d['observations'][o];first['frame_index']=0
    second=copy.deepcopy(first);second.update(id=str(uuid.uuid4()),frame_index=2,person_ext=None,full_quality='unknown',evidence_note='Head only')
    d['observations'][second['id']]=second
    xml=cvat_xml(p,v);root=ET.fromstring(xml);tracks=root.findall('track');assert len(tracks)==2
    assert tracks[0].findall('box')[1].get('frame')=='1' and tracks[0].findall('box')[1].get('outside')=='1'
    empty=copy.deepcopy(p);empty['state']={k:{} for k in MODELS}
    changes,warnings=parse_cvat(xml,empty,v);obs=[c['after'] for c in changes if c['collection']=='observations'];assert len(obs)==2
    head=next(o for o in obs if o['frame_index']==2);assert head['person_ext'] is None and head['full_quality']=='unknown';assert head['person_visible']==second['person_visible']

def test_cvat_never_infers_person_from_track_id(project):
    p,v=project
    xml=b'<annotations><track id="999" label="person_ext"><box frame="0" outside="0" xtl="1" ytl="2" xbr="10" ybr="20"/></track></annotations>'
    changes,warnings=parse_cvat(xml,p,v)
    identity=next(c['after'] for c in changes if c['collection']=='identities');assert identity['person_id'] is None
    assert any('unpaired' in w for w in warnings)

def test_cvat_rejects_ambiguous_pair_and_entities(project):
    p,v=project
    track='<track id="1" label="person_ext"><box frame="0" xtl="1" ytl="2" xbr="10" ybr="20"><attribute name="person_id">1</attribute></box></track>'
    with pytest.raises(ValueError,match='Ambiguous'):parse_cvat(('<annotations>'+track+track+'</annotations>').encode(),p,v)
    with pytest.raises(Exception):parse_cvat(b'<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><annotations>&xxe;</annotations>',p,v)

def test_native_export_carries_history_and_frame_mapping(project):
    p,v=project;j=new_job(p['id'],'export');export_project(p['id'],{'format':'native'},j['id']);job=db.job_get(j['id']);assert job['status']=='completed'
    with db.connect() as c:path=json.loads(c.execute('SELECT data FROM exports WHERE id=?',(job['export_id'],)).fetchone()['data'])['path']
    with zipfile.ZipFile(path) as z:native=json.loads(z.read('native/project.json'));assert native['schema_version']==2 and v in native['frames'] and 'operations' in native

def test_incomplete_yolo_and_unreviewed_mot_block(project):
    p,v=project
    for fmt in ('dual_class','mot'):
        j=new_job(p['id'],'export');export_project(p['id'],{'format':fmt,'mot_profile':'motchallenge-1based-unknown-visibility'},j['id']);assert db.job_get(j['id'])['status']=='failed'

def test_mot_positive_numbering_and_selected_geometry(tmp_path):
    from test_video_restore import setup_video
    from backend.app.config import DATA
    pid,v=setup_video(tmp_path);p=db.snapshot(pid)
    p,v,i,s,o=seeded((p,v));obs=p['state']['observations'][o]
    obs.update(frame_index=0,person_ext=[10,10,100,80],person_visible=[20,20,90,70],review_state='draft')
    for f in range(5):
        rid=f'{v}:{f}';p['state']['reviews'][rid]=MODELS['reviews'](id=rid,video_id=v,frame_index=f,complete=True,checked_all_people=True).model_dump()
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,key,json.dumps(value)))
    job=new_job(pid,'export');export_project(pid,{'format':'mot','geometry':'person_visible','mot_profile':'motchallenge-1based-unknown-visibility'},job['id']);result=db.job_get(job['id']);assert result['status']=='completed',result
    with db.connect() as c:path=json.loads(c.execute('SELECT data FROM exports WHERE id=?',(result['export_id'],)).fetchone()['data'])['path']
    with zipfile.ZipFile(path) as z:
        assert z.read(f'{v}/gt/gt.txt').decode().strip()=='1,17,21.000000,21.000000,70.000000,50.000000,1,1,-1'
        assert len([n for n in z.namelist() if '/img1/' in n])==5
        assert len(json.loads(z.read(f'{v}/timing.json')))==5

def test_unknown_a_excludes_entire_dual_image_but_allows_reviewed_visible_image(tmp_path):
    from test_video_restore import setup_video
    pid,v=setup_video(tmp_path);p,v,i,s,o=seeded((db.snapshot(pid),v));obs=p['state']['observations'][o]
    obs.update(frame_index=0,person_ext=None,person_visible=[20,20,90,70],full_quality='unknown',evidence_note='Hidden posture',review_state='draft',occluded=None,truncated=None)
    for f in (0,1):
        rid=f'{v}:{f}';p['state']['reviews'][rid]=MODELS['reviews'](id=rid,video_id=v,frame_index=f,complete=True,checked_all_people=True).model_dump()
    with db.transaction() as c:
        for col,entities in p['state'].items():
            for key,value in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,key,json.dumps(value)))
    for profile,count in [('visible_only',2),('dual_class',1)]:
        job=new_job(pid,'export');export_project(pid,{'format':profile},job['id']);result=db.job_get(job['id']);assert result['status']=='completed',result
        with db.connect() as c:path=json.loads(c.execute('SELECT data FROM exports WHERE id=?',(result['export_id'],)).fetchone()['data'])['path']
        with zipfile.ZipFile(path) as z:
            assert len([n for n in z.namelist() if n.startswith('images/')])==count
            assert z.read(f'labels/train/{v}_00000001.txt')==b''
            if profile=='dual_class':assert any(x['frame_index']==0 and ('Unknown full' in x['reason'] or 'invalid' in x['reason']) for x in json.loads(z.read('exclusions.json')))

def test_visible_cvat_has_one_class_and_retains_original_a_in_state(project):
    p,v,i,s,o=seeded(project);original=copy.deepcopy(p)
    root=ET.fromstring(cvat_xml(p,v,visible_only=True))
    assert [t.get('label') for t in root.findall('track')]==['person_visible']
    assert [e.text for e in root.findall('.//labels/label/name')]==['person_visible']
    assert p==original
