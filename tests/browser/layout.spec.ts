import {expect, test, type APIRequestContext, type Locator, type Page} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';

async function bounds(locator:Locator){
 await expect(locator).toBeVisible();
 const box=await locator.boundingBox();expect(box).not.toBeNull();return box!;
}
async function fixture(request:APIRequestContext,width:number){
 const project=(await(await request.post('/api/projects',{data:{name:`Compact layout ${width} ${Date.now()}`,classes:['Person visible','Person extended']}})).json());
 const videos:string[]=[];
 for(let i=0;i<2;i++)videos.push((await(await request.post(`/api/projects/${project.id}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id);
 await expect.poll(async()=>{
  const state=await(await request.get('/api/projects/'+project.id)).json();return videos.map(id=>state.videos[id].status);
 }).toEqual(['ready','ready']);
 return {pid:project.id,videos};
}
async function draw(page:Page,from:number[],to:number[]){
 const view=await page.getByTestId('canvas').evaluate(host=>{const box=host.getBoundingClientRect();return {x:box.x+Number(host.getAttribute('data-offset-x')),y:box.y+Number(host.getAttribute('data-offset-y')),scale:Number(host.getAttribute('data-scale'))}});
 await page.mouse.move(view.x+from[0]*view.scale,view.y+from[1]*view.scale);await page.mouse.down();await page.mouse.move(view.x+to[0]*view.scale,view.y+to[1]*view.scale,{steps:6});await page.mouse.up();
}
const rgb=(hex:string)=>'rgb('+[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)).join(', ')+')';

for(const width of [1440,1366])test(`compact library, class capsules and centered timeline remain usable at ${width}px`,async({page,request})=>{
 await page.setViewportSize({width,height:width===1366?768:960});
 const {pid,videos}=await fixture(request,width),vid=videos[0];
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByTestId('open-project-'+pid).click();
 const table=page.getByRole('table',{name:'Project videos',exact:true});await expect(table).toBeVisible();
 await expect(table.getByRole('columnheader')).toHaveText(['Video','Status','Created','Last updated','Actions']);
 await expect(table.locator('tbody tr')).toHaveCount(2);await expect(page.locator('.video-library img,.video-thumbnail,.resume-video')).toHaveCount(0);
 const apiRows=await(await request.get('/api/video-library')).json();
 for(const id of videos){
  const row=page.getByTestId('video-row-'+id),record=apiRows.find((video:any)=>video.id===id);
  await expect(row).toContainText('numbered.mp4');await expect(row.getByRole('cell',{name:'In progress',exact:true})).toBeVisible();
  await expect(row.locator('time')).toHaveCount(2);await expect(row.locator('time').nth(0)).toHaveAttribute('datetime',record.created_at);await expect(row.locator('time').nth(1)).toHaveAttribute('datetime',record.updated_at);
  expect(Number.isFinite(Date.parse(record.created_at))).toBe(true);expect(Number.isFinite(Date.parse(record.updated_at))).toBe(true);
  expect((await bounds(row)).height).toBeLessThanOrEqual(90);
  await row.getByTestId('open-video-'+id).click({trial:true});await row.getByTestId('delete-video-'+id).click({trial:true});
 }
 const tableBox=await bounds(table);expect(tableBox.x).toBeGreaterThanOrEqual(0);expect(tableBox.x+tableBox.width).toBeLessThanOrEqual(width);
 await page.getByTestId('open-video-'+vid).click();const canvas=page.getByTestId('canvas');await expect(canvas).toHaveAttribute('data-frame','0');
 const project=await(await request.get('/api/projects/'+pid)).json();
 for(const name of ['Person visible','Person extended']){
  const choose=page.getByRole('button',{name:'Select class '+name,exact:true});
  const capsule=page.locator('.class-control').filter({has:choose}),eye=capsule.getByRole('button',{name:'Hide class '+name,exact:true});
  await expect(capsule).toHaveCount(1);await expect(capsule.getByRole('button')).toHaveCount(2);await expect(capsule.locator('kbd')).toHaveCount(0);await expect(choose).toHaveText(name);await expect(capsule.locator('i')).toHaveCSS('background-color',rgb(project.class_colors[name]));
  const outer=await bounds(capsule),inside=await bounds(eye),label=await bounds(choose);
  expect(inside.x).toBeGreaterThanOrEqual(outer.x);expect(inside.x+inside.width).toBeLessThanOrEqual(outer.x+outer.width+1);expect(inside.y).toBeGreaterThanOrEqual(outer.y);expect(inside.y+inside.height).toBeLessThanOrEqual(outer.y+outer.height+1);
  expect(inside.x-(label.x+label.width)).toBeLessThanOrEqual(4);
  const radius=await capsule.evaluate(element=>parseFloat(getComputedStyle(element).borderTopLeftRadius));expect(radius).toBeGreaterThanOrEqual(outer.height/2-1);
 }
 const tools=page.locator('.canvas-toolbar'),toolsBox=await bounds(tools),canvasBox=await bounds(canvas);
 expect(toolsBox.y+toolsBox.height).toBeLessThanOrEqual(canvasBox.y+1);await expect(canvas.locator('.canvas-toolbox')).toHaveCount(0);
 for(const name of ['Copy to class…','Delete range','Restore range','Select and move (V)','Draw box (B)','Hand tool (H)','Zoom in','Zoom out','Fit video']){
  const button=tools.getByRole('button',{name,exact:true});await expect(button).toBeVisible();await expect(button).toHaveText('');await expect(button).toHaveAttribute('title',/.+/);await expect(button.locator('svg')).toHaveCount(1);
  const b=await bounds(button);expect(b.width).toBeLessThanOrEqual(36);expect(Math.abs(b.y+b.height/2-(toolsBox.y+toolsBox.height/2))).toBeLessThanOrEqual(3);expect(b.x).toBeGreaterThanOrEqual(canvasBox.x);expect(b.x+b.width).toBeLessThanOrEqual(canvasBox.x+canvasBox.width+1);
 }
 // Shortcut labels are absent from the capsules, but the two geometry keys still work.
 await canvas.press('n');await canvas.press('2');await expect(page.getByRole('button',{name:'Select class Person extended',exact:true})).toHaveAttribute('aria-pressed','true');await draw(page,[90,70],[190,300]);
 await canvas.press('1');await expect(page.getByRole('button',{name:'Select class Person visible',exact:true})).toHaveAttribute('aria-pressed','true');await draw(page,[110,90],[170,230]);await expect(page.locator('.save-status')).toHaveText('Saved');
 await expect.poll(async()=>{const p=await(await request.get('/api/projects/'+pid)).json();return Object.values(p.state.observations).map((o:any)=>Object.keys(o.boxes).sort())}).toEqual([['class:Person extended','class:Person visible']]);
 const saved=await(await request.get('/api/projects/'+pid)).json();await page.getByRole('button',{name:'Hide class Person extended',exact:true}).click();await expect(page.getByRole('button',{name:'Show class Person extended',exact:true})).toBeVisible();await page.getByRole('button',{name:'Show class Person extended',exact:true}).click();expect((await(await request.get('/api/projects/'+pid)).json()).state).toEqual(saved.state);

 const header=page.getByTestId('timeline-header'),transport=page.getByTestId('timeline-transport'),leading=page.getByTestId('timeline-leading'),trailing=page.getByTestId('timeline-trailing');
 await expect(leading.getByText('Present',{exact:true})).toBeVisible();await expect(leading.getByText('Hidden',{exact:true})).toBeVisible();await expect(trailing).toContainText('24 frames');
 const h=await bounds(header),t=await bounds(transport),l=await bounds(leading),r=await bounds(trailing),image=await bounds(canvas);
 expect(h.y).toBeGreaterThanOrEqual(image.y+image.height);expect(l.x+l.width).toBeLessThanOrEqual(t.x+1);expect(t.x+t.width).toBeLessThanOrEqual(r.x+1);
 expect(Math.abs(t.x+t.width/2-(h.x+h.width/2))).toBeLessThanOrEqual(3);
 for(const slot of [l,t,r]){expect(Math.abs(slot.y+slot.height/2-(h.y+h.height/2))).toBeLessThanOrEqual(3);expect(slot.x).toBeGreaterThanOrEqual(h.x-1);expect(slot.x+slot.width).toBeLessThanOrEqual(h.x+h.width+1)}
 await expect(transport.getByRole('button',{name:'Play',exact:true})).toBeVisible();await expect(transport.getByRole('spinbutton',{name:'Go to frame',exact:true})).toBeVisible();
 await transport.getByRole('button',{name:'Next frame',exact:true}).click();await expect(canvas).toHaveAttribute('data-frame','1');await transport.getByRole('button',{name:'Previous frame',exact:true}).click();await expect(canvas).toHaveAttribute('data-frame','0');
 // A save notice must neither cover the timeline nor make its central frames unclickable.
 await page.getByRole('button',{name:'Save',exact:true}).click();const notice=page.getByRole('status').filter({hasText:'All changes saved.'});await expect(notice).toBeVisible();
 const toast=await bounds(notice);expect(toast.y+toast.height).toBeLessThanOrEqual(h.y);
 await page.getByRole('group',{name:'Frame ranges',exact:true}).getByRole('button',{name:/^Frames 12–12:/}).click({timeout:2000});await expect(canvas).toHaveAttribute('data-frame','12');await expect(notice).toBeVisible();
 await selectOption(page,'Playback speed','0.5×');await transport.getByRole('spinbutton',{name:'Go to frame',exact:true}).fill('7');await expect(canvas).toHaveAttribute('data-frame','7');
 await page.getByRole('button',{name:'Import annotations',exact:true}).click();await expect(page.getByRole('dialog',{name:'Import annotations',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect((await(await request.get('/api/projects/'+pid)).json()).state).toEqual(saved.state);
 // Reopening uses the compact row's saved position, without introducing a resume hero.
 await page.locator('.project-switch').click();await expect(page.getByTestId('video-row-'+vid)).toContainText('Saved at frame 7');await expect(page.getByTestId('open-video-'+vid)).toHaveText('Resume');await expect(page.locator('.resume-video,.video-thumbnail')).toHaveCount(0);
 await page.getByTestId('open-video-'+vid).click();await expect(canvas).toHaveAttribute('data-frame','7');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
