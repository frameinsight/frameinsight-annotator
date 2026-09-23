import {useEffect, useMemo, useState} from 'react';
import {ArrowRight, BookOpen, Check, ChevronRight, FolderArchive, LoaderCircle, LockKeyhole, Play, Plus, Search, Trash2, Upload} from 'lucide-react';
import {api, post} from './api';
import {type Video} from './types';
import {useStore} from './store';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Modal} from './components/AppDialog';
import {Onboarding} from './components/Onboarding';
import {APP_VERSION} from './release';

export type LibraryVideo = Video & {project_id: string; project_name: string; finished: boolean};
type RestoreJob = {id: string; status: string; error?: string; restored_project_id?: string};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

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

export function VideoLibrary({onOpen, onNew}: {onOpen: (p: string, v: string) => Promise<void>; onNew: () => void}) {
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
    void api<LibraryVideo[]>('/video-library').then(rows => { if (!gone) setVideos(rows); }).catch(e => { if (!gone) setError(message(e)); }).finally(() => { if (!gone) setLoading(false); });
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
  const shown = videos.filter(v => (v.name + ' ' + v.project_name).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'finished' ? v.finished : !v.finished)));
  const finished = videos.filter(v => v.finished).length;
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
        <div><span className="library-kicker">YOUR WORKSPACE</span><h1>Your videos</h1><p>Continue where you left off, or start a new annotation.</p></div>
        <div className="library-actions"><Button variant="outline" onClick={() => setGuide(true)}><BookOpen size={16}/>Start guide</Button><Button className="primary" onClick={onNew}><Plus size={17}/>New video</Button></div>
      </div>
      <div className="library-body">
        {error && !deleting && <p role="alert" className="error">{error}</p>}
        {!loading && resume && <div className="resume-video"><div className="resume-icon"><Play size={19}/></div><div className="resume-copy"><span>CONTINUE ANNOTATING</span><strong>{resume.video.name}</strong><small>Last viewed: frame {resume.frame} of {Math.max(0, resume.video.frame_count - 1)}</small></div><Button variant="outline" disabled={!!busy} data-testid={'resume-video-' + resume.video.id} onClick={() => openVideo(resume.video)}>Resume video<ArrowRight size={15}/></Button></div>}
        {(loading || videos.length > 0) && <><div className="library-controls"><label className="video-search"><Search size={17}/><Input className="rounded-none border-0 px-0 shadow-none focus-visible:ring-0" aria-label="Search videos" placeholder="Search your videos…" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="library-filters" aria-label="Filter videos">{([['all', 'All videos'], ['progress', 'In progress'], ['finished', 'Finished']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div><p className="library-count">{videos.length} {videos.length === 1 ? 'video' : 'videos'}{finished > 0 && ` · ${finished} finished`}</p></>}
        {loading ? <p role="status"><LoaderCircle size={16} className="animate-spin"/> Loading your videos…</p> : <div className="video-grid">{shown.map(video => (
          <article key={video.id} className="video-card">
            <button data-testid={'open-video-' + video.id} className="video-tile" disabled={!!busy} onClick={() => openVideo(video)}>
              <div className="video-thumbnail">{video.frame_count > 0 ? <img src={'/api/videos/' + video.id + '/frames/0'} loading="lazy" alt=""/> : <Play size={32}/>}</div>
              <strong title={video.name}>{video.name}</strong>
              <div className="video-card-meta"><span>{video.frame_count.toLocaleString()} frames</span><span className={'video-state-badge ' + (video.status === 'failed' ? 'failed' : video.finished ? 'finished' : '')}>{video.status === 'failed' ? 'Needs attention' : video.status === 'indexing' ? 'Preparing…' : video.finished ? 'Finished' : 'In progress'}</span></div>
              {video.project_name !== video.name && <span>{video.project_name}</span>}
            </button>
            <div className="video-card-footer"><small>{busy === video.id ? 'Opening…' : 'Open video'} <ChevronRight size={12}/></small><Button variant="ghost" size="sm" className="delete-video" aria-label={'Delete video ' + video.name} data-testid={'delete-video-' + video.id} disabled={!!busy} onClick={() => { setError(''); setDeleting(video); }}><Trash2 size={13}/>Delete video</Button></div>
          </article>
        ))}</div>}
        {!loading && videos.length > 0 && !shown.length && <div className="library-no-results"><p>No videos match this search.</p><Button variant="ghost" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</Button></div>}
        {!loading && !videos.length && <div className="library-empty"><Upload size={35}/><h2>Your first video starts here</h2><p>Add a video, draw your first person, and adjust their box as you move through the frames.</p><div className="empty-actions"><Button onClick={onNew}><Plus size={16}/>Create new video</Button><Button variant="outline" onClick={() => setGuide(true)}><BookOpen size={16}/>See the 5-step guide</Button></div></div>}
        <details className="restore-backup"><summary><FolderArchive size={16}/> Restore a backup</summary><p>Choose a project backup ZIP. You will also need the original videos on this computer.</p><Input aria-label="Restore backup" type="file" accept=".zip" disabled={!!restore && !['completed', 'failed'].includes(restore.status)} onChange={e => {
          const file = e.target.files?.[0]; if (!file) return;
          const data = new FormData(); data.append('file', file); setError('');
          void api<RestoreJob>('/imports/native', {method: 'POST', body: data}).then(setRestore).catch(e => setError(message(e)));
        }}/>{restore && <p role="status">{restore.status === 'completed' ? 'Backup restored. Your video is ready to open.' : restore.status === 'failed' ? restore.error || 'The backup could not be restored.' : 'Restoring your backup…'}</p>}{restore?.restored_project_id && <Button variant="outline" onClick={() => void api('/projects/' + restore.restored_project_id).then(project => onOpen(project.id, Object.keys(project.videos)[0])).catch(e => setError(message(e)))}>Open restored video<ArrowRight size={14}/></Button>}</details>
        <div className="library-note"><span><LockKeyhole size={12}/>Your videos and annotations stay on this computer.</span><span>Frameinsight {APP_VERSION}</span></div>
      </div>
      {deleting && <Modal title="Delete video" onClose={() => { if (!busy) { setDeleting(null); setError(''); } }} busy={!!busy}>
        <p><strong>{deleting.name}</strong></p><p>This removes the video, its annotations, and cached frames from this app. Your original video file and downloaded exports stay on your computer.</p><p>This cannot be undone. Keep a project backup if you need to edit this work later.</p>{error && <p role="alert" className="error">{error}</p>}<div className="button-row"><Button variant="outline" disabled={!!busy} onClick={() => { setDeleting(null); setError(''); }}>Cancel</Button><Button variant="destructive" disabled={!!busy} onClick={deleteVideo}>{busy && <LoaderCircle size={14} className="animate-spin"/>}Delete video and annotations</Button></div>
      </Modal>}
      {guide && <Modal title="Your first annotation" onClose={() => setGuide(false)}><Onboarding onDone={() => setGuide(false)}/></Modal>}
    </main>
  );
}

export function NewVideo({onCreated, onBusy}: {onCreated: (p: string, v: string) => Promise<void>; onBusy: (busy: boolean) => void}) {
  const [classes, setClasses] = useState(['Person']);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState('');
  const [dragging, setDragging] = useState(false);
  async function upload(file: File) {
    if (busy) return;
    setBusy(true); onBusy(true); setError('');
    try {
      const id = pid || (await post('/projects', {name: file.name, classes: classes.map(c => c.trim())})).id;
      setPid(id);
      const data = new FormData(); data.append('file', file);
      const result = await api(`/projects/${id}/videos`, {method: 'POST', body: data});
      await onCreated(id, result.video_id);
    } catch (e) { setError(message(e)); } finally { setBusy(false); onBusy(false); }
  }
  return <div className="new-video">
    <div className="new-video-steps" aria-label={`Step ${step} of 2`}><span className={step === 1 ? 'current' : ''}><b>{step === 2 ? <Check size={13}/> : 1}</b>Choose labels</span><ChevronRight size={14}/><span className={step === 2 ? 'current' : ''}><b>2</b>Add your video</span></div>
    {error && <p role="alert" className="error">{error}</p>}
    {step === 1 ? <form onSubmit={event => {
      event.preventDefault(); const names = classes.map(c => c.trim());
      if (names.some(c => !c) || new Set(names).size !== names.length) { setError('Give each class a different, non-empty name.'); return; }
      setError(''); setStep(2);
    }}>
      <p>Classes are labels for your boxes. You can keep <strong>Person</strong> to get started, and add other labels later.</p>
      <label className="class-count">Number of classes<Input aria-label="Number of classes" type="number" min="1" max="100" value={classes.length} onChange={e => { const count = Math.max(1, Math.min(100, Number(e.target.value) || 1)); setClasses(Array.from({length: count}, (_, i) => classes[i] ?? '')); }}/></label>
      <div className="class-fields">{classes.map((value, index) => <label key={index}>Class {index + 1}<Input aria-label={'Class ' + (index + 1)} required maxLength={80} value={value} placeholder="Enter a class name" onChange={e => setClasses(classes.map((old, i) => index === i ? e.target.value : old))}/></label>)}</div>
      <Button type="submit" className="primary">Continue to upload<ArrowRight size={15}/></Button>
    </form> : <div className="new-video-upload">
      <div className="new-video-classes" aria-label="Selected classes">{classes.map(name => <span key={name}>{name}</span>)}</div>
      <label className={'upload-box ' + (dragging ? 'is-dragging' : '')} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file && !busy) void upload(file); }}>
        {busy ? <LoaderCircle size={28} className="animate-spin"/> : <Upload size={28}/>}<strong>{busy ? 'Uploading your video…' : 'Choose a video from your computer'}</strong><span>{busy ? 'Keep this window open while your video is prepared.' : 'Or drag your video here. MP4, MOV, AVI, MKV or WebM.'}</span><Input aria-label="Upload video" type="file" accept=".mp4,.mov,.avi,.mkv,.webm,.m4v" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }}/>
      </label>
      <p className="form-help">Your video stays on this computer. Longer videos take more time and disk space to prepare.</p>
      {!pid && <Button variant="ghost" disabled={busy} onClick={() => setStep(1)}>Back to classes</Button>}
    </div>}
  </div>;
}
