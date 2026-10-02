import {test,expect} from '../../frontend/node_modules/@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
async function openTrim(page){
 await page.route('**/api/updates/check*',r=>r.fulfill({json:{status:'current'}}));await page.goto('/');
 await page.getByRole('button',{name:'Trim sections',exact:true}).click();
 await page.getByLabel('Source video to trim').setInputFiles(path.resolve('../tests/fixtures/numbered.mp4'));
 await expect(page.getByRole('button',{name:'Play source video',exact:true})).toBeEnabled();
}
async function cutAt(page,frame:number){
 await page.getByLabel('Trim source frame',{exact:true}).fill(String(frame));
 await page.getByRole('slider',{name:'Trim playhead',exact:true}).press('c');
}
test('cut points, section deletion and undo create a new video without changing projects',async({page,request},testInfo)=>{
 await openTrim(page);const before=await(await request.get('/api/projects')).json();
 await cutAt(page,6);await cutAt(page,15);
 await expect(page.getByRole('button',{name:'Section 2, frames 6 to 14, kept',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Select section 2',exact:true}).click();await page.keyboard.press('Delete');
 await expect(page.getByRole('button',{name:'Section 2, frames 6 to 14, removed',exact:true})).toBeVisible();
 await page.keyboard.press('Control+z');await expect(page.getByRole('button',{name:'Section 2, frames 6 to 14, kept',exact:true})).toBeVisible();
 await page.keyboard.press('Control+Shift+z');await expect(page.getByRole('button',{name:'Restore selected section',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Restore selected section',exact:true}).click();await page.getByRole('button',{name:'Remove selected section',exact:true}).click();
 await page.getByLabel('New video filename').fill('Team cuts.mp4');await page.getByRole('button',{name:'Combine & save video',exact:true}).click();
 const downloadLink=page.getByRole('link',{name:'Save new video (.mp4)',exact:true});await expect(downloadLink).toBeVisible({timeout:30000});const video=page.getByLabel('Trimmed video preview');
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 expect(await video.evaluate((v:HTMLVideoElement)=>[v.videoWidth,v.videoHeight])).toEqual([640,360]);
 const event=page.waitForEvent('download');await downloadLink.click();const file=await event;expect(file.suggestedFilename()).toBe('Team cuts.mp4');expect(await file.failure()).toBeNull();const filename=testInfo.outputPath('trimmed.mp4');await file.saveAs(filename);
 expect(await(await request.get('/api/projects')).json()).toEqual(before);
 await page.reload();await page.getByRole('button',{name:'Trim sections',exact:true}).click();await expect(downloadLink).toBeVisible();
 const p=await(await request.post('/api/projects',{data:{name:'Prepared clip '+Date.now(),classes:['Object']}})).json();
 const uploaded=await(await request.post(`/api/projects/${p.id}/videos`,{multipart:{file:{name:'Team cuts.mp4',mimeType:'video/mp4',buffer:fs.readFileSync(filename)}}})).json();
 await expect.poll(async()=>(await(await request.get('/api/projects/'+p.id)).json()).videos[uploaded.video_id].status).toBe('ready');
 const fresh=await(await request.get('/api/projects/'+p.id)).json();expect(fresh.videos[uploaded.video_id].frame_count).toBe(15);expect(fresh.state.observations).toEqual({});
 await page.getByRole('button',{name:'Back to videos',exact:true}).last().click();await page.getByTestId('open-project-'+p.id).click();await page.getByTestId('open-video-'+uploaded.video_id).click();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');await expect(page.getByLabel('Go to frame')).toHaveAttribute('max','14');
});
test('C cuts during playback, shortcuts ignore typing, and empty output cannot be saved',async({page})=>{
 await openTrim(page);
 await page.getByRole('combobox',{name:'Trim playback speed'}).click();await page.getByRole('option',{name:'0.25×',exact:true}).click();
 await page.getByRole('button',{name:'Play source video',exact:true}).click();
 await expect.poll(()=>page.getByLabel('Source video player').evaluate((v:HTMLVideoElement)=>v.currentTime),{intervals:[20]}).toBeGreaterThan(.09);
 await page.keyboard.press('c');await expect(page.getByRole('button',{name:'Select section 2',exact:true})).toBeVisible();
 expect(await page.getByLabel('Source video player').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(false);
 await page.getByRole('button',{name:'Pause source video',exact:true}).click();
 await page.keyboard.press('Control+z');await expect(page.getByRole('button',{name:'Select section 2',exact:true})).toHaveCount(0);
 await page.getByLabel('New video filename').fill('C');await page.keyboard.press('c');await expect(page.getByRole('button',{name:'Select section 2',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Select section 1',exact:true}).click();await page.keyboard.press('Delete');await expect(page.getByRole('button',{name:'Combine & save video',exact:true})).toBeDisabled();
 await page.reload();await page.getByRole('button',{name:'Trim sections',exact:true}).click();await expect(page.getByRole('button',{name:'Restore selected section',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Restore selected section',exact:true}).click();await expect(page.getByRole('button',{name:'Combine & save video',exact:true})).toBeEnabled();
});

test('unsupported source playback can prepare a compatible preview and preserve the cuts',async({page})=>{
 await openTrim(page);await cutAt(page,6);
 await page.route('**/api/video-trims/*/source',route=>route.fulfill({contentType:'video/mp4',body:'unsupported test video'}));
 await page.reload();await page.getByRole('button',{name:'Trim sections',exact:true}).click();
 await page.getByRole('button',{name:'Prepare playback preview',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play source video',exact:true})).toBeEnabled({timeout:30000});
 await expect(page.getByRole('button',{name:'Section 2, frames 6 to 23, kept',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Play source video',exact:true}).click();await expect(page.getByRole('button',{name:'Pause source video',exact:true})).toBeVisible();
});
