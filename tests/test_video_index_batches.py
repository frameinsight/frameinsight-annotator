import json
import uuid
import av
from PIL import Image
from backend.app import db, video


def test_index_batches_flush_tail_and_preserve_all_frames(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB', tmp_path/'db.sqlite3')
    monkeypatch.setattr(video, 'DATA', tmp_path)
    (tmp_path/'frames').mkdir()
    db.init()
    source, target = tmp_path/'source.mkv', tmp_path/'copied.mkv'
    with av.open(str(source),'w') as container:
        stream=container.add_stream('ffv1',rate=25);stream.width=32;stream.height=32;stream.pix_fmt='bgr0'
        for n in range(65):
            frame=av.VideoFrame.from_image(Image.new('RGB',(32,32),(n,20,30)))
            for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    pid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with db.transaction() as c:
        c.execute('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)',(pid,'Batch test',db.now()))
        c.execute('INSERT INTO videos VALUES(?,?,?)',(vid,pid,json.dumps({'id':vid,'project_id':pid,'status':'indexing','frame_count':0})))
    job=video.new_job(pid,'index');video.index_video(vid,source,target,job['id'])
    assert db.job_get(job['id'])['status']=='completed'
    record=db.snapshot(pid)['videos'][vid]
    assert record['frame_count']==65 and record['source_hash']==video.sha256(source)
    assert source.read_bytes()==target.read_bytes()
    with db.connect() as c:
        frames=[json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index',(vid,))]
    assert [f['frame_index'] for f in frames]==list(range(65))
    for n in (0,31,32,63,64):
        assert Image.open(tmp_path/'frames'/vid/f'{n:08d}.png').getpixel((10,10))==(n,20,30)
