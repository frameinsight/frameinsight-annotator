import {beforeEach,it,expect,vi} from 'vitest';
import {type Project,type Operation} from './types';
const disk=vi.hoisted(()=>({values:new Map<string,any>(),writes:vi.fn(),failJournal:false}));
vi.mock('idb-keyval',()=>({get:vi.fn(async(key:string)=>structuredClone(disk.values.get(key))),set:vi.fn(async(key:string,value:any)=>{disk.writes(key,value);if(disk.failJournal&&key.startsWith('frameinsight:journal:'))throw new Error('Storage unavailable');disk.values.set(key,structuredClone(value));}),keys:vi.fn(async()=>[...disk.values.keys()]),del:vi.fn(async(key:string)=>{disk.values.delete(key);})}));
import {extendRecovery,writeRecovery,readRecovery,deleteRecovery,journalKey} from './recovery-journal';
let ordinal=0;
function fixture():Project{return {id:'journal-'+ordinal++,name:'Recovery',revision:0,classes:['Person'],videos:{},state:{identities:{p:{id:'p',person_id:1,name:'Person'}},segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}}};}
function edit(before:Project,n:number){const after={...before,revision:before.revision+1,state:{...before.state,identities:{...before.state.identities,p:{...before.state.identities.p,name:'Person '+n}}}};const op:Operation={id:'op-'+before.id+'-'+n,base_revision:before.revision,video_id:null,frame_index:null,label:'Rename',changes:[{collection:'identities',id:'p',before:before.state.identities.p,after:after.state.identities.p}]};extendRecovery(before,after,op);return {after,op};}
const record=(project:Project,ops:Operation[],pending=ops)=>({project,pending,history:ops,redoStack:[],videoId:'',frame:0,activeId:'p',geometry:'class:Person'});
beforeEach(()=>{disk.values.clear();disk.writes.mockClear();disk.failJournal=false;});
it('writes one checkpoint and only new operations during consecutive edits and acknowledgements',async()=>{
 let project=fixture();const ops:Operation[]=[];
 for(let n=1;n<=20;n++){const next=edit(project,n);project=next.after;ops.push(next.op);await writeRecovery(record(project,[...ops]));await writeRecovery(record(project,[...ops],[]));}
 const checkpoints=disk.writes.mock.calls.filter(([key])=>key.startsWith('frameinsight:checkpoint:'));
 const operations=disk.writes.mock.calls.filter(([key])=>key.startsWith('frameinsight:operation:'));
 expect(checkpoints).toHaveLength(1);expect(operations).toHaveLength(20);
 const compact=disk.values.get(journalKey(project.id));expect(compact.project.state).toBeUndefined();expect(compact.history).toEqual(ops.map(op=>op.id));
 const recovered=await readRecovery(project.id);expect(recovered.project).toEqual(project);expect(recovered.pending).toEqual([]);expect(recovered.history).toEqual(ops);
});
it('keeps pending edits recoverable after a lost server acknowledgement and preserves legacy full journals',async()=>{
 const before=fixture(),{after,op}=edit(before,1);await writeRecovery(record(after,[op]));expect((await readRecovery(after.id)).pending).toEqual([op]);expect((await readRecovery(after.id)).project).toEqual(after);
 const legacy=record(before,[]);disk.values.set(journalKey(before.id),legacy);expect(await readRecovery(before.id)).toEqual(legacy);
});
it('retains the previously committed recovery pointer if the next journal write fails, then retries',async()=>{
 const first=edit(fixture(),1);await writeRecovery(record(first.after,[first.op]));const second=edit(first.after,2);disk.failJournal=true;
 await expect(writeRecovery(record(second.after,[first.op,second.op]))).rejects.toThrow('Storage unavailable');expect((await readRecovery(first.after.id)).project).toEqual(first.after);
 disk.failJournal=false;await writeRecovery(record(second.after,[first.op,second.op]));expect((await readRecovery(first.after.id)).project).toEqual(second.after);
});
it('rotates checkpoints while retaining pending operations and exact undo records',async()=>{
 let project=fixture();const ops:Operation[]=[];
 for(let n=1;n<=1002;n++){const next=edit(project,n);project=next.after;ops.push(next.op);await writeRecovery(record(project,[...ops]));}
 const checkpoints=disk.writes.mock.calls.filter(([key])=>key.startsWith('frameinsight:checkpoint:'));expect(checkpoints).toHaveLength(2);expect(disk.values.has(checkpoints[0][0])).toBe(true); // An older tab may still need it.
 const recovered=await readRecovery(project.id);expect(recovered.project).toEqual(project);expect(recovered.pending).toEqual(ops);expect(recovered.history).toEqual(ops);
});
it('rejects missing or changed recovery records without silently dropping pending annotations',async()=>{
 const {after,op}=edit(fixture(),1);await writeRecovery(record(after,[op]));disk.values.delete('frameinsight:operation:'+after.id+':'+op.id);
 await expect(readRecovery(after.id)).rejects.toThrow('unavailable');
});

it('project cleanup removes its checkpoints and operations without deleting another project recovery',async()=>{
 const a=edit(fixture(),1),b=edit(fixture(),1);await writeRecovery(record(a.after,[a.op]));await writeRecovery(record(b.after,[b.op]));await deleteRecovery(a.after.id);
 expect(await readRecovery(a.after.id)).toBeUndefined();expect((await readRecovery(b.after.id)).project).toEqual(b.after);
 expect([...disk.values.keys()].some(key=>key.includes(a.after.id))).toBe(false);
});

it('reads a complete settings snapshot even if it carries stale compact-journal markers',async()=>{
 const project=fixture();const full={...record(project,[]),journalVersion:3,checkpointKey:'obsolete',operations:['obsolete']};disk.values.set(journalKey(project.id),full);expect((await readRecovery(project.id)).project).toEqual(project);
});
