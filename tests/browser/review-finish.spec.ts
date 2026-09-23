import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';

let projectId:string,videoId:string;
const state=async(request:any)=>(await request.get(`/api/projects/${projectId}`)).json();
async function saved(page:Page){await expect(page.locator('.save-status')).toHaveText('Saved');}
async function ready(page:Page,frame:number){await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame',String(frame));}
async function draw(page:Page,a=[100,80],b=[200,300]){
 const box=await page.getByTestId('canvas').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x+Number(e.getAttribute('data-offset-x')),y:r.y+Number(e.getAttribute('data-offset-y')),s:Number(e.getAttribute('data-scale'))};});
 await page.mouse.move(box.x+a[0]*box.s,box.y+a[1]*box.s);await page.mouse.down();await page.mouse.move(box.x+b[0]*box.s,box.y+b[1]*box.s,{steps:5});await page.mouse.up();await saved(page);
}
async function track(page:Page){await page.getByTestId('canvas').press('n');await draw(page);await page.getByLabel('Go to frame').fill('20');await ready(page,20);await draw(page,[200,80],[300,300]);}

test.beforeEach(async({page,request})=>{
 projectId=(await(await request.post('/api/projects',{data:{name:'UX review acceptance '+Date.now(),classes:['person_visible','person_extended']}})).json()).id;
 videoId=(await(await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await state(request)).videos[videoId].status).toBe('ready');
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByTestId('open-project-'+projectId).click();await page.getByTestId('open-video-'+videoId).click();await ready(page,0);
});

test('deleted range explains why filling stops and can be refilled with one undo',async({page,request})=>{
 await track(page);await page.getByLabel('Go to frame').fill('10');await ready(page,10);
 await page.getByTestId('canvas').press('Shift+Delete');await page.getByLabel('First frame to delete').fill('8');await page.getByLabel('Last frame to delete').fill('12');await page.getByRole('button',{name:'Delete boxes',exact:true}).click();await saved(page);
 const deleted=(await state(request)).state;
 await expect(page.locator('.gap-banner')).toContainText('Interpolation paused');
 expect(await page.locator('.box-status').evaluate(status=>{
  const banner=status.querySelector<HTMLElement>('.gap-banner')!,bounds=banner.getBoundingClientRect();
  return {statusFits:status.scrollHeight<=status.clientHeight+1,bannerFits:banner.scrollHeight<=banner.clientHeight+1,buttonsFit:Array.from(banner.querySelectorAll('button')).every(button=>{const rect=button.getBoundingClientRect();return rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;})};
 })).toEqual({statusFits:true,bannerFits:true,buttonsFit:true});
 await page.locator('.gap-banner').getByRole('button',{name:'Restore deleted range'}).click();
 await expect(page.getByLabel('First frame to restore')).toHaveValue('8');await expect(page.getByLabel('Last frame to restore')).toHaveValue('12');
 await expect(page.getByRole('dialog')).toContainText('5 boxes to restore');
 await page.getByRole('button',{name:'Remove gap & fill boxes'}).click();await saved(page);
 const restored=(await state(request)).state;expect(Object.values(restored.intervals)).toHaveLength(0);
 expect((Object.values(restored.observations) as any[]).filter(o=>o.frame_index>=8&&o.frame_index<=12&&o.boxes?.['class:person_visible'])).toHaveLength(5);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(deleted);
 await page.getByTestId('canvas').press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(restored);
});

async function finish(page:Page){
 await page.getByRole('button',{name:'Finish',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Review before finishing',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'I reviewed — continue',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('main',{name:'Validate & export',exact:true})).toBeVisible();
}
async function validate(page:Page){
 await selectOption(page,'Annotation coverage','Only the objects I chose to annotate');
 const response=page.waitForResponse(r=>r.url().endsWith('/validate')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Run annotation validation',exact:true}).click();
 const result=await response;expect(result.request().postDataJSON()).not.toHaveProperty('review_job_id');
 await expect(page.getByRole('heading',{name:'Validation passed. You can export.',exact:true})).toBeVisible();
 return result.json();
}

test('reviews existing canvas at slow speeds and exports validated JSON without rendering another video',async({page,request})=>{
 const renderRequests:string[]=[];
 page.on('request',r=>{if(r.url().includes('/review-jobs')||r.url().includes('/reviews/'))renderRequests.push(r.url());});
 await track(page);const original=(await state(request)).state;
 await page.getByRole('button',{name:'Hide Track 1',exact:true}).click();
 await page.getByRole('button',{name:'Hide class person_visible',exact:true}).click();
 await page.getByRole('button',{name:'Finish',exact:true}).click();
 await page.getByRole('button',{name:'Review in editor',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Playback speed',exact:true})).toHaveText('0.5×');
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await expect(page.getByRole('button',{name:'Hide Track 1',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Hide class person_visible',exact:true})).toBeVisible();
 await selectOption(page,'Playback speed','0.125×');
 await page.getByLabel('Go to frame').fill('0');await ready(page,0);
 await page.getByRole('button',{name:'Next frame',exact:true}).click();await ready(page,1);
 await page.getByRole('button',{name:'Previous frame',exact:true}).click();await ready(page,0);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await expect.poll(async()=>Number(await page.getByTestId('canvas').getAttribute('data-frame'))).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 expect((await state(request)).state).toEqual(original);
 await finish(page);
 await expect(page.locator('video')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Prepare validated JSON',exact:true})).toBeDisabled();
 const report=await validate(page);expect(report.mode).toBe('structural');
 await page.getByRole('button',{name:'Prepare validated JSON',exact:true}).click();
 const download=page.getByRole('link',{name:'Download annotations (.json)',exact:true});await expect(download).toBeVisible();
 const exported=await(await request.get((await download.getAttribute('href'))!)).json();
 expect(exported.media_included).toBe(false);expect(exported.video_scope).toBe(videoId);expect(exported.annotation_index).toHaveLength(21);
 expect(new Set(exported.annotation_index.map((row:any)=>row.person_id))).toEqual(new Set([1]));
 expect(exported.validation.mode).toBe('structural');expect(exported.validation.coverage).toBe('selected_people');
 expect(exported.validation).not.toHaveProperty('review_video_hash');expect(JSON.stringify(exported)).not.toContain('data:image/');
 expect(renderRequests).toEqual([]);
 const main=await page.locator('.finish-main').boundingBox(),sidebar=await page.locator('.finish-sidebar').boundingBox();
 expect(sidebar!.x).toBeGreaterThan(main!.x+main!.width);
});

test('editing after validation rejects old export proof and requires validation again',async({page,request})=>{
 await track(page);await finish(page);const proof=await validate(page);
 await page.getByRole('button',{name:'Back to annotation',exact:true}).click();await ready(page,20);
 await page.getByLabel('Go to frame').fill('1');await ready(page,1);
 const before=await state(request);await draw(page,[150,190],[160,190]);expect((await state(request)).revision).toBeGreaterThan(before.revision);
 const stale=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId,revision:proof.revision,validation_id:proof.validation_id,include_videos:false}});
 expect(stale.status()).toBe(409);
 await finish(page);
 await expect(page.getByRole('button',{name:'Prepare validated JSON',exact:true})).toBeDisabled();
 await expect(page.getByRole('heading',{name:'Validation passed. You can export.',exact:true})).toHaveCount(0);
 const current=await validate(page);expect(current.revision).toBeGreaterThan(proof.revision);expect(current.validation_id).not.toBe(proof.validation_id);
 await expect(page.getByRole('button',{name:'Prepare validated JSON',exact:true})).toBeEnabled();
});

test('dialog traps keyboard focus and guide is available without changing annotations',async({page,request})=>{
 const before=(await state(request)).state;
 await page.getByRole('button',{name:'Help',exact:true}).click();await page.getByRole('button',{name:'Start guide',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 for(let i=0;i<12;i++)await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect((await state(request)).state).toEqual(before);
});

test('focused Finish opens with Enter and Space without advancing or playing the video',async({page,request})=>{
 const before=(await state(request)).state;
 const finishButton=page.getByRole('button',{name:'Finish',exact:true});
 for(const key of ['Enter','Space']){
  await finishButton.focus();
  await finishButton.press(key);
  await expect(page.getByRole('dialog',{name:'Review before finishing',exact:true})).toBeVisible();
  await ready(page,0);
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveCount(0);
  await ready(page,0);
 }
 expect((await state(request)).state).toEqual(before);
});
