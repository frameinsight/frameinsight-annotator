import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Check,ChevronLeft,ChevronRight,Download,LoaderCircle,Pause,Play,Redo2,RotateCcw,Scissors,Trash2,Undo2,Upload} from 'lucide-react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect} from './components/ui/native-select';
import {Slider} from './components/ui/slider';
import {api,post} from './api';
import {hasOpenOverlay} from './shortcut-guards';
import {cutSections,frameAtTime,fromKeptSections,keptSections,type CutSection} from './trim-sections';

type TrimJob={id:string;status:string;progress:number;total?:number;phase?:string;error?:string;metadata?:{name:string;frame_count:number;width:number;height:number;has_audio:boolean};download_url?:string;preview_url?:string;name?:string;frame_count?:number};
type Edit={past:CutSection[][];present:CutSection[];future:CutSection[][]};
type Timing={timestamps:number[];duration:number};
const storage='frameinsight:video-preparation';
const emptyEdit=():Edit=>({past:[],present:[],future:[]});
function restored(){try{return JSON.parse(localStorage.getItem(storage)||'null')}catch{return null}}
function restoreEdit(saved:any):Edit{
 const count=saved?.scan?.metadata?.frame_count;
 if(!count)return emptyEdit();
 try{
  const rows:CutSection[]=saved.cutSections||fromKeptSections(saved.sections?.length?saved.sections:[{start:0,end:count-1}],count);
  if(rows.length>200||rows[0]?.start!==0||rows.at(-1)?.end!==count-1||rows.some((r,i)=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.end<r.start||(i>0&&rows[i-1].end+1!==r.start)||typeof r.removed!=='boolean'))return emptyEdit();
  return {past:[],present:rows,future:[]};
 }catch{return emptyEdit()}
}
function timeLabel(seconds:number){const n=Math.max(0,seconds);return `${Math.floor(n/60)}:${Math.floor(n%60).toString().padStart(2,'0')}.${Math.floor(n%1*1000).toString().padStart(3,'0')}`;}
const running=(job:TrimJob|null)=>!!job&&['queued','running'].includes(job.status);

export function TrimVideo({onBack}:{onBack:()=>void}){
 const [saved]=useState(restored);
 const [scan,setScan]=useState<TrimJob|null>(saved?.scan||null),[result,setResult]=useState<TrimJob|null>(saved?.result||null),[playbackJob,setPlaybackJob]=useState<TrimJob|null>(saved?.playbackJob||null);
 const [edit,setEdit]=useState<Edit>(()=>restoreEdit(saved)),[selected,setSelected]=useState(0),[name,setName]=useState(saved?.name||'trimmed.mp4');
 const [timing,setTiming]=useState<Timing|null>(null),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[rate,setRate]=useState(1),[mediaError,setMediaError]=useState(false),[ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
 const player=useRef<HTMLVideoElement>(null),pendingSeek=useRef<number|null>(null);
 const info=scan?.metadata,count=info?.frame_count||1,rows=edit.present;
 const working=busy||running(scan)||running(result)||running(playbackJob),complete=result?.status==='completed';
 const activeJob=running(result)?result:running(playbackJob)?playbackJob:scan;
 const chosen=rows.find(r=>selected>=r.start&&selected<=r.end)||rows[0];
 const kept=useMemo(()=>keptSections(rows),[rows]);
 const keptCount=kept.reduce((sum,r)=>sum+r.end-r.start+1,0);
 const offset=playbackJob?.status==='completed'?(timing?.timestamps[0]||0):0;
 const timestamps=useMemo(()=>timing?.timestamps.map(t=>t-offset)||[],[timing,offset]);
 const duration=timing?timing.duration-offset:0;
 const sourceUrl=scan?playbackJob?.status==='completed'?playbackJob.preview_url:`/api/video-trims/${scan.id}/source`:'';
 const canEdit=!!info&&!!timing&&!working&&!complete;

 useEffect(()=>{try{localStorage.setItem(storage,JSON.stringify({scan,result,playbackJob,cutSections:rows,sections:kept,name}))}catch{}},[scan,result,playbackJob,rows,kept,name]);
 useEffect(()=>{
  if(!scan?.id)return;
  let gone=false,timer=0;
  const poll=async()=>{try{
   const next=await api<TrimJob>('/jobs/'+scan.id);if(gone)return;setScan(next);
   if(next.status==='completed'&&next.metadata)setEdit(current=>current.present.length?current:{...emptyEdit(),present:[{start:0,end:next.metadata!.frame_count-1,removed:false}]});
   if(running(next))timer=window.setTimeout(poll,700);
  }catch(e){if(!gone){setError(String(e));if((e as {status?:number}).status===404){setScan(null);setEdit(emptyEdit());setResult(null);setPlaybackJob(null);}}}};
  void poll();return()=>{gone=true;clearTimeout(timer)};
 },[scan?.id,retry]);
 useEffect(()=>{
  if(!scan||scan.status!=='completed')return;
  let gone=false;
  void api<Timing>(`/video-trims/${scan.id}/timing`).then(value=>{if(!gone)setTiming(value)}).catch(e=>{if(!gone)setError(String(e))});
  return()=>{gone=true};
 },[scan?.id,scan?.status,retry]);
 useEffect(()=>{
  let gone=false;const timers:number[]=[];
  async function poll(id:string,put:(value:TrimJob|null)=>void){try{
   const next=await api<TrimJob>('/jobs/'+id);if(gone)return;put(next);
   if(running(next))timers.push(window.setTimeout(()=>void poll(id,put),700));
  }catch(e){if(!gone){setError(String(e));if((e as {status?:number}).status===404)put(null);}}}
  if(result?.id)void poll(result.id,setResult);
  if(playbackJob?.id)void poll(playbackJob.id,setPlaybackJob);
  return()=>{gone=true;timers.forEach(clearTimeout)};
 },[result?.id,playbackJob?.id,retry]);
 useEffect(()=>{setMediaError(false);setReady(false);setPlaying(false)},[sourceUrl,complete]);
 useEffect(()=>{if(player.current)player.current.playbackRate=rate},[rate,sourceUrl,complete]);
 useEffect(()=>{
  if(!playing||!timestamps.length)return;
  let animation=0;
  const tick=()=>{if(player.current)setFrame(frameAtTime(timestamps,player.current.currentTime));animation=requestAnimationFrame(tick)};
  animation=requestAnimationFrame(tick);return()=>cancelAnimationFrame(animation);
 },[playing,timestamps]);
 function pause(){player.current?.pause();setPlaying(false)}
 function seekTime(at:number){const start=timestamps[at]||0;return Math.max(0,start+Math.min(.00001,((timestamps[at+1]??duration)-start)/2));}
 function seek(next:number){
  const at=Math.max(0,Math.min(count-1,next));pause();setFrame(at);pendingSeek.current=at;
  if(player.current?.readyState&&timestamps.length){player.current.currentTime=seekTime(at);pendingSeek.current=null;}
 }
 function onLoaded(){
  const video=player.current;if(!video)return;setReady(true);video.playbackRate=rate;
  const at=pendingSeek.current??frame;if(timestamps.length)video.currentTime=seekTime(at);pendingSeek.current=null;
 }
 async function togglePlay(){
  const video=player.current;if(!video||!canEdit||!ready||mediaError)return;
  if(!video.paused)pause();else{if(video.ended)video.currentTime=Math.max(0,timestamps[0]||0);try{await video.play()}catch(e){setError(String(e))}}
 }
 function commit(next:CutSection[]){
  if(next===rows)return;
  setEdit(current=>({past:[...current.past,current.present].slice(-100),present:next,future:[]}));setResult(null);
 }
 function cut(){
  if(!canEdit)return;
  const at=playing&&player.current?frameAtTime(timestamps,player.current.currentTime):frame;
  const next=cutSections(rows,at);
  if(next===rows){setNotice(rows.length>=200?'You can create up to 200 sections.':'There is already a boundary at this frame.');return;}
  commit(next);setSelected(at);setNotice(`Cut placed before frame ${at}.${playing?' Playback continues.':''}`);
 }
 function toggleSection(){if(!canEdit||!chosen)return;pause();commit(rows.map(r=>r.start===chosen.start?{...r,removed:!r.removed}:r));setNotice(chosen.removed?'Section restored.':'Section removed from the new video.');}
 function undo(redo=false){
  if(!canEdit)return;pause();
  setEdit(current=>{
   if(redo){const [next,...rest]=current.future;return next?{past:[...current.past,current.present],present:next,future:rest}:current;}
   const previous=current.past.at(-1);return previous?{past:current.past.slice(0,-1),present:previous,future:[current.present,...current.future]}:current;
  });setResult(null);
 }
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement;
   if(!canEdit||hasOpenOverlay()||e.altKey||target.closest('input,textarea,select,[contenteditable=true],[role=combobox],[role=dialog]'))return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
   if(e.ctrlKey||e.metaKey||e.repeat)return;
   if(e.key.toLowerCase()==='c'){e.preventDefault();cut();}
   else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(chosen&&!chosen.removed)toggleSection();}
   else if(!target.closest('button,a,[role=slider]')){
    if(e.code==='Space'){e.preventDefault();void togglePlay();}
    else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek(frame+(e.key==='ArrowRight'?1:-1));}
   }
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 });
 async function choose(file:File){
  pause();setBusy(true);setError('');setNotice('');setResult(null);setPlaybackJob(null);setEdit(emptyEdit());setFrame(0);setSelected(0);setTiming(null);setScan(null);setName(file.name.replace(/\.[^.]+$/,'')+'-trimmed.mp4');
  try{const data=new FormData();data.append('file',file);setScan(await api<TrimJob>('/video-trims',{method:'POST',body:data}));}catch(e){setError(String(e));}finally{setBusy(false)}
 }
 async function create(previewOnly=false){
  if(!scan||(!previewOnly&&!kept.length))return;pause();setBusy(true);setError('');
  try{const job=await post<TrimJob>(`/video-trims/${scan.id}/render`,{sections:previewOnly?[{start:0,end:count-1}]:kept,name:previewOnly?'playback-preview.mp4':name});(previewOnly?setPlaybackJob:setResult)(job);}catch(e){setError(String(e));}finally{setBusy(false)}
 }
 async function cancel(){if(!activeJob)return;setBusy(true);try{const next=await post<TrimJob>('/jobs/'+activeJob.id+'/cancel');(activeJob.id===result?.id?setResult:activeJob.id===playbackJob?.id?setPlaybackJob:setScan)(next);}catch(e){setError(String(e));}finally{setBusy(false)}}
 function selectSection(row:CutSection){setSelected(row.start);seek(row.start)}
 const failure=error||[scan,result,playbackJob].find(job=>job?.status==='failed')?.error;
 return <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6" aria-label="Prepare a new video">
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="ghost" size="icon-sm" aria-label="Back to videos" disabled={working} onClick={onBack}><ArrowLeft/></Button><div><h1 className="text-lg font-semibold">Trim sections</h1><p className="text-xs text-muted-foreground">Play. Press C to cut. Remove sections you don't need.</p></div></div><Button variant="outline" size="sm" disabled={working} onClick={onBack}>Back to videos</Button></div>
  <div className="mb-4 flex flex-wrap items-center gap-3"><label className="!m-0 relative inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs"><Upload className="size-4"/>{scan?'Choose another video':'Choose source video'}<Input className="absolute inset-0 cursor-pointer opacity-0" aria-label="Source video to trim" type="file" accept="video/*,.mkv" disabled={working} onChange={e=>{const file=e.target.files?.[0];if(file)void choose(file);e.target.value=''}}/></label><span className="truncate text-xs text-muted-foreground">{info?.name||scan?.name||'Your original file stays unchanged.'}</span></div>
  {failure&&<div role="alert" className="mb-3 text-sm text-destructive">{failure}<Button variant="outline" size="sm" className="ml-3" onClick={()=>{setError('');setRetry(n=>n+1)}}>Retry status</Button></div>}
  {working&&<div role="status" className="mb-3 flex items-center gap-3 rounded-xl border border-border p-3 text-sm"><LoaderCircle className="size-4 animate-spin"/><span>{busy?'Preparing…':running(playbackJob)?'Creating playback preview…':activeJob?.phase||'Preparing…'} {!!activeJob?.total&&`${Math.round((activeJob.progress||0)/activeJob.total*100)}%`}</span>{!busy&&<Button variant="ghost" size="sm" className="ml-auto" onClick={()=>void cancel()}>Cancel job</Button>}</div>}
  {info&&scan?.status==='completed'?<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
   <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex justify-between px-4 py-2 text-xs"><span>{complete?'New video preview':'Original video'}</span><span className="tabular-nums">{complete?`${result.frame_count} frames`:`Frame ${frame} / ${count-1}`}</span></div>
    <div className="relative flex min-h-48 flex-1 items-center justify-center bg-black">
     {complete?<video key={result.id} className="absolute h-full w-full object-contain" src={result.preview_url} controls aria-label="Trimmed video preview"/>:<>
      <video key={sourceUrl} ref={player} className="absolute h-full w-full object-contain" src={sourceUrl} preload="auto" playsInline aria-label="Source video player" onLoadedData={onLoaded} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setFrame(count-1)}} onTimeUpdate={()=>{if(player.current&&timestamps.length&&!player.current.seeking)setFrame(frameAtTime(timestamps,player.current.currentTime))}} onError={()=>{setMediaError(true);setReady(false);setPlaying(false)}}/>
      {mediaError&&<div className="relative mx-4 max-w-sm rounded-xl border border-border bg-card p-5 text-center text-sm"><p>This video format needs a playback preview.</p><Button className="mt-3" size="sm" disabled={working} onClick={()=>void create(true)}>Prepare playback preview</Button><p className="mt-2 text-xs text-muted-foreground">Your original video and selected sections stay unchanged.</p></div>}
     </>}
    </div>
    {complete?<div className="flex items-center justify-between gap-3 p-3"><span className="text-xs text-muted-foreground">Remaining sections joined in order.</span><Button variant="outline" size="sm" onClick={()=>{setResult(null);setFrame(0)}}>Continue editing</Button></div>:<>
     <div className="flex flex-wrap items-center gap-1 px-3 py-2" role="group" aria-label="Trim playback controls">
      <Button variant="ghost" size="icon-sm" aria-label="Previous source frame" disabled={!canEdit||!ready} onClick={()=>seek(frame-1)}><ChevronLeft/></Button>
      <Button variant="outline" size="icon-sm" aria-label={playing?'Pause source video':'Play source video'} disabled={!canEdit||!ready||mediaError} onClick={()=>void togglePlay()}>{playing?<Pause/>:<Play/>}</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next source frame" disabled={!canEdit||!ready} onClick={()=>seek(frame+1)}><ChevronRight/></Button>
      <span className="mx-2 text-xs tabular-nums text-muted-foreground">{timeLabel(timestamps[frame]||0)} / {timeLabel(duration)}</span>
      <Input type="number" aria-label="Trim source frame" className="h-7 w-24 text-xs tabular-nums" min={0} max={count-1} value={frame} disabled={!canEdit} onChange={e=>seek(Number(e.target.value))}/>
      <NativeSelect size="sm" aria-label="Trim playback speed" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[.25,.5,1,2].map(v=><option key={v} value={v}>{v}×</option>)}</NativeSelect>
      <div className="ml-auto flex items-center gap-1"><Button variant="outline" size="sm" disabled={!canEdit} onClick={cut}><Scissors className="size-3.5"/>Cut <kbd className="text-[10px] text-muted-foreground">C</kbd></Button><Button variant="ghost" size="icon-sm" aria-label="Undo trim edit" title="Undo · Ctrl+Z" disabled={!canEdit||!edit.past.length} onClick={()=>undo()}><Undo2/></Button><Button variant="ghost" size="icon-sm" aria-label="Redo trim edit" title="Redo · Ctrl+Shift+Z" disabled={!canEdit||!edit.future.length} onClick={()=>undo(true)}><Redo2/></Button></div>
     </div>
     <div className="space-y-3 border-t border-border/60 p-3">
      <div className="flex h-12 gap-0.5" role="group" aria-label="Video sections timeline">{rows.map((r,i)=><button key={r.start} className={'min-w-1 overflow-hidden rounded-md border px-0.5 text-xs transition-colors '+(chosen?.start===r.start?'ring-2 ring-primary ring-offset-1 ring-offset-background ':'')+(r.removed?'border-destructive/40 bg-destructive/10 text-destructive':'border-primary/30 bg-primary/15 text-foreground')} style={{flex:r.end-r.start+1}} aria-label={`Section ${i+1}, frames ${r.start} to ${r.end}, ${r.removed?'removed':'kept'}`} aria-pressed={chosen?.start===r.start} title={`Section ${i+1} · Frames ${r.start}–${r.end} · ${r.removed?'Removed':'Keep'}`} disabled={!canEdit} onClick={()=>selectSection(r)}>{i+1}</button>)}</div>
      <Slider aria-label="Trim playhead" min={0} max={Math.max(1,count-1)} step={1} value={[frame]} disabled={!canEdit||count<2} onValueChange={v=>seek(v[0])}/>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>Space play/pause · C cut · Delete remove · Ctrl+Z undo</span><span>{rows.length} sections · Cut starts a new section at the current frame.</span></div>
     </div>
    </>}
   </section>
   <aside className="flex min-h-0 flex-col gap-3">
    <div><h2 className="text-sm font-medium">Your sections</h2><p className="mt-1 text-xs text-muted-foreground">Select a section to remove or restore it.</p></div>
    <div className="min-h-24 flex-1 space-y-1 overflow-y-auto pr-1">{rows.map((r,i)=><Button key={r.start} variant={chosen?.start===r.start?'secondary':'ghost'} className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-left" disabled={!canEdit} aria-label={`Select section ${i+1}`} aria-pressed={chosen?.start===r.start} onClick={()=>selectSection(r)}><span className={'flex size-6 shrink-0 items-center justify-center rounded-md text-xs '+(r.removed?'bg-destructive/10 text-destructive':'bg-primary/10')}>{r.removed?<Trash2 className="size-3"/>:i+1}</span><span className="min-w-0 flex-1"><span className="block text-xs">Section {i+1} <span className="float-right text-[10px] text-muted-foreground">{r.removed?'Removed':'Keep'}</span></span><span className="block text-[11px] tabular-nums text-muted-foreground">Frames {r.start}–{r.end}</span></span></Button>)}</div>
    {chosen&&!complete&&<Button variant="outline" size="sm" disabled={!canEdit} onClick={toggleSection}>{chosen.removed?<RotateCcw/>:<Trash2/>}{chosen.removed?'Restore selected section':'Remove selected section'}</Button>}
    <p className="text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">{keptCount.toLocaleString()} of {count.toLocaleString()} frames kept</strong><br/>{info.width} × {info.height} · Original resolution{info.has_audio?' · Audio kept':''}</p>
    <label className="!m-0 text-xs">New video filename<Input aria-label="New video filename" className="h-8 text-xs" value={name} maxLength={180} disabled={working} onChange={e=>setName(e.target.value)}/></label>
    {complete?<div className="space-y-2 rounded-xl border border-border p-3"><p className="flex items-center gap-2 text-sm"><Check className="size-4"/>Your new video is ready.</p><Button asChild className="w-full" size="sm"><a href={result.download_url+'?filename='+encodeURIComponent(name)} download={name}><Download/>Save new video (.mp4)</a></Button><p className="text-xs text-muted-foreground">Save this file, then upload it using New video in your project.</p></div>:<><Button size="sm" disabled={!canEdit||!keptCount} onClick={()=>void create()}><Scissors/>Combine &amp; save video</Button>{!keptCount&&<p className="text-xs text-destructive">Restore at least one section to create a video.</p>}</>}
    <p role="status" aria-live="polite" className="min-h-8 text-xs text-muted-foreground">{notice}</p>
   </aside>
  </div>:!working&&<div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-10 text-center"><Scissors className="size-8 text-muted-foreground"/><h2 className="text-base font-medium">Make a shorter video</h2><p className="max-w-md text-sm text-muted-foreground">Choose a video. Play and press C wherever you want a cut. Remove unwanted sections, then combine the rest into a new MP4.</p></div>}
 </main>;
}
