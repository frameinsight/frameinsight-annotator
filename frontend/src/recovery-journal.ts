import {get,set,del,keys} from 'idb-keyval';
import {type Domain,type Operation,type Project,uuid} from './types';

type Checkpoint={key:string;project:Project;operations:Operation[]};
const checkpoints=new WeakMap<Domain,Checkpoint>();
const written=new Set<string>();
const storedOperations=new WeakSet<Operation>();
const operationKey=(pid:string,id:string)=>'frameinsight:operation:'+pid+':'+id;
export const journalKey=(id:string)=>'frameinsight:journal:'+id;

// Edits replace records. Share one recovery checkpoint and append immutable
// operations instead of structured-cloning every camera's boxes on every save.
export function extendRecovery(before:Project,after:Project,operation:Operation){
 let checkpoint=checkpoints.get(before.state);
 if(!checkpoint){checkpoint={key:'frameinsight:checkpoint:'+before.id+':'+uuid(),project:before,operations:[]};checkpoints.set(before.state,checkpoint);}
 checkpoints.set(after.state,checkpoint.operations.length>=1000
  ?{key:'frameinsight:checkpoint:'+after.id+':'+uuid(),project:after,operations:[]}
  :{...checkpoint,operations:[...checkpoint.operations,operation]});
}
export async function writeRecovery(record:any){
 const project:Project=record.project;
 let checkpoint=checkpoints.get(project.state);
 if(!checkpoint){checkpoint={key:'frameinsight:checkpoint:'+project.id+':'+uuid(),project,operations:[]};checkpoints.set(project.state,checkpoint);}
 if(!written.has(checkpoint.key)){await set(checkpoint.key,checkpoint.project);written.add(checkpoint.key);}
 const operations=new Map<string,Operation>();
 for(const op of [...checkpoint.operations,...record.pending,...record.history,...record.redoStack] as Operation[])operations.set(op.id,op);
 for(const op of operations.values())if(!storedOperations.has(op)){await set(operationKey(project.id,op.id),op);storedOperations.add(op);}
 const ids=(values:Operation[])=>values.map(op=>op.id);
 const {state:_,...metadata}=project;
 await set(journalKey(project.id),{...record,journalVersion:3,project:metadata,checkpointKey:checkpoint.key,operations:ids(checkpoint.operations),pending:ids(record.pending),history:ids(record.history),redoStack:ids(record.redoStack)});
 // Another tab may still refer to an earlier checkpoint. Retain it until
 // explicit project cleanup rather than invalidating that tab's recovery data.
}
export async function readRecovery(id:string){
 const record=await get<any>(journalKey(id));
 if(record?.project?.state||record?.journalVersion!==2&&record?.journalVersion!==3)return record; // Older installations keep full snapshots.
 if(record.journalVersion===3){
  const ids=new Set<string>([...record.operations,...record.pending,...record.history,...record.redoStack]);
  const values=new Map<string,Operation>();
  await Promise.all([...ids].map(async key=>{const op=await get<Operation>(operationKey(id,key));if(!op||op.id!==key)throw new Error('A local recovery operation is unavailable. Keep the recovery data.');values.set(key,op);storedOperations.add(op);}));
  for(const field of ['operations','pending','history','redoStack'])record[field]=record[field].map((key:string)=>values.get(key)!);
 }
 const checkpoint=await get<Project>(record.checkpointKey);
 if(!checkpoint||checkpoint.id!==id)throw new Error('The local recovery checkpoint is unavailable. Keep this tab open and recover your annotations.');
 const state:Domain={...checkpoint.state};const copied=new Set<keyof Domain>();
 let revision=checkpoint.revision;
 for(const operation of record.operations as Operation[]){
  if(operation.base_revision!==revision++)throw new Error('Local recovery revisions do not match their checkpoint. Keep the recovery data.');
  for(const change of operation.changes){
   if(JSON.stringify(state[change.collection][change.id]??null)!==JSON.stringify(change.before))throw new Error('Local recovery operations do not match their checkpoint. Keep the recovery data.');
   if(!copied.has(change.collection)){(state as any)[change.collection]={...state[change.collection]};copied.add(change.collection);}
   if(change.after===null)delete state[change.collection][change.id];else (state[change.collection] as any)[change.id]=change.after;
  }
 }
 if(revision!==record.project.revision)throw new Error('The local recovery revision is incomplete. Keep the recovery data.');
 const project={...record.project,state} as Project;
 checkpoints.set(state,{key:record.checkpointKey,project:checkpoint,operations:record.operations});written.add(record.checkpointKey);
 return {...record,project};
}
export async function deleteRecovery(id:string){
 const record=await get<any>(journalKey(id));await del(journalKey(id));
 if(record?.checkpointKey){await del(record.checkpointKey);written.delete(record.checkpointKey);}
 if(record?.journalVersion===3)for(const key of new Set<string>([...record.operations,...record.pending,...record.history,...record.redoStack]))await del(operationKey(id,key));
 for(const key of await keys())if(typeof key==='string'&&(key.startsWith('frameinsight:checkpoint:'+id+':')||key.startsWith('frameinsight:operation:'+id+':')))await del(key);
}
