"""Queue the provided model for the requested clip when indexing completes."""
import json,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=json.load(open(ROOT/'.frameinsight/clip-project.json'));pid=p['id'];vid=next(iter(p['videos']))
while True:
    v=json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/videos/'+vid+'/metadata'))
    if v['status']=='ready':break
    if v['status'] in ('failed','cancelled'):raise RuntimeError(v)
    time.sleep(5)
settings={'model':'student_yolo26m_20260815_0023_best.pt','class_mapping':{'0':'person_ext'},'device':'0','confidence':.12,'imgsz':1280,'batch_size':1}
r=urllib.request.Request('http://127.0.0.1:8765/api/videos/'+vid+'/proposal-jobs',data=json.dumps(settings).encode(),headers={'Content-Type':'application/json'})
job=json.load(urllib.request.urlopen(r));json.dump(job,open(ROOT/'.frameinsight/clip-proposal-job.json','w'));print(json.dumps(job),flush=True)
