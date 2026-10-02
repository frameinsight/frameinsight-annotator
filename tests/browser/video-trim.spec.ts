import {test,expect} from '../../frontend/node_modules/@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
test('standalone trimming creates a new downloadable video that can be uploaded without changing projects',async({page,request},testInfo)=>{
 await page.route('**/api/updates/check*',r=>r.fulfill({json:{status:'current'}}));await page.goto('/');
 const before=await(await request.get('/api/projects')).json();
 await page.getByRole('button',{name:'Trim sections',exact:true}).click();
 await page.getByLabel('Source video to trim').setInputFiles(path.resolve('../tests/fixtures/numbered.mp4'));
 const end=page.getByRole('slider',{name:'Section 1 end',exact:true});await expect(end).toHaveAttribute('aria-valuenow','23');
 const bounds=await end.boundingBox(),track=await page.locator('[aria-label="Section 1"] [data-slot="slider-track"]').boundingBox();
 await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);await page.mouse.down();await page.mouse.move(track!.x+track!.width*5/23,track!.y+track!.height/2,{steps:8});await page.mouse.up();await expect(end).toHaveAttribute('aria-valuenow','5');await expect(page.getByAltText('Source frame 5',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add section',exact:true}).click();await page.getByRole('slider',{name:'Section 2 end',exact:true}).press('End');await page.getByLabel('Section 2 start frame',{exact:true}).fill('15');await page.getByLabel('Section 2 end frame',{exact:true}).fill('20');
 await page.getByLabel('New video filename').fill('Team clip.mp4');await page.getByRole('button',{name:'Create new video',exact:true}).click();
 const downloadLink=page.getByRole('link',{name:'Save new video (.mp4)',exact:true});await expect(downloadLink).toBeVisible({timeout:30000});const video=page.getByLabel('Trimmed video preview');await expect(video).toBeVisible();
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
 const event=page.waitForEvent('download');await downloadLink.click();const file=await event;expect(file.suggestedFilename()).toBe('Team clip.mp4');expect(await file.failure()).toBeNull();const filename=testInfo.outputPath('trimmed.mp4');await file.saveAs(filename);
 expect(await(await request.get('/api/projects')).json()).toEqual(before);
 // Reopening retains the prepared result, and annotation has no crop/scope toggle.
 await page.reload();await page.getByRole('button',{name:'Trim sections',exact:true}).click();await expect(downloadLink).toBeVisible();
 const p=await(await request.post('/api/projects',{data:{name:'Prepared clip '+Date.now(),classes:['Object']}})).json();
 const uploaded=await(await request.post(`/api/projects/${p.id}/videos`,{multipart:{file:{name:'Team clip.mp4',mimeType:'video/mp4',buffer:fs.readFileSync(filename)}}})).json();
 await expect.poll(async()=>(await(await request.get('/api/projects/'+p.id)).json()).videos[uploaded.video_id].status).toBe('ready');
 const fresh=await(await request.get('/api/projects/'+p.id)).json();expect(fresh.videos[uploaded.video_id].frame_count).toBe(12);expect(fresh.state.observations).toEqual({});
 await page.getByRole('button',{name:'Back to videos',exact:true}).last().click();await page.getByTestId('open-project-'+p.id).click();await page.getByTestId('open-video-'+uploaded.video_id).click();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');await expect(page.getByRole('button',{name:'Crop video',exact:true})).toHaveCount(0);await expect(page.getByLabel('Go to frame')).toHaveAttribute('max','11');
});
