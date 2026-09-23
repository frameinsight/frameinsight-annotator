import {emptyObservation,uuid,type Box,type Domain,type Geometry,type Observation,type Operation,type Segment} from './types';

export type RestoreMode='interpolate'|'original';
export type RestorePreview={mode:RestoreMode;start:number;end:number;geometry:Geometry;canRestore:boolean;restoredBoxes:number;keptBoxes:number;remainingBlockedFrames:number;anchorFrames:number[];warnings:string[];error?:string};
type RestoreBox={frame:number;box:Box;provenance:Observation['provenance'][Geometry];source?:Observation;segmentStatus?:Segment['status'];segmentId?:string};
type Plan={preview:RestorePreview;boxes:RestoreBox[];join:Segment[][]};
const covers=(g:{start:number;end:number|null},f:number)=>g.start<=f&&(g.end===null||g.end>=f);
const belongs=(v:string,id:string)=>(o:{video_id:string;identity_uuid:string})=>o.video_id===v&&o.identity_uuid===id;
const applies=(v:string,id:string,g:Geometry)=>(row:any)=>!!row&&belongs(v,id)(row)&&(!row.geometry||row.geometry===g);
const generated=(o:Observation,g:Geometry)=>['interpolated','copied_track','model_track'].includes(o.provenance[g]?.origin||'')&&!o.provenance[g]?.human_corrected;

// Only a deletion still represented by the available edit history can supply its
// previous coordinates. A later deletion of an already-empty range supersedes
// earlier candidates; trimming/splitting the same gap does not.
type OriginalBox={observation:Observation;segmentStatus:Segment['status']};
function originals(history:Operation[],videoId:string,identityId:string,start:number,end:number,geometry:Geometry,currentSegments:Domain['segments']){
 const status=new Map(Object.values(currentSegments).map(s=>[s.id,s.status]));
 const candidates=new Map<number,OriginalBox>(),match=applies(videoId,identityId,geometry);
 const effects=new Map<string,Map<number,{before?:OriginalBox;after?:OriginalBox}>>();
 for(const operation of history){
  for(const c of operation.changes)if(c.collection==='segments'&&c.before)status.set(c.id,c.before.status);
  const updateSegments=()=>{for(const c of operation.changes)if(c.collection==='segments'){if(c.after)status.set(c.id,c.after.status);else status.delete(c.id);}};
  const changed=new Map<number,{before?:OriginalBox;after?:OriginalBox}>(),compensated=operation.compensates?effects.get(operation.compensates):undefined;
  const change=(frame:number,next?:OriginalBox)=>{
   if(candidates.get(frame)===next)return;
   if(!changed.has(frame))changed.set(frame,{before:candidates.get(frame)});
   if(next)candidates.set(frame,next);else candidates.delete(frame);changed.get(frame)!.after=next;
  };
  if(compensated){
   // Undoing a recovery restores the earlier deletion's source coordinates; it
   // must not turn the just-generated interpolation into the original boxes.
   for(const [frame,previous] of compensated)if(previous.before!==previous.after&&candidates.get(frame)===previous.after)change(frame,previous.before);
   effects.set(operation.id,changed);updateSegments();continue;
  }
  const deleted=new Map<number,Observation>();
  const oldGaps=operation.changes.filter(c=>c.collection==='intervals'&&match(c.before)).map(c=>c.before);
  for(const c of operation.changes)if(c.collection==='observations'){
   const old=c.before as Observation|null,next=c.after as Observation|null,row=old||next;
   if(!row||!belongs(videoId,identityId)(row)||row.frame_index<start||row.frame_index>end)continue;
   if(old?.[geometry]&&!next?.[geometry])deleted.set(row.frame_index,old);
   else if(next?.[geometry]&&JSON.stringify(old?.[geometry]??null)!==JSON.stringify(next[geometry]))change(row.frame_index);
  }
  for(const c of operation.changes)if(c.collection==='intervals'&&match(c.after)){
   const gap=c.after;
   for(let frame=Math.max(start,gap.start);frame<=Math.min(end,gap.end??end);frame++)if(!oldGaps.some(g=>covers(g,frame)))change(frame);
  }
  for(const [frame,row] of deleted)change(frame,{observation:row,segmentStatus:status.get(row.segment_id)||'unresolved'});
  effects.set(operation.id,changed);updateSegments();
 }
 return candidates;
}

function planRestore(d:Domain,videoId:string,identityId:string,start:number,end:number,frameCount:number,geometry:Geometry,mode:RestoreMode,history:Operation[],times:(number|null)[]):Plan{
 const preview:RestorePreview={mode,start,end,geometry,canRestore:false,restoredBoxes:0,keptBoxes:0,remainingBlockedFrames:0,anchorFrames:[],warnings:[]};
 const plan:Plan={preview,boxes:[],join:[]},fail=(message:string)=>{preview.error=message;return plan;};
 if(!d.identities[identityId])return fail('Select a person first.');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=frameCount)return fail(`Enter an inclusive frame range from 0 to ${frameCount-1}.`);
 if(mode!=='original'&&mode!=='interpolate')return fail('Choose original boxes or interpolation.');
 const rows=Object.values(d.observations).filter(belongs(videoId,identityId)).sort((a,b)=>a.frame_index-b.frame_index),byFrame=new Map(rows.map(o=>[o.frame_index,o]));
 const gaps=Object.values(d.intervals).filter(applies(videoId,identityId,geometry));
 const blocked=new Set<number>(),missing:number[]=[];
 for(let f=start;f<=end;f++){if(byFrame.get(f)?.[geometry])preview.keptBoxes++;else{missing.push(f);if(gaps.some(g=>covers(g,f)))blocked.add(f);}}
 preview.remainingBlockedFrames=blocked.size;
 if(!missing.length)return fail('Every selected frame already has this box type. Existing boxes will not be replaced.');
 if(mode==='original'){
  const prior=originals(history,videoId,identityId,start,end,geometry,d.segments);
  for(const frame of missing){const old=prior.get(frame),source=old?.observation;if(blocked.has(frame)&&source?.[geometry])plan.boxes.push({frame,box:[...source[geometry]!],provenance:source.provenance[geometry]?structuredClone(source.provenance[geometry]):undefined,source,segmentStatus:old!.segmentStatus});}
  if(plan.boxes.some(b=>b.segmentStatus==='unresolved'))preview.warnings.push('Some original boxes had an unresolved identity segment. Recovery keeps that status; verify the person before finishing.');
  preview.remainingBlockedFrames-=plan.boxes.length;
  if(!plan.boxes.length)return fail('Original deleted boxes are not available in the available edit history. Draw two boundary boxes and choose Fill between boxes instead.');
  if(preview.remainingBlockedFrames)preview.warnings.push(`${preview.remainingBlockedFrames} deleted frames have no recoverable original box and will stay empty. Use boundary boxes and interpolation to fill those separately.`);
 }else{
  const anchors=rows.filter(o=>o[geometry]&&(o.review_state==='approved'||!generated(o,geometry)));
  const used=new Set<number>(),timing=new Map<string,boolean>();let anchorIndex=0;
  for(const frame of missing){
   while(anchorIndex<anchors.length&&anchors[anchorIndex].frame_index<frame)anchorIndex++;
   const left=anchors[anchorIndex-1],right=anchors[anchorIndex];
   if(!left||!right)return fail(`Frame ${frame} needs a drawn or corrected ${geometry==='person_visible'?'Visible':'Extended'} box on both sides. Add boundary boxes, then try again.`);
   const first=left.frame_index,last=right.frame_index;
   // The command may override only the chosen range, never an outside absence.
   const outside=gaps.find(g=>g.start<=last&&(g.end===null||g.end>=first)&&((g.start<start&&Math.min(g.end??Infinity,start-1)>=first)||(g.end===null||g.end>end)&&Math.max(g.start,end+1)<=last));
   if(outside)return fail(`A deleted interval outside ${start}–${end} blocks these anchors. Draw boundary boxes closer to this section or include the whole deleted interval.`);
   const segments=[...new Set([left.segment_id,right.segment_id])].map(id=>d.segments[id]);
   if(segments.some(s=>!s||s.status!=='verified'||!belongs(videoId,identityId)(s)))return fail('The boundary boxes need the same verified person. Resolve uncertain identity segments before filling this gap.');
   const insideSegments=Object.values(d.segments).filter(s=>belongs(videoId,identityId)(s)&&s.start<=last&&(s.end===null||s.end>=first));
   if(insideSegments.some(s=>s.status!=='verified'))return fail('An unresolved identity segment crosses this gap. Resolve its identity before interpolation.');
   if(segments.length>1&&!plan.join.some(s=>s.some(v=>v.id===segments[0].id)&&s.some(v=>v.id===segments[1].id)))plan.join.push(insideSegments);
   const t0=times[first],t1=times[last],key=first+':'+last;
   if(!timing.has(key))timing.set(key,t0!=null&&t1!=null&&t1>t0&&Array.from({length:last-first+1},(_,n)=>times[first+n]).every((t,n)=>t!=null&&Number.isFinite(t)&&t>=t0&&t<=t1&&(n===0||t>times[first+n-1]!)));
   const timeValid=timing.get(key)!;
   const t=timeValid?(times[frame]!-t0!)/(t1!-t0!):(frame-first)/(last-first);
   plan.boxes.push({frame,box:left[geometry]!.map((x,i)=>x+(right[geometry]![i]-x)*t) as Box,provenance:{origin:'interpolated',proposal_id:null,human_corrected:false},segmentId:left.segment_id});used.add(first);used.add(last);
  }
  preview.anchorFrames=[...used].sort((a,b)=>a-b);preview.remainingBlockedFrames=0;
  if(plan.join.length)preview.warnings.push('Verified segments of this person will be reconnected across the restored section. Existing box coordinates stay unchanged.');
 }
 preview.restoredBoxes=plan.boxes.length;preview.canRestore=plan.boxes.length>0;return plan;
}

export function previewRestoreRange(d:Domain,videoId:string,identityId:string,start:number,end:number,frameCount:number,geometry:Geometry,mode:RestoreMode,history:Operation[]=[],times:(number|null)[]=[]){return planRestore(d,videoId,identityId,start,end,frameCount,geometry,mode,history,times).preview;}

function clearFrames(d:Domain,videoId:string,identityId:string,geometry:Geometry,frames:Set<number>){
 for(const gap of Object.values(d.intervals)){
  if(!applies(videoId,identityId,geometry)(gap))continue;
  const affected=[...frames].filter(f=>covers(gap,f)).sort((a,b)=>a-b);if(!affected.length)continue;
  const original={...gap};delete d.intervals[gap.id];
  // A legacy unscoped interval still applies to the other box type in full.
  if(!original.geometry)d.intervals[original.id]={...original,geometry:geometry==='person_visible'?'person_ext':'person_visible'};
  let cursor=original.start,reuse=!!original.geometry;
  const retain=(start:number,end:number|null)=>{const id=reuse?original.id:uuid();reuse=false;d.intervals[id]={...original,id,start,end,geometry};};
  for(const frame of affected){if(cursor<frame)retain(cursor,frame-1);cursor=frame+1;}
  if(original.end===null||cursor<=original.end)retain(cursor,original.end);
 }
}

function mergeSegments(d:Domain,segments:Segment[]){
 const live=segments.map(s=>d.segments[s.id]).filter(Boolean);if(live.length<2)return;
 const first=live.sort((a,b)=>a.start-b.start)[0],ids=new Set(live.map(s=>s.id));
 first.start=Math.min(...live.map(s=>s.start));first.end=live.some(s=>s.end===null)?null:Math.max(...live.map(s=>s.end!));
 for(const o of Object.values(d.observations))if(ids.has(o.segment_id))o.segment_id=first.id;
 for(const id of ids)if(id!==first.id)delete d.segments[id];
}

/** Apply only a reviewed recovery plan; the caller records one atomic operation. */
export function restoreRange(d:Domain,videoId:string,identityId:string,start:number,end:number,frameCount:number,geometry:Geometry,mode:RestoreMode,history:Operation[]=[],times:(number|null)[]=[]):RestorePreview{
 const plan=planRestore(d,videoId,identityId,start,end,frameCount,geometry,mode,history,times);
 if(!plan.preview.canRestore)throw new Error(plan.preview.error||'No boxes can be restored.');
 const frames=new Set(plan.boxes.map(b=>b.frame));clearFrames(d,videoId,identityId,geometry,frames);
 for(const segments of plan.join)mergeSegments(d,segments);
 const rows=new Map(Object.values(d.observations).filter(belongs(videoId,identityId)).map(o=>[o.frame_index,o]));
 for(const item of plan.boxes){
  let o=rows.get(item.frame);
  if(!o){
   let segment=Object.values(d.segments).find(s=>belongs(videoId,identityId)(s)&&covers(s,item.frame));
   if(!segment){
    const previous=Object.values(d.segments).find(s=>belongs(videoId,identityId)(s)&&s.end===item.frame-1&&s.status===(item.segmentStatus||'verified'));
    if(previous){previous.end=item.frame;segment=previous;}
    else{const id=uuid();segment={id,video_id:videoId,identity_uuid:identityId,start:item.frame,end:item.frame,status:item.segmentStatus||'verified'};d.segments[id]=segment;}
   }
   o=emptyObservation(videoId,item.frame,identityId,segment.id);
   if(item.source&&!d.observations[item.source.id])o.id=item.source.id;
   o.evidence_note=mode==='original'?item.source!.evidence_note:`Restored interpolation between current boundary boxes. Review against the image.`;
   d.observations[o.id]=o;rows.set(item.frame,o);
  }
  o[geometry]=[...item.box];o.geometry_link='independent';o.review_state='draft';
  if(item.provenance)o.provenance[geometry]=structuredClone(item.provenance);else delete o.provenance[geometry];
  if(geometry==='person_ext')o.full_quality=item.source?.full_quality||'estimated';
 }
 // Older deletions split shared identity segments. Join only touching verified
 // spans at this recovery, with every remaining selected-type barrier respected.
 const segments=Object.values(d.segments).filter(s=>belongs(videoId,identityId)(s)&&s.status==='verified').sort((a,b)=>a.start-b.start);
 let previous=segments[0];
 for(const next of segments.slice(1)){
  if(previous&&(previous.end??Infinity)+1>=next.start&&previous.start<=end&&(next.end??Infinity)>=start){
   const a=Math.min(previous.end??next.start,next.start),b=Math.max(previous.end??next.start,next.start);
   if(!Object.values(d.intervals).some(g=>applies(videoId,identityId,geometry)(g)&&g.start<=b&&(g.end===null||g.end>=a))){mergeSegments(d,[previous,next]);previous=d.segments[previous.id]||d.segments[next.id];continue;}
  }
  previous=next;
 }
 for(const r of Object.values(d.reviews))if(r.video_id===videoId&&frames.has(r.frame_index)){r.complete=false;r.checked_all_people=false;}
 return plan.preview;
}
