"""Exercise installed Windows binaries; run with bundled python.exe (Wine or Windows)."""
import ctypes,json,os,subprocess,sys,time,urllib.request,uuid
from pathlib import Path
root=Path(sys.argv[1]).resolve();fixture=Path(sys.argv[2]).resolve()
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.OpenEventW.argtypes=[ctypes.c_ulong,ctypes.c_int,ctypes.c_wchar_p];k.OpenEventW.restype=ctypes.c_void_p
k.SetEvent.argtypes=k.CloseHandle.argtypes=[ctypes.c_void_p]
def request(path,data=None,raw=False,headers=None,method=None):
 body=json.dumps(data).encode() if data is not None else None
 req=urllib.request.Request('http://127.0.0.1:8765'+path,body,headers=headers or ({'Content-Type':'application/json'} if body else {}),method=method)
 with urllib.request.urlopen(req,timeout=10) as r:return r.read() if raw else json.load(r)
def wait(fn,seconds=90):
 deadline=time.time()+seconds
 while time.time()<deadline:
  try:
   value=fn()
   if value:return value
  except (OSError,ValueError):pass
  time.sleep(.3)
 raise AssertionError('Timed out')
def stop(proc):
 user=ctypes.WinDLL('user32');user.FindWindowW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p];user.FindWindowW.restype=ctypes.c_void_p
 user.PostMessageW.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t]
 hwnd=user.FindWindowW('Frameinsight.Desktop.v1',None);assert hwnd
 user.PostMessageW(hwnd,0x0010,0,0);assert proc.wait(timeout=30)==0
uid=lambda:str(uuid.uuid4())
p=subprocess.Popen([str(root/'Frameinsight.exe')])
try:
 wait(lambda:request('/api/projects') is not None)
 assert b'Frameinsight' in request('/',raw=True)
 second=subprocess.run([str(root/'Frameinsight.exe')],timeout=10);assert second.returncode==0
 project=request('/api/projects',{'name':'Windows runtime acceptance','classes':['Worker','Customer']});pid=project['id']
 boundary='frameinsight-smoke-boundary'
 body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="numbered.mp4"\r\nContent-Type: video/mp4\r\n\r\n'.encode()+fixture.read_bytes()+f'\r\n--{boundary}--\r\n'.encode())
 req=urllib.request.Request(f'http://127.0.0.1:8765/api/projects/{pid}/videos',body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
 with urllib.request.urlopen(req,timeout=30) as r:vid=json.load(r)['video_id']
 wait(lambda:request('/api/projects/'+pid)['videos'][vid]['status']=='ready')
 assert len(request('/api/videos/'+vid+'/ledger'))==24
 assert request('/api/videos/'+vid+'/frames/10',raw=True).startswith(b'\x89PNG')
 from backend.app.schema import Identity,Segment,Observation
 who,seg,obs=uid(),uid(),uid()
 identity=Identity(id=who,person_id=7,class_name='Worker',color='#ff7700',box_styles={'person_ext':{'class_name':'person_extended','color':'#67e2b1'}}).model_dump(mode='json')
 segment=Segment(id=seg,identity_uuid=who,video_id=vid,start=0).model_dump(mode='json')
 observation=Observation(id=obs,identity_uuid=who,segment_id=seg,video_id=vid,frame_index=10,person_visible=[10,20,100,200],person_ext=[5,10,110,220],full_quality='estimated',provenance={'person_visible':{'origin':'manual'}}).model_dump(mode='json')
 changes=[{'collection':col,'id':val['id'],'before':None,'after':val} for col,val in [('identities',identity),('segments',segment),('observations',observation)]]
 request('/api/projects/'+pid+'/operations',{'id':uid(),'base_revision':0,'label':'Windows smoke annotation','changes':changes})
 assert request('/api/projects/'+pid)['classes']==['Worker','Customer']
 request('/api/videos/'+vid+'/finish',{'confirmed':True,'revision':1})
 assert next(v for v in request('/api/video-library') if v['id']==vid)['finished']
 job=request('/api/projects/'+pid+'/exports',{'format':'annotations_json','video_id':vid})
 job=wait(lambda:(j if (j:=request('/api/jobs/'+job['id']))['status']=='completed' else False))
 export=request('/api/exports/'+job['export_id']);assert export['media_included'] is False and export['annotation_index'][0]['color']=='#ff7700'
 assert export['schema_version']==2 and len(export['annotation_index'])==2
 assert export['annotation_index'][1]['person_id']==7 and export['annotation_index'][1]['box_type']=='person_extended'
 assert export['frame_annotations'][0]['boxes']['person_extended']==[5,10,110,220]
 assert [(r['start'],r['end'],r['status']) for r in export['visibility_intervals']]==[(0,9,'not_visible'),(10,10,'visible'),(11,23,'not_visible')]
 stop(p)
 p=subprocess.Popen([str(root/'Frameinsight.exe')]);wait(lambda:request('/api/projects/'+pid)['revision']==1)
 assert request('/api/projects/'+pid)['state']['identities'][who]==identity
 assert request('/api/videos/'+vid+'?confirmed=true',method='DELETE')['deleted']
 assert request('/api/video-library')==[] and fixture.exists()
 stop(p)
 report={'runtime':'Windows embedded Python 3.13.12','environment':'Wine on Linux' if 'WINEPREFIX' in os.environ else 'Windows','checks':['native launcher','single instance','HTTP frontend','multipart video import','24 exact frames','PNG decoding','annotation save with class/color','class catalog','video library','finish confirmation','annotations-only export','paired-box JSON v2 with shared identity','automatic visibility export','delete video preserves original file','graceful shutdown','relaunch persistence'],'project_id':pid}
 Path('windows-smoke-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
finally:
 if p.poll() is None:
  try:stop(p)
  except Exception:p.terminate()
