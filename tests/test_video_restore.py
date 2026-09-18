import json
import uuid
from pathlib import Path
from fractions import Fraction
import av
from PIL import Image,ImageDraw
from backend.app import db
from backend.app.config import DATA,ROOT
from backend.app.video import index_video,new_job
from backend.app.formats import export_project
from backend.app.restore import restore_archive

def setup_video(tmp_path):
    db.init();pid=str(uuid.uuid4());vid=str(uuid.uuid4());source=tmp_path/'vfr.mkv'
    with av.open(str(source),'w') as container:
        stream=container.add_stream('ffv1',rate=30);stream.width=160;stream.height=90;stream.pix_fmt='bgr0';stream.time_base=Fraction(1,1000)
        for n,pts in enumerate([0,40,95,130,200]):
            im=Image.new('RGB',(160,90),(n*40,20,30));ImageDraw.Draw(im).text((10,10),str(n),fill='white')
            frame=av.VideoFrame.from_image(im);frame.pts=pts;frame.time_base=Fraction(1,1000)
            for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    target=DATA/'originals'/f'{vid}.mkv';v={'id':vid,'project_id':pid,'name':'numbered VFR','source':str(target),'width':160,'height':90,'frame_count':0,'status':'indexing','source_hash':None,'stream_index':0,'nominal_fps':30}
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'VFR restore',db.now()))
        c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps(v)))
    j=new_job(pid,'index');index_video(vid,source,target,j['id']);assert db.job_get(j['id'])['status']=='completed'
    return pid,vid

def test_vfr_ledger_and_lossless_source_cache(tmp_path):
    pid,vid=setup_video(tmp_path)
    with db.connect() as c:frames=[json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index',(vid,))]
    assert len(frames)==5
    times=[f['seconds'] for f in frames];assert times==sorted(times);assert len(set(round(times[i+1]-times[i],3) for i in range(4)))>1
    for n in range(5):assert Image.open(DATA/'frames'/vid/f'{n:08d}.png').getpixel((100,70))[0]==n*40

def test_native_restore_redecodes_and_verifies_timestamps(tmp_path):
    pid,vid=setup_video(tmp_path);job=new_job(pid,'export');export_project(pid,{'format':'native','include_videos':True},job['id']);eid=db.job_get(job['id'])['export_id']
    with db.connect() as c:path=json.loads(c.execute('SELECT data FROM exports WHERE id=?',(eid,)).fetchone()['data'])['path']
    restore=new_job('native-import','restore');restore_archive(path,restore['id']);j=db.job_get(restore['id']);assert j['status']=='completed',j
    p=db.snapshot(j['restored_project_id']);assert len(p['videos'])==1;v=next(iter(p['videos'].values()));assert v['frame_count']==5 and v['source_hash']==db.snapshot(pid)['videos'][vid]['source_hash']

def test_native_restore_keeps_proposal_review_and_provenance_references(tmp_path):
    from backend.app.schema import MODELS
    pid,vid=setup_video(tmp_path);ident=str(uuid.uuid4());seg=str(uuid.uuid4());obs=str(uuid.uuid4());proposal=str(uuid.uuid4())
    entities={
        'identities':MODELS['identities'](id=ident,person_id=5),
        'segments':MODELS['segments'](id=seg,video_id=vid,identity_uuid=ident,start=0),
        'observations':MODELS['observations'](id=obs,video_id=vid,frame_index=0,identity_uuid=ident,segment_id=seg,person_ext=[1,2,40,80],provenance={'person_ext':{'origin':'model','proposal_id':proposal}}),
        'proposal_reviews':MODELS['proposal_reviews'](id=proposal,proposal_id=proposal,video_id=vid,frame_index=0,reason='Duplicate candidate')}
    with db.transaction() as c:
        for col,e in entities.items():c.execute('INSERT INTO entities VALUES(?,?,?,?)',(pid,col,e.id,e.model_dump_json()))
        c.execute('INSERT INTO proposals VALUES(?,?,?,?,?)',(proposal,vid,0,'test-cache',json.dumps({'id':proposal,'video_id':vid,'frame_index':0,'cache_key':'test-cache','box':[1,2,40,80]})))
    export=new_job(pid,'export');export_project(pid,{'format':'native','include_videos':True},export['id'])
    with db.connect() as c:path=json.loads(c.execute('SELECT data FROM exports WHERE id=?',(db.job_get(export['id'])['export_id'],)).fetchone()['data'])['path']
    restore=new_job('native-import','restore');restore_archive(path,restore['id']);result=db.job_get(restore['id']);assert result['status']=='completed',result
    restored=db.snapshot(result['restored_project_id']);new_id=restored['state']['observations'][obs]['provenance']['person_ext']['proposal_id'];assert new_id!=proposal
    assert restored['state']['proposal_reviews'][new_id]['proposal_id']==new_id
    with db.connect() as c:
        row=c.execute('SELECT video_id FROM proposals WHERE id=?',(new_id,)).fetchone();assert row['video_id'] in restored['videos']
        assert c.execute('SELECT video_id FROM proposals WHERE id=?',(proposal,)).fetchone()['video_id']==vid
