import {type Box,type Domain,type Observation,geometries,emptyObservation} from './types';

export function isInterpolated(o:Observation){
 const present=geometries.filter(g=>o[g]);
 return present.length>0&&present.every(g=>o.provenance[g]?.origin==='interpolated'&&!o.provenance[g]?.human_corrected);
}
export function replaceableDraft(o:Observation){return o.review_state!=='approved'&&isInterpolated(o);}
export function markCorrected(o:Observation){
 for(const g of geometries)if(o.provenance[g]?.origin==='interpolated')o.provenance[g]={...o.provenance[g]!,human_corrected:true};
}
const lerp=(a:Box|null,b:Box|null,t:number):Box|null=>a&&b?a.map((x,i)=>x+(b[i]-x)*t) as Box:null;

// Only materialized, uncorrected interpolation drafts may be regenerated.
// Approved observations, manual edits and explicit missing geometry are anchors.
export function interpolatePerson(d:Domain,videoId:string,identity:string,times:(number|null)[]=[],changedFrame?:number,visibleOnly=true){
 const observations=Object.values(d.observations).filter(o=>o.video_id===videoId&&o.identity_uuid===identity).sort((a,b)=>a.frame_index-b.frame_index);
 const anchors=observations.filter(o=>!replaceableDraft(o));
 const existing=new Map(observations.map(o=>[o.frame_index,o]));
 let count=0;
 for(let i=1;i<anchors.length;i++){
  const left=anchors[i-1],right=anchors[i],start=left.frame_index,end=right.frame_index;
  if(changedFrame!==undefined&&changedFrame!==start&&changedFrame!==end)continue;
  if(end-start<2||left.segment_id!==right.segment_id)continue;
  const segment=d.segments[left.segment_id];
  if(!segment||segment.status!=='verified')continue;
  if(Object.values(d.intervals).some(g=>g.video_id===videoId&&g.identity_uuid===identity&&g.start<=end&&(g.end===null||g.end>=start)))continue;
  // A manual deletion/missing B is a barrier, not an invitation to recreate it.
  if(!left.person_visible||!right.person_visible)continue;
  const first=times[start],last=times[end];
  const useTime=first!=null&&last!=null&&last>first&&Array.from({length:end-start+1},(_,n)=>times[start+n]).every((t,n)=>t!=null&&Number.isFinite(t)&&t>=first&&t<=last&&(n===0||t>times[start+n-1]!));
  for(let f=start+1;f<end;f++){
   const old=existing.get(f);if(old&&!replaceableDraft(old))continue;
   const t=useTime?(times[f]!-first!)/(last!-first!):(f-start)/(end-start);
   const o=old||emptyObservation(videoId,f,identity,left.segment_id);
   o.person_visible=lerp(left.person_visible,right.person_visible,t);
   if(!visibleOnly)o.person_ext=lerp(left.person_ext,right.person_ext,t);
   o.full_quality=o.person_ext?'estimated':'unknown';o.geometry_link='independent';
   o.occluded=left.occluded===right.occluded?left.occluded:null;
   o.truncated=left.truncated===right.truncated?left.truncated:null;
   o.evidence_note=`Interpolated between source frames ${start} and ${end} using ${useTime?'source timestamps':'source frame indices'}. Review position and size against the image.${o.person_ext?'':' Full extent is not annotated.'}`;
   o.review_state='draft';
   o.provenance.person_visible={origin:'interpolated',proposal_id:null,human_corrected:false};
   if(!visibleOnly&&o.person_ext)o.provenance.person_ext={origin:'interpolated',proposal_id:null,human_corrected:false};
   d.observations[o.id]=o;count++;
  }
 }
 return count;
}
