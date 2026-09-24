import {Textarea} from './components/ui/textarea';
import {Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter} from './components/ui/card';
import {useEffect, useMemo, useState} from 'react';
import {Settings2, ArrowLeft, FolderOpen, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, FileVideo2, FolderArchive, LoaderCircle, LockKeyhole, Play, Plus, Search, Trash2, Upload} from 'lucide-react';
import {api, post} from './api';
import {type Video} from './types';
import {useStore} from './store';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Badge} from './components/ui/badge';
import {Table, TableHeader, TableBody, TableRow, TableHead, TableCell} from './components/ui/table';
import './library-table.css';
import {Modal} from './components/AppDialog';
import {Onboarding} from './components/Onboarding';
import {APP_VERSION} from './release';

export type LibraryVideo = Video & {project_id: string; project_name: string; finished: boolean; created_at?: string | null; updated_at?: string | null};
type RestoreJob = {id: string; status: string; error?: string; restored_project_id?: string};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function VideoTimestamp({value}: {value?: string | null}) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return <span className="video-table-date-unavailable" aria-label="Date unavailable">—</span>;
  return <time className="video-table-date" dateTime={value!} title={date.toLocaleString()}>
    <span>{date.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})}</span>
    <small>{date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'})}</small>
  </time>;
}


function lastPosition(videos: LibraryVideo[]) {
  try {
    const projectId = localStorage.getItem('frameinsight:lastProject');
    if (!projectId) return null;
    const position = JSON.parse(localStorage.getItem('frameinsight:position:' + projectId) || 'null');
    const video = videos.find(v => v.project_id === projectId && v.id === position?.videoId);
    if (!video || video.status !== 'ready' || !Number.isSafeInteger(position.frame)) return null;
    return {video, frame: Math.max(0, Math.min(video.frame_count - 1, position.frame))};
  } catch { return null; }
}

export function VideoLibrary({onOpen, onNew, selectedProject, onSelectProject, onNewProject, onSettings}: {onOpen: (p: string, v: string) => Promise<void>; onNew: () => void; selectedProject:string|null; onSelectProject:(id:string|null)=>void; onNewProject:()=>void;onSettings:(id:string)=>void}) {
  const [projects,setProjects]=useState<{id:string;name:string;classes:string[]|string}[]>([]);
  const [deleting, setDeleting] = useState<LibraryVideo | null>(null);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'progress' | 'finished'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState<RestoreJob | null>(null);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    let gone = false;
    void Promise.all([api<LibraryVideo[]>('/video-library'),api<{id:string;name:string;classes:string[]|string}[]>('/projects')]).then(([rows,groups]) => { if (!gone) {setVideos(rows);setProjects(groups);} }).catch(e => { if (!gone) setError(message(e)); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, []);
  useEffect(() => {
    if (!restore?.id || ['completed', 'failed'].includes(restore.status)) return;
    let gone = false;
    const timer = setInterval(() => void api<RestoreJob>('/jobs/' + restore.id).then(job => { if (!gone) setRestore(job); }).catch(e => {
      if (!gone) { setError(message(e)); setRestore({...restore, status: 'failed'}); }
    }), 1000);
    return () => { gone = true; clearInterval(timer); };
  }, [restore?.id, restore?.status]);
  const resume = useMemo(() => lastPosition(videos), [videos]);
  const projectVideos=videos.filter(v=>v.project_id===selectedProject);
  const selected=projects.find(p=>p.id===selectedProject);
  const shown = projectVideos.filter(v => (v.name + ' ' + v.project_name).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'finished' ? v.finished : !v.finished)));
  const finished = projectVideos.filter(v => v.finished).length;
  function openVideo(video: LibraryVideo) {
    setBusy(video.id); setError('');
    void onOpen(video.project_id, video.id).catch(e => { setError(message(e)); setBusy(''); });
  }
  function deleteVideo() {
    if (!deleting) return;
    const target = deleting;
    setBusy(target.id); setError('');
    void api<{cleanup_warning?: string}>(`/videos/${target.id}?confirmed=true`, {method: 'DELETE'}).then(async result => {
      setVideos(list => list.filter(v => v.id !== target.id)); setDeleting(null);
      await useStore.getState().forgetProject(target.project_id);
      if (result.cleanup_warning) setError(result.cleanup_warning);
    }).catch(e => setError(message(e))).finally(() => setBusy(''));
  }
  return (
    <main className="video-library">
      <div className="library-heading">
        <div><span className="library-kicker">YOUR WORKSPACE</span><h1>{selected?.name||'Your projects'}</h1><p>{selectedProject?'Videos in this project share the same classes.':'Group related videos and classes in a project.'}</p></div>
        <div className="library-actions">{selectedProject&&<Button variant="outline" onClick={()=>onSettings(selectedProject)}><Settings2 size={16}/>Project settings</Button>}<Button variant="outline" size="sm" onClick={() => setGuide(true)}><BookOpen size={16}/>Start guide</Button><Button size="sm" onClick={selectedProject?onNew:onNewProject}><Plus size={17}/>{selectedProject?'New video':'New project'}</Button></div>
      </div>
      <div className="library-body">
        {error && !deleting && <p role="alert" className="error">{error}</p>}
        {loading&&!selectedProject&&<p role="status">Loading your projects…</p>}
        {selectedProject&&<Button variant="ghost" size="sm" className="project-back" onClick={()=>{setQuery('');onSelectProject(null)}}><ArrowLeft size={15}/>All projects</Button>}
        {!selectedProject&&<><label className="video-search"><Search size={17}/><Input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="project-folders">{projects.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=>{const classes:string[]=typeof p.classes==='string'?JSON.parse(p.classes):p.classes||[];return <Card className="project-folder gap-4 py-4 shadow-none" key={p.id}>
          <CardHeader className="px-4"><CardTitle className="flex items-start gap-2"><FolderOpen size={17} className="mt-0.5 shrink-0 text-muted-foreground"/>{p.name}</CardTitle><CardDescription>{videos.filter(v=>v.project_id===p.id).length} {videos.filter(v=>v.project_id===p.id).length===1?'video':'videos'}{!videos.some(v=>v.project_id===p.id)&&' · Empty project'}</CardDescription></CardHeader>
          <CardContent className="px-4 text-sm text-muted-foreground">{classes.join(' · ')||'Add classes when you annotate'}</CardContent>
          <CardFooter className="mt-auto px-4"><Button variant="outline" size="sm" data-testid={'open-project-'+p.id} onClick={()=>{setQuery('');onSelectProject(p.id)}}>Open project<ChevronRight size={14}/></Button><Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={'Edit project '+p.name} title="Project settings" onClick={()=>onSettings(p.id)}><Settings2 size={16}/></Button></CardFooter>
        </Card>})}</div>{!loading&&projects.length>0&&!projects.some(p=>p.name.toLowerCase().includes(query.toLowerCase()))&&<p className="library-no-results">No projects match this search.</p>}{!loading&&!projects.length&&<div className="library-empty"><FolderOpen size={35}/><h2>Create your first project</h2><p>For example, Person detection or Mobile detection. Add videos inside it.</p><Button onClick={onNewProject}><Plus size={16}/>New project</Button></div>}</>}
        {selectedProject&&<>
        {(loading || projectVideos.length > 0) && <><div className="library-controls"><label className="video-search"><Search size={17}/><Input aria-label="Search videos" placeholder="Search your videos…" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="library-filters" aria-label="Filter videos">{([['all', 'All videos'], ['progress', 'In progress'], ['finished', 'Finished']] as const).map(([value, label]) => <Button variant="ghost" size="sm" className="aria-pressed:bg-accent" key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div></div><p className="library-count">{projectVideos.length} {projectVideos.length === 1 ? 'video' : 'videos'}{finished > 0 && ` · ${finished} finished`}</p></>}
        {loading ? <p role="status" className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin"/>Loading your videos…</p> : projectVideos.length > 0 && <div className="video-table-panel">
          <Table className="video-library-table" aria-label="Project videos">
            <TableHeader><TableRow>
              <TableHead scope="col" className="h-10 video-table-name-heading">Video</TableHead>
              <TableHead scope="col" className="h-10">Status</TableHead>
              <TableHead scope="col" className="h-10">Created</TableHead>
              <TableHead scope="col" className="h-10">Last updated</TableHead>
              <TableHead scope="col" className="h-10 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>{shown.map(video => {
              const isResume = resume?.video.id === video.id;
              const preparing = video.status !== 'ready' && video.status !== 'failed';
              const status = video.status === 'failed' ? 'Needs attention' : preparing ? 'Preparing…' : video.finished ? 'Finished' : 'In progress';
              return <TableRow key={video.id} data-testid={'video-row-' + video.id}>
                <TableCell className="py-2.5 video-table-name-cell"><div className="video-table-name">
                  <FileVideo2 size={18} aria-hidden="true"/>
                  <div><strong title={video.name}>{video.name}</strong><small>{video.frame_count.toLocaleString()} frames{isResume && <span className="video-table-saved-position"> · Saved at frame {resume.frame}</span>}</small></div>
                </div></TableCell>
                <TableCell className="py-2.5"><Badge variant={video.status === 'failed' ? 'destructive' : video.finished ? 'secondary' : 'outline'} className="video-table-status">{preparing ? <LoaderCircle className="animate-spin"/> : video.finished ? <CheckCircle2/> : null}{status}</Badge></TableCell>
                <TableCell className="py-2.5"><VideoTimestamp value={video.created_at}/></TableCell>
                <TableCell className="py-2.5"><VideoTimestamp value={video.updated_at}/></TableCell>
                <TableCell className="py-2.5"><div className="video-table-actions">
                  <Button variant="outline" size="sm" data-testid={'open-video-' + video.id} aria-label={(isResume ? 'Resume video ' : 'Open video ') + video.name} disabled={!!busy} onClick={() => openVideo(video)}>
                    {busy === video.id && !deleting ? <LoaderCircle className="animate-spin"/> : <Play/>}<span data-testid={isResume ? 'resume-video-' + video.id : undefined}>{busy === video.id && !deleting ? 'Opening…' : isResume ? 'Resume' : 'Open'}</span>
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={'Delete video ' + video.name} title="Delete video" data-testid={'delete-video-' + video.id} disabled={!!busy} onClick={() => {setError(''); setDeleting(video);}}><Trash2/></Button>
                </div></TableCell>
              </TableRow>;
            })}
            {!shown.length && <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="py-9 text-center"><p className="mb-3 text-muted-foreground">No videos match this search.</p><Button variant="outline" size="sm" onClick={() => {setQuery(''); setFilter('all');}}>Clear filters</Button></TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>}
        {!loading && !projectVideos.length && <div className="library-empty"><Upload size={35}/><h2>No videos in this project</h2><p>This project and its classes are kept when you delete a video. Add a new video to reuse them.</p><div className="empty-actions"><Button onClick={onNew}><Plus size={16}/>Add video</Button><Button variant="outline" size="sm" onClick={() => setGuide(true)}><BookOpen size={16}/>See the start guide</Button></div></div>}
        </>}
        <details className="restore-backup"><summary><FolderArchive size={16}/> Restore a backup</summary><p>Choose a project backup ZIP. You will also need the original videos on this computer.</p><Input aria-label="Restore backup" type="file" accept=".zip" disabled={!!restore && !['completed', 'failed'].includes(restore.status)} onChange={e => {
          const file = e.target.files?.[0]; if (!file) return;
          const data = new FormData(); data.append('file', file); setError('');
          void api<RestoreJob>('/imports/native', {method: 'POST', body: data}).then(setRestore).catch(e => setError(message(e)));
        }}/>{restore && <p role="status">{restore.status === 'completed' ? 'Backup restored. Your video is ready to open.' : restore.status === 'failed' ? restore.error || 'The backup could not be restored.' : 'Restoring your backup…'}</p>}{restore?.restored_project_id && <Button variant="outline" onClick={() => void api('/projects/' + restore.restored_project_id).then(project => {setProjects(rows=>[...rows.filter(p=>p.id!==project.id),project]);onSelectProject(project.id);return api<LibraryVideo[]>('/video-library').then(setVideos)}).catch(e => setError(message(e)))}>Open restored project<ArrowRight size={14}/></Button>}</details>
        <div className="library-note"><span><LockKeyhole size={12}/>Your videos and annotations stay on this computer.</span><span>Frameinsight {APP_VERSION}</span></div>
      </div>
      {deleting && <Modal title="Delete video" onClose={() => { if (!busy) { setDeleting(null); setError(''); } }} busy={!!busy}>
        <p><strong>{deleting.name}</strong></p><p>This removes the video, its annotations, and cached frames from this app. Your original video file and downloaded exports stay on your computer.</p><p>This cannot be undone. Keep a project backup if you need to edit this work later.</p>{error && <p role="alert" className="error">{error}</p>}<div className="button-row"><Button variant="outline" disabled={!!busy} onClick={() => { setDeleting(null); setError(''); }}>Cancel</Button><Button variant="destructive" disabled={!!busy} onClick={deleteVideo}>{busy && <LoaderCircle size={14} className="animate-spin"/>}Delete video and annotations</Button></div>
      </Modal>}
      {guide && <Modal title="Your first annotation" onClose={() => setGuide(false)}><Onboarding onDone={() => setGuide(false)}/></Modal>}
    </main>
  );
}

export function NewProject({onCreated,onBusy}:{onCreated:(id:string)=>void;onBusy:(busy:boolean)=>void}) {
 const [name,setName]=useState(''),[classes,setClasses]=useState('Person'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <form onSubmit={async e=>{e.preventDefault();setError('');setBusy(true);onBusy(true);try{const names=classes.split('\n').map(c=>c.trim()).filter(Boolean);if(!name.trim()||!names.length)throw new Error('Enter a project name and at least one class.');const p=await post('/projects',{name:name.trim(),classes:names});onCreated(p.id);}catch(e){setError(message(e))}finally{setBusy(false);onBusy(false)}}}>
 <label>Project name<Input autoFocus required maxLength={150} placeholder="Person detection" value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>Class names — one per line<Textarea aria-label="Project classes" rows={4} required value={classes} onChange={e=>setClasses(e.target.value)}/></label><p className="form-help">All videos in this project use these classes, in this order. You can add more later.</p>{error&&<p role="alert" className="error">{error}</p>}<Button type="submit" className="primary" disabled={busy}>Create project</Button></form>;
}

export function NewVideo({projectId,onCreated,onBusy}:{projectId:string;onCreated:(p:string,v:string)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[path,setPath]=useState('');
 async function upload(file?:File){if(busy)return;setBusy(true);onBusy(true);setError('');try{let result;if(file){const data=new FormData();data.append('file',file);result=await api(`/projects/${projectId}/videos`,{method:'POST',body:data});}else result=await post(`/projects/${projectId}/videos/local`,{path:path.trim()});await onCreated(projectId,result.video_id);}catch(e){setError(message(e))}finally{setBusy(false);onBusy(false)}}
 return <div className="new-video"><p>Add a video to this project. After it is prepared, use <strong>Import annotations</strong> to load YOLO or MOT labels.</p>{error&&<p role="alert" className="error">{error}</p>}<label className="upload-box"><Upload size={28}/><strong>{busy?'Preparing video…':'Choose a video'}</strong><span>MP4, MOV, AVI, MKV or WebM</span><Input aria-label="Upload video" type="file" accept=".mp4,.mov,.avi,.mkv,.webm,.m4v" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/></label><details><summary>Or use a video path on this computer</summary><form onSubmit={e=>{e.preventDefault();void upload()}}><label>Video path<Input aria-label="Video path" required value={path} onChange={e=>setPath(e.target.value)} placeholder="/home/name/Videos/recording.mp4"/></label><Button disabled={busy||!path.trim()}>Add video from path</Button></form></details></div>;
}
