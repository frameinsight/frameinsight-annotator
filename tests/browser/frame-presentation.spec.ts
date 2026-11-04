import {test,expect,type Page,type APIRequestContext} from '../../frontend/node_modules/@playwright/test';
import {randomUUID} from 'node:crypto';

async function setup(request:APIRequestContext){
 const project=await (await request.post('/api/projects',{data:{name:'Frame presentation '+randomUUID(),classes:['Person']}})).json();
 const {video_id:video}=await (await request.post(`/api/projects/${project.id}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json();
 await expect.poll(async()=>(await(await request.get(`/api/projects/${project.id}`)).json()).videos[video].status).toBe('ready');
 const identity={id:randomUUID(),person_id:1,name:'Track 1',class_name:'Person',color:'#22d3ee',box_styles:{'class:Person':{class_name:'Person',color:'#22d3ee'}}};
 const segment={id:randomUUID(),video_id:video,identity_uuid:identity.id,start:0,end:null,status:'verified'};
 const observations=Array.from({length:24},(_,frame)=>({id:randomUUID(),video_id:video,frame_index:frame,identity_uuid:identity.id,segment_id:segment.id,person_visible:null,person_ext:null,boxes:{'class:Person':[100+frame*10,80,180+frame*10,260]},full_quality:'unknown',occluded:null,truncated:null,geometry_link:'independent',review_state:'draft',evidence_note:'',provenance:{'class:Person':{origin:'manual',proposal_id:null,human_corrected:true}}}));
 const response=await request.post(`/api/projects/${project.id}/operations`,{data:{id:randomUUID(),base_revision:0,label:'Presentation fixture',video_id:video,frame_index:0,changes:[{collection:'identities',id:identity.id,before:null,after:identity},{collection:'segments',id:segment.id,before:null,after:segment},...observations.map(row=>({collection:'observations',id:row.id,before:null,after:row}))]}});
 expect(response.ok(),await response.text()).toBeTruthy();
 return {project:project.id,video};
}
async function open(page:Page,fixture:Awaited<ReturnType<typeof setup>>){
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByTestId('open-project-'+fixture.project).click();await page.getByTestId('open-video-'+fixture.video).click();
 await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
 await page.getByRole('button',{name:'Select Track 1',exact:true}).click();
}
async function pixels(page:Page){return page.getByTestId('canvas').locator('canvas').evaluateAll(elements=>elements.map(element=>(element as HTMLCanvasElement).toDataURL()));}
async function point(page:Page,x:number,y:number){return page.getByTestId('canvas').evaluate((element,point)=>{const r=element.getBoundingClientRect(),scale=Number(element.getAttribute('data-scale'));return {x:r.x+Number(element.getAttribute('data-offset-x'))+point.x*scale,y:r.y+Number(element.getAttribute('data-offset-y'))+point.y*scale};},{x,y});}

test('slow and failed frames retain their complete previous pixels and overlays without allowing edits',async({page,request})=>{
 const fixture=await setup(request);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/videos/${fixture.video}/frames/10`,async route=>{await gate;await route.continue().catch(()=>{});});
 let attempts=0;
 await page.route(`**/api/videos/${fixture.video}/frames/14`,route=>++attempts===1?route.fulfill({status:503,body:'Temporarily unavailable'}):route.continue());
 await open(page,fixture);
 const canvas=page.getByTestId('canvas'),before=await(await request.get(`/api/projects/${fixture.project}`)).json();
 const initial=await pixels(page),labels=await canvas.getAttribute('data-labels');expect(initial.length).toBeGreaterThanOrEqual(2);
 const projectRequests:string[]=[];page.on('request',req=>{if(new URL(req.url()).pathname===`/api/projects/${fixture.project}`&&req.method()==='GET')projectRequests.push(req.url());});
 try{
  await page.getByLabel('Go to frame',{exact:true}).fill('10');
  await expect(canvas).toHaveAttribute('data-buffering','true');await expect(canvas).toHaveAttribute('data-displayed-frame','0');
  expect(await pixels(page)).toEqual(initial);expect(await canvas.getAttribute('data-labels')).toBe(labels);
  await expect(canvas.locator('.canvas-loading')).toHaveCount(0);await expect(canvas).toContainText('Showing frame 0');
  const start=await point(page,140,170),end=await point(page,190,170);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();
  await canvas.press('Delete');await page.mouse.click(start.x,start.y,{button:'right'});await expect(page.getByRole('menu')).toHaveCount(0);
  expect((await(await request.get(`/api/projects/${fixture.project}`)).json()).state).toEqual(before.state);
  release();await expect(canvas).toHaveAttribute('data-frame','10');await expect(canvas).toHaveAttribute('data-buffering','false');
  expect(await pixels(page)).not.toEqual(initial);expect(await canvas.getAttribute('data-labels')).not.toBe(labels);
  const current=await pixels(page),currentLabels=await canvas.getAttribute('data-labels');
  await page.getByLabel('Go to frame',{exact:true}).fill('14');await expect(page.getByRole('button',{name:'Retry frame',exact:true})).toBeVisible();
  await expect(canvas).toHaveAttribute('data-displayed-frame','10');expect(await pixels(page)).toEqual(current);expect(await canvas.getAttribute('data-labels')).toBe(currentLabels);
  await page.getByRole('button',{name:'Retry frame',exact:true}).click();await expect(canvas).toHaveAttribute('data-frame','14');expect(attempts).toBe(2);
  expect((await(await request.get(`/api/projects/${fixture.project}`)).json()).state).toEqual(before.state);
  expect(projectRequests).toEqual([]);
 }finally{release();}
});

test('a late abandoned response cannot replace the newer requested frame or its annotations',async({page,request})=>{
 const fixture=await setup(request);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/videos/${fixture.video}/frames/10`,async route=>{await gate;await route.continue().catch(()=>{});});
 await open(page,fixture);const canvas=page.getByTestId('canvas');
 try{
  await page.getByLabel('Go to frame',{exact:true}).fill('10');await expect(canvas).toHaveAttribute('data-buffering','true');
  await page.getByLabel('Go to frame',{exact:true}).fill('18');await expect(canvas).toHaveAttribute('data-frame','18');const current=await pixels(page),labels=await canvas.getAttribute('data-labels');
  const received=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/videos/${fixture.video}/frames/10`);release();await received;
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(canvas).toHaveAttribute('data-displayed-frame','18');expect(await pixels(page)).toEqual(current);expect(await canvas.getAttribute('data-labels')).toBe(labels);
 }finally{release();}
});

test('single-video playback never clears its canvas while slow next frames are decoding',async({page,request},testInfo)=>{
 const fixture=await setup(request);
 await page.route(`**/api/videos/${fixture.video}/frames/*`,async route=>{await new Promise(resolve=>setTimeout(resolve,180));await route.continue().catch(()=>{});});
 await open(page,fixture);const canvas=page.getByTestId('canvas');
 await page.evaluate(()=>{
  const result={frames:[] as number[],blank:0,buffered:0};(window as any).__presentation=result;
  const sample=()=>{const host=document.querySelector<HTMLElement>('[data-testid=canvas]');if(host){if(host.querySelectorAll('canvas').length<2)result.blank++;if(host.dataset.buffering==='true')result.buffered++;const frame=Number(host.dataset.displayedFrame);if(!result.frames.includes(frame))result.frames.push(frame);}(window as any).__presentationRaf=requestAnimationFrame(sample);};sample();
 });
 await page.getByLabel('Playback speed',{exact:true}).click();await page.getByRole('option',{name:'1×',exact:true}).click();
 await page.getByRole('button',{name:'Play',exact:true}).click();await expect(canvas).toHaveAttribute('data-frame','23',{timeout:20000});
 const result=await page.evaluate(()=>{cancelAnimationFrame((window as any).__presentationRaf);return (window as any).__presentation;});
 await testInfo.attach('presentation-under-slow-frames',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result.frames).toEqual(Array.from({length:24},(_,frame)=>frame));expect(result.blank).toBe(0);expect(result.buffered).toBeGreaterThan(0);
});

test('passive cameras keep the decoded image and its own frame overlays together until the next slot is ready',async({page,request})=>{
 const fixture=await setup(request);
 const {video_id:second}=await(await request.post(`/api/projects/${fixture.project}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json();
 await expect.poll(async()=>(await(await request.get(`/api/projects/${fixture.project}`)).json()).videos[second].status).toBe('ready');
 const state=await(await request.get(`/api/projects/${fixture.project}`)).json();
 const oldIdentity:any=Object.values(state.state.identities)[0],oldSegment:any=Object.values(state.state.segments)[0];
 const identity={...oldIdentity,id:randomUUID()},segment={...oldSegment,id:randomUUID(),video_id:second,identity_uuid:identity.id};
 const rows=Object.values(state.state.observations).map((row:any)=>({...row,id:randomUUID(),video_id:second,identity_uuid:identity.id,segment_id:segment.id}));
 const response=await request.post(`/api/projects/${fixture.project}/operations`,{data:{id:randomUUID(),base_revision:state.revision,label:'Passive presentation fixture',video_id:second,frame_index:0,changes:[{collection:'identities',id:identity.id,before:null,after:identity},{collection:'segments',id:segment.id,before:null,after:segment},...rows.map(row=>({collection:'observations',id:row.id,before:null,after:row}))]}});expect(response.ok(),await response.text()).toBeTruthy();
 const cameras=[fixture.video,second].map((video_id,index)=>({id:randomUUID(),name:`Camera ${index+1}`,video_id,offset_seconds:0}));
 const session=await(await request.post(`/api/projects/${fixture.project}/camera-sessions`,{data:{name:'Slow passive camera',cameras}})).json();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route(`**/api/videos/${second}/frames/10`,async route=>{await gate;await route.continue().catch(()=>{});});
 await page.goto('/');await page.getByTestId('open-project-'+fixture.project).click();await page.getByTestId('open-session-'+session.id).click();
 const passive=page.getByTestId('camera-tile-'+cameras[1].id).locator('.mc-preview');
 await expect(passive).toHaveAttribute('data-frame','0');const layer=passive.locator('.mc-frame-layer:not([hidden])');
 const source=await layer.locator('img').getAttribute('src'),box=layer.locator('.mc-preview-box > rect').first();
 await expect(box).toHaveAttribute('x','100');
 try{
  await page.getByLabel('Active camera frame',{exact:true}).fill('10');await expect(passive).toHaveAttribute('data-buffering','true');
  await expect(passive).toHaveAttribute('data-displayed-frame','0');await expect(layer.locator('img')).toHaveAttribute('src',source!);await expect(box).toHaveAttribute('x','100');
  await expect(passive.locator('.mc-frame-layer')).toHaveCount(2);await expect(layer.locator('.mc-preview-box')).toHaveAttribute('aria-disabled','true');
  await layer.locator('.mc-preview-box').click({force:true});await expect(page.getByTestId('camera-tile-'+cameras[0].id)).toHaveClass(/is-active/);
  release();await expect(passive).toHaveAttribute('data-frame','10');await expect(layer.locator('img')).toHaveAttribute('src',new RegExp('/frames/10$'));await expect(box).toHaveAttribute('x','200');await expect(passive.locator('.mc-frame-layer')).toHaveCount(1);
 }finally{release();}
});
