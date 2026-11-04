import {test,expect,type Page,type APIRequestContext} from '../../frontend/node_modules/@playwright/test';
import {randomUUID} from 'node:crypto';
import {selectOption} from './select';

type Setup={pid:string;videos:string[];tracks:string[];cameras:any[];session:any;ledgers:any[][]};
const fail=async(r:any)=>{expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
async function setup(request:APIRequestContext,count=2,seed=true,offsets:number[]=[]):Promise<Setup>{
 const project=await fail(await request.post('/api/projects',{data:{name:'Multi-camera browser '+Date.now(),classes:['Visible','Extended']}}));
 const pid=project.id,videos:string[]=[],tracks:string[]=[],ledgers:any[][]=[];
 for(let i=0;i<count;i++){
  const video=await fail(await request.post(`/api/projects/${pid}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}}));videos.push(video.video_id);
  await expect.poll(async()=>(await(await request.get('/api/projects/'+pid)).json()).videos[video.video_id].status).toBe('ready');
  const ledger=await fail(await request.get(`/api/videos/${video.video_id}/ledger`));ledgers.push(ledger);
  if(seed){const identity=randomUUID(),segment=randomUUID();tracks.push(identity);const current=await fail(await request.get('/api/projects/'+pid));
   const rows=[{collection:'identities',id:identity,before:null,after:{id:identity,person_id:1,name:'Track 1',class_name:'Visible',color:'#22d3ee',box_styles:{'class:Visible':{class_name:'Visible',color:'#22d3ee'}}}},{collection:'segments',id:segment,before:null,after:{id:segment,video_id:video.video_id,identity_uuid:identity,start:0,end:null,status:'verified'}},...ledger.map((_:any,f:number)=>{const id=randomUUID();return {collection:'observations',id,before:null,after:{id,video_id:video.video_id,frame_index:f,identity_uuid:identity,segment_id:segment,person_visible:null,person_ext:null,boxes:{'class:Visible':[100+i*30,80,200+i*30,300]},full_quality:'unknown',occluded:null,truncated:null,geometry_link:'independent',review_state:'draft',evidence_note:'',provenance:{'class:Visible':{origin:'manual',proposal_id:null,human_corrected:true}}}};})];
   await fail(await request.post(`/api/projects/${pid}/operations`,{data:{id:randomUUID(),base_revision:current.revision,label:'Seed camera browser test',video_id:video.video_id,frame_index:0,changes:rows}}));
  }
 }
 const cameras=videos.map((video_id,i)=>({id:randomUUID(),name:`Camera ${i+1}`,video_id,offset_seconds:offsets[i]||0}));
 const session=await fail(await request.post(`/api/projects/${pid}/camera-sessions`,{data:{name:'Room together '+Date.now(),cameras}}));
 return {pid,videos,tracks,cameras,session,ledgers};
}
async function open(page:Page,s:Setup){
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByTestId('open-project-'+s.pid).click();await page.getByTestId('open-session-'+s.session.id).click();await expect(page.getByTestId('multicamera-workspace')).toBeVisible();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
}
async function state(request:APIRequestContext,s:Setup){return fail(await request.get('/api/projects/'+s.pid));}
async function session(request:APIRequestContext,s:Setup){return fail(await request.get('/api/camera-sessions/'+s.session.id));}
async function person(page:Page,id=1){await page.getByRole('button',{name:'New shared person',exact:true}).click();await page.getByLabel('Person ID',{exact:true}).fill(String(id));await page.getByRole('button',{name:'Save person',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function assign(page:Page,track=1,personId=1){await page.getByRole('button',{name:`Assign track ${track} to person`,exact:true}).click();await selectOption(page,'Shared person for track',`Person ${personId}`);await page.getByRole('button',{name:'Save assignment',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}


test('unlinked shared person can be cancelled, deleted, undone and redone without changing annotations',async({page,request})=>{
 const s=await setup(request);await open(page,s);await person(page,8);await person(page,9);const before=await state(request,s);
 await page.getByRole('button',{name:'Delete person 8',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Delete person 8?',exact:true});await expect(dialog).toContainText('not linked to any camera tracks');
 await dialog.getByRole('button',{name:'Keep person',exact:true}).click();expect((await session(request,s)).people.map((p:any)=>p.person_id)).toEqual([8,9]);
 await page.getByRole('button',{name:'Delete person 8',exact:true}).click();await dialog.getByRole('button',{name:'Delete shared person',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect((await session(request,s)).people.map((p:any)=>p.person_id)).toEqual([9]);expect((await state(request,s)).state).toEqual(before.state);
 await page.getByRole('button',{name:'Undo person or camera change',exact:true}).click();await expect(page.getByRole('button',{name:'Delete person 8',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Redo person or camera change',exact:true}).click();await expect(page.getByRole('button',{name:'Delete person 8',exact:true})).toHaveCount(0);
 await open(page,s);await expect(page.getByRole('button',{name:'Delete person 9',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Delete person 8',exact:true})).toHaveCount(0);expect((await state(request,s)).state).toEqual(before.state);
});

test('linked shared person deletion confirms unlinking and preserves all camera tracks and boxes',async({page,request})=>{
 const s=await setup(request);await open(page,s);await person(page,7);await assign(page,1,7);
 await page.getByTestId('camera-tile-'+s.cameras[1].id).getByRole('button',{name:'Camera 2',exact:true}).click();await assign(page,1,7);
 const before=await state(request,s),linked=await session(request,s);await page.getByRole('button',{name:'Focus person 7',exact:true}).click();
 await page.getByRole('button',{name:'Delete person 7',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete person 7?',exact:true});
 await expect(dialog).toContainText('unlink 2 tracks across 2 cameras');await expect(dialog).toContainText('All camera tracks, local track IDs, and annotation boxes are kept');
 await dialog.getByRole('button',{name:'Delete shared person',exact:true}).click();await expect(dialog).toHaveCount(0);
 const deleted=await session(request,s);expect(deleted.people).toEqual([]);expect(deleted.assignments).toEqual([]);expect((await state(request,s)).state).toEqual(before.state);
 await expect(page.getByRole('button',{name:'Show everyone',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Select local track 1',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Unlink track 1',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Undo person or camera change',exact:true}).click();await expect.poll(async()=>(await session(request,s)).assignments).toEqual(linked.assignments);expect((await state(request,s)).state).toEqual(before.state);
});

test('person deletion rejects a stale confirmation rather than unlinking newly assigned tracks',async({page,request})=>{
 const s=await setup(request);await open(page,s);await person(page,3);await page.getByRole('button',{name:'Delete person 3',exact:true}).click();
 const current=await session(request,s),{name,cameras,people,revision}=current;const assignments=[{video_id:s.videos[0],identity_uuid:s.tracks[0],person_uuid:people[0].id}];
 await fail(await request.patch('/api/camera-sessions/'+current.id,{data:{name,cameras,people,revision,assignments}}));
 const dialog=page.getByRole('dialog',{name:'Delete person 3?',exact:true});await dialog.getByRole('button',{name:'Delete shared person',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('changed in another window');
 const saved=await session(request,s);expect(saved.people).toEqual(people);expect(saved.assignments).toEqual(assignments);
 await dialog.getByRole('button',{name:'Keep person',exact:true}).click();await page.getByRole('button',{name:'Delete person 3',exact:true}).click();await expect(dialog).toContainText('unlink 1 track across 1 camera');
});

test('failed shared person deletion remains retryable and blocks other deletions until resolved',async({page,request})=>{
 const s=await setup(request);await open(page,s);await person(page,2);await person(page,3);const before=await state(request,s);
 const updates='**/api/camera-sessions/'+s.session.id;await page.route(updates,route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{detail:'Temporary session outage'}}):route.continue());
 await page.getByRole('button',{name:'Delete person 2',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete person 2?',exact:true});await dialog.getByRole('button',{name:'Delete shared person',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Temporary session outage');expect((await session(request,s)).people.map((p:any)=>p.person_id)).toEqual([2,3]);
 await expect(page.getByRole('button',{name:'Delete person 3',exact:true,includeHidden:true})).toBeDisabled();await page.unroute(updates);await dialog.getByRole('button',{name:'Retry failed save',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect((await session(request,s)).people.map((p:any)=>p.person_id)).toEqual([3]);expect((await state(request,s)).state).toEqual(before.state);
});
