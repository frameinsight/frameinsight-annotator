import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';

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
 await page.goto('/');await page.getByTestId('open-video-'+videoId).click();await ready(page,0);
});

test('deleted range explains why filling stops and can be refilled with one undo',async({page,request})=>{
 await track(page);await page.getByLabel('Go to frame').fill('10');await ready(page,10);
 await page.getByTestId('canvas').press('Shift+Delete');await page.getByLabel('First frame to delete').fill('8');await page.getByLabel('Last frame to delete').fill('12');await page.getByRole('button',{name:'Delete boxes',exact:true}).click();await saved(page);
 const deleted=(await state(request)).state;
 await expect(page.locator('.gap-banner')).toContainText('Interpolation paused');
 await page.locator('.gap-banner').getByRole('button',{name:'Restore deleted range'}).click();
 await expect(page.getByLabel('First frame to restore')).toHaveValue('8');await expect(page.getByLabel('Last frame to restore')).toHaveValue('12');
 await expect(page.getByRole('dialog')).toContainText('5 boxes to restore');
 await page.getByRole('button',{name:'Remove gap & fill boxes'}).click();await saved(page);
 const restored=(await state(request)).state;expect(Object.values(restored.intervals)).toHaveLength(0);
 expect((Object.values(restored.observations) as any[]).filter(o=>o.frame_index>=8&&o.frame_index<=12&&o.boxes?.['class:person_visible'])).toHaveLength(5);
 await page.getByTestId('canvas').press('Control+z');await saved(page);expect((await state(request)).state).toEqual(deleted);
 await page.getByTestId('canvas').press('Control+Shift+z');await saved(page);expect((await state(request)).state).toEqual(restored);
});

test('review player supports slow speed and frame seeking, validates then exports media-free JSON',async({page,request})=>{
 await track(page);await page.getByRole('button',{name:'Finish',exact:true}).click();
 await expect(page.getByRole('button',{name:'Prepare validated JSON'})).toHaveCount(0);
 await page.getByRole('button',{name:'Prepare review video',exact:true}).click();
 const player=page.getByTestId('review-video');await expect(player).toBeVisible({timeout:30000});
 await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 await expect(page.getByRole('button',{name:'Run annotation validation'})).toBeDisabled();
 await page.getByLabel('Review playback speed').selectOption('0.125');await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.playbackRate)).toBe(.125);
 await page.getByRole('button',{name:'Next review frame',exact:true}).click();await expect(page.locator('.review-position')).toContainText('Frame 1 / 23');
 await page.getByRole('button',{name:'Previous review frame',exact:true}).click();await expect(page.locator('.review-position')).toContainText('Frame 0 / 23');
 await page.getByRole('button',{name:'Play review',exact:true}).click();await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>!v.paused)).toBe(true);await page.getByRole('button',{name:'Pause review',exact:true}).click();
 await page.getByLabel('Annotation coverage').selectOption('selected_people');await page.getByLabel('Visual review complete').check();await page.getByRole('button',{name:'Run annotation validation'}).click();
 await expect(page.getByText('Validation passed — you can export',{exact:true})).toBeVisible();
 const notes=page.getByLabel('Review notes checked');if(await notes.count())await notes.check();
 await page.getByRole('button',{name:'Prepare validated JSON'}).click();const download=page.getByRole('link',{name:'Download annotations (.json)'});await expect(download).toBeVisible();
 const exported=await(await request.get((await download.getAttribute('href'))!)).json();
 expect(exported.media_included).toBe(false);expect(exported.video_scope).toBe(videoId);expect(exported.annotation_index).toHaveLength(21);
 expect(new Set(exported.annotation_index.map((row:any)=>row.person_id))).toEqual(new Set([1]));
 expect(JSON.stringify(exported)).not.toContain('data:image/');
});

test('a correction returns to the exact review frame and makes old review proof stale',async({page,request})=>{
 await track(page);await page.getByRole('button',{name:'Finish',exact:true}).click();await page.getByRole('button',{name:'Prepare review video',exact:true}).click();await expect(page.getByTestId('review-video')).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Next review frame',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Next review frame',exact:true}).click();await expect(page.locator('.review-position')).toContainText('Frame 1 / 23');
 await page.getByRole('button',{name:'Fix this frame',exact:true}).click();await ready(page,1);
 const before=await state(request);await draw(page,[150,190],[160,190]);expect((await state(request)).revision).toBeGreaterThan(before.revision);
 await page.getByRole('button',{name:'Finish',exact:true}).click();await expect(page.getByRole('button',{name:'Prepare review video',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Prepare validated JSON'})).toHaveCount(0);
});

test('dialog traps keyboard focus and guide is available without changing annotations',async({page,request})=>{
 const before=(await state(request)).state;
 await page.getByRole('button',{name:'Help',exact:true}).click();await page.getByRole('button',{name:'Start guide',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 for(let i=0;i<12;i++)await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect((await state(request)).state).toEqual(before);
});
