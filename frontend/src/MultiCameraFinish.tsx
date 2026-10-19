import {useEffect, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, Check, CheckCircle2, Download, FileJson2, LoaderCircle, ShieldCheck} from 'lucide-react';
import {post} from './api';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from './components/ui/card';
import {Checkbox} from './components/ui/checkbox';
import {Input} from './components/ui/input';
import type {CameraSession} from './multicam';
import './review-finish.css';

type Finding = {code:string;message:string;video_id?:string;frame_index?:number;first_frame?:number;last_frame?:number;identity_uuid?:string;person_uuid?:string};
type Report = {validation_id:string;passed:boolean;revision:number;project_revision:number;errors:Finding[];warnings:Finding[];checks:{name:string;passed:boolean}[];summary:Record<string,number>;limitation:string};
type DownloadResult = {export_id:string;filename:string;download_url:string};
export type MultiCameraFinishProps = {session:CameraSession;projectRevision:number;onBack:()=>void};
const errorMessage = (error:unknown) => error instanceof Error ? error.message : String(error);

/** Review happens in the live camera grid; this page checks its saved data. */
export function MultiCameraFinish({session, projectRevision, onBack}:MultiCameraFinishProps){
 const [confirmed,setConfirmed]=useState(false);
 const [report,setReport]=useState<Report|null>(null);
 const [filename,setFilename]=useState(()=>session.name+'.json');
 const [prepared,setPrepared]=useState<DownloadResult|null>(null);
 const [busy,setBusy]=useState<'validation'|'export'|null>(null);
 const [error,setError]=useState('');
 const [changed,setChanged]=useState(false);
 const snapshot=`${session.id}:${session.revision}:${projectRevision}`;
 const currentSnapshot=useRef(snapshot);currentSnapshot.current=snapshot;
 const previousSnapshot=useRef(snapshot);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(previousSnapshot.current===snapshot)return;
  previousSnapshot.current=snapshot;setConfirmed(false);setReport(null);setPrepared(null);setError('');setChanged(true);
 },[snapshot]);
 const passed=confirmed&&!!report?.passed&&report.revision===session.revision&&report.project_revision===projectRevision;
 const cameraNames=new Map(session.cameras.map(camera=>[camera.video_id,camera.name]));
 const defaultName=session.name+'.json';
 const name=filename.trim()||defaultName;
 const request={revision:session.revision,project_revision:projectRevision};
 async function validate(){
  if(!confirmed||busy)return;
  const expected=snapshot;setBusy('validation');setError('');setReport(null);setPrepared(null);
  try{
   const result=await post<Report>(`/camera-sessions/${session.id}/validate`,{...request,visual_confirmed:true});
   if(!alive.current)return;
   if(currentSnapshot.current!==expected)throw new Error('The camera session changed. Review your changes and validate again.');
   setReport(result);setChanged(false);
  }catch(e){if(alive.current)setError(errorMessage(e));}
  finally{if(alive.current)setBusy(null);}
 }
 async function prepare(){
  if(!passed||!report||busy)return;
  const expected=snapshot;setBusy('export');setError('');setPrepared(null);
  try{
   const result=await post<DownloadResult>(`/camera-sessions/${session.id}/export`,{...request,validation_id:report.validation_id,filename:name});
   if(!alive.current)return;
   if(currentSnapshot.current!==expected)throw new Error('The camera session changed. Validate again before downloading.');
   setPrepared(result);
  }catch(e){if(alive.current)setError(errorMessage(e));}
  finally{if(alive.current)setBusy(null);}
 }
 function findingLocation(item:Finding){
  const camera=item.video_id?cameraNames.get(item.video_id):undefined;
  const frame=item.frame_index??item.first_frame;
  return [camera,frame!=null?`Frame ${frame}${item.last_frame!=null&&item.last_frame!==frame?`–${item.last_frame}`:''}`:undefined].filter(Boolean).join(' · ');
 }
 return <main className="finish-page" aria-labelledby="multicam-finish-title"><div className="finish-shell">
  <header className="finish-heading"><div className="finish-heading-copy">
   <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft/>Back to camera grid</Button>
   <h1 id="multicam-finish-title">Validate & export camera session</h1>
   <p>{session.name} · {session.cameras.length} cameras</p>
  </div><Badge variant={passed?'default':'secondary'}>{passed?<CheckCircle2/>:<ShieldCheck/>}{passed?'Ready to export':'Final data check'}</Badge></header>
  {error&&<div className="finish-notice finish-notice-error" role="alert"><AlertTriangle/><p>{error}</p></div>}
  {changed&&!passed&&<div className="finish-notice" role="status"><ShieldCheck/><p>The camera session or its annotations changed. Review the changes, then validate again.</p></div>}
  <div className="finish-grid">
   <section className="finish-main" aria-label="Camera session validation"><Card><CardHeader>
    <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5"/>Check this session</CardTitle>
    <CardDescription>Use the camera grid to review playback, box placement, synchronization and shared person IDs before confirming.</CardDescription>
   </CardHeader><CardContent className="flex flex-col gap-5">
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
     <Checkbox checked={confirmed} disabled={!!busy} onCheckedChange={value=>{setConfirmed(value===true);setReport(null);setPrepared(null);}} aria-label="I reviewed the cameras and shared person IDs"/>
     <span>I reviewed the cameras and shared person IDs. The annotations and camera timing are ready for a data check.</span>
    </label>
    <div className="finish-review-note"><ShieldCheck/><p>Validation checks JSON structure, track and person references, frame timestamps and export consistency. It cannot decide whether two tracks show the same real person.</p></div>
    {!report&&<ul className="finish-check-preview">{['Valid local track IDs and shared person IDs','Source frames and synchronized timestamps','Consistent annotations across the exported camera session'].map(label=><li key={label}><ShieldCheck/><span>{label}</span></li>)}</ul>}
    <Button className="self-start" disabled={!confirmed||!!busy||session.cameras.length<2} onClick={()=>void validate()}>{busy==='validation'?<LoaderCircle className="spin"/>:<ShieldCheck/>}{busy==='validation'?'Checking session…':'Validate camera session'}</Button>
   </CardContent>{report&&<CardFooter className="block border-t" data-testid="multicam-validation-report">
    <div className={'validation-heading '+(passed?'passed':'failed')} role="status">{passed?<CheckCircle2/>:<AlertTriangle/>}<div><h2>{passed?'Validation passed. You can export.':'Fix these issues before exporting'}</h2><p>{passed?'The saved camera session passed its structural checks.':'Return to the camera grid, correct the data and validate again.'}</p></div></div>
    <ul className="validation-checks">{report.checks.map((check,index)=><li key={index} className={check.passed?'passed':'failed'}>{check.passed?<Check/>:<AlertTriangle/>}<span>{check.name}</span></li>)}</ul>
    {report.errors.length>0&&<div className="validation-findings"><h3>Issues to fix</h3>{report.errors.map((item,index)=><div key={index}><span>{findingLocation(item)&&<strong className="block">{findingLocation(item)}</strong>}{item.message}</span></div>)}</div>}
    {report.warnings.length>0&&<div className="validation-findings warnings"><h3>Review notes ({report.warnings.length})</h3><p className="text-xs text-muted-foreground">These notes do not block export. Unassigned tracks keep their local IDs.</p>{report.warnings.map((item,index)=><div key={index}><span>{findingLocation(item)&&<strong className="block">{findingLocation(item)}</strong>}{item.message}</span></div>)}</div>}
   </CardFooter>}</Card></section>
   <aside className="finish-sidebar" aria-label="Camera session export"><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileJson2 className="size-5"/>Camera session JSON</CardTitle><CardDescription>One compact file for all cameras, their annotations and shared identities.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
    <dl className="finish-counts"><div><dt>Cameras</dt><dd>{session.cameras.length}</dd></div><div><dt>Shared people</dt><dd>{session.people.length}</dd></div><div><dt>Linked tracks</dt><dd>{session.assignments.length}</dd></div></dl>
    <ul className="finish-export-content"><li>Final boxes, classes and original frame numbers</li><li>Local track IDs and shared person IDs</li><li>Camera names, timing offsets and video references</li></ul>
    <p className="finish-export-hint">Videos, images and edit history are excluded. Your local annotations remain saved.</p>
    <label className="flex flex-col gap-2 text-sm">JSON filename<Input aria-label="Camera session JSON filename" value={filename} placeholder={defaultName} maxLength={180} disabled={!!busy} onChange={e=>{setFilename(e.target.value);setPrepared(null);}}/><small className="text-muted-foreground">The .json extension is added automatically.</small></label>
    <Button disabled={!passed||!!busy} onClick={()=>void prepare()}>{busy==='export'?<LoaderCircle className="spin"/>:<FileJson2/>}{busy==='export'?'Preparing session JSON…':'Prepare camera session JSON'}</Button>
    {passed&&prepared&&<div className="finish-download" role="status"><p><CheckCircle2/>Your camera session file is ready.</p><Button variant="outline" asChild><a href={prepared.download_url} download={prepared.filename}><Download/>Download session JSON</a></Button></div>}
    {!passed&&<p className="finish-export-hint">Confirm your visual review and pass validation to enable export.</p>}
   </CardContent></Card><Card size="sm"><CardHeader><CardTitle>Reopen this work later</CardTitle><CardDescription>Import the camera session JSON from the project. Select the original recording for each camera; video fingerprints are checked before any annotations are added.</CardDescription></CardHeader></Card></aside>
  </div>
 </div></main>;
}
