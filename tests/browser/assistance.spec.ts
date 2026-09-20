import {test,expect,type Page,type APIRequestContext} from '../../frontend/node_modules/@playwright/test';

let projectId:string,videoId:string;
const state=async(request:APIRequestContext)=>(await request.get(`/api/projects/${projectId}`)).json();
const observations=(p:any)=>Object.values(p.state.observations) as any[];
const at=(p:any,f:number)=>observations(p).find(o=>o.frame_index===f);
const saved=async(page:Page)=>expect(page.locator('.save-status')).toHaveText('Saved');
async function ready(page:Page,frame:number){await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame',String(frame));}
async function go(page:Page,frame:number){await page.getByLabel('Go to frame').fill(String(frame));await ready(page,frame);}
async function point(page:Page,x:number,y:number){return page.getByTestId('canvas').evaluate((e,p)=>{const r=e.getBoundingClientRect();return {x:r.x+Number(e.getAttribute('data-offset-x'))+p.x*Number(e.getAttribute('data-scale')),y:r.y+Number(e.getAttribute('data-offset-y'))+p.y*Number(e.getAttribute('data-scale'))}},{x,y});}
async function clickBox(page:Page,x:number,y:number){const p=await point(page,x,y);await page.mouse.click(p.x,p.y);}
async function drag(page:Page,a:number[],b:number[]){const from=await point(page,a[0],a[1]),to=await point(page,b[0],b[1]);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();}
async function reopen(page:Page){await page.reload();await page.getByTestId('open-video-'+videoId).click();}
function proposal(frame:number,track='1',confidence=.95){return {id:`suggestion-${track}-${frame}`,video_id:videoId,frame_index:frame,geometry:'person_visible',box:track==='2'?[340+frame,80,420+frame,240]:[100+frame*4,80,180+frame*4,240],confidence,class_name:'person',cache_key:'browser-track-pass',track_id:track};}
async function mockTracks(page:Page,rows:ReturnType<typeof proposal>[]){
 // Only inference results are mocked. Adoption, save, undo, export and import use
 // the real backend so the test exercises the actual annotation contract.
 await page.route('**/api/assist/status',route=>route.fulfill({json:{available:true,gpu:'Test GPU',default_model:'test.pt',models:[{name:'test.pt',installed:true}],trackers:['botsort']}}));
 await page.route(`**/api/videos/${videoId}/tracks*`,route=>{
  const tracks=[...new Set(rows.map(p=>p.track_id))].map(id=>{const items=rows.filter(p=>p.track_id===id);return {id,start:Math.min(...items.map(p=>p.frame_index)),end:Math.max(...items.map(p=>p.frame_index)),count:items.length,issues:[]};});
  return route.fulfill({json:{cache_key:'browser-track-pass',tracks,complete:true,status:'completed',processed_frames:24,total_frames:24}});
 });
 await page.route(`**/api/videos/${videoId}/tracks/*`,route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);return route.fulfill({json:{cache_key:'browser-track-pass',track_id:id,proposals:rows.filter(p=>p.track_id===id),complete:true}});});
 await page.route(`**/api/videos/${videoId}/proposals?*`,route=>{const url=new URL(route.request().url()),frame=Number(url.searchParams.get('start'));return route.fulfill({json:rows.filter(p=>p.frame_index===frame)});});
}
async function open(page:Page,rows:ReturnType<typeof proposal>[]){await mockTracks(page,rows);await page.goto('/');await page.getByTestId('open-video-'+videoId).click();await ready(page,0);await expect(page.getByRole('tab',{name:'AI assistance',exact:true})).toHaveAttribute('aria-selected','true');}
async function exported(request:APIRequestContext){const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId}});expect(response.ok()).toBe(true);const job=(await response.json()).id;await expect.poll(async()=>(await(await request.get('/api/jobs/'+job)).json()).status).toBe('completed');const done=await(await request.get('/api/jobs/'+job)).json();return(await request.get('/api/exports/'+done.export_id)).json();}
async function file(page:Page,doc:any){await page.getByLabel('Annotations JSON',{exact:true}).setInputFiles({name:'own-export.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});}
test.beforeEach(async({request})=>{
 projectId=(await(await request.post('/api/projects',{data:{name:'Assistance acceptance '+Date.now(),classes:['person_visible','person_extended']}})).json()).id;
 videoId=(await(await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await state(request)).videos[videoId].status).toBe('ready');
});

test('confidence and canvas selection only affect suggestions, not annotations',async({page,request})=>{
 await open(page,[proposal(0),proposal(0,'2',.4)]);const suggestions=page.getByLabel('Suggestions on this frame'),before=await state(request);
 await expect(suggestions.getByRole('button')).toHaveCount(2);await clickBox(page,150,150);await expect(suggestions.getByRole('button',{name:'Track 1 95%'})).toHaveAttribute('aria-pressed','true');
 expect((await state(request)).state).toEqual(before.state);expect((await state(request)).revision).toBe(before.revision);
 await page.getByRole('slider',{name:'Display confidence'}).fill('80');await expect(suggestions.getByRole('button')).toHaveCount(1);await expect(suggestions).not.toContainText('Track 2');
 await page.getByLabel('Show AI suggestions').uncheck();await page.getByLabel('Show AI suggestions').check();await page.getByRole('tab',{name:'Shortcuts',exact:true}).click();await expect(page.getByText('USEFUL SHORTCUTS',{exact:true})).toBeVisible();await page.getByRole('tab',{name:'AI assistance',exact:true}).click();
 await page.getByRole('slider',{name:'Display confidence'}).fill('10');await expect(suggestions.getByRole('button')).toHaveCount(2);expect((await state(request)).state).toEqual(before.state);expect((await state(request)).revision).toBe(before.revision);
});

test('whole-track adoption includes low confidence, starts late, preserves holes and supports interpolation and atomic undo',async({page,request})=>{
 const frames=[5,6,7,8,9,12,13,14,15];await open(page,frames.map(f=>proposal(f,'1',f===7?.4:.95)));const before=(await state(request)).state;
 await page.getByRole('slider',{name:'Display confidence'}).fill('98');await page.getByLabel('Suggested track').selectOption('1');await ready(page,5);
 const nextIssue=page.getByRole('button',{name:'Next issue (2)',exact:true});await nextIssue.click();await ready(page,7);await nextIssue.click();await ready(page,10);await nextIssue.click();await ready(page,7);await go(page,5);
 await page.getByRole('button',{name:'Use track as new person',exact:true}).click();await saved(page);
 let p=await state(request);expect(observations(p).map(o=>o.frame_index).sort((a,b)=>a-b)).toEqual(frames);expect(Object.keys(p.state.identities)).toHaveLength(1);expect(Object.values(p.state.identities)[0]).toMatchObject({person_id:1});expect(at(p,7).provenance.person_visible.origin).toBe('model_track');expect(at(p,0)).toBeUndefined();expect(at(p,16)).toBeUndefined();expect(Object.values(p.state.intervals)).toMatchObject([{start:10,end:11,geometry:'person_visible',reason:'unavailable'}]);
 const adopted=p.state;await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.getByTestId('canvas').press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(adopted);
 await drag(page,[160,240],[160,260]);await go(page,9);await drag(page,[176,240],[176,300]);await saved(page);p=await state(request);expect(at(p,7).person_visible[3]).toBeCloseTo(280,0);expect(at(p,7).provenance.person_visible.origin).toBe('interpolated');expect(at(p,9).provenance.person_visible.human_corrected).toBe(true);
 await page.getByTestId('canvas').press('k');await saved(page);p=await state(request);expect(at(p,10)).toBeUndefined();expect(at(p,11)).toBeUndefined();
 const persisted=p.state;await reopen(page);await ready(page,9);expect((await state(request)).state).toEqual(persisted);
});

test('individual detection clicks become same-person keyframes and interpolate skipped frames',async({page,request})=>{
 await open(page,[proposal(2),proposal(8)]);await go(page,2);await expect(page.getByLabel('Suggestions on this frame').getByRole('button')).toHaveCount(1);await clickBox(page,148,150);await page.getByRole('button',{name:'Use only this frame',exact:true}).click();await saved(page);
 expect(observations(await state(request))).toHaveLength(1);await go(page,8);await expect(page.getByLabel('Suggestions on this frame').getByRole('button')).toHaveCount(1);await clickBox(page,172,150);await page.getByRole('button',{name:/Use only this frame for Person 1/}).click();await saved(page);
 const p=await state(request);expect(Object.keys(p.state.identities)).toHaveLength(1);expect(observations(p)).toHaveLength(7);expect(at(p,5).person_visible).toEqual([120,80,200,240]);expect(at(p,2).provenance.person_visible.origin).toBe('model');expect(at(p,8).provenance.person_visible.origin).toBe('model');expect(at(p,5).provenance.person_visible.origin).toBe('interpolated');expect(Object.values(p.state.intervals)).toHaveLength(0);expect(at(p,1)).toBeUndefined();
});

test('own annotation JSON previews without writes, imports paired classes, and supports undo, redo and reload',async({page,request})=>{
 await open(page,[]);await page.getByTestId('canvas').press('n');await drag(page,[100,80],[180,240]);await page.getByTestId('canvas').press('i');await page.getByLabel('Person ID',{exact:true}).fill('7');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByTestId('canvas').press('2');await drag(page,[95,75],[185,300]);await saved(page);
 const before=await state(request),doc=await exported(request);expect(doc.media_included).toBe(false);await page.getByRole('button',{name:'Import annotations (.json)',exact:true}).click();await file(page,doc);await expect(page.getByText('Source video matched',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toContainText('1 people · 1 observations · 2 boxes');await expect(page.getByRole('dialog')).toContainText('7 → 1');expect((await state(request)).state).toEqual(before.state);expect((await state(request)).revision).toBe(before.revision);
 await page.getByRole('button',{name:'Import annotations',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);const imported=await state(request);expect(Object.keys(imported.state.identities)).toHaveLength(2);expect(observations(imported)).toHaveLength(2);const original=observations(before)[0],added=observations(imported).find(o=>o.id!==original.id)!;expect(added.person_visible).toEqual(original.person_visible);expect(added.person_ext).toEqual(original.person_ext);expect(imported.state.identities[added.identity_uuid].person_id).toBe(1);expect(imported.state.observations[original.id]).toEqual(original);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before.state);await page.getByTestId('canvas').press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(imported.state);await reopen(page);await ready(page,0);expect((await state(request)).state).toEqual(imported.state);
});

test('a mismatched source hash is rejected before importing any JSON annotation',async({page,request})=>{
 await open(page,[]);await page.getByTestId('canvas').press('n');await drag(page,[100,80],[180,240]);await saved(page);const before=await state(request),doc=await exported(request);doc.videos[videoId].source_hash='0'.repeat(64);
 await page.getByRole('button',{name:'Import annotations (.json)',exact:true}).click();await file(page,doc);await expect(page.getByRole('alert')).toContainText('Source video hash does not match');await expect(page.getByRole('button',{name:'Import annotations',exact:true})).toHaveCount(0);expect((await state(request)).state).toEqual(before.state);expect((await state(request)).revision).toBe(before.revision);
});
