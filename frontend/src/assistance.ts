import {emptyObservation,legacyExtended,uuid,type BoxStyle,type Domain,type Proposal,type Segment} from './types';

type TrackResult={identityId:string;added:number;skipped:number};
const belongs=(videoId:string,identityId:string)=>(row:{video_id:string;identity_uuid:string})=>row.video_id===videoId&&row.identity_uuid===identityId;
const covers=(row:{start:number;end:number|null},frame:number)=>row.start<=frame&&(row.end===null||frame<=row.end);

/** Accept one proposed track as editable Visible starting boxes in one undoable commit. */
export function applySuggestedTrack(d:Domain,videoId:string,proposals:Proposal[],targetId:string|null,style:BoxStyle):TrackResult{
 if(targetId&&!d.identities[targetId])throw new Error('Select an existing person or create a new person.');
 if(!style.class_name.trim()||style.class_name.trim().length>80||!/^#[0-9a-f]{6}$/i.test(style.color))throw new Error('Choose a valid class name and box color.');
 const eligible=proposals.filter(p=>p.video_id===videoId&&p.geometry==='person_visible');
 for(const p of eligible)if(!Number.isSafeInteger(p.frame_index)||p.frame_index<0||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1||p.box.length!==4||!p.box.every(Number.isFinite)||p.box[0]<0||p.box[1]<0||p.box[2]<=p.box[0]||p.box[3]<=p.box[1])throw new Error('The proposed track contains invalid detection coordinates or frames.');
 const tracks=new Set(eligible.map(p=>p.track_id?`${p.cache_key}:${p.track_id}`:null).filter(Boolean));
 if(tracks.size>1)throw new Error('Choose one suggested track at a time.');
 if(eligible.length>1&&eligible.some(p=>!p.track_id))throw new Error('These detections do not have a shared track. Accept their boxes one frame at a time.');

 // Proposal references survive manual correction, so accepting the same suggestion
 // again selects the existing person rather than creating a duplicate identity.
 const proposalIds=new Set(eligible.map(p=>p.id));
 const linked=new Set(Object.values(d.observations).filter(o=>o.video_id===videoId&&o.provenance.person_visible?.proposal_id&&proposalIds.has(o.provenance.person_visible.proposal_id)).map(o=>o.identity_uuid));
 if(linked.size>1||(targetId&&[...linked].some(id=>id!==targetId)))throw new Error('This suggested track is already linked to another person. Select that person before continuing.');
 let identityId=targetId||[...linked][0]||'';
 if(identityId&&legacyExtended(d.identities[identityId]))throw new Error('Assign this older track to the correct box type using I first.');
 const rejected=new Set(Object.values(d.proposal_reviews).filter(r=>r.video_id===videoId&&r.decision==='rejected').map(r=>r.proposal_id));
 // A tracker should emit one detection per frame. Retain the stronger suggestion
 // defensively if a cache contains duplicate rows, without creating duplicate boxes.
 const frames=new Map<number,Proposal>();
 for(const p of eligible)if(!rejected.has(p.id)&&(!frames.has(p.frame_index)||frames.get(p.frame_index)!.confidence<p.confidence))frames.set(p.frame_index,p);
 const rows=[...frames.values()].sort((a,b)=>a.frame_index-b.frame_index);
 if(!rows.length)return {identityId,added:0,skipped:proposals.length};
 const existing=new Map(Object.values(d.observations).filter(belongs(videoId,identityId)).map(o=>[o.frame_index,o]));
 const gaps=Object.values(d.intervals).filter(g=>belongs(videoId,identityId)(g)&&(!g.geometry||g.geometry==='person_visible'));
 const additions=rows.filter(p=>{
  const old=existing.get(p.frame_index);
  return !old?.person_visible&&!old?.provenance.person_visible&&!gaps.some(g=>covers(g,p.frame_index));
 });
 if(!additions.length)return {identityId,added:0,skipped:proposals.length};
 if(!identityId){
  const numbers=new Set(Object.values(d.identities).map(p=>p.person_id));let personId=1;while(numbers.has(personId))personId++;
  identityId=uuid();d.identities[identityId]={id:identityId,person_id:personId,name:`Person ${personId}`,class_name:style.class_name.trim(),color:style.color.toLowerCase(),box_styles:{person_visible:{class_name:style.class_name.trim(),color:style.color.toLowerCase()}}};
 }else{
  const person=d.identities[identityId];
  // Adding AI suggestions must not change saved classes/colors on an existing track.
  if(!person.box_styles?.person_visible&&!Object.values(d.observations).some(o=>o.identity_uuid===identityId&&o.person_visible)){
   person.box_styles={...person.box_styles,person_visible:{class_name:style.class_name.trim(),color:style.color.toLowerCase()}};
   person.class_name=style.class_name.trim();person.color=style.color.toLowerCase();
  }
 }
 const segments=Object.values(d.segments).filter(belongs(videoId,identityId));
 let generated:Segment|undefined;
 for(const p of additions){
  let o=existing.get(p.frame_index);
  if(!o){
   let segment=segments.find(s=>covers(s,p.frame_index));
   if(!segment){
    if(generated&&generated.end===p.frame_index-1){generated.end=p.frame_index;segment=generated;}
    else{const id=uuid();segment={id,video_id:videoId,identity_uuid:identityId,start:p.frame_index,end:p.frame_index,status:'verified'};d.segments[id]=segment;segments.push(segment);generated=segment;}
   }
   o=emptyObservation(videoId,p.frame_index,identityId,segment.id);d.observations[o.id]=o;existing.set(p.frame_index,o);
   o.evidence_note='AI track suggestion accepted as an editable starting box. Review identity and position against the video.';
  }
  o.person_visible=[...p.box];o.geometry_link='independent';o.review_state='draft';
  o.provenance.person_visible={origin:'model_track',proposal_id:p.id,human_corrected:false};
 }

 // Absence from a detector is uncertainty, not proof of occlusion. Explicit,
 // Visible-only unavailable intervals stop interpolation from bridging that hole;
 // existing manual boxes and user-marked intervals take priority.
 const trackStart=rows[0].frame_index,trackEnd=rows.at(-1)!.frame_index;
 const occupied=Object.values(d.observations).filter(o=>belongs(videoId,identityId)(o)&&o.person_visible&&o.frame_index>=trackStart&&o.frame_index<=trackEnd).map(o=>o.frame_index).sort((a,b)=>a-b);
 const preserved=Object.values(d.intervals).filter(g=>belongs(videoId,identityId)(g)&&(!g.geometry||g.geometry==='person_visible'));
 const addUnavailable=(start:number,end:number)=>{
  let cursor=start;
  for(const gap of preserved.filter(g=>g.start<=end&&(g.end===null||g.end>=start)).sort((a,b)=>a.start-b.start)){
   if(cursor<gap.start)add(cursor,Math.min(end,gap.start-1));
   cursor=Math.max(cursor,(gap.end??Infinity)+1);if(cursor>end)return;
  }
  if(cursor<=end)add(cursor,end);
 };
 const add=(start:number,end:number)=>{const id=uuid();d.intervals[id]={id,video_id:videoId,identity_uuid:identityId,start,end,geometry:'person_visible',reason:'unavailable',evidence_note:'Detection unavailable; review required. This does not establish that the person is hidden or occluded.'};};
 for(let i=1;i<occupied.length;i++)if(occupied[i]>occupied[i-1]+1)addUnavailable(occupied[i-1]+1,occupied[i]-1);
 const changedFrames=new Set(additions.map(p=>p.frame_index));
 for(const review of Object.values(d.reviews))if(review.video_id===videoId&&changedFrames.has(review.frame_index)){review.complete=false;review.checked_all_people=false;}
 return {identityId,added:additions.length,skipped:proposals.length-additions.length};
}

export type TrackIssue={id:string;video_id:string;frame_index:number;track_id:string|null;kind:'low_confidence'|'gap'|'motion_jump'|'size_jump'|'tracker_warning';message:string;proposal_id:string;start_frame?:number;end_frame?:number};
export type TrackIssueOptions={confidenceThreshold?:number;motionThreshold?:number;sizeRatioThreshold?:number};

/** Review aids only: these heuristics never reject detections or alter annotations. */
export function listTrackIssues(proposals:Proposal[],options:TrackIssueOptions={}):TrackIssue[]{
 const {confidenceThreshold=.45,motionThreshold=1,sizeRatioThreshold=2.5}=options,issues:TrackIssue[]=[];
 const grouped=new Map<string,Proposal[]>();
 for(const p of proposals){
  if(p.geometry!=='person_visible')continue;
  const key=`${p.video_id}:${p.cache_key}:${p.track_id||p.id}`;const group=grouped.get(key)||[];group.push(p);grouped.set(key,group);
 }
 const add=(p:Proposal,kind:TrackIssue['kind'],message:string,range?:{start_frame:number;end_frame:number})=>issues.push({id:`${p.id}:${kind}`,video_id:p.video_id,frame_index:p.frame_index,track_id:p.track_id||null,kind,message,proposal_id:p.id,...range});
 for(const group of grouped.values()){
  group.sort((a,b)=>a.frame_index-b.frame_index);let previous:Proposal|undefined;
  for(const p of group){
   if(p.confidence<confidenceThreshold)add(p,'low_confidence',`Low detection confidence (${Math.round(p.confidence*100)}%). Check the person and box.`);
   if(p.track_issue)add(p,'tracker_warning',p.track_issue);
   if(previous&&p.frame_index>previous.frame_index){
    const elapsed=p.frame_index-previous.frame_index;
    if(elapsed>1)add(p,'gap',`No detection on frames ${previous.frame_index+1}–${p.frame_index-1}. Confirm whether this is the same person.`,{start_frame:previous.frame_index+1,end_frame:p.frame_index-1});
    const [ax,ay,bx,by]=previous.box,[cx,cy,dx,dy]=p.box;
    const oldArea=(bx-ax)*(by-ay),newArea=(dx-cx)*(dy-cy);
    if(oldArea>0&&newArea>0){
     const motion=Math.hypot((cx+dx-ax-bx)/2,(cy+dy-ay-by)/2)/Math.max(1,Math.hypot(bx-ax,by-ay));
     if(motion/elapsed>motionThreshold)add(p,'motion_jump','The box moved abruptly. Check for an identity switch or misplaced detection.');
     if(Math.max(oldArea/newArea,newArea/oldArea)>sizeRatioThreshold)add(p,'size_jump','The box size changed abruptly. Check its edges and identity.');
    }
   }
   if(!previous||p.frame_index>previous.frame_index)previous=p;
  }
 }
 return issues.sort((a,b)=>a.video_id.localeCompare(b.video_id)||a.frame_index-b.frame_index||a.kind.localeCompare(b.kind));
}
