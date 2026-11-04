import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {emptyObservation,type Project,classKey,getBox} from './types';
const mocks=vi.hoisted(()=>({post:vi.fn(async()=>({})),set:vi.fn(async()=>{})}));
vi.mock('./api',()=>({api:vi.fn(),post:mocks.post}));
vi.mock('idb-keyval',()=>({get:vi.fn(),set:mocks.set,del:vi.fn()}));
let useStore:typeof import('./store').useStore;
beforeAll(async()=>{vi.stubGlobal('window',{addEventListener:vi.fn(),setTimeout:vi.fn()});vi.stubGlobal('localStorage',{getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()});vi.stubGlobal('setInterval',vi.fn());({useStore}=await import('./store'));});
afterAll(()=>vi.unstubAllGlobals());
export function largeProject():Project{
 const project:Project={id:'performance',name:'Large project',revision:0,classes:['Person'],videos:{v:{id:'v',name:'test.mp4',width:1920,height:1080,frame_count:2030,nominal_fps:30,status:'ready',source_hash:'test',stream_index:0,session:''}},state:{identities:{},observations:{},segments:{},intervals:{},reviews:{},links:{},proposal_reviews:{}}};
 for(let t=0;t<20;t++){
  const id='track'+t,seg='segment'+t;project.state.identities[id]={id,person_id:t+1,name:'Track '+(t+1),class_name:'Person',box_styles:{'class:Person':{class_name:'Person',color:'#38bdf8'}}};project.state.segments[seg]={id:seg,identity_uuid:id,video_id:'v',start:0,end:null,status:'verified'};
  for(let f=0;f<2030;f++){const o=emptyObservation('v',f,id,seg);o.id=id+'-'+f;o.boxes={'class:Person':[100,100,180,280]};o.provenance['class:Person']={origin:f%30===0?'manual':'interpolated',proposal_id:null,human_corrected:false};project.state.observations[o.id]=o;}
 }
 return project;
}
it('successive box adjustments in a 40,600-observation project preserve exact undo and save order',async()=>{
 const project=largeProject();useStore.setState({project,videoId:'v',frame:30,activeId:'track0',geometry:classKey('Person'),pending:[],history:[],redoStack:[],hiddenIds:{},frameTimes:{},saveStatus:'Saved',saveError:'',settingsSaving:false});
 const samples:number[]=[];
 for(const frame of [30,60,90,120,150]){useStore.getState().navigate(frame);const start=performance.now();useStore.getState().setBox('class:Person',[110,100,190,280]);samples.push(performance.now()-start);}
 console.log('40,600 observations; five synchronous box-edit calls (ms):',samples.map(n=>Math.round(n)));
 expect(useStore.getState().history).toHaveLength(5);expect(useStore.getState().pending).toHaveLength(5);
 expect(getBox(useStore.getState().project!.state.observations['track0-45'],'class:Person')).toEqual([110,100,190,280]);
 expect(useStore.getState().project!.state.observations['track19-2029']).toBe(project.state.observations['track19-2029']);
 expect(useStore.getState().project!.state.observations['track0-2000']).toBe(project.state.observations['track0-2000']);
 await useStore.getState().saveNow();expect(mocks.post).toHaveBeenCalledTimes(5);expect(mocks.post.mock.calls.map((args:any[])=>args[1].base_revision)).toEqual([0,1,2,3,4]);
 for(let i=0;i<5;i++)useStore.getState().undo();await useStore.getState().saveNow();expect(useStore.getState().project!.state).toEqual(project.state);
 for(let i=0;i<5;i++)useStore.getState().redo();await useStore.getState().saveNow();expect(getBox(useStore.getState().project!.state.observations['track0-150'],'class:Person')).toEqual([110,100,190,280]);
},30000);

it('keeps a pending journal snapshot immutable across subsequent edits and undo/redo',async()=>{
 const project=largeProject();project.state.observations=Object.fromEntries(Object.entries(project.state.observations).filter(([,o])=>o.identity_uuid==='track0'&&o.frame_index<61));
 useStore.setState({project,videoId:'v',frame:30,activeId:'track0',geometry:'class:Person',pending:[],history:[],redoStack:[],hiddenIds:{},frameTimes:{},saveStatus:'Saved',saveError:''});
 let release!:()=>void;mocks.set.mockClear();mocks.post.mockClear();mocks.set.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 useStore.getState().setBox('class:Person',[105,100,185,280]);await vi.waitFor(()=>expect(mocks.set).toHaveBeenCalledTimes(1));
 const captured=(mocks.set.mock.calls[0] as any[])[1],snapshot=structuredClone(captured);
 useStore.getState().navigate(60);useStore.getState().setBox('class:Person',[120,100,200,280]);useStore.getState().undo();useStore.getState().redo();
 expect(captured).toEqual(snapshot);expect(mocks.post).not.toHaveBeenCalled();release();await useStore.getState().saveNow();
 expect(mocks.post.mock.calls.map((args:any[])=>args[1].base_revision)).toEqual([0,1,2,3]);expect(useStore.getState().pending).toEqual([]);
});

it('retains legacy all-class hidden barriers for classes known only in another camera',async()=>{
 const project=largeProject();project.state.identities={p:{id:'p',person_id:1,name:'Person 1',class_name:'Visible'}};project.classes=['Visible','Head'];project.videos.b={...project.videos.v,id:'b'};project.state.segments={a:{id:'a',video_id:'v',identity_uuid:'p',start:0,end:null,status:'verified'},b:{id:'b',video_id:'b',identity_uuid:'p',start:0,end:null,status:'verified'}};project.state.observations={};
 for(const [id,video,frame,geometry] of [['left','v',0,'class:Visible'],['right','v',10,'class:Visible'],['head','b',1,'class:Head']] as const){const row=emptyObservation(video,frame,'p',video==='v'?'a':'b');row.id=id;row.boxes={[geometry]:[100,100,180,280]};row.provenance[geometry]={origin:'manual',proposal_id:null,human_corrected:false};project.state.observations[id]=row;}
 project.state.intervals={gap:{id:'gap',video_id:'v',identity_uuid:'p',start:3,end:8,reason:'unknown',evidence_note:''}};
 useStore.setState({project,videoId:'v',frame:4,activeId:'p',geometry:'class:Visible',pending:[],history:[],redoStack:[],hiddenIds:{},frameTimes:{},saveStatus:'Saved',saveError:''});
 const before=structuredClone(project.state);useStore.getState().setBox('class:Visible',[105,100,185,280]);await useStore.getState().saveNow();
 const after=useStore.getState().project!.state,gaps=Object.values(after.intervals);
 expect(gaps.filter(g=>g.geometry==='class:Head').map(g=>[g.start,g.end])).toEqual([[3,8]]);
 expect(gaps.filter(g=>g.geometry==='class:Visible').map(g=>[g.start,g.end]).sort((a,b)=>a[0]!-b[0]!)).toEqual([[3,3],[5,8]]);
 expect(after.observations.head.boxes).toEqual(before.observations.head.boxes);useStore.getState().undo();await useStore.getState().saveNow();expect(useStore.getState().project!.state).toEqual(before);
});

it('does not bypass duplicate-ID checks when a stale selection crosses to another video',async()=>{
 const project=largeProject();project.state.observations={};project.state.identities={a:{id:'a',person_id:1,name:'A'},b:{id:'b',person_id:1,name:'B'}};project.videos.b={...project.videos.v,id:'b'};project.state.segments={a:{id:'a',video_id:'v',identity_uuid:'a',start:0,end:null,status:'verified'},b:{id:'b',video_id:'b',identity_uuid:'b',start:0,end:null,status:'verified'}};
 useStore.setState({project,videoId:'b',frame:0,activeId:'a',geometry:'class:Person',pending:[],history:[],redoStack:[],hiddenIds:{},frameTimes:{},saveStatus:'Saved',saveError:''});
 useStore.getState().setBox('class:Person',[100,100,180,280]);expect(useStore.getState().project).toBe(project);expect(useStore.getState().notice).toContain('unique');expect(useStore.getState().pending).toEqual([]);
});
