import {create} from 'zustand';
import {interpolatePerson,markCorrected} from './interpolation';
import {assignPerson as assignPersonInDomain} from './identity';
import {VISIBLE_ONLY,legacyExtended,boxStyle,classColor} from './types';
import {deleteGeometryRange,prepareGeometryFrame} from './hidden-range';
import {applySuggestedTrack} from './assistance';
import {copyVisibleToExtended} from './copy-visible';
import {get,set as dbSet,del as dbDelete} from 'idb-keyval';
import {api,post} from './api';
import {type Domain,type Project,type Operation,type Change,type Geometry,type Observation,type Proposal,uuid,currentObservation,emptyObservation,observationIssues,validateDomain} from './types';
type Store={remoteBusy:boolean;adoptImport:(project:Project,operation:Operation|null)=>Promise<void>;acceptTrack:(proposals:Proposal[],targetId:string|null,className:string)=>boolean;copyVisibleToExtended:()=>void;forgetProject:(id:string)=>Promise<void>;markHiddenRange:(start:number,end:number)=>boolean;saveNow:()=>Promise<void>;hiddenIds:Record<string,boolean>;togglePersonVisibility:(id:string)=>void;focusPerson:(id:string)=>void;showAllPeople:()=>void;selectPerson:(id:string)=>void;deletePerson:(id:string)=>boolean;assignPerson:(target:string,personId:number|null,className:string,color:string,geometry?:Geometry)=>boolean;autoInterpolate:boolean;frameTimes:Record<string,(number|null)[]>;toggleInterpolation:()=>void;fillInterpolation:()=>void;project:Project|null;videoId:string;frame:number;activeId:string;geometry:Geometry;saveStatus:string;saveError:string;notice:string;pending:Operation[];history:Operation[];redoStack:Operation[];ready:boolean;load:(id:string)=>Promise<void>;commit:(label:string,fn:(d:Domain)=>void)=>boolean;navigate:(n:number)=>void;undo:()=>void;redo:()=>void;retry:()=>void;newPerson:()=>void;editObservation:(label:string,fn:(o:Observation)=>void,propagate?:boolean)=>void;setBox:(geometry:Geometry,box:Observation['person_ext'],proposal?:Proposal,context?:{videoId:string;frame:number;activeId:string})=>void;equal:()=>void;copyPrevious:()=>void;approve:()=>boolean;rename:(id:string,n:number|null)=>void;toast:(message:string)=>void;};
let pumpRunning=false;let persistChain=Promise.resolve();
const clone=<T,>(x:T):T=>structuredClone(x);
const same=(a:any,b:any):boolean=>{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
};
const journalKey=(id:string)=>'frameinsight:journal:'+id;
const positionKey=(id:string)=>'frameinsight:position:'+id;
function persist(){
 const s=useStore.getState();if(!s.project)return Promise.resolve();
 const record=clone({project:s.project,pending:s.pending,history:s.history,redoStack:s.redoStack,videoId:s.videoId,frame:s.frame,activeId:s.activeId,geometry:s.geometry});
 const task=persistChain.then(()=>dbSet(journalKey(record.project.id),record));
 persistChain=task.catch(()=>{});return task;
}
async function durableAndPump(){try{await persist();useStore.setState({saveStatus:useStore.getState().pending.length?'Saved locally':'Saved'});void pump();}catch(e){useStore.setState({saveStatus:'Save failed',saveError:'Browser storage failed. Keep this tab open and export a recovery copy. '+String(e)});}}
async function pump(){
 if(pumpRunning)return;pumpRunning=true;
 try{while(useStore.getState().pending.length){
  const s=useStore.getState(), op=s.pending[0], pid=s.project!.id;
  useStore.setState({saveStatus:'Saving'});
  await post('/projects/'+pid+'/operations',op);
  if(useStore.getState().project?.id!==pid)break;
  useStore.setState({pending:useStore.getState().pending.filter(p=>p.id!==op.id),saveError:''});await persist();
 }
 useStore.setState({saveStatus:'Saved'});
 }catch(e){useStore.setState({saveStatus:'Save failed',saveError:String(e)});}finally{pumpRunning=false;}
}
function queue(op:Operation,state:Domain,history:Operation[],redoStack:Operation[]){
 const s=useStore.getState();useStore.setState({project:{...s.project!,state,revision:s.project!.revision+1},pending:[...s.pending,op],history,redoStack,saveStatus:'Saving',saveError:''});void durableAndPump();
}
function invalidate(before:Domain,after:Domain){
 const frames=new Set<string>(),identities=new Set<string>();
 for(const id of new Set([...Object.keys(before.identities),...Object.keys(after.identities)]))if(!same(before.identities[id],after.identities[id]))identities.add(id);
 for(const o of Object.values(after.observations))if(identities.has(o.identity_uuid))o.review_state='draft';
 for(const id of new Set([...Object.keys(before.observations),...Object.keys(after.observations)])){
  const old=before.observations[id],o=after.observations[id];
  if(!same(old,o)){if(old)frames.add(old.video_id+':'+old.frame_index);if(o)frames.add(o.video_id+':'+o.frame_index);}
 }
 for(const r of Object.values(after.reviews))if(frames.has(r.video_id+':'+r.frame_index)){r.complete=false;r.checked_all_people=false;}
}
export const useStore=create<Store>((set,get)=>({
 remoteBusy:false,
 adoptImport:async(project,operation)=>{
  const s=get();if(s.project?.id!==project.id||s.pending.length)throw new Error('Project changed during import. Reopen the video to load the saved import.');
  const matches=operation&&project.revision===operation.base_revision+1&&operation.changes.every(c=>same(project.state[c.collection][c.id]??null,c.after));
  const history=operation&&matches&&!s.history.some(op=>op.id===operation.id)?[...s.history,operation].slice(-200):s.history;
  set({project,history,redoStack:[],saveStatus:'Saved',saveError:''});await persist();
 },
 acceptTrack:(proposals,targetId,className)=>{
  const s=get();let result={identityId:'',added:0,skipped:0};
  const ok=s.commit('Use AI track as editable Visible boxes',d=>{result=applySuggestedTrack(d,s.videoId,proposals,targetId,{class_name:className,color:classColor(s.project,className)})});
  if(ok){if(result.identityId)s.selectPerson(result.identityId);set({geometry:'person_visible'});void durableAndPump();s.toast(`${result.added} AI boxes added; ${result.skipped} existing or excluded boxes kept. Review the track and adjust where needed.`);}return ok;
 },
 copyVisibleToExtended:()=>{
  const s=get();if(!s.activeId||s.hiddenIds[s.activeId])return s.toast('Select a visible person first');
  let count=0;
  if(s.commit('Copy Visible to Extended across video',d=>{count=copyVisibleToExtended(d,s.videoId,s.activeId)})){
   set({geometry:'person_ext'});void durableAndPump();
   s.toast(count?`${count} Extended boxes copied across this video. Resize at keyframes; Ctrl+Z undoes the whole copy.`:'All available Visible boxes already have Extended boxes.');
  }
 },
 forgetProject:async(id)=>{await persistChain;if(get().project?.id===id)set({project:null,videoId:'',activeId:'',pending:[],history:[],redoStack:[],saveStatus:'Saved',saveError:''});await dbDelete(journalKey(id));for(const key of [positionKey(id),'frameinsight:visibility:'+id])localStorage.removeItem(key);},
 saveNow:async()=>{await persist();await pump();const deadline=Date.now()+30000;while(get().pending.length){if(get().saveStatus==='Save failed')throw new Error(get().saveError||'Saving failed. Your edits are kept locally.');if(Date.now()>deadline)throw new Error('Still saving. Keep this tab open and try again.');await new Promise(resolve=>setTimeout(resolve,50));if(!pumpRunning)await pump();}set({saveStatus:'Saved',saveError:''});},
 markHiddenRange:(start,end)=>{const s=get();let removed=0;const ok=s.commit(`Delete person boxes: frames ${start}–${end}`,d=>{removed=deleteGeometryRange(d,s.videoId,s.activeId,start,end,s.project!.videos[s.videoId].frame_count,s.geometry)});if(ok)s.toast(`${removed} boxes deleted. Selected box type absent on frames ${start}–${end}. Ctrl+Z undoes this.`);return ok;},
 hiddenIds:{},
 togglePersonVisibility:(id)=>{const s=get(),hidden=!s.hiddenIds[id];set({hiddenIds:{...s.hiddenIds,[id]:hidden},...(hidden&&s.activeId===id?{activeId:''}:{})});},
 focusPerson:(id)=>{const s=get();if(!s.project?.state.identities[id])return;set({activeId:id,hiddenIds:Object.fromEntries(Object.keys(s.project.state.identities).map(key=>[key,key!==id]))});},
 showAllPeople:()=>set({hiddenIds:{}}),
 selectPerson:(id)=>set({activeId:id,hiddenIds:{...get().hiddenIds,[id]:false}}),
 deletePerson:(id)=>{const s=get();const ok=s.commit('Delete person and all their annotations',d=>{if(!d.identities[id])throw new Error('Person not found');for(const col of ['observations','segments','intervals'] as const)for(const row of Object.values(d[col]))if(row.identity_uuid===id)delete d[col][row.id];for(const link of Object.values(d.links))if(link.source===id||link.target===id)delete d.links[link.id];delete d.identities[id];});if(ok){set({activeId:s.activeId===id?'':s.activeId});s.toast('Person deleted. Press Ctrl+Z to undo.');}return ok;},
 autoInterpolate:(()=>{try{return localStorage.getItem('frameinsight:interpolate')!=='off'}catch{return true}})(),frameTimes:{},
 toggleInterpolation:()=>{const enabled=!get().autoInterpolate;set({autoInterpolate:enabled});try{localStorage.setItem('frameinsight:interpolate',enabled?'on':'off')}catch{}},
 fillInterpolation:()=>{const s=get();if(!s.activeId)return s.toast('Select a person first');let count=0;const ok=s.commit('Interpolate between keyframes',d=>{count=interpolatePerson(d,s.videoId,s.activeId,s.frameTimes[s.videoId],undefined,s.geometry)});if(ok)s.toast(count?`${count} interpolated frames. Drag any box to correct it; changes save automatically.`:'No frames to fill. Draw two keyframes in the same visible segment; gaps and reviewed work are preserved.');},
 project:null,videoId:'',frame:0,activeId:'',geometry:VISIBLE_ONLY?'person_visible':'person_ext',saveStatus:'Saved',saveError:'',notice:'',pending:[],history:[],redoStack:[],ready:false,
 toast:(notice)=>{set({notice});window.setTimeout(()=>{if(get().notice===notice)set({notice:''})},5500)},
 load:async(id)=>{
  if(get().pending.length)throw new Error('Save or recover pending edits before switching projects.');
  const [remote,local]=await Promise.all([api<Project>('/projects/'+id),getJournal(id)]);
  let position:any=null;try{position=JSON.parse(localStorage.getItem(positionKey(id))||'null')}catch{}
  if(local?.pending?.length){set({...local,ready:true,saveStatus:'Saved locally',saveError:''});void pump();}
  else{set({project:remote,pending:[],history:local?.history||[],redoStack:local?.redoStack||[],videoId:local?.videoId&&remote.videos[local.videoId]?local.videoId:Object.keys(remote.videos)[0]||'',frame:local?.frame||0,activeId:local?.activeId||'',geometry:local?.geometry||'person_visible',ready:true,saveStatus:'Saved',saveError:''});}
  const loaded=get().project;const positionVideo=loaded?.videos[position?.videoId];
  if(positionVideo&&Number.isSafeInteger(position.frame))set({videoId:position.videoId,frame:Math.max(0,Math.min(positionVideo.frame_count-1,position.frame)),activeId:loaded?.state.identities[position.activeId]?position.activeId:'',geometry:position.geometry==='person_visible'?'person_visible':'person_ext'});
  let hiddenIds:Record<string,boolean>={};try{const saved=JSON.parse(localStorage.getItem('frameinsight:visibility:'+id)||'{}');hiddenIds=Object.fromEntries(Object.keys(loaded?.state.identities||{}).map(key=>[key,saved[key]===true]));}catch{}
  set({hiddenIds,...(hiddenIds[get().activeId]?{activeId:''}:{})});

  localStorage.setItem('frameinsight:lastProject',id);
 },
 commit:(label,fn)=>{
  const s=get();if(!s.project)return false;
  const before=s.project.state,after=clone(before);
  try{fn(after);invalidate(before,after);validateDomain(after,s.project.videos);}catch(e){s.toast(String(e));return false;}
  const changes:Change[]=[];
  for(const col of Object.keys(before) as (keyof Domain)[])for(const id of new Set([...Object.keys(before[col]),...Object.keys(after[col])]))if(!same(before[col][id],after[col][id]))changes.push({collection:col,id,before:before[col][id]??null,after:after[col][id]??null});
  if(!changes.length)return true;
  if(changes.length>50000){s.toast('This action exceeds the 50,000-change limit. Use individual-frame suggestions or a shorter video. Nothing was changed.');return false;}
  const op:Operation={id:uuid(),label,base_revision:s.project.revision,video_id:s.videoId||null,frame_index:s.frame,changes,compensates:null};
  queue(op,after,[...s.history,op].slice(-200),[]);return true;
 },
 navigate:(n)=>{const s=get(),v=s.project?.videos[s.videoId];if(!v)return;set({frame:Math.max(0,Math.min(v.frame_count-1,n))});},
 undo:()=>compensate(false),redo:()=>compensate(true),retry:()=>void durableAndPump(),
 newPerson:()=>{
  const s=get();if(!s.videoId)return;
  const id=uuid(),seg=uuid();s.commit('New person',d=>{d.identities[id]={id,person_id:null,name:'Person '+(Object.keys(d.identities).length+1),class_name:s.project?.classes?.[0]||'Person',box_styles:{[s.geometry]:{class_name:s.geometry==='person_ext'?'person_extended':s.project?.classes?.[0]||'Person',color:classColor(s.project,s.geometry==='person_ext'?'person_extended':s.project?.classes?.[0]||'Person')}}};d.segments[seg]={id:seg,video_id:s.videoId,identity_uuid:id,start:s.frame,end:null,status:'verified'};});set({activeId:id});
 },
 editObservation:(label,fn,propagate=true)=>{
  const s=get();if(!s.activeId||s.hiddenIds[s.activeId]){s.toast('Select a visible person or press N first');return;}
  s.commit(label,d=>{let o=currentObservation(s.project,s.videoId,s.frame,s.activeId);if(o)o=d.observations[o.id];
   else{const segment=prepareGeometryFrame(d,s.videoId,s.activeId,s.frame,s.geometry);
    o=emptyObservation(s.videoId,s.frame,s.activeId,segment.id);d.observations[o.id]=o;
   }
   const person=d.identities[s.activeId];
   // Legacy extended tracks keep their original marker until explicit ID conversion.
   if(!legacyExtended(person)){person.box_styles??={};if(!person.box_styles[s.geometry]){const style=boxStyle(person,s.geometry);person.box_styles[s.geometry]={...style,color:s.geometry==='person_visible'&&person.color?person.color:classColor(s.project,style.class_name)};}}
   prepareGeometryFrame(d,s.videoId,s.activeId,s.frame,s.geometry);markCorrected(o,s.geometry);o.review_state='draft';fn(o);
   if(s.autoInterpolate&&propagate)interpolatePerson(d,s.videoId,s.activeId,s.frameTimes[s.videoId],s.frame,s.geometry);
  });
 },
 setBox:(geometry,box,proposal,context)=>{
  const s=get();if(context&&(context.videoId!==s.videoId||context.frame!==s.frame||context.activeId!==s.activeId)){s.toast('Gesture frame changed; edit cancelled for safety');return;}
  if(box===null&&VISIBLE_ONLY){s.markHiddenRange(s.frame,s.frame);return;}
  const old=currentObservation(s.project,s.videoId,s.frame,s.activeId);
  const broken=old?.geometry_link==='equal'&&geometry==='person_visible';
  s.editObservation('Edit '+geometry,o=>{
   if(geometry==='person_visible'&&o.geometry_link==='equal'){o.geometry_link='independent';o.full_quality='unset';o.occluded=null;}
   o.geometry_link='independent';o[geometry]=box;
   const previous=o.provenance[geometry];
   o.provenance[geometry]=proposal?{origin:'model',proposal_id:proposal.id,human_corrected:false}:{origin:previous?.origin||'manual',proposal_id:previous?.proposal_id||null,human_corrected:!!previous?.proposal_id||previous?.origin==='interpolated'||previous?.origin==='copied'||previous?.origin==='copied_track'||previous?.origin==='model_track'};
   if(geometry==='person_ext'&&box)o.full_quality='estimated';
  },box!==null);
  if(broken&&!VISIBLE_ONLY)s.toast('Equal link released. Review full extent quality and occlusion.');
  if(!VISIBLE_ONLY&&geometry==='person_ext'&&box&&!old?.person_visible)set({geometry:'person_visible'});
 },
 equal:()=>{
  const s=get(),o=currentObservation(s.project,s.videoId,s.frame,s.activeId);if(!o)return s.toast('Draw a box first');const box=o[s.geometry]||o.person_ext||o.person_visible;if(!box)return s.toast('Draw a box first');
  s.editObservation('Clear person · A = B',n=>{n.person_ext=[...box];n.person_visible=[...box];n.geometry_link='equal';n.full_quality='observed';n.occluded=false;n.provenance.person_ext=n.provenance.person_ext||{origin:'manual',proposal_id:null,human_corrected:false};n.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};});s.toast((o[s.geometry]?s.geometry==='person_ext'?'A':'B':o.person_ext?'A':'B')+' is authoritative. A = B; review truncation before approval.');
 },
 copyPrevious:()=>{
  const s=get(),o=currentObservation(s.project,s.videoId,s.frame-1,s.activeId),g=s.geometry;
  if(!o?.[g])return s.toast('No box of this type on the previous frame');
  if(currentObservation(s.project,s.videoId,s.frame,s.activeId)?.[g])return s.toast('This box type already exists on the current frame');
  s.editObservation('Copy previous '+g,n=>{n[g]=[...o[g]!];n.geometry_link='independent';if(g==='person_ext')n.full_quality='estimated';n.provenance[g]={origin:'copied',proposal_id:null,human_corrected:false};});
 },
 approve:()=>{
  const s=get(),o=currentObservation(s.project,s.videoId,s.frame,s.activeId);if(!o){s.toast('Draw the observation first');return false;}const errors=observationIssues(o);if(s.project!.state.segments[o.segment_id].status!=='verified')errors.push('Resolve the returning identity first');if(errors.length){s.toast(errors.join(' · '));return false;}
  return s.commit('Approve observation',d=>{d.observations[o.id].review_state='approved';});
 },
 assignPerson:(target,personId,className,color,chosenGeometry)=>{const s=get(),g=chosenGeometry||(s.project&&legacyExtended(s.project.state.identities[s.activeId])?'person_ext':s.geometry);const reconnect=s.activeId!==target&&s.project&&!legacyExtended(s.project.state.identities[s.activeId])&&!legacyExtended(s.project.state.identities[target])&&Object.values(s.project.state.observations).some(o=>o.identity_uuid===target&&o[g]);const ok=s.commit('Assign existing person / class / color',d=>{assignPersonInDomain(d,s.activeId,target,s.videoId,s.frame,personId,className,color,g);if(s.autoInterpolate&&reconnect)interpolatePerson(d,s.videoId,target,s.frameTimes[s.videoId],s.frame,g)});if(ok){get().selectPerson(target);set({geometry:g});}return ok;},
 rename:(id,n)=>{const s=get();if(n!==null&&(!Number.isSafeInteger(n)||n<=0)){s.toast('Person ID must be a positive integer');return;}s.commit('Rename person ID',d=>{if(n!==null&&Object.values(d.identities).some(i=>i.id!==id&&i.person_id===n))throw new Error('That ID is already assigned. Resolve or merge identities explicitly.');d.identities[id].person_id=n;});},
}));
async function getJournal(id:string){return get<any>(journalKey(id));}
function compensate(redo:boolean){
 const s=useStore.getState(),stack=redo?s.redoStack:s.history,original=stack.at(-1);if(!original||!s.project)return;
 const changes=original.changes.map(c=>({...c,before:c.after,after:c.before}));
 const state=clone(s.project.state);
 for(const c of changes){if(!same(state[c.collection][c.id]??null,c.before)){s.toast('Undo history does not match current data. Reload to review server changes.');return;}if(c.after===null)delete state[c.collection][c.id];else (state[c.collection] as any)[c.id]=clone(c.after);}
 const op:Operation={...original,id:uuid(),base_revision:s.project.revision,label:(redo?'Redo ':'Undo ')+original.label,compensates:original.id,changes};
 queue(op,state,redo?[...s.history,op]:s.history.slice(0,-1),redo?s.redoStack.slice(0,-1):[...s.redoStack,op]);
 if(original.video_id)useStore.setState({videoId:original.video_id,frame:original.frame_index||0});
 const affected=changes.find(c=>c.collection==='observations');const identity=affected?.after?.identity_uuid||affected?.before?.identity_uuid;if(identity&&state.identities[identity])useStore.getState().selectPerson(identity);else if(!state.identities[s.activeId])useStore.setState({activeId:Object.keys(state.identities)[0]||''});
}
window.addEventListener('online',()=>void pump());
window.addEventListener('beforeunload',e=>{if(useStore.getState().saveStatus==='Saving'){e.preventDefault();}});
setInterval(()=>{const s=useStore.getState();if(s.pending.length&&s.saveStatus!=='Save failed')void pump();},3000);

// Cursor changes do not modify annotations. Persist only this tiny position record;
// cloning the entire durable edit journal on F/D stalls large completed projects.
useStore.subscribe((s,previous)=>{if(!s.project)return;if(s.project.id===previous.project?.id&&s.videoId===previous.videoId&&s.frame===previous.frame&&s.activeId===previous.activeId&&s.geometry===previous.geometry)return;try{localStorage.setItem(positionKey(s.project.id),JSON.stringify({videoId:s.videoId,frame:s.frame,activeId:s.activeId,geometry:s.geometry}))}catch{/* Losing a cursor position must not affect annotation saves. */}});

useStore.subscribe((s,previous)=>{if(!s.project||s.hiddenIds===previous.hiddenIds)return;try{localStorage.setItem('frameinsight:visibility:'+s.project.id,JSON.stringify(s.hiddenIds))}catch{}});
