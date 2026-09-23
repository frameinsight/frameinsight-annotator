import copy
import json
import time
import uuid
from fractions import Fraction
from pathlib import Path

import av
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from backend.app import db, review_delivery as review, formats
from backend.app.annotation_export import annotation_document
from backend.app.main import app
from backend.app.schema import MODELS, Operation
from backend.app.video import sha256, new_job
from backend.app.review_validation import validate_document, group_warnings


class ImmediatePool:
    def submit(self, fn, *args): fn(*args)


@pytest.fixture
def reviewed_project(tmp_path, monkeypatch):
    import backend.app.main as main
    monkeypatch.setattr(db, 'DB', tmp_path/'review.sqlite3')
    monkeypatch.setattr(review, 'DATA', tmp_path)
    monkeypatch.setattr(formats, 'DATA', tmp_path)
    monkeypatch.setattr(main, 'DATA', tmp_path)
    monkeypatch.setattr(review, 'POOL', ImmediatePool())
    (tmp_path/'exports').mkdir(); db.init()
    source = tmp_path/'source.mp4'
    pts = [100, 140, 220, 260, 380, 420]
    with av.open(str(source), 'w') as output:
        stream = output.add_stream('libx264', rate=25)
        stream.width, stream.height = 160, 120
        stream.pix_fmt = 'yuv420p'; stream.time_base = Fraction(1, 1000); stream.codec_context.time_base = Fraction(1, 1000)
        stream.options = {'bf': '0', 'preset': 'ultrafast', 'crf': '10'}
        for i, t in enumerate(pts):
            frame = av.VideoFrame.from_image(Image.new('RGB',(160,120),(20+i*10,20,20)))
            frame.time_base = Fraction(1,1000); frame.pts = t
            for packet in stream.encode(frame): output.mux(packet)
        for packet in stream.encode(): output.mux(packet)
    ledger = []
    with av.open(str(source)) as container:
        s = container.streams.video[0]
        for n, f in enumerate(container.decode(s)):
            ledger.append({'frame_index':n,'pts':f.pts,'time_base_num':f.time_base.numerator,'time_base_den':f.time_base.denominator,'seconds':float(f.pts*f.time_base),'decode_state':'ready','key_frame':f.key_frame})
    pid, vid, ident, segment = [str(uuid.uuid4()) for _ in range(4)]
    video = {'id':vid,'project_id':pid,'name':'vfr.mp4','source':str(source),'source_hash':sha256(source),'width':160,'height':120,'frame_count':6,'nominal_fps':25,'stream_index':0,'status':'ready'}
    identity = MODELS['identities'](id=ident,person_id=1,box_styles={'person_visible':{'class_name':'person_visible','color':'#22d3ee'},'person_ext':{'class_name':'person_extended','color':'#fb923c'}}).model_dump()
    seg = MODELS['segments'](id=segment,video_id=vid,identity_uuid=ident,start=0).model_dump()
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at,classes) VALUES(?,?,?,?)',(pid,'review fixture',db.now(),json.dumps(['person_visible','person_extended'])))
        c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps(video)))
        c.executemany('INSERT INTO frames VALUES(?,?,?)',[(vid,f['frame_index'],json.dumps(f)) for f in ledger])
        for col,value in [('identities',identity),('segments',seg)]:c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,value['id'],json.dumps(value)))
        for n in range(6):
            o=MODELS['observations'](id=str(uuid.uuid4()),video_id=vid,frame_index=n,identity_uuid=ident,segment_id=segment,person_visible=[30+n,30,75+n,85],person_ext=[25+n,25,80+n,105]).model_dump(mode='json')
            c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,'observations',o['id'],json.dumps(o)))
    return pid,vid,ident,ledger


def completed_review(pid,vid):
    job=review.create_review(vid,db.snapshot(pid)['revision']);job=db.job_get(job['id'])
    assert job['status']=='completed',job
    return job


def proof(pid,vid):
    job=completed_review(pid,vid)
    report=review.validate_review(vid,job['revision'],job['id'],True,'selected_people')
    assert report['passed'],report
    return job,report,{'format':'annotations_json','video_id':vid,'revision':job['revision'],'review_job_id':job['id'],'validation_id':report['validation_id']}


def edit_identity(pid,ident):
    p=db.snapshot(pid);old=p['state']['identities'][ident];new={**old,'name':'Edited after review'}
    return db.apply(pid,Operation(id=str(uuid.uuid4()),base_revision=p['revision'],label='edit',changes=[{'collection':'identities','id':ident,'before':old,'after':new}]))


def test_full_vfr_review_preserves_every_frame_timing_last_duration_and_range_seek(reviewed_project):
    pid,vid,ident,ledger=reviewed_project
    with TestClient(app) as client:
        response=client.post(f'/api/videos/{vid}/review-jobs',json={'revision':0});assert response.status_code==200,response.text
        job=db.job_get(response.json()['id']);assert job['status']=='completed',job
        meta=client.get('/api/reviews/'+job['id']).json()
        expected=[f['seconds']-ledger[0]['seconds'] for f in ledger]
        assert meta['frame_timestamps']==pytest.approx(expected) and not meta['stale']
        with av.open(job['video_path']) as rendered:
            frames=list(rendered.decode(rendered.streams.video[0]))
            assert len(frames)==6
            assert [float(f.pts*f.time_base) for f in frames]==pytest.approx(expected)
            assert meta['duration_seconds']>expected[-1]
            pixels=list(frames[0].to_image().convert('RGB').getdata())
            assert sum(g>140 and b>140 and r<110 for r,g,b in pixels)>20
            assert sum(r>180 and 65<g<200 and b<120 for r,g,b in pixels)>20
        streamed=client.get('/api/reviews/'+job['id']+'/video',headers={'Range':'bytes=0-99'})
        assert streamed.status_code==206 and len(streamed.content)==100
        assert streamed.headers['content-type']=='video/mp4'
        assert not db.snapshot(pid)['state']['reviews']


def test_validated_json_exact_snapshot_coverage_metadata_and_backup_without_proof(reviewed_project):
    pid,vid,ident,_=reviewed_project
    before=db.snapshot(pid)['state']
    with TestClient(app) as client:
        denied=client.post(f'/api/projects/{pid}/exports',json={'format':'annotations_json','video_id':vid})
        assert denied.status_code==422
        assert client.post(f'/api/videos/{vid}/finish',json={'confirmed':True,'revision':0}).status_code==422
        job,report,settings=proof(pid,vid)
        assert report['coverage']=='selected_people' and report['limitation']
        assert db.snapshot(pid)['videos'][vid]['validation_id']==report['validation_id']
        assert db.snapshot(pid)['state']==before
        finish=client.post(f'/api/videos/{vid}/finish',json={'confirmed':True,'revision':0,'review_job_id':job['id'],'validation_id':report['validation_id']})
        assert finish.status_code==200 and finish.json()['coverage']=='selected_people'
        assert next(v for v in client.get('/api/video-library').json() if v['id']==vid)['finished']
        export=new_job(pid,'export');formats.export_project(pid,settings,export['id']);done=db.job_get(export['id'])
        assert done['status']=='completed',done
        response=client.get('/api/exports/'+done['export_id']);assert response.status_code==200,response.text
        doc=response.json()
        assert doc['validation']['validation_id']==report['validation_id'] and doc['app_version']==review.APP_VERSION
        assert doc['state']==before and doc['media_included'] is False
        assert 'Selected people only' in doc['conventions']['scope']
        edit_identity(pid,ident)
        assert client.get('/api/exports/'+done['export_id']).status_code==409
        native=new_job(pid,'export');formats.export_project(pid,{'format':'native','include_videos':False},native['id'])
        assert db.job_get(native['id'])['status']=='completed'


def test_stale_render_validation_and_mismatched_proof_blocked(reviewed_project,monkeypatch):
    pid,vid,ident,_=reviewed_project
    class HeldPool:
        def submit(self,fn,*args):self.work=(fn,args)
    held=HeldPool();monkeypatch.setattr(review,'POOL',held)
    job=review.create_review(vid,0)
    edit_identity(pid,ident)
    held.work[0](*held.work[1])
    assert db.job_get(job['id'])['status']=='completed'
    assert review.review_metadata(job['id'])['stale']
    with pytest.raises(ValueError,match='stale'):review.validate_review(vid,1,job['id'],True,'all_people')
    with pytest.raises(ValueError,match='visual review'):review.validate_review(vid,1,job['id'],False,'all_people')


def test_edits_while_export_is_prepared_cannot_publish_stale_json(reviewed_project,monkeypatch):
    pid,vid,ident,_=reviewed_project
    _,_,settings=proof(pid,vid)
    original=Path.write_text;edited=False
    def racing_write(path,*args,**kwargs):
        nonlocal edited
        result=original(path,*args,**kwargs)
        if path.parent==review.DATA/'exports' and path.suffix=='.json' and not edited:
            edited=True;edit_identity(pid,ident)
        return result
    monkeypatch.setattr(Path,'write_text',racing_write)
    job=new_job(pid,'export');formats.export_project(pid,settings,job['id'])
    assert db.job_get(job['id'])['status']=='failed'
    with db.connect() as c:assert c.execute('SELECT COUNT(*) FROM exports WHERE project_id=?',(pid,)).fetchone()[0]==0
    assert not list((review.DATA/'exports').glob('*.json'))


def test_edit_during_validation_does_not_issue_a_finished_proof(reviewed_project,monkeypatch):
    pid,vid,ident,_=reviewed_project
    job=completed_review(pid,vid);original=review.validate_document
    def racing_validation(document):
        report=original(document);edit_identity(pid,ident);return report
    monkeypatch.setattr(review,'validate_document',racing_validation)
    with pytest.raises(db.Conflict):review.validate_review(vid,0,job['id'],True,'all_people')
    with db.connect() as c:assert c.execute('SELECT COUNT(*) FROM validations WHERE project_id=?',(pid,)).fetchone()[0]==0
    assert 'finished_revision' not in db.snapshot(pid)['videos'][vid]


def test_validation_errors_and_paired_identity_consistency(reviewed_project):
    pid,vid,ident,_=reviewed_project
    doc=annotation_document(pid,vid)
    assert validate_document(doc)['passed']
    doc['state']['identities'][ident]['person_id']=None
    assert 'missing_person_id' in {e['code'] for e in validate_document(doc)['errors']}
    doc=annotation_document(pid,vid);doc['annotation_index'][0]['identity_uuid']='wrong-person'
    assert 'annotation_index_mismatch' in {e['code'] for e in validate_document(doc)['errors']}
    doc=annotation_document(pid,vid);doc['frames'][vid][2]['seconds']+=.02
    assert 'frame_timestamp' in {e['code'] for e in validate_document(doc)['errors']}
    doc=annotation_document(pid,vid);first=next(iter(doc['state']['observations'].values()));first['person_visible']=[-1,30,60,70]
    assert not validate_document(doc)['passed']
    for bad in ([float('nan'),0,1,2], [1,2], ['bad',0,10,20], [1,1,1,1]):
        doc=annotation_document(pid,vid);next(iter(doc['state']['observations'].values()))['person_visible']=bad
        assert not validate_document(doc)['passed']


def test_catalog_change_without_revision_bump_invalidates_proof(reviewed_project):
    pid,vid,ident,_=reviewed_project
    job,report,settings=proof(pid,vid)
    with TestClient(app) as client:
        assert client.post(f'/api/projects/{pid}/classes',json={'name':'New class'}).status_code==200
        assert db.snapshot(pid)['revision']==0
        assert review.review_metadata(job['id'])['stale']
        assert not next(v for v in client.get('/api/video-library').json() if v['id']==vid)['finished']
        assert client.post(f'/api/projects/{pid}/exports',json=settings).status_code==422


def test_containment_warnings_preserve_all_consecutive_ranges():
    notes=[{'code':'visible_outside_extended','message':'Check edges','frame_index':f,'identity_uuid':person,'person_id':int(person)} for person,frames in [('1',[0,1,2,5,6]),('2',[1,2])] for f in frames]
    grouped=group_warnings(notes)
    assert [(r['person_id'],r['frame_index'],r['end_frame_index'],r['occurrences']) for r in grouped]==[(1,0,2,3),(2,1,2,2),(1,5,6,2)]
    assert sum(r['occurrences'] for r in grouped)==len(notes)
    assert 'Frames 0–2 (3 frames)' in grouped[0]['message']


def test_freshness_check_does_not_build_the_full_history_export(reviewed_project,monkeypatch):
    pid,vid,_,_=reviewed_project
    job=completed_review(pid,vid)
    def fail(*args,**kwargs):raise AssertionError('Freshness must not rebuild operation history')
    monkeypatch.setattr(review,'annotation_document',fail)
    assert review.current_matches(job)


def test_review_cancel_and_changed_source_or_snapshot_fail_safely(reviewed_project,monkeypatch):
    pid,vid,ident,_=reviewed_project
    class HeldPool:
        def submit(self,fn,*args):pass
    monkeypatch.setattr(review,'POOL',HeldPool())
    job=review.create_review(vid,0);db.job_update(job['id'],status='cancelled');review.render_review(job['id'])
    assert db.job_get(job['id'])['status']=='cancelled' and not Path(job['video_path']).exists()
    job=review.create_review(vid,0)
    Path(job['snapshot_path']).write_text('{}')
    review.render_review(job['id'])
    assert db.job_get(job['id'])['status']=='failed'
    assert 'snapshot has changed' in db.job_get(job['id'])['error']


def test_changed_source_after_review_blocks_validation(reviewed_project):
    pid,vid,_,_=reviewed_project
    job=completed_review(pid,vid)
    Path(db.snapshot(pid)['videos'][vid]['source']).write_bytes(b'changed video')
    with pytest.raises(ValueError,match='source video'):
        review.validate_review(vid,0,job['id'],True,'all_people')
