import {useEffect,useState} from 'react';
import {Camera,LoaderCircle,Plus,Trash2} from 'lucide-react';
import {api} from './api';
import {type Video} from './types';
import {type CameraSession,type SessionCamera,type SessionContent} from './multicam';
import {Modal} from './components/AppDialog';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect} from './components/ui/native-select';

type LibraryVideo=Video&{project_id:string};
type Props={session:CameraSession;onSave:(content:SessionContent)=>Promise<void>;onClose:()=>void};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Editing session membership never deletes a recording or its local annotations. */
export function CameraSessionSettings({session,onSave,onClose}:Props){
 const [name,setName]=useState(session.name);
 const [cameras,setCameras]=useState<SessionCamera[]>(()=>structuredClone(session.cameras));
 const [videos,setVideos]=useState<LibraryVideo[]>([]);
 const [videoId,setVideoId]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [removeId,setRemoveId]=useState('');
 const [reload,setReload]=useState(0);
 const [baseRevision]=useState(session.revision);
 const minimum=Math.min(2,session.cameras.length);
 useEffect(()=>{let gone=false;setLoading(true);setError('');void api<LibraryVideo[]>('/video-library').then(rows=>{
  if(!gone)setVideos(rows.filter(video=>video.project_id===session.project_id));
 }).catch(error=>{if(!gone)setError(message(error));}).finally(()=>{if(!gone)setLoading(false);});return()=>{gone=true;};},[session.project_id,reload]);
 const available=videos.filter(video=>video.status==='ready'&&!cameras.some(camera=>camera.video_id===video.id));
 const pendingRemove=cameras.find(camera=>camera.id===removeId);
 const removedLinks=pendingRemove?session.assignments.filter(assignment=>assignment.video_id===pendingRemove.video_id).length:0;
 const changedWhileEditing=session.revision!==baseRevision;
 const names=cameras.map(camera=>camera.name.trim().toLocaleLowerCase());
 const duplicateName=new Set(names).size!==names.length;
 function addCamera(){
  if(!available.some(video=>video.id===videoId)||cameras.length>=64)return;
  let number=1;while(names.includes(`camera ${number}`))number++;
  setCameras(current=>[...current,{id:crypto.randomUUID(),video_id:videoId,name:`Camera ${number}`,offset_seconds:0}]);
  setVideoId('');
 }
 async function save(){
  if(busy||changedWhileEditing)return;
  setBusy(true);setError('');
  try{
   const kept=new Set(cameras.map(camera=>camera.video_id));
   await onSave({name:name.trim(),cameras:cameras.map(camera=>({...camera,name:camera.name.trim()})),people:structuredClone(session.people),assignments:session.assignments.filter(assignment=>kept.has(assignment.video_id))});
   onClose();
  }catch(error){setError(message(error));}finally{setBusy(false);}
 }
 return <Modal title="Camera session settings" onClose={onClose} busy={busy} description="Rename this session or change its camera recordings. Videos and their annotations remain in your project.">
  <label className="grid gap-2 text-sm">Session name<Input aria-label="Edit camera session name" value={name} maxLength={150} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
  <div className="grid gap-2" aria-label="Session cameras">{cameras.map(camera=>{
   const video=videos.find(video=>video.id===camera.video_id);
   return <div className="flex items-center gap-2 rounded-xl border border-border p-3" key={camera.id}><Camera className="size-4 shrink-0 text-muted-foreground"/><div className="grid min-w-0 flex-1 gap-1"><Input className="h-8 text-sm" aria-label={'Edit camera name '+camera.name} value={camera.name} maxLength={100} disabled={busy} onChange={event=>setCameras(current=>current.map(item=>item.id===camera.id?{...item,name:event.target.value}:item))}/><span className="truncate text-xs text-muted-foreground" title={video?.name}>{video?.name||camera.video_id}</span></div><Button type="button" size="icon-sm" variant="ghost" disabled={busy||cameras.length<=minimum} aria-label={'Remove camera '+camera.name} title={cameras.length<=minimum?'Add a replacement camera before removing this one':'Remove from this session'} onClick={()=>setRemoveId(camera.id)}><Trash2/></Button></div>;
  })}{!cameras.length&&<p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">This session has no recordings. Add available videos below to continue.</p>}</div>
  {pendingRemove&&<div role="alert" className="grid gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>Remove <strong>{pendingRemove.name}</strong> from this session? Its {removedLinks} shared-person {removedLinks===1?'link':'links'} will be removed when you save. The video and all its boxes stay in the project.</p><div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={()=>setRemoveId('')}>Keep camera</Button><Button variant="destructive" size="sm" disabled={busy} onClick={()=>{setCameras(current=>current.filter(camera=>camera.id!==pendingRemove.id));setRemoveId('');}}>Remove from session</Button></div></div>}
  <section className="grid gap-3 border-t border-border pt-4" aria-label="Add existing camera"><h3 className="text-sm font-medium">Add a camera recording</h3>{loading?<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin"/>Loading project videos…</p>:available.length?<div className="flex items-center gap-2"><NativeSelect className="min-w-0 flex-1" aria-label="Existing video to add to session" value={videoId} disabled={busy||cameras.length>=64} onChange={event=>setVideoId(event.target.value)}><option value="">Choose a project video</option>{available.map(video=><option key={video.id} value={video.id}>{video.name} · {video.id.slice(0,6)}</option>)}</NativeSelect><Button variant="outline" size="sm" disabled={busy||!videoId||cameras.length>=64} onClick={addCamera}><Plus/>Add camera</Button></div>:<p className="text-sm text-muted-foreground">No additional ready videos. Upload a video to this project, then return here.</p>}<Button variant="ghost" size="sm" className="justify-self-start" disabled={busy||loading} onClick={()=>setReload(value=>value+1)}>Refresh videos</Button></section>
  {cameras.length<2&&<p className="text-xs text-muted-foreground">Add at least two camera recordings to use synchronized playback and session export.</p>}
  {duplicateName&&<p className="text-sm text-destructive" role="alert">Give each camera a different name.</p>}
  {changedWhileEditing&&<p className="text-sm text-destructive" role="alert">This session changed while these settings were open. Close and reopen settings before saving.</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy||!name.trim()||cameras.length<minimum||cameras.some(camera=>!camera.name.trim())||duplicateName||changedWhileEditing||!!pendingRemove} onClick={()=>void save()}>{busy&&<LoaderCircle className="animate-spin"/>}Save session</Button></div>
 </Modal>;
}
