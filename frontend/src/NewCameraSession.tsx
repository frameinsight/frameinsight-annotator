import {useEffect,useState} from 'react';
import {FileVideo2,Grid2X2,Upload,LoaderCircle} from 'lucide-react';
import {api,post} from './api';
import {type Project,type Video} from './types';
import {type CameraSession} from './multicam';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Checkbox} from './components/ui/checkbox';
import {NativeSelect} from './components/ui/native-select';
const message=(e:unknown)=>e instanceof Error?e.message:String(e);

export function WorkflowChoice({onSingle,onMultiple}:{onSingle:()=>void;onMultiple:()=>void}){
 return <div className="grid gap-3" aria-label="Annotation workflow"><p>What would you like to annotate?</p><Button variant="outline" className="h-auto justify-start gap-4 rounded-2xl p-5 text-left whitespace-normal" onClick={onSingle}><FileVideo2 className="size-7 shrink-0"/><span><strong className="block">Single video</strong><span className="block text-xs text-muted-foreground mt-1">Your usual annotation tools, one video at a time.</span></span></Button><Button variant="outline" className="h-auto justify-start gap-4 rounded-2xl p-5 text-left whitespace-normal" onClick={onMultiple}><Grid2X2 className="size-7 shrink-0"/><span><strong className="block">Multiple cameras</strong><span className="block text-xs text-muted-foreground mt-1">Play related videos together and link the same person across cameras.</span></span></Button><p className="text-xs text-muted-foreground">Existing videos keep their current workflow. Camera sessions are saved separately.</p></div>;
}

type CameraLibraryVideo=Video&{project_id:string};
type ImportPreview={name:string;cameras:{video_id:string;name:string;video_name?:string;source_hash?:string;frame_count:number}[]};
type ImportImpact={project_revision:number;replacement_token:string;cameras:{video_id:string;video_name:string;camera_name:string;existing_tracks:number;existing_boxes:number;imported_tracks:number;imported_boxes:number}[];affected_sessions:{id:string;name:string;revision:number;video_ids:string[]}[]};
export function NewCameraSession({projectId,onCreated,onBusy}:{projectId:string;onCreated:(session:CameraSession)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [videos,setVideos]=useState<CameraLibraryVideo[]>([]),[name,setName]=useState('Camera session'),[selected,setSelected]=useState<string[]>([]),[names,setNames]=useState<Record<string,string>>({}),[path,setPath]=useState('');
 const [action,setAction]=useState<'upload'|'create'|'preview'|'plan'|'import'|null>(null),[error,setError]=useState(''),[libraryError,setLibraryError]=useState(''),[importError,setImportError]=useState(''),[importFile,setImportFile]=useState<File|null>(null),[preview,setPreview]=useState<ImportPreview|null>(null),[mapping,setMapping]=useState<Record<string,string>>({});
 const [mode,setMode]=useState<'add'|'replace'>('add'),[impact,setImpact]=useState<ImportImpact|null>(null),[confirmed,setConfirmed]=useState(false);
 function invalidateImpact(){setImpact(null);setConfirmed(false)}
 const busy=action!==null;
 useEffect(()=>{let gone=false,inFlight=false;const load=async()=>{if(inFlight)return;inFlight=true;try{const rows=await api<CameraLibraryVideo[]>('/video-library');if(!gone){setVideos(rows.filter(video=>video.project_id===projectId));setLibraryError('')}}catch(e){if(!gone)setLibraryError(message(e))}finally{inFlight=false}};void load();const timer=setInterval(()=>void load(),1500);return()=>{gone=true;clearInterval(timer)}},[projectId]);
 async function refreshVideos(){const rows=await api<CameraLibraryVideo[]>('/video-library');setVideos(rows.filter(video=>video.project_id===projectId));}
 async function run(next:NonNullable<typeof action>,fn:()=>Promise<void>){const report=next==='preview'||next==='plan'||next==='import'?setImportError:setError;report('');setAction(next);onBusy(true);try{await fn()}catch(e){report(message(e))}finally{setAction(null);onBusy(false)}}
 async function upload(files:File[]){await run('upload',async()=>{for(const file of files){const body=new FormData();body.append('file',file);const result=await api<{video_id:string}>(`/projects/${projectId}/videos`,{method:'POST',body});setSelected(old=>[...old,result.video_id]);}await refreshVideos()})}
 const ready=videos.filter(v=>v.status==='ready'),preparing=videos.filter(v=>v.status!=='ready'&&v.status!=='failed');
 const mappingReady=preview!==null&&preview.cameras.every(c=>ready.some(v=>v.id===mapping[c.video_id]))&&new Set(Object.values(mapping)).size===preview.cameras.length;
 return <div className="grid gap-4"><label>Session name<Input aria-label="Camera session name" maxLength={150} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><p className="text-sm text-muted-foreground">Choose at least two related videos. Set camera names now; align their timing in the workspace.</p>
 <div className="max-h-64 overflow-y-auto rounded-xl border border-border p-2" aria-label="Camera videos">{!videos.length&&<p className="p-3 text-sm text-muted-foreground">Upload videos to begin.</p>}{videos.map((v,i)=><div key={v.id} className="flex items-center gap-3 p-2"><Checkbox aria-label={'Use camera video '+v.name+' '+v.id} checked={selected.includes(v.id)} disabled={busy||v.status==='failed'} onCheckedChange={value=>setSelected(old=>value===true?[...new Set([...old,v.id])]:old.filter(id=>id!==v.id))}/><div className="min-w-0 flex-1"><span className="block truncate text-sm" title={v.name}>{v.name}</span><small className="text-muted-foreground">{v.status==='ready'?`${v.frame_count.toLocaleString()} frames`:v.status==='failed'?'Preparing failed — retry from the video library':'Preparing exact frames…'}</small></div><Input className="w-32 h-8 text-xs" aria-label={'Camera name for '+v.id} maxLength={80} value={names[v.id]??`Camera ${i+1}`} onChange={e=>setNames(old=>({...old,[v.id]:e.target.value}))} disabled={busy}/></div>)}</div>
 <label className="flex items-center gap-2 text-sm"><Upload size={16}/>Upload camera videos<Input aria-label="Upload camera videos" type="file" multiple accept="video/*" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void upload(files)}}/></label>
 <details><summary className="text-sm cursor-pointer">Add a video path on this computer</summary><form className="flex gap-2 mt-3" onSubmit={e=>{e.preventDefault();void run('upload',async()=>{const r=await post<{video_id:string}>(`/projects/${projectId}/videos/local`,{path:path.trim()});setSelected(old=>[...old,r.video_id]);setPath('');await refreshVideos()})}}><Input aria-label="Camera video path" value={path} onChange={e=>setPath(e.target.value)} placeholder="Path inside your workspace" disabled={busy}/><Button variant="outline" disabled={busy||!path.trim()}>Add video</Button></form></details>
 {libraryError&&<p className="error" role="alert">Could not refresh the video list: {libraryError}</p>}
 {error&&<p className="error" role="alert">{error}</p>}
 <Button disabled={busy||!name.trim()||selected.length<2||selected.some(id=>!ready.some(v=>v.id===id))} onClick={()=>void run('create',async()=>{const cameras=selected.map(id=>({id:crypto.randomUUID(),video_id:id,name:(names[id]??`Camera ${videos.findIndex(v=>v.id===id)+1}`).trim(),offset_seconds:0}));if(cameras.some(c=>!c.name))throw new Error('Enter a name for every camera.');const session=await post<CameraSession>(`/projects/${projectId}/camera-sessions`,{name:name.trim(),cameras});await onCreated(session)})}>{action==='create'?<LoaderCircle className="animate-spin"/>:<Grid2X2/>}{action==='create'?'Creating camera session…':'Create camera session'}</Button>
 <details className="border-t border-border pt-3" data-testid="camera-session-import">
  <summary className="text-sm cursor-pointer">Import a multi-camera annotation JSON</summary>
  <div className="grid gap-3 mt-3">
   <p className="text-sm text-muted-foreground">Upload the matching original videos above, then choose which video belongs to each camera. Add keeps existing annotations; Replace updates only the mapped videos after you confirm.</p>
   <Input aria-label="Multi-camera annotation file" type="file" accept=".json,.gz" disabled={busy} onChange={e=>{setImportFile(e.target.files?.[0]||null);setPreview(null);setMapping({});invalidateImpact();setImportError('')}}/>
   <Button variant="outline" disabled={busy||!importFile} onClick={()=>void run('preview',async()=>{setPreview(null);setMapping({});invalidateImpact();const body=new FormData();body.append('file',importFile!);const result=await api<ImportPreview>(`/projects/${projectId}/camera-sessions/import/preview`,{method:'POST',body});setPreview(result)})}>
    {action==='preview'&&<LoaderCircle className="animate-spin"/>}{action==='preview'?'Reading camera list…':'Read camera list'}
   </Button>
   {preparing.length>0&&<p className="text-sm text-muted-foreground" role="status">{preparing.length} {preparing.length===1?'video is':'videos are'} still preparing exact frames. You can read the camera list now; match each camera when its video is ready.</p>}
   {importError&&<p className="error" role="alert">{importError}</p>}
   {preview&&<>
    <p className="text-sm">{preview.name}</p>
    {preview.cameras.map(c=><label key={c.video_id} className="text-sm">{c.name} · {c.video_name||c.video_id}
     <NativeSelect aria-label={'Match camera '+c.name} value={mapping[c.video_id]||''} disabled={busy||!ready.length} onChange={e=>{setMapping(old=>({...old,[c.video_id]:e.target.value}));invalidateImpact()}}>
      <option value="">{!ready.length&&preparing.length?'Waiting for videos to finish preparing':'Choose the matching video'}</option>
      {videos.map(v=><option key={v.id} value={v.id} disabled={v.status!=='ready'}>{v.name} · {v.id.slice(0,6)}{v.status==='ready'?'':v.status==='failed'?' · Preparing failed':' · Preparing exact frames…'}</option>)}
     </NativeSelect>
    </label>)}
    <label className="text-sm">Import mode<NativeSelect aria-label="Camera annotation import mode" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as 'add'|'replace');invalidateImpact()}}><option value="add">Add to existing annotations</option><option value="replace">Replace annotations on mapped cameras</option></NativeSelect></label>
    {mode==='replace'&&<>
     <Button variant="outline" disabled={busy||!mappingReady} onClick={()=>void run('plan',async()=>{invalidateImpact();const body=new FormData();body.append('file',importFile!);body.append('video_mapping',JSON.stringify(mapping));const result=await api<ImportPreview&{impact:ImportImpact}>(`/projects/${projectId}/camera-sessions/import/preview`,{method:'POST',body});setImpact(result.impact)})}>{action==='plan'&&<LoaderCircle className="animate-spin"/>}{action==='plan'?'Checking mapped cameras…':'Preview replacement'}</Button>
     {impact&&<div className="grid gap-3 rounded-xl border border-border p-3" data-testid="camera-import-impact">
      <p className="text-sm">Only these videos’ annotations will be replaced. Original videos and unmapped annotations stay unchanged. Imported shared people and camera timing will be saved in a new session.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[400px] text-xs" aria-label="Camera replacement impact"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Camera / video</th><th className="p-2">Tracks: current → imported</th><th className="p-2">Boxes: current → imported</th></tr></thead><tbody>{impact.cameras.map(row=><tr key={row.video_id}><td className="p-2 min-w-32"><span className="block font-medium">{row.camera_name}</span><span className="block max-w-36 truncate text-muted-foreground" title={row.video_name}>{row.video_name}</span><span className="text-muted-foreground">{row.video_id.slice(0,6)}</span></td><td className="p-2 tabular-nums whitespace-nowrap">{row.existing_tracks.toLocaleString()} → {row.imported_tracks.toLocaleString()}</td><td className="p-2 tabular-nums whitespace-nowrap">{row.existing_boxes.toLocaleString()} → {row.imported_boxes.toLocaleString()}</td></tr>)}</tbody></table></div>
      {impact.affected_sessions.length>0&&<p className="text-sm text-amber-400">These videos are also used by: {impact.affected_sessions.map(row=>row.name).join(', ')}. Those sessions are kept, but assignments to replaced tracks are removed. Review and relink them afterward.</p>}
      <label className="flex items-start gap-2 text-sm"><Checkbox aria-label="Replace the annotations on these mapped videos" checked={confirmed} disabled={busy} onCheckedChange={value=>setConfirmed(value===true)}/>Replace the annotations on these mapped videos</label>
     </div>}
    </>}
    <Button disabled={busy||!mappingReady||(mode==='replace'&&(!impact||!confirmed))} onClick={()=>void run('import',async()=>{const revision=mode==='replace'?impact!.project_revision:(await api<Project>('/projects/'+projectId)).revision;const body=new FormData();body.append('file',importFile!);body.append('video_mapping',JSON.stringify(mapping));body.append('project_revision',String(revision));body.append('mode',mode);if(mode==='replace')body.append('replacement_token',impact!.replacement_token);const result=await api<{session:CameraSession}>(`/projects/${projectId}/camera-sessions/import`,{method:'POST',body});await onCreated(result.session)})}>
     {action==='import'&&<LoaderCircle className="animate-spin"/>}{action==='import'?'Importing camera session…':mode==='replace'?'Replace annotations and import session':'Import camera session'}
    </Button>
   </>}
  </div>
 </details>
 </div>;
}
