import {type Change,type Domain,type Project,type Geometry,getBox,validateDomain} from './types';
import {isGeometryGenerated} from './interpolation';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const collections: (keyof Domain)[]=['identities','segments','observations','intervals','links','reviews','proposal_reviews'];

/** Box edits can touch only this track's current video, its class style, and review
 * flags. Keep unrelated recordings out of the draft and the deep comparison.
 * General operations (ID changes, deletion, recovery) use the full transaction.
 */
export function canEditTrack(project:Project,videoId:string,identityId:string){
 return Object.values(project.state.segments).some(s=>s.video_id===videoId&&s.identity_uuid===identityId)&&!Object.values(project.state.intervals).some(g=>g.video_id===videoId&&g.identity_uuid===identityId&&!g.geometry);
}
export function editTrack(project:Project,videoId:string,identityId:string,edit:(draft:Domain)=>void,context?:{frame:number;geometry:Geometry}):{state:Domain;changes:Change[]}{
 const before=project.state;
 if(!before.identities[identityId]||!project.videos[videoId])throw new Error('Select a track in an available video first.');
 const belongs=(row:{video_id:string;identity_uuid:string})=>row.video_id===videoId&&row.identity_uuid===identityId;
 const scope:Domain={identities:{[identityId]:before.identities[identityId]},segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 for(const collection of ['segments','observations','intervals'] as const)for(const row of Object.values(before[collection]))if(belongs(row))(scope[collection] as Record<string,unknown>)[row.id]=row;
 // Without deletion barriers, an endpoint edit affects only its two adjacent
 // keyframe spans. Keep every class on those rows, but don't clone/diff thousands
 // of untouched generated rows elsewhere along the same recording.
 if(context&&!Object.keys(scope.intervals).length){
  const {frame,geometry}=context;let left=-Infinity,right=Infinity;
  for(const row of Object.values(scope.observations))if((getBox(row,geometry)||row.provenance[geometry])&&(row.review_state==='approved'||!isGeometryGenerated(row,geometry))){
   if(row.frame_index<frame)left=Math.max(left,row.frame_index);
   if(row.frame_index>frame)right=Math.min(right,row.frame_index);
  }
  if(left===-Infinity)left=frame;if(right===Infinity)right=frame;
  scope.observations=Object.fromEntries(Object.entries(scope.observations).filter(([,row])=>row.frame_index>=left&&row.frame_index<=right));
 }
 const draft=structuredClone(scope);
 edit(draft);
 // This restricted transaction cannot be reused for changes to track IDs or
 // memberships: those require whole-project conflict checks.
 const person=draft.identities[identityId];
 if(Object.keys(draft.identities).length!==1||!person||person.id!==identityId||person.person_id!==before.identities[identityId].person_id)throw new Error('Track identity changes need a full project transaction.');
 for(const collection of ['segments','observations','intervals'] as const)for(const row of Object.values(draft[collection]))if(!belongs(row))throw new Error('A box edit cannot change another track or video.');
 if(Object.keys(draft.links).length||Object.keys(draft.reviews).length||Object.keys(draft.proposal_reviews).length)throw new Error('A box edit cannot add unrelated review records.');
 validateDomain(draft,{[videoId]:project.videos[videoId]});
 const changes:Change[]=[];
 const frames=new Set<string>();
 const identityChanged=!same(scope.identities[identityId],person);
 const after:Domain={...before};
 const written=new Set<keyof Domain>();
 const put=(collection:keyof Domain,id:string,value:unknown)=>{
  if(!written.has(collection)){(after as any)[collection]={...before[collection]};written.add(collection);}
  if(value==null)delete after[collection][id];else (after[collection] as any)[id]=value;
 };
 // Style changes invalidate every observation of a shared legacy identity,
 // including its other videos, just like the general commit path.
 if(identityChanged)for(const row of Object.values(draft.observations))row.review_state='draft';
 for(const collection of collections)for(const id of new Set([...Object.keys(scope[collection]),...Object.keys(draft[collection])])){
  const old=scope[collection][id]??null,value=draft[collection][id]??null;
  if(same(old,value))continue;
  changes.push({collection,id,before:old,after:value});put(collection,id,value);
  if(collection==='observations')for(const row of [old,value])if(row)frames.add((row as any).video_id+':'+(row as any).frame_index);
 }
 if(identityChanged)for(const old of Object.values(before.observations)){
  if(old.identity_uuid!==identityId||old.review_state==='draft'||after.observations[old.id]!==old)continue;
  const value={...old,review_state:'draft' as const};changes.push({collection:'observations',id:old.id,before:old,after:value});put('observations',old.id,value);frames.add(old.video_id+':'+old.frame_index);
 }
 for(const old of Object.values(before.reviews))if(frames.has(old.video_id+':'+old.frame_index)&&(old.complete||old.checked_all_people)){
  const value={...old,complete:false,checked_all_people:false};changes.push({collection:'reviews',id:old.id,before:old,after:value});put('reviews',old.id,value);
 }
 return {state:changes.length?after:before,changes};
}
