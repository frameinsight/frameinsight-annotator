import {test,expect,type Page,type APIRequestContext} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';

const jsonFile=(name='session.json')=>({name,mimeType:'application/json',buffer:Buffer.from('{}')});
const preview={name:'Imported room',cameras:[{video_id:'source-a',name:'Entrance',video_name:'cam_01.mp4',frame_count:24},{video_id:'source-b',name:'Exit',video_name:'cam_02.mp4',frame_count:24}]};
async function setup(page:Page,request:APIRequestContext){
 const response=await request.post('/api/projects',{data:{name:'Import feedback '+Date.now(),classes:['Person']}});expect(response.ok(),await response.text()).toBeTruthy();const project=await response.json();
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 return {project,open:async()=>{await page.goto('/');await page.getByTestId('open-project-'+project.id).click();await page.getByRole('button',{name:'New video',exact:true}).click();await page.getByRole('button',{name:/^Multiple cameras/}).click();await page.getByTestId('camera-session-import').locator('summary').click();}};
}
function library(pid:string,status='ready'){
 return ['a','b'].map((id,i)=>({id:'local-'+id,project_id:pid,name:`cam_0${i+1}.mp4`,width:640,height:360,frame_count:24,nominal_fps:24,status,source_hash:'test',stream_index:0,session:''}));
}

test('preview failures stay in the JSON import section and a new file clears only the import error',async({page,request})=>{
 const s=await setup(page,request);await page.route('**/api/video-library',route=>route.fulfill({json:library(s.project.id)}));
 await page.route(`**/api/projects/${s.project.id}/camera-sessions`,route=>route.request().method()==='POST'?route.fulfill({status:400,json:{detail:'Camera name must be unique'}}):route.continue());
 let release!:()=>void,requested=false;const gate=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/camera-sessions/import/preview',async route=>{requested=true;await gate;await route.fulfill({status:400,json:{detail:'Annotation JSON is incomplete; export it again.'}})});
 await s.open();const section=page.getByTestId('camera-session-import');
 for(const video of library(s.project.id))await page.getByRole('checkbox',{name:'Use camera video '+video.name+' '+video.id,exact:true}).check();
 await page.getByRole('button',{name:'Create camera session',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Camera name must be unique');
 await page.getByLabel('Multi-camera annotation file',{exact:true}).setInputFiles(jsonFile());
 try{
  await page.getByRole('button',{name:'Read camera list',exact:true}).click();await expect.poll(()=>requested).toBe(true);
  await expect(section.getByRole('button',{name:'Reading camera list…',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Create camera session',exact:true})).toBeDisabled();await expect(page.getByLabel('Multi-camera annotation file',{exact:true})).toBeDisabled();
  release();await expect(section.getByRole('alert')).toHaveText('Annotation JSON is incomplete; export it again.');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(2);
  await page.getByLabel('Multi-camera annotation file',{exact:true}).setInputFiles(jsonFile('corrected-session.json'));
  await expect(section.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Camera name must be unique');await expect(section.getByRole('button',{name:'Read camera list',exact:true})).toBeEnabled();
 }finally{release()}
});

test('camera preview works while videos prepare and import waits for ready, distinct video mappings',async({page,request})=>{
 const s=await setup(page,request);let rows=library(s.project.id,'processing');
 await page.route('**/api/video-library',route=>route.fulfill({json:rows}));await page.route('**/camera-sessions/import/preview',route=>route.fulfill({json:preview}));
 await s.open();const section=page.getByTestId('camera-session-import');await page.getByLabel('Multi-camera annotation file',{exact:true}).setInputFiles(jsonFile());
 await section.getByRole('button',{name:'Read camera list',exact:true}).click();await expect(section.getByRole('status')).toContainText('2 videos are still preparing exact frames');await expect(section.getByRole('combobox',{name:'Match camera Entrance',exact:true})).toBeDisabled();await expect(section.getByRole('button',{name:'Import camera session',exact:true})).toBeDisabled();
 rows=library(s.project.id);rows[1].status='processing';
 await expect(section.getByRole('status')).toContainText('1 video is still preparing exact frames');await expect(section.getByRole('combobox',{name:'Match camera Entrance',exact:true})).toBeEnabled();
 await section.getByRole('combobox',{name:'Match camera Entrance',exact:true}).click();await expect(page.getByRole('option',{name:'cam_02.mp4 · local- · Preparing exact frames…',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
 await selectOption(page,'Match camera Entrance','cam_01.mp4 · local-');await selectOption(page,'Match camera Exit','cam_01.mp4 · local-');await expect(section.getByRole('button',{name:'Import camera session',exact:true})).toBeDisabled();
 rows=library(s.project.id);await expect(section.getByRole('status')).toHaveCount(0);await selectOption(page,'Match camera Exit','cam_02.mp4 · local-');await expect(section.getByRole('button',{name:'Import camera session',exact:true})).toBeEnabled();
 // A cache clear or failed preparation reported by polling invalidates a previous match.
 rows[1]={...rows[1],status:'processing'};await expect(section.getByRole('button',{name:'Import camera session',exact:true})).toBeDisabled();
});

test('import shows progress, preserves backend errors, and remains retryable without rereading the file',async({page,request})=>{
 const s=await setup(page,request);await page.route('**/api/video-library',route=>route.fulfill({json:library(s.project.id)}));await page.route('**/camera-sessions/import/preview',route=>route.fulfill({json:preview}));
 let release!:()=>void,requested=false;const gate=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/camera-sessions/import',async route=>{requested=true;await gate;await route.fulfill({status:409,json:{detail:'Project changed in another window. Read the latest revision and retry.'}})});
 await s.open();const section=page.getByTestId('camera-session-import');await page.getByLabel('Multi-camera annotation file',{exact:true}).setInputFiles(jsonFile());await section.getByRole('button',{name:'Read camera list',exact:true}).click();
 await selectOption(page,'Match camera Entrance','cam_01.mp4 · local-');await selectOption(page,'Match camera Exit','cam_02.mp4 · local-');
 try{
  await section.getByRole('button',{name:'Import camera session',exact:true}).click();await expect.poll(()=>requested).toBe(true);await expect(section.getByRole('button',{name:'Importing camera session…',exact:true})).toBeDisabled();await expect(section.getByRole('combobox',{name:'Match camera Entrance',exact:true})).toBeDisabled();
  release();await expect(section.getByRole('alert')).toHaveText('Project changed in another window. Read the latest revision and retry.');await expect(section.getByRole('button',{name:'Import camera session',exact:true})).toBeEnabled();await expect(section.getByRole('combobox',{name:'Match camera Entrance',exact:true})).toContainText('cam_01.mp4');await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(1);
 }finally{release()}
});

test('a downloaded camera session imports through the UI with boxes and shared IDs intact',async({page,request})=>{
 const s=await setup(page,request);
 const data=async(response:any)=>{expect(response.ok(),await response.text()).toBeTruthy();return response.json()};
 const source=await data(await request.post('/api/projects',{data:{name:'Roundtrip source '+Date.now(),classes:['Person']}}));
 const sourceVideos:string[]=[],targetVideos:string[]=[],identities:string[]=[];
 for(const pid of [source.id,s.project.id])for(let index=0;index<2;index++){
  const video=await data(await request.post(`/api/projects/${pid}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}}));
  (pid===source.id?sourceVideos:targetVideos).push(video.video_id);
  await expect.poll(async()=>(await data(await request.get('/api/projects/'+pid))).videos[video.video_id].status).toBe('ready');
 }
 for(const [index,video_id] of sourceVideos.entries()){
  const identity=crypto.randomUUID(),segment=crypto.randomUUID(),observation=crypto.randomUUID();identities.push(identity);
  const current=await data(await request.get('/api/projects/'+source.id));
  await data(await request.post(`/api/projects/${source.id}/operations`,{data:{id:crypto.randomUUID(),base_revision:current.revision,label:'Roundtrip fixture',video_id,frame_index:0,changes:[
   {collection:'identities',id:identity,before:null,after:{id:identity,person_id:1,name:'Track 1',class_name:'Person',color:'#22d3ee',box_styles:{'class:Person':{class_name:'Person',color:'#22d3ee'}}}},
   {collection:'segments',id:segment,before:null,after:{id:segment,video_id,identity_uuid:identity,start:0,end:null,status:'verified'}},
   {collection:'observations',id:observation,before:null,after:{id:observation,video_id,frame_index:0,identity_uuid:identity,segment_id:segment,person_visible:null,person_ext:null,boxes:{'class:Person':[40+index*20,30,100+index*20,120]},full_quality:'unknown',occluded:null,truncated:null,geometry_link:'independent',review_state:'draft',evidence_note:'',provenance:{'class:Person':{origin:'manual',proposal_id:null,human_corrected:true}}}}
  ]}}));
 }
 const person=crypto.randomUUID(),session=await data(await request.post(`/api/projects/${source.id}/camera-sessions`,{data:{name:'Roundtrip room',cameras:sourceVideos.map((video_id,index)=>({id:crypto.randomUUID(),video_id,name:`Camera ${index+1}`,offset_seconds:0})),people:[{id:person,person_id:17,name:'Person 17',color:'#22d3ee'}],assignments:sourceVideos.map((video_id,index)=>({video_id,identity_uuid:identities[index],person_uuid:person}))}}));
 const before=await data(await request.get('/api/projects/'+source.id));
 await page.goto('/');await page.getByTestId('open-project-'+source.id).click();await page.getByTestId('open-session-'+session.id).click();await expect(page.getByTestId('multicamera-workspace')).toBeVisible();
 await page.getByRole('button',{name:'Export session',exact:true}).click();await page.getByRole('checkbox',{name:'I reviewed the cameras and shared person IDs',exact:true}).check();await page.getByRole('button',{name:'Validate camera session',exact:true}).click();await expect(page.getByTestId('multicam-validation-report')).toContainText('Validation passed. You can export.');await page.getByRole('button',{name:'Prepare camera session JSON',exact:true}).click();
 const link=page.getByRole('link',{name:'Download session JSON',exact:true});await expect(link).toBeVisible();const exported=await request.get((await link.getAttribute('href'))!);expect(exported.ok()).toBeTruthy();const raw=await exported.body();expect(JSON.parse(raw.toString()).session.people[0].person_id).toBe(17);
 await s.open();await page.getByLabel('Multi-camera annotation file',{exact:true}).setInputFiles({name:'room-session.json',mimeType:'application/json',buffer:raw});await page.getByRole('button',{name:'Read camera list',exact:true}).click();
 for(const [index,video_id] of targetVideos.entries())await selectOption(page,`Match camera Camera ${index+1}`,new RegExp(video_id.slice(0,6)));
 await page.getByRole('button',{name:'Import camera session',exact:true}).click();await expect(page.getByTestId('multicamera-workspace')).toBeVisible();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
 const importedSessions=await data(await request.get(`/api/projects/${s.project.id}/camera-sessions`));expect(importedSessions).toHaveLength(1);expect(importedSessions[0].people[0].person_id).toBe(17);expect(importedSessions[0].assignments).toHaveLength(2);expect(new Set(importedSessions[0].assignments.map((assignment:any)=>assignment.person_uuid)).size).toBe(1);
 const restored=await data(await request.get('/api/projects/'+s.project.id));const observations=Object.values(restored.state.observations) as any[];expect(observations).toHaveLength(2);
 for(const [index,video_id] of targetVideos.entries())expect(observations.find(row=>row.video_id===video_id).boxes['class:Person']).toEqual([40+index*20,30,100+index*20,120]);
 expect(Object.values(restored.state.identities).map((identity:any)=>identity.person_id)).toEqual([1,1]);expect((await data(await request.get('/api/projects/'+source.id))).state).toEqual(before.state);
});
