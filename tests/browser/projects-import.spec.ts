import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';
import path from 'node:path';
import {selectOption} from './select';

async function openImport(page:Page,format:string,name:string,text:string){
 await page.getByRole('button',{name:'Import annotations',exact:true}).click();
 await selectOption(page,'Annotation format',format==='mot'?'MOT 1.1 ground truth':format==='yolo_tracks'?'YOLO with track IDs — 6 columns':'YOLO detection — 5 columns, no track IDs');
 await page.getByLabel('Annotation file',{exact:true}).setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});
 await page.getByRole('button',{name:'Preview import',exact:true}).click();
 await expect(page.getByRole('region',{name:'Import preview'})).toBeVisible();
}

test('project workflow, class order, tracked import, undo, reload and video isolation',async({page,request})=>{
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByRole('button',{name:'New project',exact:true}).click();
 const name='Project workflow '+Date.now();await page.getByLabel('Project name',{exact:true}).fill(name);await page.getByLabel('Project classes').fill('Visible\nExtended\nHead');
 const created=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await page.getByRole('button',{name:'Create project',exact:true}).click();const pid=(await(await created).json()).id;
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New video',exact:true}).click();const uploaded=page.waitForResponse(r=>r.url().endsWith('/videos')&&r.request().method()==='POST');await page.getByLabel('Upload video').setInputFiles(path.resolve('../tests/fixtures/numbered.mp4'));const vid=(await(await uploaded).json()).video_id;await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');await expect(page.getByRole('dialog')).toHaveCount(0);
 await openImport(page,'yolo_tracks','000000.txt','1 .5 .5 .3 .7 7\n0 .5 .5 .2 .6 7\n1 .8 .5 .1 .3 9');
 await expect(page.getByRole('region',{name:'Import preview'})).toContainText('3 boxes · 2 tracks');await page.getByRole('button',{name:'Add annotations',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.save-status')).toHaveText('Saved');
 const track7=page.getByRole('button',{name:'Select Track 7',exact:true});await expect(track7.locator('small')).toHaveText(['Visible','Extended']);await expect(page.getByRole('button',{name:'Select Track 9',exact:true}).locator('small')).toHaveText(['Extended']);
 const canvas=await page.getByTestId('canvas').boundingBox(),tracks=await page.locator('.people-panel').boundingBox(),transport=await page.locator('.transport').boundingBox();expect(tracks!.x).toBeGreaterThan(canvas!.x);expect(transport!.y).toBeGreaterThanOrEqual(canvas!.y+canvas!.height);
 await page.getByRole('button',{name:'Select class Visible',exact:true}).click();await page.getByRole('button',{name:'Select Track 9',exact:true}).click();await expect(page.getByRole('button',{name:'Select class Extended',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();await page.getByTestId('open-project-'+pid).click();await page.getByTestId('open-video-'+vid).click();await expect(track7).toBeVisible();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');await page.getByTestId('canvas').press('Control+z');await expect(track7).toHaveCount(0);await page.getByTestId('canvas').press('Control+Shift+z');await expect(track7).toBeVisible();await expect(page.locator('.save-status')).toHaveText('Saved');
 const original=await(await request.get('/api/projects/'+pid)).json();expect(Object.keys(original.state.observations)).toHaveLength(2);
 await page.getByRole('button',{name:'New video',exact:true}).click();await page.getByText('Or use a video path on this computer',{exact:true}).click();await page.getByLabel('Video path',{exact:true}).fill('tests/fixtures/numbered.mp4');await page.getByRole('button',{name:'Add video from path'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');await expect(track7).toHaveCount(0);
 await page.locator('.project-switch').click();await expect(page.getByRole('table',{name:'Project videos',exact:true}).locator('tbody tr')).toHaveCount(2);await page.getByTestId('open-video-'+vid).click();await expect(track7).toBeVisible();
});

test('MOT import applies frame/coordinate bases, stays editable and rejects invalid replacement previews',async({page,request})=>{
 const pid=(await(await request.post('/api/projects',{data:{name:'MOT import '+Date.now(),classes:['Person']}})).json()).id;
 const vid=(await(await request.post(`/api/projects/${pid}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await(await request.get('/api/projects/'+pid)).json()).videos[vid].status).toBe('ready');
 await page.goto('/');await page.getByTestId('open-project-'+pid).click();await page.getByTestId('open-video-'+vid).click();
 await openImport(page,'mot','gt.txt','1,7,100,80,100,220,1,1,1\n11,7,200,80,100,220,1,1,.5');
 await selectOption(page,'Box coordinate base','Start at 1 (MOTChallenge)');await expect(page.getByRole('region',{name:'Import preview'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add annotations',exact:true})).toHaveCount(0);
 let release!:()=>void,requested=false;const pending=new Promise<void>(resolve=>{release=resolve});const previewRoute=`**/api/projects/${pid}/imports/annotations/preview?*`;await page.route(previewRoute,async route=>{requested=true;await pending;await route.continue()});
 try{await page.getByRole('button',{name:'Preview import',exact:true}).click();await expect.poll(()=>requested).toBe(true);await expect(page.getByRole('combobox',{name:'Annotation format',exact:true})).toBeDisabled();await expect(page.getByRole('combobox',{name:'First source frame number',exact:true})).toBeDisabled();await expect(page.getByRole('combobox',{name:'Box coordinate base',exact:true})).toBeDisabled();release();await expect(page.getByRole('region',{name:'Import preview'})).toBeVisible();await expect(page.getByRole('combobox',{name:'Box coordinate base',exact:true})).toBeEnabled();}finally{release();await page.unroute(previewRoute)}
 await page.getByRole('button',{name:'Add annotations',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.save-status')).toHaveText('Saved');const imported=await(await request.get('/api/projects/'+pid)).json();const first:any=Object.values(imported.state.observations).find((o:any)=>o.frame_index===0);expect(first.boxes['class:pedestrian']).toEqual([99,79,199,299]);
 await page.getByLabel('Go to frame').fill('5');await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','5');await expect(page.locator('.gap-banner')).toBeVisible();await page.getByTestId('canvas').press('k');await expect(page.locator('.save-status')).toHaveText('Saved');await expect.poll(async()=>Object.keys((await(await request.get('/api/projects/'+pid)).json()).state.observations).length).toBe(11);
 await page.getByRole('button',{name:'Import annotations',exact:true}).click();await selectOption(page,'Annotation format','YOLO detection — 5 columns, no track IDs');await page.getByLabel('Annotation file',{exact:true}).setInputFiles({name:'99999.txt',mimeType:'text/plain',buffer:Buffer.from('0 .5 .5 .2 .2')});await page.getByRole('button',{name:'Preview import',exact:true}).click();await expect(page.getByRole('alert')).toContainText('outside');await expect(page.getByRole('button',{name:'Add annotations',exact:true})).toHaveCount(0);
});

test('retrying a failed import save never adds the tracks twice',async({page,request})=>{
 const pid=(await(await request.post('/api/projects',{data:{name:'Import save retry '+Date.now(),classes:['Person']}})).json()).id;
 const vid=(await(await request.post(`/api/projects/${pid}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await(await request.get('/api/projects/'+pid)).json()).videos[vid].status).toBe('ready');
 await page.goto('/');await page.getByTestId('open-project-'+pid).click();await page.getByTestId('open-video-'+vid).click();await openImport(page,'yolo_tracks','0.txt','0 .5 .5 .2 .4 7');
 await page.route(`**/api/projects/${pid}/operations`,route=>route.fulfill({status:503,json:{detail:'Temporary test outage'}}));
 await page.getByRole('button',{name:'Add annotations',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Import added locally');await expect(page.getByRole('button',{name:'Retry saving import',exact:true})).toBeEnabled();
 await page.unroute(`**/api/projects/${pid}/operations`);await page.getByRole('button',{name:'Retry saving import',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);const p=await(await request.get('/api/projects/'+pid)).json();expect(Object.keys(p.state.identities)).toHaveLength(1);expect(Object.keys(p.state.observations)).toHaveLength(1);
});
