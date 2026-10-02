import {type Domain,type Geometry,getBox} from './types';
import {annotationKeyframes} from './interpolation';
import {previewRestoreRange,restoreRange} from './restore-range';

export function repairMarker(d:Domain,videoId:string,identity:string,geometry:Geometry,frame:number){
 const gap=Object.values(d.intervals).filter(g=>g.video_id===videoId&&g.identity_uuid===identity&&(!g.geometry||g.geometry===geometry)&&g.start<=frame&&(g.end===null||g.end>=frame)).at(-1);
 return gap&&(gap.repair_id||gap.id);
}
/** Two replacement anchors reopen only their shared deletion and only between them. */
export function repairBetweenNewBoxes(d:Domain,videoId:string,identity:string,geometry:Geometry,frame:number,count:number,times:(number|null)[]=[]){
 const rows=new Map(Object.values(d.observations).filter(o=>o.video_id===videoId&&o.identity_uuid===identity).map(o=>[o.frame_index,o]));
 const current=rows.get(frame),marker=current?.provenance[geometry]?.repair_id;
 if(!marker||!getBox(current,geometry))return 0;
 const anchors=annotationKeyframes(d,videoId,identity,geometry),index=anchors.indexOf(frame);
 if(index<0)return 0;
 let restored=0;
 for(const other of [anchors[index-1],anchors[index+1]]){
  if(other===undefined||rows.get(other)?.provenance[geometry]?.repair_id!==marker)continue;
  const start=Math.min(frame,other),end=Math.max(frame,other);
  const gaps=Object.values(d.intervals).filter(g=>g.video_id===videoId&&g.identity_uuid===identity&&(!g.geometry||g.geometry===geometry)&&g.start<=end&&(g.end===null||g.end>=start));
  if(!gaps.length||gaps.some(g=>(g.repair_id||g.id)!==marker))continue;
  const preview=previewRestoreRange(d,videoId,identity,start,end,count,geometry,'interpolate',[],times);
  if(preview.canRestore)restored+=restoreRange(d,videoId,identity,start,end,count,geometry,'interpolate',[],times).restoredBoxes;
 }
 return restored;
}
