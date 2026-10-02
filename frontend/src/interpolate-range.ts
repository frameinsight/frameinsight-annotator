import {getBox,boxStyle,type Domain,type Geometry} from './types';
import {markCorrected,annotationKeyframes} from './interpolation';
import {previewRestoreRange,restoreRange} from './restore-range';

export function boundaryFrames(d:Domain,videoId:string,identity:string,geometry:Geometry,frame:number){
 const anchors=annotationKeyframes(d,videoId,identity,geometry);
 const before=anchors.filter(f=>f<frame).at(-1),after=anchors.find(f=>f>frame);
 return anchors.includes(frame)&&before!==undefined?{start:before,end:frame}:{start:before??frame,end:after??frame};
}
function prepare(d:Domain,videoId:string,identity:string,geometry:Geometry,start:number,end:number){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end)throw new Error('Choose two different frames, with the first before the last.');
 for(const frame of [start,end]){
  const row=Object.values(d.observations).find(o=>o.video_id===videoId&&o.identity_uuid===identity&&o.frame_index===frame);
  if(!row||!getBox(row,geometry))throw new Error(`Draw a ${boxStyle(d.identities[identity],geometry).class_name} box for this track on frame ${frame} first.`);
  if(row.review_state!=='approved')markCorrected(row,geometry);
 }
}
export function previewBetweenFrames(d:Domain,videoId:string,identity:string,geometry:Geometry,start:number,end:number,count:number,times:(number|null)[]=[]){
 const copy=structuredClone(d);
 try{prepare(copy,videoId,identity,geometry,start,end);}catch(error){return {canRestore:false,restoredBoxes:0,keptBoxes:0,anchorFrames:[],warnings:[],error:(error as Error).message};}
 return previewRestoreRange(copy,videoId,identity,start,end,count,geometry,'interpolate',[],times);
}
export function interpolateBetweenFrames(d:Domain,videoId:string,identity:string,geometry:Geometry,start:number,end:number,count:number,times:(number|null)[]=[]){
 const preview=previewBetweenFrames(d,videoId,identity,geometry,start,end,count,times);
 if(!preview.canRestore)throw new Error(preview.error||'No frames to fill.');
 prepare(d,videoId,identity,geometry,start,end);
 return restoreRange(d,videoId,identity,start,end,count,geometry,'interpolate',[],times);
}
