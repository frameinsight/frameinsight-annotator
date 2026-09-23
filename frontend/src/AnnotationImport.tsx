import {useState} from 'react';
import {api} from './api';
import {useStore} from './store';
import {type Change} from './types';
import {Button} from './components/ui/button';

type Preview={base_revision:number;changes:Change[];warnings:string[];mapping:{source:string|number;track_id:number}[];summary:{boxes:number;tracks:number;frames:number;first_frame:number;last_frame:number}};
export function AnnotationImport({onClose,onBusy}:{onClose:()=>void;onBusy:(busy:boolean)=>void}){
 const s=useStore(),[format,setFormat]=useState('yolo'),[file,setFile]=useState<File|null>(null),[frameBase,setFrameBase]=useState(0),[coordinateBase,setCoordinateBase]=useState(0),[names,setNames]=useState(''),[clip,setClip]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[applied,setApplied]=useState(false);
 function reset(){setPreview(null);setError('')}
 async function inspect(){if(!file||!s.project)return;setBusy(true);onBusy(true);setError('');try{await s.saveNow();const data=new FormData();data.append('file',file);data.append('format',format);data.append('frame_base',String(frameBase));data.append('coordinate_base',String(coordinateBase));data.append('clip_boxes',String(clip));if(names.trim())data.append('class_names',JSON.stringify(names.split('\n').map(n=>n.trim()).filter(Boolean)));setPreview(await api(`/projects/${s.project.id}/imports/annotations/preview?video_id=${s.videoId}`,{method:'POST',body:data}));}catch(e){setError(String(e))}finally{setBusy(false);onBusy(false)}}
 async function apply(){
  if(!preview)return;setBusy(true);onBusy(true);setError('');let committed=applied;
  try{
   await s.saveNow();
   if(!committed){
    if(useStore.getState().project?.revision!==preview.base_revision)throw new Error('The project changed. Preview the file again.');
    const ok=s.commit('Import '+format+' annotations',d=>{for(const c of preview.changes)(d[c.collection] as Record<string,unknown>)[c.id]=structuredClone(c.after)});
    if(!ok)throw new Error(useStore.getState().notice||'Import could not be applied');
    committed=true;setApplied(true);
   }
   await useStore.getState().saveNow();
   const first=preview.changes.find(c=>c.collection==='observations')?.after;
   if(first){s.navigate(first.frame_index);useStore.getState().selectPerson(first.identity_uuid)}
   s.toast('Annotations imported. Check the boxes visually. Ctrl+Z undoes this import.');onClose();
  }catch(e){if(!committed)setPreview(null);setError((committed?'Import added locally. Retry saving; it will not be added twice. ':'')+String(e))}finally{setBusy(false);onBusy(false)}
 }

 return <div className="annotation-import"><p>Import labels for <strong>{s.project?.videos[s.videoId]?.name}</strong>. Existing tracks are kept. Review the result before training.</p><fieldset disabled={busy||applied} onChange={reset}><label>Format<select aria-label="Annotation format" value={format} onChange={e=>{setFormat(e.target.value);setFrameBase(e.target.value==='mot'?1:0)}}><option value="yolo">YOLO detection — 5 columns, no track IDs</option><option value="yolo_tracks">YOLO with track IDs — 6 columns</option><option value="mot">MOT 1.1 ground truth</option></select></label><label>Annotation file<input aria-label="Annotation file" type="file" accept=".zip,.txt" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><label>First source frame number<select aria-label="First source frame number" value={frameBase} onChange={e=>setFrameBase(Number(e.target.value))}><option value={0}>0 → app frame 0</option><option value={1}>1 → app frame 0</option></select></label>{format==='mot'&&<label>Box coordinates<select aria-label="Box coordinate base" value={coordinateBase} onChange={e=>setCoordinateBase(Number(e.target.value))}><option value={0}>Start at 0 (CVAT exports)</option><option value={1}>Start at 1 (MOTChallenge)</option></select></label>}<details><summary>Class names and image boundaries</summary><label>Override class names — one per line<textarea aria-label="Import class names" rows={4} placeholder="Leave empty to use the archive’s class list" value={names} onChange={e=>setNames(e.target.value)}/></label><p className="form-help">List names in source ID order: YOLO starts at 0; MOT starts at 1. Without an archive class list, YOLO uses project classes and MOT uses standard MOT labels.</p><label><input type="checkbox" checked={clip} onChange={e=>setClip(e.target.checked)}/>Clip boxes that extend beyond the image</label></details></fieldset>{error&&<p role="alert" className="error">{error}</p>}{preview&&<section className="import-preview" aria-label="Import preview"><h3>{preview.summary.boxes} boxes · {preview.summary.tracks} tracks</h3><p>{preview.summary.frames} labeled frames, from app frame {preview.summary.first_frame} to {preview.summary.last_frame}. Frames without labels stay Hidden.</p>{preview.warnings.map(w=><p className="import-warning" key={w}>{w}</p>)}<details><summary>Track ID mapping</summary><div className="import-mapping">{preview.mapping.slice(0,200).map(m=><div key={m.source}>Source {m.source} → Track {m.track_id}</div>)}</div>{preview.mapping.length>200&&<p>Showing the first 200 mappings.</p>}</details><p>Adding labels does not confirm that their identities or locations are correct. Inspect playback before finishing.</p></section>}<div className="button-row">{!applied&&<Button disabled={busy||!file} onClick={()=>void inspect()}>{busy?'Working…':preview?'Preview again':'Preview import'}</Button>}{preview&&<Button className="primary" disabled={busy} onClick={()=>void apply()}>{applied?'Retry saving import':'Add annotations'}</Button>}</div></div>
}
