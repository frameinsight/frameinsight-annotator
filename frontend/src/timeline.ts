import type {Domain} from './types';
export function timelineBins(state:Domain|null,videoId:string,count:number,activeId:string){
 const length=Math.min(count,240);
 const bins=Array.from({length},(_,i)=>({start:Math.floor(i*count/length),end:Math.floor((i+1)*count/length),complete:false,draft:false,gap:false,reviewed:0}));
 if(!state||!length)return bins;
 // These indices agree with the floor-rounded boundaries, including short bins.
 const binFor=(frame:number)=>frame>=0&&frame<count?bins[Math.ceil((frame+1)*length/count)-1]:undefined;
 for(const r of Object.values(state.reviews)){const bin=r.video_id===videoId?binFor(r.frame_index):undefined;if(bin&&r.complete)bin.reviewed++;}
 for(const o of Object.values(state.observations)){const bin=o.video_id===videoId?binFor(o.frame_index):undefined;if(bin)bin.draft=true;}
 for(const bin of bins){
  bin.complete=bin.reviewed===bin.end-bin.start;
  bin.gap=Object.values(state.intervals).some(g=>g.video_id===videoId&&g.identity_uuid===activeId&&g.start<bin.end&&(g.end===null||g.end>=bin.start));
 }
 return bins;
}
