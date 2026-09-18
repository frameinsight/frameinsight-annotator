import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';
import path from 'node:path';
let projectId:string,videoId:string;
async function state(request:any){return (await request.get(`/api/projects/${projectId}`)).json()}
async function drag(page:Page,a:number[],b:number[]){const v=await page.getByTestId('canvas').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+Number(e.getAttribute('data-offset-x')),y:r.y+Number(e.getAttribute('data-offset-y')),s:Number(e.getAttribute('data-scale'))}});await page.mouse.move(v.x+a[0]*v.s,v.y+a[1]*v.s);await page.mouse.down();await page.mouse.move(v.x+b[0]*v.s,v.y+b[1]*v.s,{steps:8});await page.mouse.up()}
async function saved(page:Page){await expect(page.locator('.save-status')).toHaveText('Saved')}
async function ready(page:Page,f:number){await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame',String(f))}
async function reopen(page:Page){await page.reload();await expect(page.getByRole('heading',{name:'Your videos'})).toBeVisible();await page.getByTestId('open-video-'+videoId).click();}
const obs=(p:any)=>Object.values(p.state.observations) as any[];
const at=(p:any,f:number)=>obs(p).find(o=>o.frame_index===f);
test.beforeEach(async({page,request})=>{
 const r=await request.post('/api/projects',{data:{name:'Browser acceptance '+Date.now(),classes:['Person']}});projectId=(await r.json()).id;
 const v=await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}});videoId=(await v.json()).video_id;
 await expect.poll(async()=> (await state(request)).videos[videoId].status).toBe('ready');
 await page.goto('/');await expect(page.getByRole('heading',{name:'Your videos'})).toBeVisible();await page.getByTestId('open-video-'+videoId).click();await ready(page,0);
});
test('simple workspace, explicit save and keyboard save retain annotations',async({page,request})=>{
 for(const name of ['Export','Manual ready','Visible person','Configure detector','Review / reject suggestions','New project'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(page.getByText('USEFUL SHORTCUTS',{exact:true})).toBeVisible();await page.getByTestId('canvas').press('n');await drag(page,[100,80],[220,310]);await page.getByRole('button',{name:'Save',exact:true}).click();await saved(page);
 let p=await state(request);expect(obs(p)).toHaveLength(1);expect(obs(p)[0].person_visible[0]).toBeCloseTo(100,0);expect(obs(p)[0].person_ext).toBeNull();
 await page.getByTestId('canvas').press('Control+s');await saved(page);expect((await state(request)).revision).toBe(p.revision);
 await reopen(page);await ready(page,0);expect((await state(request)).state).toEqual(p.state);
});
test('new video collects classes before uploading and opens editor',async({page,request})=>{
 await page.getByRole('button',{name:'New video',exact:true}).click();await expect(page.getByLabel('Upload video')).toHaveCount(0);
 await page.getByLabel('Number of classes').fill('2');await page.getByLabel('Class 1',{exact:true}).fill('person_visible');await page.getByLabel('Class 2',{exact:true}).fill('person_extended');await page.getByRole('button',{name:'Continue to upload'}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/videos')&&r.request().method()==='POST');
 await page.getByLabel('Upload video').setInputFiles(path.resolve('../tests/fixtures/numbered.mp4'));
 const result=await (await response).json();videoId=result.video_id;await ready(page,0);
 const library=await (await request.get('/api/video-library')).json();projectId=library.find((v:any)=>v.id===videoId).project_id;
 expect((await state(request)).classes).toEqual(['person_visible','person_extended']);
 await page.getByTestId('canvas').press('n');await page.keyboard.press('i');await expect(page.getByLabel('Class name',{exact:true})).toHaveValue('person_visible');await page.getByLabel('Class name',{exact:true}).fill('Visitor');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);expect((await state(request)).classes).toContain('Visitor');
});
test('reuse later ID before earlier frame; class, color, interpolation and undo persist',async({page,request})=>{
 await page.getByLabel('Go to frame').fill('20');await ready(page,20);await page.getByTestId('canvas').press('n');await drag(page,[200,80],[300,300]);await page.keyboard.press('i');await page.getByLabel('Person ID',{exact:true}).fill('7');await page.getByLabel('Class name',{exact:true}).fill('Worker');await page.getByLabel('Box color',{exact:true}).fill('#ff7700');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 const original=Object.keys((await state(request)).state.identities)[0];await page.getByLabel('Go to frame').fill('5');await ready(page,5);await page.getByTestId('canvas').press('n');await drag(page,[110,80],[210,300]);await saved(page);const before=(await state(request)).state;
 await page.keyboard.press('i');await page.getByLabel('Existing person ID').selectOption(original);await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 let p=await state(request);expect(Object.keys(p.state.identities)).toEqual([original]);expect(p.state.identities[original]).toMatchObject({person_id:7,class_name:'Worker',color:'#ff7700'});expect(obs(p)).toHaveLength(16);expect(at(p,10).person_visible[0]).toBeCloseTo(140,0);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.keyboard.press('Control+Shift+z');await saved(page);await reopen(page);await ready(page,5);await page.getByTestId('canvas').press('i');await expect(page.getByLabel('Box color')).toHaveValue('#ff7700');
});
test('keyframes interpolate, correction changes neighbors, undo restores and gaps remain empty',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[200,300]);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[200,80],[300,300]);await saved(page);expect(obs(await state(request))).toHaveLength(11);
 await page.getByLabel('Go to frame').fill('5');await ready(page,5);await drag(page,[200,190],[220,190]);await saved(page);let p=await state(request);expect(at(p,5).provenance.person_visible.human_corrected).toBe(true);expect(at(p,5).person_visible[0]).toBeCloseTo(170,0);expect(at(p,3).person_visible[0]).toBeCloseTo(142,0);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect(at(await state(request),5).person_visible[0]).toBeCloseTo(150,0);
 await page.getByLabel('Go to frame').fill('11');await ready(page,11);await page.getByTestId('canvas').press('g');await page.getByRole('button',{name:'Start gap at frame 11'}).click();await saved(page);
 await page.getByLabel('Go to frame').fill('15');await ready(page,15);await page.getByTestId('canvas').press('h');await page.getByLabel('Evidence for this decision').fill('Same person returning');await page.getByRole('button',{name:'Start visible segment'}).click();await drag(page,[210,80],[310,300]);await saved(page);p=await state(request);expect(obs(p).some(o=>o.frame_index>=11&&o.frame_index<15)).toBe(false);
});
test('eye and focus preserve work, delete can be cancelled or undone',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[200,300]);await page.keyboard.press('n');await drag(page,[130,90],[230,310]);await saved(page);const before=await state(request);
 await page.getByRole('button',{name:'Focus Person 2',exact:true}).click();await expect(page.getByRole('button',{name:'Show Person 1',exact:true})).toBeVisible();await reopen(page);await ready(page,0);await expect(page.getByRole('button',{name:'Show Person 1',exact:true})).toBeVisible();expect((await state(request)).state).toEqual(before.state);
 await page.getByRole('button',{name:'Show all people'}).click();await page.getByRole('button',{name:'Delete Person 1',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await state(request)).state).toEqual(before.state);
 await page.getByRole('button',{name:'Delete Person 1',exact:true}).click();await page.getByRole('button',{name:'Delete person and annotations'}).click();await saved(page);expect(Object.keys((await state(request)).state.identities)).toHaveLength(1);await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before.state);
});
test('finish asks confirmation, exports annotations only, and edits reopen finished work',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[200,300]);await page.getByRole('button',{name:'Finish',exact:true}).click();await expect(page.getByRole('button',{name:'Finish & choose export'})).toBeDisabled();await page.getByLabel('Every person annotated and tracked').check();await page.getByRole('button',{name:'Finish & choose export'}).click();await expect(page.getByLabel('Export format')).toHaveValue('annotations_json');await page.getByRole('button',{name:'Prepare download'}).click();
 const link=page.getByRole('link',{name:'Download annotations (.json)'});await expect(link).toBeVisible();const doc=await (await request.get((await link.getAttribute('href'))!)).json();expect(doc.video_scope).toBe(videoId);expect(doc.media_included).toBe(false);expect(doc.annotation_index).toHaveLength(1);expect(doc.state.reviews).toEqual({});
 await page.getByRole('button',{name:'Back to videos'}).click();await expect(page.getByTestId('open-video-'+videoId)).toContainText('Finished');await page.getByTestId('open-video-'+videoId).click();await ready(page,0);await drag(page,[150,190],[160,190]);await saved(page);await page.getByRole('button',{name:'All videos',exact:true}).click();await expect(page.getByTestId('open-video-'+videoId)).toContainText('In progress');
});
test('offline edits are retained and Save retries after reconnect',async({page,request,context})=>{
 await page.getByTestId('canvas').press('n');await saved(page);await context.setOffline(true);await drag(page,[100,80],[200,300]);await expect(page.locator('.save-status')).toHaveText('Save failed');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.save-status')).toHaveText('Save failed');await context.setOffline(false);await page.getByRole('button',{name:'Save',exact:true}).click();await saved(page);expect(obs(await state(request))).toHaveLength(1);
});
test('navigation during drag commits on its original frame and cursor survives reopening',async({page,request})=>{
 await page.getByTestId('canvas').press('n');const v=await page.getByTestId('canvas').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+Number(e.getAttribute('data-offset-x')),y:r.y+Number(e.getAttribute('data-offset-y')),s:Number(e.getAttribute('data-scale'))}});await page.mouse.move(v.x+100*v.s,v.y+80*v.s);await page.mouse.down();await page.mouse.move(v.x+200*v.s,v.y+300*v.s);await page.keyboard.press('f');await page.mouse.up();await ready(page,1);await saved(page);expect(obs(await state(request))[0].frame_index).toBe(0);const before=await state(request);await reopen(page);await ready(page,1);expect((await state(request)).state).toEqual(before.state);
});
test('hidden range deletes interpolated boxes, preserves other people, and survives undo, redo, export and reload',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[200,300]);await page.getByLabel('Go to frame').fill('20');await ready(page,20);await drag(page,[200,80],[300,300]);await saved(page);
 const who=Object.keys((await state(request)).state.identities)[0];
 await page.getByLabel('Go to frame').fill('10');await ready(page,10);await page.getByTestId('canvas').press('n');await drag(page,[350,80],[450,300]);await saved(page);await page.locator('.person').filter({hasText:'Person 1'}).click();
 const before=(await state(request)).state;
 await page.getByRole('button',{name:'Mark hidden range',exact:true}).first().click();await page.getByLabel('First hidden frame').fill('8');await page.getByLabel('Last hidden frame').fill('12');await expect(page.getByRole('dialog')).toContainText('5 boxes');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await state(request)).state).toEqual(before);
 await page.getByTestId('canvas').press('Shift+g');await page.getByLabel('First hidden frame').fill('8');await page.getByLabel('Last hidden frame').fill('12');await page.getByRole('button',{name:'Delete boxes & mark hidden'}).click();await saved(page);
 let p=await state(request);const gap=Object.values(p.state.intervals) as any[];expect(gap).toMatchObject([{identity_uuid:who,start:8,end:12}]);expect(obs(p).filter(o=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);expect(obs(p).filter(o=>o.identity_uuid!==who)).toHaveLength(1);await expect(page.locator('.gap-banner')).toContainText('Hidden frames 8–12');
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.keyboard.press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(p.state);
 await page.getByRole('button',{name:'Go to frame 13',exact:true}).click();await ready(page,13);await drag(page,[215,190],[225,190]);await saved(page);await page.getByTestId('canvas').press('k');await saved(page);p=await state(request);expect(obs(p).filter(o=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);expect(obs(p).find(o=>o.identity_uuid===who&&o.frame_index===16)!.person_visible[0]).toBeGreaterThan(180);
 await reopen(page);await ready(page,13);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await expect(page.locator('.gap-banner')).toContainText('Hidden frames 8–12');
 const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId}});const job=(await response.json()).id;await expect.poll(async()=> (await (await request.get('/api/jobs/'+job)).json()).status).toBe('completed');const exportId=(await (await request.get('/api/jobs/'+job)).json()).export_id;const exported=await (await request.get('/api/exports/'+exportId)).json();expect(Object.values(exported.state.intervals)).toMatchObject([{start:8,end:12}]);expect(exported.annotation_index.filter((o:any)=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);
});
