import {useMemo,useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {useStore} from './store';
import {geometryLabel} from './types';
import {previewBetweenFrames,interpolateBetweenFrames} from './interpolate-range';

export function InterpolateRange({initialStart,initialEnd,onClose}:{initialStart:number;initialEnd:number;onClose:()=>void}){
 const s=useStore(),[start,setStart]=useState(String(initialStart)),[end,setEnd]=useState(String(initialEnd));
 const count=s.project!.videos[s.videoId].frame_count,first=start.trim()?Number(start):NaN,last=end.trim()?Number(end):NaN;
 const preview=useMemo(()=>previewBetweenFrames(s.project!.state,s.videoId,s.activeId,s.geometry,first,last,count,s.frameTimes[s.videoId]),[s.project,s.videoId,s.activeId,s.geometry,first,last,count,s.frameTimes]);
 return <form onSubmit={e=>{e.preventDefault();if(!preview.canRestore)return;let restored=0;const ok=s.commit(`Interpolate frames ${first}–${last}`,d=>{restored=interpolateBetweenFrames(d,s.videoId,s.activeId,s.geometry,first,last,count,s.frameTimes[s.videoId]).restoredBoxes;});if(ok){s.toast(`${restored} frames filled. Other deleted frames stay hidden. Ctrl+Z undoes this fill.`);onClose();}}}>
  <p>Fill <strong>{geometryLabel(s.geometry,s.project!.state.identities[s.activeId])}</strong> boxes for <strong>Track {s.project!.state.identities[s.activeId].person_id}</strong> between two frames.</p>
  <div className="form-grid"><label>First frame with a box<Input autoFocus aria-label="First boundary frame" type="number" required min={0} max={count-1} value={start} onChange={e=>setStart(e.target.value)}/></label><label>Last frame with a box<Input aria-label="Last boundary frame" type="number" required min={0} max={count-1} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
  <p className="muted">Draw a box on both frames for this same track and class. Deleted frames between them can be filled. Existing boxes and all frames outside this range are kept.</p>
  <div className="restore-preview" aria-live="polite">{preview.error?<p className="error">{preview.error}</p>:<><strong>{preview.restoredBoxes} frames to fill</strong><p>{preview.keptBoxes} existing boxes kept. Uses frames {preview.anchorFrames.join(', ')}.</p></>}{preview.warnings.map(w=><p className="muted" key={w}>{w}</p>)}</div>
  <div className="button-row"><Button variant="outline" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!preview.canRestore}>Interpolate frames</Button></div>
 </form>;
}
