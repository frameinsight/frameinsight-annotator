import {type Domain} from './types';

export function assignPerson(d:Domain,source:string,target:string,videoId:string,frame:number,personId:number|null,className:string,color:string){
 if(!d.identities[source]||!d.identities[target])throw new Error('Choose an existing person');
 if(personId!==null&&(!Number.isSafeInteger(personId)||personId<=0))throw new Error('Person ID must be a positive integer');
 if(!className.trim()||className.trim().length>80)throw new Error('Class name must contain 1–80 characters');
 if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Choose a valid box color');
 if(source!==target){
  const mine=Object.values(d.observations).filter(o=>o.identity_uuid===source),other=Object.values(d.observations).filter(o=>o.identity_uuid===target);
  if(mine.some(a=>other.some(b=>a.video_id===b.video_id&&a.frame_index===b.frame_index)))throw new Error('This ID already has a box on the same frame. Select its existing box; two boxes cannot share one person ID.');
  if(Object.values(d.links).some(l=>l.relation==='different'&&((l.source===source&&l.target===target)||(l.source===target&&l.target===source))))throw new Error('These identities were marked different. Resolve that decision in Identity tools first.');
  for(const o of mine){o.identity_uuid=target;o.review_state='draft';}
  for(const seg of Object.values(d.segments))if(seg.identity_uuid===source)seg.identity_uuid=target;
  for(const gap of Object.values(d.intervals))if(gap.identity_uuid===source)gap.identity_uuid=target;
  for(const link of Object.values(d.links)){if(link.source===source)link.source=target;if(link.target===source)link.target=target;if(link.source===link.target)delete d.links[link.id];}
  delete d.identities[source];
  // Overlapping verified segments describe one continuous visible span after reuse.
  // Keep explicit gaps and distinct/non-overlapping or unresolved segments intact.
  const segments=Object.values(d.segments).filter(s=>s.identity_uuid===target&&s.status==='verified').sort((a,b)=>a.video_id.localeCompare(b.video_id)||a.start-b.start);
  let previous=segments[0];
  for(const seg of segments.slice(1)){
   if(previous.video_id===seg.video_id&&seg.start<=(previous.end??Infinity)){
    const end=previous.end===null||seg.end===null?null:Math.max(previous.end,seg.end);
    const hasGap=Object.values(d.intervals).some(g=>g.identity_uuid===target&&g.video_id===seg.video_id&&g.start<=(end??Infinity)&&(g.end??Infinity)>=previous.start);
    if(!hasGap){previous.end=end;for(const o of Object.values(d.observations))if(o.segment_id===seg.id)o.segment_id=previous.id;delete d.segments[seg.id];continue;}
   }
   previous=seg;
  }
 }
 const identity=d.identities[target];identity.person_id=personId;identity.class_name=className.trim();identity.color=color.toLowerCase();
 // Reusing a selected identity before its first frame extends only its first verified span.
 const segments=Object.values(d.segments).filter(s=>s.identity_uuid===target&&s.video_id===videoId).sort((a,b)=>a.start-b.start);
 const first=segments[0];
 if(first&&first.status==='verified'&&frame<first.start&&!Object.values(d.intervals).some(g=>g.identity_uuid===target&&g.video_id===videoId&&g.start<=first.start&&(g.end===null||g.end>=frame)))first.start=frame;
}
