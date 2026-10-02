import io
import json
import hashlib
import math
from array import array
from fractions import Fraction
from pathlib import Path
import av
import pytest
from PIL import Image, ImageStat
from fastapi.testclient import TestClient
from backend.app import db,video_trim
from backend.app.main import app
from test_review_delivery import reviewed_project,ImmediatePool


@pytest.fixture
def client(reviewed_project,monkeypatch,tmp_path):
    monkeypatch.setattr(video_trim,'DATA',tmp_path)
    monkeypatch.setattr(video_trim,'POOL',ImmediatePool())
    with TestClient(app) as c:yield c


def scan(client,source):
    response=client.post('/api/video-trims',files={'file':(source.name,source.read_bytes(),'video/mp4')})
    assert response.status_code==200,response.text
    job=response.json();assert job['status']=='completed',job
    return job


def create(client,scan,sections,name='Training.mp4'):
    r=client.post(f'/api/video-trims/{scan["id"]}/render',json={'sections':sections,'name':name})
    assert r.status_code==200,r.text
    job=client.get('/api/jobs/'+r.json()['id']).json()
    assert job['status']=='completed',job
    return job


def test_new_video_has_only_selected_frames_and_exact_vfr_timing(client,reviewed_project):
    pid,vid,_,ledger=reviewed_project;before=db.snapshot(pid);source=Path(before['videos'][vid]['source']);digest=hashlib.sha256(source.read_bytes()).hexdigest()
    job=scan(client,source)
    assert job['metadata']['frame_count']==6
    assert client.get(f'/api/video-trims/{job["id"]}/frames/4').headers['content-type']=='image/jpeg'
    result=create(client,job,[{'start':0,'end':1},{'start':4,'end':5}])
    assert result['frame_count']==4
    response=client.get(result['download_url']);assert 'Training.mp4' in response.headers['content-disposition']
    with av.open(io.BytesIO(response.content)) as output:
        frames=list(output.decode(video=0));assert len(frames)==4
        assert all((f.width,f.height)==(160,120) for f in frames)
        assert [float(f.pts*f.time_base) for f in frames]==pytest.approx([0,.04,.12,.16])
        assert [round(ImageStat.Stat(f.to_image()).mean[0]/10)*10 for f in frames]==[20,30,60,70]
    assert db.snapshot(pid)==before
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
    # This is an ordinary new MP4 with sequential frame numbers when imported.
    assert client.get(result['preview_url'],headers={'Range':'bytes=0-99'}).status_code==206


def test_single_frame_and_overlapping_sections_do_not_duplicate_frames(client,reviewed_project):
    source=Path(db.snapshot(reviewed_project[0])['videos'][reviewed_project[1]]['source']);job=scan(client,source)
    for ranges,count in [([{'start':3,'end':3}],1),([{'start':2,'end':5},{'start':0,'end':2}],6)]:
        result=create(client,job,ranges)
        with av.open(io.BytesIO(client.get(result['download_url']).content)) as output:
            frames=list(output.decode(video=0));assert len(frames)==count and frames[0].pts==0


@pytest.mark.parametrize('sections',[[],[{'start':0,'end':6}],[{'start':3,'end':2}],[{'start':True,'end':2}],[{'start':1.5,'end':2}]])
def test_invalid_sections_do_not_create_render_job(client,reviewed_project,sections):
    source=Path(db.snapshot(reviewed_project[0])['videos'][reviewed_project[1]]['source']);job=scan(client,source)
    with db.connect() as c:before=c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
    assert client.post(f'/api/video-trims/{job["id"]}/render',json={'sections':sections}).status_code==422
    with db.connect() as c:assert c.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]==before


def test_audio_survives_cut_with_continuous_timing(client,tmp_path):
    source=tmp_path/'sound.mp4'
    with av.open(str(source),'w') as out:
        video=out.add_stream('libx264',rate=25);video.width=160;video.height=120;video.pix_fmt='yuv420p';video.options={'bf':'0'}
        audio=out.add_stream('aac',rate=48000);audio.layout='stereo'
        for n in range(50):
            frame=av.VideoFrame.from_image(Image.new('RGB',(160,120),(20+n*2,30,40)));frame.pts=n;frame.time_base=Fraction(1,25)
            for packet in video.encode(frame):out.mux(packet)
            a=av.AudioFrame(format='fltp',layout='stereo',samples=1920);a.sample_rate=48000;a.time_base=Fraction(1,48000);a.pts=n*1920
            data=array('f',(0.25*math.sin(2*math.pi*440*(n*1920+i)/48000) for i in range(1920))).tobytes()
            for plane in a.planes:plane.update(data)
            for packet in audio.encode(a):out.mux(packet)
        for stream in (video,audio):
            for packet in stream.encode():out.mux(packet)
    job=scan(client,source);result=create(client,job,[{'start':0,'end':9},{'start':30,'end':39}])
    assert result['audio_included'] and result['frame_count']==20 and result['duration_seconds']==pytest.approx(.8)
    raw=client.get(result['download_url']).content
    with av.open(io.BytesIO(raw)) as output:
        frames=list(output.decode(audio=0));assert frames and output.streams.audio
        timestamps=[float(f.pts*f.time_base) for f in frames];assert timestamps==sorted(timestamps)
        assert abs(sum(f.samples for f in frames)/48000-.8)<.025
        samples=array('f');samples.frombytes(bytes(frames[0].planes[0]));assert max(samples)>.05
    with av.open(io.BytesIO(raw)) as output:assert len(list(output.decode(video=0)))==20


def test_cancelled_queued_job_stays_cancelled(client,reviewed_project,monkeypatch):
    class Deferred:
        def submit(self,*args):pass
    source=Path(db.snapshot(reviewed_project[0])['videos'][reviewed_project[1]]['source']);job=scan(client,source)
    monkeypatch.setattr(video_trim,'POOL',Deferred())
    render=client.post(f'/api/video-trims/{job["id"]}/render',json={'sections':[{'start':0,'end':3}]}).json()
    client.post('/api/jobs/'+render['id']+'/cancel');video_trim.render_video(render['id'])
    assert db.job_get(render['id'])['status']=='cancelled'
    assert not (video_trim.folder(render['id'])/'video.mp4').exists()


def test_odd_dimensions_and_pixel_aspect_are_preserved(client,tmp_path):
    source=tmp_path/'odd.mp4'
    with av.open(str(source),'w') as out:
        stream=out.add_stream('libx264',rate=25);stream.width=161;stream.height=121;stream.pix_fmt='yuv444p';stream.sample_aspect_ratio=Fraction(4,3)
        for n in range(4):
            frame=av.VideoFrame.from_image(Image.new('RGB',(161,121),(40+n*20,50,60)));frame.pts=n;frame.time_base=Fraction(1,25)
            for packet in stream.encode(frame):out.mux(packet)
        for packet in stream.encode():out.mux(packet)
    job=scan(client,source);result=create(client,job,[{'start':1,'end':2}])
    with av.open(io.BytesIO(client.get(result['download_url']).content)) as output:
        assert output.streams.video[0].sample_aspect_ratio==Fraction(4,3)
        frames=list(output.decode(video=0));assert len(frames)==2
        assert all((f.width,f.height)==(161,121) for f in frames)


def test_display_rotation_is_preserved_without_resizing(client,tmp_path):
    source=tmp_path/'rotated.mp4'
    with av.open(str(source),'w') as out:
        stream=out.add_stream('libx264',rate=25);stream.width=160;stream.height=120;stream.pix_fmt='yuv420p';stream.set_display_rotation(90)
        for n in range(4):
            frame=av.VideoFrame.from_image(Image.new('RGB',(160,120),(40+n*20,50,60)));frame.pts=n;frame.time_base=Fraction(1,25)
            for packet in stream.encode(frame):out.mux(packet)
        for packet in stream.encode():out.mux(packet)
    job=scan(client,source);result=create(client,job,[{'start':1,'end':2}])
    with av.open(io.BytesIO(client.get(result['download_url']).content)) as output:
        frames=list(output.decode(video=0));assert len(frames)==2
        assert all((f.width,f.height,f.rotation)==(160,120,90) for f in frames)


def test_source_playback_and_timing_match_decoded_frames(client,reviewed_project):
    source=Path(db.snapshot(reviewed_project[0])['videos'][reviewed_project[1]]['source']);job=scan(client,source)
    prefix='/api/video-trims/'+job['id']
    assert client.get(prefix+'/source',headers={'Range':'bytes=0-99'}).status_code==206
    assert client.get(prefix+'/source').content==source.read_bytes()
    timing=client.get(prefix+'/timing').json()
    with av.open(str(source)) as video:
        origin=(video.start_time or 0)/av.time_base
        frames=list(video.decode(video=0))
        assert timing['timestamps']==pytest.approx([float(f.pts*f.time_base)-origin for f in frames])
        assert timing['duration']>timing['timestamps'][-1]
