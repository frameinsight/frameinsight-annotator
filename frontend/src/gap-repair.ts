import {type Domain,type Geometry,getBox} from './types';
import {annotationKeyframes} from './interpolation';
import {previewRestoreRange,restoreRange} from './restore-range';
import {scopeGeometryGaps} from './hidden-range';

/** Old releases could save overlapping deletion fragments with unrelated IDs.
 * Link those fragments without changing which frames are hidden. New deletions
 * are disjoint, so they keep their own marker and cannot reuse old anchors.
 */
function normalizeOverlappingRepairs(d:Domain,videoId:string,identity:string,geometry:Geometry){
 scopeGeometryGaps(d,videoId,identity,geometry);
 const gaps=Object.values(d.intervals).filter(g=>g.video_id===videoId&&g.identity_uuid===identity&&g.geometry===geometry).sort((a,b)=>a.start-b.start);
 const parents=new Map<string,string>();
 const root=(key:string):string=>{if(!parents.has(key))parents.set(key,key);let r=key;while(parents.get(r)!==r)r=parents.get(r)!;let cursor=key;while(cursor!==r){const next=parents.get(cursor)!;parents.set(cursor,r);cursor=next;}return r;};
 let end=-1,group='';
 for(const gap of gaps){const key=gap.repair_id||gap.id;root(key);if(gap.start<=end){parents.set(root(key),root(group));end=Math.max(end,gap.end??Infinity);}else{group=key;end=gap.end??Infinity;}}
 const sizes=new Map<string,number>();for(const key of parents.keys()){const r=root(key);sizes.set(r,(sizes.get(r)||0)+1);}
 for(const gap of gaps){const r=root(gap.repair_id||gap.id);if(sizes.get(r)!>1)gap.repair_id=r;}
 for(const row of Object.values(d.observations))if(row.video_id===videoId&&row.identity_uuid===identity){const p=row.provenance[geometry];if(p?.repair_id&&parents.has(p.repair_id))p.repair_id=root(p.repair_id);}
}
export function repairMarker(d:Domain,videoId:string,identity:string,geometry:Geometry,frame:number){
 normalizeOverlappingRepairs(d,videoId,identity,geometry);
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
