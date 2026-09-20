import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {Domain,Project,Proposal} from './types';

const io=vi.hoisted(()=>({save:vi.fn().mockResolvedValue(undefined),post:vi.fn().mockResolvedValue({revision:1})}));
vi.mock('idb-keyval',()=>({get:vi.fn().mockResolvedValue(undefined),set:io.save,del:vi.fn().mockResolvedValue(undefined)}));
vi.mock('./api',()=>({api:vi.fn(),post:io.post}));
let useStore:typeof import('./store')['useStore'];
beforeAll(async()=>{
 vi.stubGlobal('window',{addEventListener:vi.fn(),setTimeout:vi.fn(()=>0)});
 vi.stubGlobal('localStorage',{getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()});
 vi.stubGlobal('setInterval',vi.fn(()=>0));
 ({useStore}=await import('./store'));
});
afterAll(()=>vi.unstubAllGlobals());

it('rejects an oversized AI track before queuing or mutating saved state, then still saves a small track',async()=>{
 const domain:Domain={identities:{},segments:{},observations:{},intervals:{},links:{},reviews:{},proposal_reviews:{}};
 const project:Project={id:'limit-test',name:'Limit safety',revision:0,classes:['person_visible'],class_colors:{person_visible:'#22d3ee'},state:domain,videos:{v:{id:'v',name:'long-video.mp4',width:640,height:360,frame_count:60000,nominal_fps:30,status:'ready',source_hash:'test',stream_index:0,session:'test'}}};
 useStore.setState({project,videoId:'v',frame:0,activeId:'',geometry:'person_visible',pending:[],history:[],redoStack:[],saveStatus:'Saved',saveError:'',notice:''});
 const detection=(frame:number):Proposal=>({id:`detection-${frame}`,video_id:'v',frame_index:frame,geometry:'person_visible',box:[100,80,180,240],confidence:.9,class_name:'person',cache_key:'pass',track_id:'track'});
 // 49,999 observations + one identity + one segment = 50,001 changes.
 const oversized=Array.from({length:49999},(_,frame)=>detection(frame));
 expect(useStore.getState().acceptTrack(oversized,null,'person_visible')).toBe(false);
 const rejected=useStore.getState();expect(rejected.project).toBe(project);expect(rejected.project!.revision).toBe(0);expect(rejected.project!.state).toEqual(domain);expect(rejected.pending).toEqual([]);expect(rejected.history).toEqual([]);expect(rejected.redoStack).toEqual([]);expect(rejected.saveStatus).toBe('Saved');expect(rejected.notice).toContain('50,000');expect(io.save).not.toHaveBeenCalled();expect(io.post).not.toHaveBeenCalled();
 expect(useStore.getState().acceptTrack([detection(50),detection(51)],null,'person_visible')).toBe(true);
 const queued=useStore.getState();expect(queued.project!.revision).toBe(1);expect(queued.pending).toHaveLength(1);expect(queued.history).toHaveLength(1);expect(queued.pending[0].changes).toHaveLength(4);expect(Object.values(queued.project!.state.observations).map(o=>o.frame_index)).toEqual([50,51]);
 await useStore.getState().saveNow();expect(useStore.getState().pending).toEqual([]);expect(useStore.getState().saveStatus).toBe('Saved');expect(io.post).toHaveBeenCalledTimes(1);expect(io.post.mock.calls[0][0]).toBe('/projects/limit-test/operations');expect(io.post.mock.calls[0][1].changes).toHaveLength(4);
},15000);
