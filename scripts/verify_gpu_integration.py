"""Exercise the actual local worker and cache with the supplied model, no mocks."""
import json,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8765/api'
def call(path,body=None):
    request=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
def wait_job(job):
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
        result=call('/jobs/'+job['id'])
        if result['status'] in ('completed','failed','cancelled'):
            assert result['status']=='completed',result
            return result
        time.sleep(.5)
    raise TimeoutError('GPU test job did not finish within 180 seconds')
p=call('/projects',{'name':'GPU integration acceptance'})
v=call('/projects/'+p['id']+'/videos/local',{'path':'tests/fixtures/numbered.mp4'})
while call('/videos/'+v['video_id']+'/metadata')['status']!='ready':time.sleep(.2)
settings={'model':str(ROOT/'models/student_yolo26m_20260815_0023_best.pt'),'class_mapping':{'0':'person_ext'},'device':'0','confidence':.99,'imgsz':640,'batch_size':1}
first=wait_job(call('/videos/'+v['video_id']+'/proposal-jobs',settings))
second=wait_job(call('/videos/'+v['video_id']+'/proposal-jobs',settings))
assert first['progress']==first['total']==24 and first['cached_frames']==0
assert second['cached_frames']==second['total']==24
assert not call('/projects/'+p['id'])['state']['observations']
result={'actual_cuda_inference':True,'input_frame_path_and_dimensions_verified':True,'first_pass':first,'cached_pass':second,'manual_observations_untouched':True}
(ROOT/'docs/gpu-integration-results.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'first_pass':first['status'],'cached_pass':second['status'],'cached_frames':second['cached_frames'],'source_frames':first['total']}))
