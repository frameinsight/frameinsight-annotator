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
 await page.getByRole('button',{name:'Delete boxes in range',exact:true}).first().click();await page.getByLabel('First frame to delete').fill('8');await page.getByLabel('Last frame to delete').fill('12');await expect(page.getByRole('dialog')).toContainText('5 boxes');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await state(request)).state).toEqual(before);
 await page.getByTestId('canvas').press('Shift+Delete');await page.getByLabel('First frame to delete').fill('8');await page.getByLabel('Last frame to delete').fill('12');await page.getByRole('button',{name:'Delete boxes',exact:true}).click();await saved(page);
 let p=await state(request);const gap=Object.values(p.state.intervals) as any[];expect(gap).toMatchObject([{identity_uuid:who,start:8,end:12}]);expect(obs(p).filter(o=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);expect(obs(p).filter(o=>o.identity_uuid!==who)).toHaveLength(1);await expect(page.locator('.gap-banner')).toContainText('Not visible — no visible box on this frame');
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.keyboard.press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(p.state);
 await page.getByRole('button',{name:'Go to frame 13',exact:true}).click();await ready(page,13);await drag(page,[215,190],[225,190]);await saved(page);await page.getByTestId('canvas').press('k');await saved(page);p=await state(request);expect(obs(p).filter(o=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);expect(obs(p).find(o=>o.identity_uuid===who&&o.frame_index===16)!.person_visible[0]).toBeGreaterThan(180);
 await reopen(page);await ready(page,13);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await expect(page.locator('.gap-banner')).toContainText('Not visible — no visible box on this frame');
 const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId}});const job=(await response.json()).id;await expect.poll(async()=> (await (await request.get('/api/jobs/'+job)).json()).status).toBe('completed');const exportId=(await (await request.get('/api/jobs/'+job)).json()).export_id;const exported=await (await request.get('/api/exports/'+exportId)).json();expect(Object.values(exported.state.intervals)).toMatchObject([{start:8,end:12,reason:'unknown'}]);expect(exported.visibility_intervals.find((r:any)=>r.identity_uuid===who&&r.start===8)).toMatchObject({end:12,status:'not_visible',basis:'explicit_gap',reason:'unknown'});expect(exported.annotation_index.filter((o:any)=>o.identity_uuid===who&&o.frame_index>=8&&o.frame_index<=12)).toHaveLength(0);
});

test('missing boxes are automatically not visible; Delete saves absence and drawing restores it without G or H',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await expect(page.locator('.person').filter({hasText:'Person 1'})).toContainText('Not visible');
 await drag(page,[100,80],[200,300]);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[200,80],[300,300]);await saved(page);
 await page.getByLabel('Go to frame').fill('5');await ready(page,5);
 await page.getByTestId('canvas').press('Delete');await saved(page);let p=await state(request);expect(at(p,5)).toBeUndefined();expect(Object.values(p.state.intervals)).toMatchObject([{start:5,end:5,reason:'unknown'}]);await expect(page.locator('.gap-banner')).toContainText('Not visible');
 await page.getByTestId('canvas').press('k');await saved(page);expect(at(await state(request),5)).toBeUndefined();
 await drag(page,[140,80],[240,300]);await saved(page);p=await state(request);expect(at(p,5).person_visible[0]).toBeCloseTo(140,0);expect(Object.values(p.state.intervals)).toHaveLength(0);await expect(page.locator('.gap-banner')).toHaveCount(0);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect(at(await state(request),5)).toBeUndefined();await expect(page.locator('.gap-banner')).toContainText('Not visible');await page.keyboard.press('Control+Shift+z');await saved(page);expect(at(await state(request),5).person_visible).not.toBeNull();
 await page.getByLabel('Go to frame').fill('15');await ready(page,15);await expect(page.locator('.gap-banner')).toContainText('Not visible');await drag(page,[230,80],[330,300]);await saved(page);expect(at(await state(request),15).person_visible).not.toBeNull();
 await reopen(page);await ready(page,15);await page.getByLabel('Go to frame').fill('23');await ready(page,23);await expect(page.locator('.gap-banner')).toContainText('Not visible');
});
test('video library deletion can be cancelled and removes only the selected video',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[200,300]);await saved(page);
 const second=await request.post('/api/projects',{data:{name:'Keep this video',classes:['Person']}});const otherProject=(await second.json()).id;const added=await request.post(`/api/projects/${otherProject}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}});const otherVideo=(await added.json()).video_id;
 await expect.poll(async()=> (await (await request.get('/api/projects/'+otherProject)).json()).videos[otherVideo].status).toBe('ready');
 await page.getByRole('button',{name:'All videos',exact:true}).click();await page.getByTestId('delete-video-'+videoId).click();await expect(page.getByRole('dialog',{name:'Delete video'})).toContainText('numbered.mp4');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByTestId('open-video-'+videoId)).toBeVisible();
 await page.getByTestId('delete-video-'+videoId).click();await page.getByRole('button',{name:'Delete video and annotations',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByTestId('open-video-'+videoId)).toHaveCount(0);await expect(page.getByTestId('open-video-'+otherVideo)).toBeVisible();expect((await request.get('/api/projects/'+projectId)).status()).toBe(404);
 await page.reload();await expect(page.getByTestId('open-video-'+videoId)).toHaveCount(0);await page.getByTestId('open-video-'+otherVideo).click();await ready(page,0);
});

test('visible and extended boxes share an ID with independent interpolation, deletion, undo and JSON rows',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[120,100],[180,240]);await page.keyboard.press('i');await page.getByLabel('Person ID',{exact:true}).fill('1');await page.getByLabel('Class name',{exact:true}).fill('person_visible');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 await page.getByTestId('canvas').press('2');await drag(page,[100,80],[200,300]);await saved(page);
 await page.getByTestId('canvas').press('i');await expect(page.getByLabel('Annotation box type')).toHaveValue('person_ext');await page.getByLabel('Class name',{exact:true}).fill('person_extended');await page.getByLabel('Box color').fill('#ff8800');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[200,80],[300,300]);await page.getByTestId('canvas').press('1');await drag(page,[220,100],[280,240]);await saved(page);
 let p=await state(request);expect(Object.keys(p.state.identities)).toHaveLength(1);expect(obs(p)).toHaveLength(11);expect(at(p,5).person_visible[0]).toBeCloseTo(170,0);expect(at(p,5).person_ext[0]).toBeCloseTo(150,0);
 const extended=structuredClone(at(p,5).person_ext),extProvenance=structuredClone(at(p,5).provenance.person_ext);
 await page.getByLabel('Go to frame').fill('5');await ready(page,5);await drag(page,[200,170],[210,170]);await saved(page);p=await state(request);expect(at(p,5).person_ext).toEqual(extended);expect(at(p,5).provenance.person_ext).toEqual(extProvenance);expect(at(p,5).provenance.person_visible.human_corrected).toBe(true);
 await page.getByTestId('canvas').press('Delete');await saved(page);p=await state(request);expect(at(p,5).person_visible).toBeNull();expect(at(p,5).person_ext).toEqual(extended);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect(at(await state(request),5).person_visible).not.toBeNull();await page.keyboard.press('Control+Shift+z');await saved(page);expect(at(await state(request),5).person_visible).toBeNull();await page.getByTestId('canvas').press('k');await saved(page);expect(at(await state(request),5).person_visible).toBeNull();
 await drag(page,[175,100],[235,240]);await saved(page);await page.getByTestId('canvas').press('2');await page.getByLabel('Show both box types').uncheck();await saved(page);const before=(await state(request)).state;await reopen(page);await ready(page,5);expect((await state(request)).state).toEqual(before);await expect(page.getByRole('button',{name:'Extended 2',exact:true})).toHaveAttribute('aria-pressed','true');
 const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId}});const job=(await response.json()).id;await expect.poll(async()=> (await (await request.get('/api/jobs/'+job)).json()).status).toBe('completed');const exportId=(await (await request.get('/api/jobs/'+job)).json()).export_id;const doc=await (await request.get('/api/exports/'+exportId)).json();
 expect(doc.schema_version).toBe(2);const rows=doc.annotation_index.filter((r:any)=>r.frame_index===5);expect(rows).toHaveLength(2);expect(rows.map((r:any)=>r.person_id)).toEqual([1,1]);expect(rows[0].identity_uuid).toBe(rows[1].identity_uuid);expect(rows.map((r:any)=>r.class_name)).toEqual(['person_visible','person_extended']);expect(rows[1].color).toBe('#ff8800');expect(doc.frame_annotations.find((r:any)=>r.frame_index===5).boxes.person_extended).toEqual(extended);
});

test('I links an older extended-class track to visible ID on the same frame and undo restores both tracks',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[130,120],[190,240]);await page.keyboard.press('i');await page.getByLabel('Person ID',{exact:true}).fill('7');await page.getByLabel('Class name',{exact:true}).fill('person_visible');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 const first=Object.keys((await state(request)).state.identities)[0];
 await page.getByTestId('canvas').press('n');await drag(page,[100,80],[220,300]);await saved(page);let p=await state(request);const second=Object.keys(p.state.identities).find(id=>id!==first)!;const identity=p.state.identities[second];
 const response=await request.post(`/api/projects/${projectId}/operations`,{data:{id:crypto.randomUUID(),base_revision:p.revision,label:'Legacy fixture',changes:[{collection:'identities',id:second,before:identity,after:Object.fromEntries(Object.entries({...identity,class_name:'person_extended',color:'#ffaa00'}).filter(([key])=>key!=='box_styles'))}]}});expect(response.ok()).toBeTruthy();await reopen(page);await ready(page,0);await page.locator('.person').filter({hasText:'Person 2'}).click();await drag(page,[110,190],[115,190]);await saved(page);const before=(await state(request)).state;expect(before.identities[second].box_styles).toBeUndefined();
 await page.getByTestId('canvas').press('i');await expect(page.getByLabel('Annotation box type')).toHaveValue('person_ext');await page.getByLabel('Existing person ID').selectOption(first);await expect(page.getByLabel('Class name',{exact:true})).toHaveValue('person_extended');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 p=await state(request);expect(Object.keys(p.state.identities)).toEqual([first]);expect(obs(p)).toHaveLength(1);expect(at(p,0).person_visible[0]).toBeCloseTo(130,0);expect(at(p,0).person_ext).toEqual((Object.values(before.observations) as any[]).find(o=>o.identity_uuid===second).person_visible);expect(p.state.identities[first].person_id).toBe(7);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.keyboard.press('Control+Shift+z');await saved(page);await reopen(page);await ready(page,0);expect((await state(request)).state).toEqual(p.state);
});

test('a new extended-first person can set its ID and later receive a visible box',async({page,request})=>{
 await page.getByTestId('canvas').press('2');await page.keyboard.press('n');await drag(page,[100,60],[220,310]);await saved(page);let p=await state(request);expect(at(p,0).person_ext).not.toBeNull();expect(at(p,0).person_visible).toBeNull();
 await page.getByTestId('canvas').press('i');await expect(page.getByLabel('Annotation box type')).toHaveValue('person_ext');await page.getByLabel('Person ID',{exact:true}).fill('9');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 const ext=at(await state(request),0).person_ext;await page.getByTestId('canvas').press('1');await drag(page,[130,120],[190,240]);await saved(page);p=await state(request);expect(at(p,0).person_ext).toEqual(ext);expect(at(p,0).person_visible).not.toBeNull();expect(Object.keys(p.state.identities)).toHaveLength(1);expect(Object.values(p.state.identities)[0]).toMatchObject({person_id:9});
});

test('class buttons group both classes under one person and persist random colors',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[120,100],[180,240]);
 await page.getByRole('button',{name:'Add class',exact:true}).click();await page.getByLabel('New class name').fill('person_extended');await page.getByRole('button',{name:'Create class',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await drag(page,[100,80],[200,300]);await saved(page);
 await expect(page.locator('.person-row')).toHaveCount(1);await expect(page.locator('.person-classes')).toContainText('Person');await expect(page.locator('.person-classes')).toContainText('person_extended');
 let p=await state(request);const person:any=Object.values(p.state.identities)[0];const styles=person.box_styles;
 expect(styles.person_visible.color).not.toBe(styles.person_ext.color);expect(styles.person_ext.color).toBe(p.class_colors.person_extended);
 const classes=page.locator('.class-bar');await classes.getByRole('button',{name:'Person',exact:true}).click();await expect(page.getByRole('button',{name:'Visible 1',exact:true})).toHaveAttribute('aria-pressed','true');
 await classes.getByRole('button',{name:'person_extended',exact:true}).click();await expect(page.getByRole('button',{name:'Extended 2',exact:true})).toHaveAttribute('aria-pressed','true');
 await reopen(page);await ready(page,0);await expect(page.locator('.person-row')).toHaveCount(1);expect((await state(request)).state.identities[person.id].box_styles).toEqual(styles);
 await page.getByTestId('canvas').press('i');await page.getByRole('dialog').getByRole('button',{name:'Add class',exact:true}).click();await page.getByLabel('Class name',{exact:true}).fill('Estimated body');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 p=await state(request);expect(p.state.identities[person.id].box_styles.person_ext.color).toBe(p.class_colors['Estimated body']);expect(p.class_colors['Estimated body']).not.toBe(styles.person_ext.color);await expect(classes.getByRole('button',{name:'Estimated body',exact:true})).toBeVisible();
});

test('manual zoom and pan survive drawing, resizing panels and switching frames',async({page,request})=>{
 const canvas=page.getByTestId('canvas');await canvas.press('n');
 const initial=Number(await canvas.getAttribute('data-scale'));const rect=(await canvas.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.wheel(0,-300);
 await expect.poll(async()=>Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(initial);
 const zoom=await canvas.getAttribute('data-scale');const view=async()=>[await canvas.getAttribute('data-offset-x'),await canvas.getAttribute('data-offset-y'),await canvas.getAttribute('data-scale')];
 // Pan with the key held, then draw in the central visible source region.
 await page.keyboard.down('Space');await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2+10);await page.mouse.up();await page.keyboard.up('Space');
 const before=await view();await drag(page,[290,140],[350,220]);await saved(page);expect(await view()).toEqual(before);
 await page.getByRole('button',{name:'Toggle shortcuts',exact:true}).click();await expect(page.locator('.shortcut-panel')).toHaveCount(0);expect(await canvas.getAttribute('data-scale')).toBe(zoom);
 await page.getByRole('button',{name:'Toggle people panel',exact:true}).click();await expect(page.locator('.people-panel')).toHaveCount(0);expect(await view()).toEqual(before);
 await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[300,140],[360,220]);await saved(page);expect(await view()).toEqual(before);
 expect(at(await state(request),0).person_visible[0]).toBeCloseTo(290,0);expect(at(await state(request),5).person_visible[0]).toBeCloseTo(295,0);
 await page.getByRole('button',{name:'Fit image',exact:true}).click();await expect.poll(async()=>canvas.getAttribute('data-scale')).not.toBe(zoom);
});

test('copy Visible to Extended selects a separate colored box; resize, undo, reload and JSON retain the same ID',async({page,request})=>{
 const copy=page.getByRole('button',{name:'Copy Visible → Extended (all frames)',exact:true});await expect(copy).toBeDisabled();
 await page.getByTestId('canvas').press('n');await drag(page,[120,100],[200,240]);await page.keyboard.press('i');await page.getByLabel('Person ID',{exact:true}).fill('7');await page.getByLabel('Class name',{exact:true}).fill('person_visible');await page.getByRole('button',{name:'Save ID',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 const before=(await state(request)).state;const canvas=page.getByTestId('canvas');const scale=await canvas.getAttribute('data-scale');
 await copy.click();await saved(page);await expect(page.getByRole('button',{name:'Extended 2',exact:true})).toHaveAttribute('aria-pressed','true');await expect(copy).toBeDisabled();await expect(canvas).toHaveAttribute('data-scale',scale!);
 let p=await state(request);const id=Object.keys(p.state.identities)[0];expect(Object.keys(p.state.identities)).toHaveLength(1);expect(p.state.identities[id].person_id).toBe(7);expect(at(p,0).person_ext).toEqual(at(p,0).person_visible);expect(at(p,0).geometry_link).toBe('independent');expect(p.state.identities[id].box_styles.person_visible.color).toBe('#22d3ee');expect(p.state.identities[id].box_styles.person_ext.color).toBe('#fb923c');
 await canvas.press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await expect(copy).toBeEnabled();await canvas.press('Control+Shift+z');await saved(page);
 await drag(page,[160,240],[160,310]);await saved(page);p=await state(request);expect(at(p,0).person_ext[3]).toBeCloseTo(310,0);expect(at(p,0).person_visible).toEqual(Object.values(before.observations).map((o:any)=>o.person_visible)[0]);expect(at(p,0).provenance.person_visible).toEqual(Object.values(before.observations).map((o:any)=>o.provenance.person_visible)[0]);
 const persisted=p.state;await reopen(page);await ready(page,0);expect((await state(request)).state).toEqual(persisted);await expect(page.getByRole('button',{name:'Extended 2',exact:true})).toHaveAttribute('aria-pressed','true');
 const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId}});const job=(await response.json()).id;await expect.poll(async()=> (await (await request.get('/api/jobs/'+job)).json()).status).toBe('completed');const exportId=(await (await request.get('/api/jobs/'+job)).json()).export_id;const doc=await (await request.get('/api/exports/'+exportId)).json();const rows=doc.annotation_index.filter((r:any)=>r.frame_index===0);expect(rows).toHaveLength(2);expect(rows.map((r:any)=>r.person_id)).toEqual([7,7]);expect(rows.map((r:any)=>r.color)).toEqual(['#22d3ee','#fb923c']);expect(rows.map((r:any)=>r.class_name)).toEqual(['person_visible','person_extended']);
 await page.getByLabel('Go to frame').fill('1');await ready(page,1);await expect(copy).toBeDisabled();
});

test('one click copies all visible frames from anywhere; spaced corrections interpolate and undo restores the whole copy',async({page,request})=>{
 await page.getByTestId('canvas').press('n');await drag(page,[100,100],[180,240]);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[200,100],[280,240]);await saved(page);
 const before=(await state(request)).state;const visible=obs(await state(request)).map(o=>({frame:o.frame_index,box:o.person_visible,provenance:o.provenance.person_visible})).sort((a,b)=>a.frame-b.frame);
 const copy=page.getByRole('button',{name:'Copy Visible → Extended (all frames)',exact:true});
 await page.getByLabel('Go to frame').fill('20');await ready(page,20);await expect(copy).toBeEnabled();await copy.click();await saved(page);await expect(copy).toBeDisabled();let p=await state(request);expect(obs(p).filter(o=>o.person_ext)).toHaveLength(11);for(const o of obs(p))expect(o.person_ext).toEqual(o.person_visible);expect(at(p,20)).toBeUndefined();
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before);await page.getByTestId('canvas').press('Control+Shift+z');await saved(page);
 await page.getByLabel('Go to frame').fill('0');await ready(page,0);await drag(page,[140,240],[140,280]);await page.getByLabel('Go to frame').fill('10');await ready(page,10);await drag(page,[240,240],[240,320]);await saved(page);p=await state(request);expect(at(p,5).person_ext[3]).toBeCloseTo(300,0);expect(at(p,10).provenance.person_ext.human_corrected).toBe(true);expect(obs(p).map(o=>({frame:o.frame_index,box:o.person_visible,provenance:o.provenance.person_visible})).sort((a,b)=>a.frame-b.frame)).toEqual(visible);
 await page.getByRole('button',{name:'Delete boxes in range',exact:true}).click();await page.getByLabel('First frame to delete').fill('3');await page.getByLabel('Last frame to delete').fill('7');await page.getByRole('button',{name:'Delete boxes',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await saved(page);
 const corrected=at(await state(request),10).person_ext;await copy.click();await saved(page);p=await state(request);for(const f of [3,4,5,6,7])expect(at(p,f).person_ext).toEqual(at(p,f).person_visible);expect(at(p,10).person_ext).toEqual(corrected);
 const persisted=p.state;await reopen(page);await ready(page,10);expect((await state(request)).state).toEqual(persisted);
});
