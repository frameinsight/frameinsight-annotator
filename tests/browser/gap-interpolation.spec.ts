import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';
let projectId:string,videoId:string;
const state=async(request:any)=>(await request.get(`/api/projects/${projectId}`)).json();
const canvas=(page:Page)=>page.getByTestId('canvas');
const saved=async(page:Page)=>expect(page.locator('.save-status')).toHaveText('Saved');
async function seek(page:Page,frame:number){await page.getByLabel('Go to frame').fill(String(frame));await expect(canvas(page)).toHaveAttribute('data-frame',String(frame));}
async function draw(page:Page,x:number){
 const v=await canvas(page).evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+Number(el.getAttribute('data-offset-x')),y:r.y+Number(el.getAttribute('data-offset-y')),s:Number(el.getAttribute('data-scale'))};});
 await page.mouse.move(v.x+x*v.s,v.y+80*v.s);await page.mouse.down();await page.mouse.move(v.x+(x+80)*v.s,v.y+280*v.s,{steps:5});await page.mouse.up();if(await page.getByRole('dialog',{name:'Track ID, class & color'}).isVisible())await page.keyboard.press('Escape');await saved(page);
}
async function open(page:Page){await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));await page.goto('/');await page.getByTestId('open-project-'+projectId).click();await page.getByTestId('open-video-'+videoId).click();await expect(canvas(page)).toHaveAttribute('data-frame',/\d+/);}
async function remove(page:Page,start:number,end:number){await canvas(page).press('Shift+Delete');await page.getByLabel('First frame to delete').fill(String(start));await page.getByLabel('Last frame to delete').fill(String(end));await page.getByRole('button',{name:'Delete boxes',exact:true}).click();await saved(page);}
const box=(p:any,f:number,g='class:Visible')=>(Object.values(p.state.observations) as any[]).find(o=>o.frame_index===f)?.boxes?.[g];
test.beforeEach(async({page,request})=>{
 projectId=(await(await request.post('/api/projects',{data:{name:'Deleted range interpolation '+Date.now(),classes:['Visible','Extended']}})).json()).id;
 videoId=(await(await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await state(request)).videos[videoId].status).toBe('ready');await open(page);
 await canvas(page).press('n');await draw(page,100);await seek(page,22);await draw(page,250);
 await page.getByRole('button',{name:'Copy to class…',exact:true}).click();await selectOption(page,'Target class','Extended');await page.getByRole('button',{name:'Copy boxes',exact:true}).click();await saved(page);await page.getByRole('button',{name:'Select class Visible',exact:true}).click();
});

test('two new boxes refill only their part of a deleted range across a fresh browser, undo and export',async({page,request,browser})=>{
 const original=await state(request);await remove(page,4,18);await seek(page,6);await draw(page,120);
 const first=await state(request);for(const f of [4,5,7,10,14,18])expect(box(first,f)).toBeUndefined();
 const fresh=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:{width:1440,height:960}});
 try{
  const other=await fresh.newPage();await open(other);await other.getByRole('button',{name:'Select Track 1',exact:true}).click();await seek(other,14);await draw(other,280);
  const filled=await state(request);for(let f=6;f<=14;f++)expect(box(filled,f)).toBeDefined();expect(box(filled,10)[0]).toBeCloseTo(200,0);
  for(const f of [4,5,15,16,17,18])expect(box(filled,f)).toBeUndefined();for(let f=0;f<=22;f++)expect(box(filled,f,'class:Extended')).toEqual(box(original,f,'class:Extended'));
  await canvas(other).press('Control+z');await saved(other);expect((await state(request)).state).toEqual(first.state);await canvas(other).press('Control+Shift+z');await saved(other);expect((await state(request)).state).toEqual(filled.state);
  const validation=await request.post(`/api/videos/${videoId}/validate`,{data:{revision:filled.revision+2,visual_confirmed:true,coverage:'selected_people'}});expect(validation.ok()).toBe(true);const proof=await validation.json();expect(proof.passed).toBe(true);
  const response=await request.post(`/api/projects/${projectId}/exports`,{data:{format:'annotations_json',video_id:videoId,revision:proof.revision,validation_id:proof.validation_id}});expect(response.ok()).toBe(true);
  const job=await response.json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
 }finally{await fresh.close();}
});

test('explicit interpolation fills a chosen gap between existing boxes and undo restores it',async({page,request})=>{
 await remove(page,4,18);await seek(page,6);await draw(page,120);await seek(page,14);await draw(page,280);await remove(page,7,13);const before=await state(request);
 await canvas(page).press('Shift+k');await expect(page.getByRole('dialog',{name:'Interpolate between frames',exact:true})).toBeVisible();await expect(page.getByLabel('First boundary frame')).toHaveValue('6');await expect(page.getByLabel('Last boundary frame')).toHaveValue('14');
 await page.getByLabel('First boundary frame').fill('8');await expect(page.getByRole('button',{name:'Interpolate frames',exact:true})).toBeDisabled();await expect(page.getByRole('dialog')).toContainText('frame 8 first');
 await page.getByLabel('First boundary frame').fill('6');await expect(page.getByRole('dialog')).toContainText('7 frames to fill');await page.getByRole('button',{name:'Interpolate frames',exact:true}).click();await saved(page);
 const filled=await state(request);expect(box(filled,10)[0]).toBeCloseTo(200,0);for(const f of [4,5,15,16,17,18])expect(box(filled,f)).toBeUndefined();expect(box(filled,6)).toEqual(box(before,6));expect(box(filled,14)).toEqual(box(before,14));
 await canvas(page).press('Control+z');await saved(page);expect((await state(request)).state).toEqual(before.state);
 await canvas(page).click({button:'right'});await expect(page.getByRole('menuitem',{name:'Interpolate between frames… ⇧ K',exact:true})).toBeVisible();
});
