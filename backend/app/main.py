import asyncio
import json
import os
import platform
import shutil
import subprocess
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from . import db
from .config import DATA, ROOT, WORKSPACE, MODELS, safe_path
from .schema import Operation
from .video import import_video, new_job, POOL, sha256
from .worker import Worker
from .formats import export_project, parse_cvat
from .delete_video import delete_video
worker=Worker(); exports_pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='export')
@asynccontextmanager
async def lifespan(app):
    db.init()
    with db.transaction() as c:
        for row in c.execute('SELECT id,data FROM jobs').fetchall():
            j=json.loads(row['data'])
            if j['status'] in ('queued','running'):
                j.update(status='failed',error='Application restarted. Retry this job; saved annotations and completed frames are intact.')
                c.execute('UPDATE jobs SET data=? WHERE id=?',(json.dumps(j),row['id']))
        for row in c.execute('SELECT id,data FROM videos').fetchall():
            v=json.loads(row['data'])
            if v['status']=='indexing':
                v.update(status='failed',error='Indexing interrupted. Use Retry indexing.')
                c.execute('UPDATE videos SET data=? WHERE id=?',(json.dumps(v),row['id']))
    yield
    worker.stop()
app=FastAPI(title='Frameinsight',version='1.0.0',lifespan=lifespan)

@app.middleware('http')
async def local_only(request:Request,call_next):
    host=request.headers.get('host','').split(':')[0]
    if host not in ('127.0.0.1','localhost','testserver','[::1]'):
        return JSONResponse({'detail':'Local-only service: use localhost'},status_code=403)
    origin=request.headers.get('origin')
    if origin and origin not in ('http://localhost:8765','http://127.0.0.1:8765','http://localhost:5173','http://127.0.0.1:5173'):
        return JSONResponse({'detail':'Untrusted origin'},status_code=403)
    return await call_next(request)
@app.exception_handler(ValueError)
async def value_error(request,e): return JSONResponse({'detail':str(e)},status_code=422)
@app.exception_handler(KeyError)
async def key_error(request,e): return JSONResponse({'detail':str(e)},status_code=404)
@app.exception_handler(db.Conflict)
async def conflict(request,e): return JSONResponse({'detail':'Revision conflict. Local edits are retained. Reconcile with server state before continuing.','revision':e.revision},status_code=409)
class NewProject(BaseModel):
    name:str=Field(min_length=1,max_length=150)
    classes:list[str]=Field(default_factory=list,max_length=100)
    @field_validator('classes')
    @classmethod
    def clean_classes(cls, values):
        values=[v.strip() for v in values]
        if any(not v or len(v)>80 for v in values): raise ValueError('Class names must contain 1–80 characters')
        if len(set(values))!=len(values): raise ValueError('Each class needs a different name')
        return values
class NewClass(BaseModel):
    name:str=Field(min_length=1,max_length=80)
class FinishVideo(BaseModel):
    revision:int=Field(ge=0)
    confirmed:bool

class LocalVideo(BaseModel): path:str
class ExportSettings(BaseModel):
    format:str
    video_id:str|None=None
    include_videos:bool=False
    split:str='train'
    geometry:str='person_ext'
    mot_profile:str|None=None
class ProposalSettings(BaseModel):
    model:str
    class_mapping:dict[str,str]
    device:str='0'
    confidence:float=Field(default=0.15,ge=0.001,le=1)
    imgsz:int=Field(default=640,ge=128,le=2048)
    batch_size:int=Field(default=1,ge=1,le=16)

def video_get(vid):
    with db.connect() as c:
        row=c.execute('SELECT data FROM videos WHERE id=?',(vid,)).fetchone()
        if not row: raise KeyError('Video not found')
        return json.loads(row['data'])
@app.get('/api/projects')
def projects():
    with db.connect() as c: return [dict(r) for r in c.execute('SELECT * FROM projects ORDER BY created_at DESC')]
@app.post('/api/projects')
def create_project(body:NewProject):
    ident=str(uuid.uuid4())
    with db.transaction() as c:c.execute('INSERT INTO projects(id,name,created_at,classes) VALUES(?,?,?,?)',(ident,body.name.strip(),db.now(),json.dumps(body.classes)))
    return db.snapshot(ident)
@app.get('/api/video-library')
def video_library():
    with db.connect() as c:
        rows=c.execute('SELECT v.id,v.project_id,v.data,p.name,p.revision FROM videos v JOIN projects p ON p.id=v.project_id ORDER BY v.rowid DESC').fetchall()
    return [{**json.loads(r['data']), 'project_id':r['project_id'], 'project_name':r['name'],
             'finished':json.loads(r['data']).get('finished_revision')==r['revision']} for r in rows]

@app.post('/api/projects/{pid}/classes')
def add_class(pid:str,body:NewClass):
    name=body.name.strip()
    if not name: raise ValueError('Enter a class name')
    with db.transaction() as c:
        p=db.get_state(c,pid);classes=p['classes']
        if name not in classes:
            if len(classes)>=100:raise ValueError('Maximum 100 classes')
            classes.append(name)
            c.execute('UPDATE projects SET classes=? WHERE id=?',(json.dumps(classes),pid))
    return {'classes':classes}

@app.delete('/api/videos/{vid}')
def remove_video(vid:str,confirmed:bool=False):
    if not confirmed:raise ValueError('Confirm deletion of this video and its annotations')
    return delete_video(vid)

@app.post('/api/videos/{vid}/finish')
def finish_video(vid:str,body:FinishVideo):
    if not body.confirmed:raise ValueError('Confirm that every person has been annotated and tracked')
    with db.transaction() as c:
        row=c.execute('SELECT project_id,data FROM videos WHERE id=?',(vid,)).fetchone()
        if not row:raise KeyError('Video not found')
        p=db.get_state(c,row['project_id']);v=json.loads(row['data'])
        if body.revision!=p['revision']:raise db.Conflict(p['revision'])
        if v['status']!='ready':raise ValueError('Wait for the video to finish loading')
        v.update(finished_revision=p['revision'],finished_at=db.now(),finish_confirmation='Every person annotated and tracked')
        c.execute('UPDATE videos SET data=? WHERE id=?',(json.dumps(v),vid))
    return v

@app.get('/api/projects/{pid}')
def project(pid:str): return db.snapshot(pid)
@app.post('/api/projects/{pid}/operations')
def operation(pid:str,body:Operation): return db.apply(pid,body)
@app.get('/api/projects/{pid}/operations')
def operations(pid:str):
    with db.connect() as c:return [json.loads(r['data']) for r in c.execute('SELECT data FROM operations WHERE project_id=? ORDER BY revision',(pid,))]
@app.get('/api/library')
def library():
    result=[]
    for directory in (WORKSPACE/'Cleaned Videos',WORKSPACE/'GuideLine and Tracking Annotation Videos',WORKSPACE/'tests'/'fixtures'):
        if directory.exists():
            for p in sorted(directory.rglob('*')):
                if p.suffix.lower() in ('.mp4','.avi','.mkv','.mov','.webm') and p.is_file():result.append({'path':str(p.relative_to(WORKSPACE)),'name':p.name,'bytes':p.stat().st_size})
    return result
@app.post('/api/projects/{pid}/videos/local')
def add_local(pid:str,body:LocalVideo):
    db.snapshot(pid); source=safe_path(body.path,WORKSPACE)
    return import_video(pid,source)
@app.post('/api/projects/{pid}/videos')
def upload(pid:str,file:UploadFile=File(...)):
    db.snapshot(pid)
    name=Path(file.filename or 'video.mp4').name
    suffix=Path(name).suffix.lower()
    if suffix not in ('.mp4','.mov','.avi','.mkv','.webm','.m4v'):raise ValueError('Unsupported video file extension')
    tmp=DATA/'originals'/f'upload-{uuid.uuid4()}{suffix}'
    with open(tmp,'wb') as f:shutil.copyfileobj(file.file,f,1024*1024)
    result=import_video(pid,tmp,name)
    # Originals stay available if decoding fails; no source deletion races.
    return result
@app.get('/api/videos/{vid}/metadata')
def metadata(vid:str): return video_get(vid)
@app.post('/api/videos/{vid}/retry-index')
def retry_index(vid:str):
    from .video import index_video
    v=video_get(vid)
    if v['status']=='indexing':raise ValueError('Indexing is already running')
    source=Path(v['source'])
    if not source.exists():raise ValueError('Original copy is missing. Reimport the source video.')
    backup=source.with_suffix(source.suffix+'.retry');shutil.copyfile(source,backup)
    db.update_video(vid,status='indexing')
    j=new_job(v['project_id'],'index',video_id=vid)
    POOL.submit(index_video,vid,backup,source,j['id'])
    return j
@app.get('/api/videos/{vid}/ledger')
def ledger(vid:str):
    video_get(vid)
    with db.connect() as c:return [json.loads(r['data']) for r in c.execute('SELECT data FROM frames WHERE video_id=? ORDER BY frame_index',(vid,))]
@app.get('/api/videos/{vid}/frames/{frame}')
def frame_image(vid:str,frame:int):
    video=video_get(vid)
    if not 0<=frame<video['frame_count']:raise HTTPException(404,'Exact frame is not decoded yet')
    path=DATA/'frames'/vid/f'{frame:08d}.png'
    if not path.exists():raise HTTPException(404,'Decoded cache file is missing; retry indexing')
    return FileResponse(path,media_type='image/png',headers={'Cache-Control':'private, max-age=86400, immutable','X-Frame-Key':f'{vid}:{frame}'})
@app.get('/api/videos/{vid}/annotations')
def annotations(vid:str,start:int=0,end:int=100):
    v=video_get(vid);s=db.snapshot(v['project_id'])['state']
    return [o for o in s['observations'].values() if o['video_id']==vid and start<=o['frame_index']<=end]
@app.get('/api/videos/{vid}/proposals')
def proposals(vid:str,start:int=0,end:int=100):
    video_get(vid)
    with db.connect() as c:return [json.loads(r['data']) for r in c.execute('SELECT data FROM proposals WHERE video_id=? AND frame_index BETWEEN ? AND ?',(vid,start,min(end,start+1000)))]
@app.get('/api/models')
def models():return [{'name':p.name,'bytes':p.stat().st_size} for p in MODELS.glob('*.pt')]
@app.post('/api/videos/{vid}/proposal-jobs')
def proposals_start(vid:str,body:ProposalSettings):
    v=video_get(vid)
    if v['status']!='ready':raise ValueError('Finish indexing before inference')
    return worker.enqueue(v['project_id'],vid,body.model_dump())
@app.get('/api/projects/{pid}/jobs')
def jobs(pid:str):
    with db.connect() as c:return [json.loads(r['data']) for r in c.execute('SELECT data FROM jobs WHERE project_id=? ORDER BY rowid DESC',(pid,))]
@app.get('/api/jobs/{jid}')
def job(jid:str):return db.job_get(jid)
@app.post('/api/jobs/{jid}/cancel')
def cancel(jid:str):
    j=db.job_get(jid)
    if j['status'] not in ('queued','running'):raise ValueError('Only queued/running jobs can be cancelled')
    return db.job_update(jid,status='cancelled')
@app.post('/api/jobs/{jid}/priority/{frame}')
def prioritize(jid:str,frame:int):return db.job_update(jid,priority_frame=frame)
@app.get('/api/worker')
def worker_status():return worker.status()
@app.post('/api/worker/stop')
def worker_stop():worker.stop();return worker.status()
@app.post('/api/projects/{pid}/exports')
def export(pid:str,body:ExportSettings):
    db.snapshot(pid)
    if body.split not in ('train','val','test') or body.geometry not in ('person_ext','person_visible'):raise ValueError('Invalid export options')
    j=new_job(pid,'export',settings=body.model_dump());exports_pool.submit(export_project,pid,body.model_dump(),j['id']);return j
@app.get('/api/exports/{eid}')
def download_export(eid:str):
    with db.connect() as c:
        row=c.execute('SELECT data FROM exports WHERE id=?',(eid,)).fetchone()
        if not row:raise KeyError('Export not found')
        e=json.loads(row['data'])
    is_json = e['settings']['format'] == 'annotations_json'
    extension, media_type = ('json', 'application/json') if is_json else ('zip', 'application/zip')
    return FileResponse(e['path'],filename=f'frameinsight-{e["settings"]["format"]}-{eid[:8]}.{extension}',media_type=media_type)
@app.post('/api/projects/{pid}/imports/cvat')
def import_cvat(pid:str,video_id:str,file:UploadFile=File(...)):
    p=db.snapshot(pid)
    if video_id not in p['videos']:raise ValueError('Video does not belong to this project')
    raw=file.file.read(50*1024*1024+1)
    if len(raw)>50*1024*1024:raise ValueError('XML limit is 50 MB')
    changes,warnings=parse_cvat(raw,p,video_id)
    result=db.apply(pid,Operation(id=str(uuid.uuid4()),base_revision=p['revision'],label='Import CVAT XML',changes=changes))
    return {**result,'warnings':warnings,'imported_entities':len(changes)}
@app.post('/api/imports/native')
def import_native(file:UploadFile=File(...)):
    from .restore import restore_archive
    path=DATA/'originals'/f'archive-{uuid.uuid4()}.zip'
    with open(path,'wb') as dst:shutil.copyfileobj(file.file,dst,1024*1024)
    j=new_job('native-import','restore')
    exports_pool.submit(restore_archive,path,j['id'])
    return j

@app.post('/api/projects/{pid}/backup')
def backup(pid:str):
    db.snapshot(pid);path=DATA/'backups'/f'projects-{uuid.uuid4()}.sqlite3'
    import sqlite3
    with db.connect() as source, sqlite3.connect(path) as target:source.backup(target)
    return {'path':str(path)}
@app.get('/api/system/diagnostics')
def diagnostics():
    import importlib.metadata as md
    packages={}
    for name in ('fastapi','pydantic','av','torch','ultralytics','uvicorn','numpy','pillow'):
        try:packages[name]=md.version(name)
        except md.PackageNotFoundError:packages[name]=None
    try:gpu=subprocess.run(['nvidia-smi','--query-gpu=name,memory.total,memory.used,driver_version','--format=csv,noheader'],capture_output=True,text=True,timeout=5).stdout.strip()
    except (OSError,subprocess.TimeoutExpired):gpu='nvidia-smi unavailable'
    return {'os':platform.platform(),'python':platform.python_version(),'packages':packages,'gpu':gpu,'worker':worker.status(),'data_directory':str(DATA),'free_disk_gb':round(shutil.disk_usage(DATA).free/1e9,2)}
@app.websocket('/api/projects/{pid}/events')
async def events(ws:WebSocket,pid:str):
    if ws.headers.get('origin') not in ('http://127.0.0.1:8765','http://localhost:8765','http://localhost:5173','http://127.0.0.1:5173'):
        await ws.close(code=1008);return
    await ws.accept();seq=0;last=None
    try:
        while True:
            state=await asyncio.to_thread(db.snapshot,pid)
            job_list=await asyncio.to_thread(jobs,pid)
            payload={'revision':state['revision'],'videos':state['videos'],'jobs':job_list,'worker':worker.status()}
            signature=json.dumps(payload,sort_keys=True)
            if signature!=last:
                seq+=1;await ws.send_json({'project_id':pid,'sequence':seq,**payload});last=signature
            else:
                await ws.send_json({'project_id':pid,'sequence':seq,'heartbeat':True})
            await asyncio.sleep(1)
    except KeyError:
        # Deleting the last video removes its project while this stream may be open.
        await ws.close(code=1008,reason='Project no longer exists')
    except (WebSocketDisconnect,RuntimeError):pass

DIST=ROOT/'frontend'/'dist'
if DIST.exists():
    app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
@app.get('/')
def home():
    if not (DIST/'index.html').exists():return JSONResponse({'detail':'Build frontend with npm run build inside frontend/'},status_code=503)
    return FileResponse(DIST/'index.html')
