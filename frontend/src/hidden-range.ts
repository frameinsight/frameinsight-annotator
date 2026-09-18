import {type Domain,type Segment,uuid} from './types';
import {isInterpolated,markCorrected} from './interpolation';

// Called inside one store commit: deletion, segment repair and the gap share Undo.
export function markHiddenRange(d:Domain,videoId:string,identityId:string,start:number,end:number,frameCount:number){
 if(!d.identities[identityId])throw new Error('Select a person first.');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=frameCount)throw new Error(`Enter a valid range from 0 to ${frameCount-1}; the last frame must be at or after the first.`);
 const belongs=(row:{video_id:string;identity_uuid:string})=>row.video_id===videoId&&row.identity_uuid===identityId;
 let removed=0;
 for(const o of Object.values(d.observations))if(belongs(o)&&o.frame_index>=start&&o.frame_index<=end){if(o.person_visible||o.person_ext)removed++;delete d.observations[o.id];}

 // Keep the original reason/evidence on portions of older gaps outside the range.
 for(const gap of Object.values(d.intervals)){
  if(!belongs(gap)||gap.start>end||(gap.end!==null&&gap.end<start))continue;
  const original={...gap};delete d.intervals[gap.id];
  if(original.start<start)d.intervals[original.id]={...original,end:start-1};
  if(end+1<frameCount&&(original.end===null||original.end>end)){const id=original.start<start?uuid():original.id;d.intervals[id]={...original,id,start:end+1};}
 }

 const boundaries:Segment[]=[];
 for(const segment of Object.values(d.segments)){
  if(!belongs(segment)||segment.start>end||(segment.end!==null&&segment.end<start))continue;
  const original={...segment},left=original.start<start,right=end+1<frameCount&&(original.end===null||original.end>end);
  delete d.segments[segment.id];
  if(left){const part={...original,end:start-1};d.segments[part.id]=part;boundaries.push(part);}
  if(right){
   const id=left?uuid():original.id,part={...original,id,start:end+1};d.segments[id]=part;boundaries.push(part);
   for(const o of Object.values(d.observations))if(o.segment_id===original.id&&o.frame_index>end&&o.segment_id!==id){o.segment_id=id;o.review_state='draft';}
  }
 }
 // Retained edge boxes become draft keyframes, so edits can still interpolate
 // within either surviving side without drawing across the hidden interval.
 for(const segment of boundaries){
  const rows=Object.values(d.observations).filter(o=>o.segment_id===segment.id).sort((a,b)=>a.frame_index-b.frame_index);
  const edge=segment.end===start-1?rows.at(-1):rows[0];
  if(edge&&isInterpolated(edge)){markCorrected(edge);edge.review_state='draft';edge.evidence_note+='\nRetained as a keyframe at a user-marked hidden-range boundary; verify against the image.';}
 }
 const id=uuid();d.intervals[id]={id,video_id:videoId,identity_uuid:identityId,start,end,reason:'occlusion',evidence_note:'Person marked hidden in this inclusive frame range; boxes removed by the annotator.'};
 for(const review of Object.values(d.reviews))if(review.video_id===videoId&&review.frame_index>=start&&review.frame_index<=end){review.complete=false;review.checked_all_people=false;}
 return removed;
}
