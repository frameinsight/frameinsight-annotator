import {type Box,type Domain,type Observation,type Geometry,geometries,emptyObservation} from './types';

export function isGeometryInterpolated(o:Observation,g:Geometry){return !!o[g]&&o.provenance[g]?.origin==='interpolated'&&!o.provenance[g]?.human_corrected;}
export function isInterpolated(o:Observation){
 const present=geometries.filter(g=>o[g]);
 return present.length>0&&present.every(g=>isGeometryInterpolated(o,g));
}
export function replaceableDraft(o:Observation){return o.review_state!=='approved'&&isInterpolated(o);}
export function markCorrected(o:Observation,geometry?:Geometry){
 for(const g of geometry?[geometry]:geometries)if(o.provenance[g]?.origin==='interpolated')o.provenance[g]={...o.provenance[g]!,human_corrected:true};
}
const lerp=(a:Box,b:Box,t:number):Box=>a.map((x,i)=>x+(b[i]-x)*t) as Box;

// Each box type has its own anchors and deletion barriers. Editing one never
// promotes, erases, or regenerates the other type's keyframes.
export function interpolatePerson(d:Domain,videoId:string,identity:string,times:(number|null)[]=[],changedFrame?:number,selection:boolean|Geometry=true){
 const selected=typeof selection==='string'?[selection]:selection?['person_visible'] as Geometry[]:geometries;
 const changed=new Set<number>();
 for(const g of selected){
  const observations=Object.values(d.observations).filter(o=>o.video_id===videoId&&o.identity_uuid===identity).sort((a,b)=>a.frame_index-b.frame_index);
  const anchors=observations.filter(o=>(o[g]||o.provenance[g])&&(o.review_state==='approved'||!isGeometryInterpolated(o,g)));
  const existing=new Map(observations.map(o=>[o.frame_index,o]));
  for(let i=1;i<anchors.length;i++){
   const left=anchors[i-1],right=anchors[i],start=left.frame_index,end=right.frame_index;
   if(changedFrame!==undefined&&changedFrame!==start&&changedFrame!==end)continue;
   if(end-start<2||left.segment_id!==right.segment_id||!left[g]||!right[g])continue;
   if(d.segments[left.segment_id]?.status!=='verified')continue;
   if(Object.values(d.intervals).some(gap=>gap.video_id===videoId&&gap.identity_uuid===identity&&(!gap.geometry||gap.geometry===g)&&gap.start<=end&&(gap.end===null||gap.end>=start)))continue;
   const first=times[start],last=times[end];
   const useTime=first!=null&&last!=null&&last>first&&Array.from({length:end-start+1},(_,n)=>times[start+n]).every((t,n)=>t!=null&&Number.isFinite(t)&&t>=first&&t<=last&&(n===0||t>times[start+n-1]!));
   for(let f=start+1;f<end;f++){
    const old=existing.get(f);if(old&&(old.review_state==='approved'||((old[g]||old.provenance[g])&&!isGeometryInterpolated(old,g))))continue;
    const t=useTime?(times[f]!-first!)/(last!-first!):(f-start)/(end-start);
    const o=old||emptyObservation(videoId,f,identity,left.segment_id);
    o[g]=lerp(left[g]!,right[g]!,t);o.geometry_link='independent';
    if(g==='person_ext')o.full_quality='estimated';
    if(!old){o.occluded=left.occluded===right.occluded?left.occluded:null;o.truncated=left.truncated===right.truncated?left.truncated:null;}
    if(!old||isInterpolated(old))o.evidence_note=`Interpolated ${g} between source frames ${start} and ${end} using ${useTime?'source timestamps':'source frame indices'}. Review against the image.`;
    o.review_state='draft';o.provenance[g]={origin:'interpolated',proposal_id:null,human_corrected:false};
    d.observations[o.id]=o;existing.set(f,o);changed.add(f);
   }
  }
 }
 return changed.size;
}
