import {type Domain,type Geometry,boxKeys,getBox} from './types';
export function timelineBins(state:Domain|null,videoId:string,count:number,activeId:string,geometry?:Geometry){
 const length=Math.min(count,240);
 const bins=Array.from({length},(_,i)=>({start:Math.floor(i*count/length),end:Math.floor((i+1)*count/length),complete:false,draft:false,manual:false,generated:false,gap:false,present:0,reviewed:0}));
 const presentFrames=new Map(bins.map(bin=>[bin,new Set<number>()]));
 if(!state||!length)return bins;
 // These indices agree with the floor-rounded boundaries, including short bins.
 const binFor=(frame:number)=>frame>=0&&frame<count?bins[Math.ceil((frame+1)*length/count)-1]:undefined;
 for(const r of Object.values(state.reviews)){const bin=r.video_id===videoId?binFor(r.frame_index):undefined;if(bin&&r.complete)bin.reviewed++;}
 for(const o of Object.values(state.observations)){
  if(activeId&&o.identity_uuid!==activeId)continue;
  const bin=o.video_id===videoId?binFor(o.frame_index):undefined;
  for(const g of geometry?[geometry]:boxKeys(o)){
   if(!bin||!getBox(o,g))continue;
   presentFrames.get(bin)!.add(o.frame_index);
   bin.draft=true;
   const provenance=o.provenance[g];
   if(o.review_state!=='approved'&&provenance&&!provenance.human_corrected&&['interpolated','copied_track','model_track'].includes(provenance.origin))bin.generated=true;
   else bin.manual=true;
  }
 }
 for(const bin of bins){
  bin.present=presentFrames.get(bin)!.size;
  bin.complete=bin.reviewed===bin.end-bin.start;
  bin.gap=Object.values(state.intervals).some(g=>g.video_id===videoId&&g.identity_uuid===activeId&&(!geometry||!g.geometry||g.geometry===geometry)&&g.start<bin.end&&(g.end===null||g.end>=bin.start));
 }
 return bins;
}
