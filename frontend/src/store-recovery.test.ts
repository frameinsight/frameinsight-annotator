import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {deleteGeometryRange} from './hidden-range';
import {interpolatePerson} from './interpolation';
import {emptyObservation,type Change,type Domain,type Operation,type Project,type Video} from './types';

const mocks=vi.hoisted(()=>({post:vi.fn(async()=>({})),set:vi.fn(async()=>{})}));
vi.mock('./api',()=>({api:vi.fn(),post:mocks.post}));
vi.mock('idb-keyval',()=>({get:vi.fn(),set:mocks.set,del:vi.fn()}));
let useStore:typeof import('./store').useStore;
const clone=<T,>(value:T):T=>structuredClone(value);
function fixture(){
 const state:Domain={identities:{p:{id:'p',person_id:7,name:'Person 7'}},segments:{s:{id:'s',video_id:'v',identity_uuid:'p',start:0,end:null,status:'verified'}},observations:{},intervals:{},reviews:{},links:{},proposal_reviews:{}};
 for(const frame of [0,10]){const o=emptyObservation('v',frame,'p','s');o.person_visible=[100+frame*10,80,150+frame*10,240];o.person_ext=[95+frame*10,70,160+frame*10,310];o.provenance.person_visible={origin:'manual',proposal_id:null,human_corrected:false};state.observations[o.id]=o;}
 interpolatePerson(state,'v','p');const before=clone(state);deleteGeometryRange(state,'v','p',4,6,20,'person_visible');
 const changes:Change[]=[];for(const collection of Object.keys(before) as (keyof Domain)[])for(const id of new Set([...Object.keys(before[collection]),...Object.keys(state[collection])]))if(JSON.stringify(before[collection][id])!==JSON.stringify(state[collection][id]))changes.push({collection,id,before:before[collection][id]??null,after:state[collection][id]??null});
 const deletion:Operation={id:'deleted',label:'Delete frames',base_revision:0,video_id:'v',frame_index:5,changes};
 const project:Project={id:'project',name:'Recovery test',revision:1,state,classes:['person_visible'],videos:{v:{id:'v',width:640,height:360,frame_count:20,status:'ready'} as Video}};
 return {project,deletion};
}
beforeAll(async()=>{
 vi.stubGlobal('window',{addEventListener:vi.fn(),setTimeout:vi.fn()});
 vi.stubGlobal('localStorage',{getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()});
 vi.stubGlobal('setInterval',vi.fn());
 ({useStore}=await import('./store'));
});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(async()=>{
 if(useStore.getState().pending.length)await useStore.getState().saveNow();
 mocks.post.mockClear();mocks.set.mockClear();const {project}=fixture();
 useStore.setState({project,videoId:'v',frame:5,activeId:'p',geometry:'person_visible',history:[],pending:[],redoStack:[],saveStatus:'Saved',saveError:'',notice:'',hiddenIds:{},frameTimes:{},ready:true});
});
describe('recovery as one saved undoable action',()=>{
 it('previews without writes, saves one operation, and undo/redo restore the exact domain',async()=>{
  const before=clone(useStore.getState().project!);expect(useStore.getState().previewRestoreRange(4,6,'interpolate')).toMatchObject({canRestore:true,restoredBoxes:3,anchorFrames:[3,7]});
  expect(useStore.getState().project).toEqual(before);expect(mocks.post).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();
  expect(useStore.getState().restoreRange(4,6,'interpolate')).toBe(true);expect(useStore.getState().history).toHaveLength(1);expect(useStore.getState().pending).toHaveLength(1);expect(useStore.getState().project!.revision).toBe(before.revision+1);
  const restored=clone(useStore.getState().project!.state);await useStore.getState().saveNow();expect(mocks.post).toHaveBeenCalledTimes(1);expect(useStore.getState().pending).toHaveLength(0);
  useStore.getState().undo();await useStore.getState().saveNow();expect(useStore.getState().project!.state).toEqual(before.state);
  useStore.getState().redo();await useStore.getState().saveNow();expect(useStore.getState().project!.state).toEqual(restored);expect(mocks.post).toHaveBeenCalledTimes(3);
 });
 it('recovers from persistent history without adding old operations to local undo',async()=>{
  const {project,deletion}=fixture();useStore.setState({project});const before=clone(project.state);
  expect(useStore.getState().previewRestoreRange(4,6,'original').canRestore).toBe(false);
  expect(useStore.getState().previewRestoreRange(4,6,'original',[deletion]).restoredBoxes).toBe(3);
  expect(useStore.getState().restoreRange(4,6,'original',[deletion])).toBe(true);expect(useStore.getState().history).toHaveLength(1);expect(useStore.getState().history[0].id).not.toBe('deleted');
  await useStore.getState().saveNow();useStore.getState().undo();await useStore.getState().saveNow();expect(useStore.getState().project!.state).toEqual(before);
 });
 it('failed recovery keeps revision, undo and save queue unchanged and K explains the barrier',async()=>{
  const before=clone(useStore.getState().project!);expect(useStore.getState().restoreRange(5,5,'interpolate')).toBe(false);expect(useStore.getState().notice).toContain('outside');
  expect(useStore.getState().project).toEqual(before);expect(useStore.getState().pending).toEqual([]);expect(useStore.getState().history).toEqual([]);
  useStore.getState().fillInterpolation();expect(useStore.getState().notice).toContain('Restore deleted range');expect(Object.values(useStore.getState().project!.state.observations).some(o=>o.frame_index>=4&&o.frame_index<=6&&o.person_visible)).toBe(false);expect(useStore.getState().project!.state.intervals).toEqual(before.state.intervals);await useStore.getState().saveNow();
 });
 it('assigns the smallest unused positive ID while preserving existing IDs and legacy drafts',async()=>{
  const project=clone(useStore.getState().project!);project.state.identities.three={id:'three',person_id:3,name:'Existing'};project.state.identities.draft={id:'draft',person_id:null,name:'Legacy draft'};useStore.setState({project});
  useStore.getState().newPerson();const first=useStore.getState().activeId;expect(useStore.getState().project!.state.identities[first]).toMatchObject({person_id:1,name:'Person 1'});await useStore.getState().saveNow();
  useStore.getState().newPerson();const second=useStore.getState().activeId;expect(useStore.getState().project!.state.identities[second]).toMatchObject({person_id:2,name:'Person 2'});await useStore.getState().saveNow();
  for(const id of ['p','three','draft'])expect(useStore.getState().project!.state.identities[id]).toEqual(project.state.identities[id]);
 });
 it('rejects an oversized recovery without stranding the save queue, then saves a small edit',async()=>{
  const project=clone(useStore.getState().project!);project.videos.v.frame_count=50002;
  project.state.observations=Object.fromEntries(Object.entries(project.state.observations).filter(([,o])=>o.frame_index===0||o.frame_index===10));
  Object.values(project.state.observations).find(o=>o.frame_index===10)!.frame_index=50001;
  const gap=Object.values(project.state.intervals)[0];gap.start=1;gap.end=50000;useStore.setState({project});
  expect(useStore.getState().restoreRange(1,50000,'interpolate')).toBe(false);expect(useStore.getState().notice).toContain('50,000');expect(useStore.getState().project).toEqual(project);expect(useStore.getState().pending).toEqual([]);expect(useStore.getState().history).toEqual([]);expect(mocks.post).not.toHaveBeenCalled();
  useStore.getState().newPerson();await useStore.getState().saveNow();expect(useStore.getState().pending).toEqual([]);expect(useStore.getState().saveStatus).toBe('Saved');expect(mocks.post).toHaveBeenCalledTimes(1);expect(useStore.getState().project!.revision).toBe(project.revision+1);
 });
});
