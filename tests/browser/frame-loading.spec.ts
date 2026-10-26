import {test, expect, type Page, type APIRequestContext, type APIResponse} from '../../frontend/node_modules/@playwright/test';
import {randomUUID} from 'node:crypto';

type Cameras = {pid:string; videos:string[]; cameras:{id:string;name:string;video_id:string;offset_seconds:number}[]; session:{id:string}};
async function json(response:APIResponse){expect(response.ok(), await response.text()).toBeTruthy();return response.json();}

async function setup(request:APIRequestContext, count=4):Promise<Cameras>{
  const project=await json(await request.post('/api/projects',{data:{name:'Frame loading '+randomUUID(),classes:['Person']}}));
  const videos:string[]=[];
  for(let index=0;index<count;index++){
    const imported=await json(await request.post(`/api/projects/${project.id}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}}));
    videos.push(imported.video_id);
    await expect.poll(async()=>(await json(await request.get(`/api/videos/${imported.video_id}/metadata`))).status).toBe('ready');
  }
  const cameras=videos.map((video_id,index)=>({id:randomUUID(),name:`Camera ${index+1}`,video_id,offset_seconds:0}));
  const session=await json(await request.post(`/api/projects/${project.id}/camera-sessions`,{data:{name:'Four slow cameras',cameras}}));
  return {pid:project.id,videos,cameras,session};
}

async function openSession(page:Page, fixture:Cameras, waitForPreviews=true){
  await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
  await page.goto('/');
  await page.getByTestId('open-project-'+fixture.pid).click();
  await page.getByTestId('open-session-'+fixture.session.id).click();
  await expect(page.getByTestId('multicamera-workspace')).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
  if(waitForPreviews)for(const camera of fixture.cameras.slice(1))await expect(page.getByTestId('camera-tile-'+camera.id).locator('.mc-preview img')).toBeVisible();
}

async function slowFrames(page:Page, milliseconds=150){
  await page.route('**/api/videos/*/frames/*',async route=>{
    // Simulate a busy local server or slower disk; no image contents are changed.
    await new Promise(resolve=>setTimeout(resolve,milliseconds));
    await route.continue().catch(()=>{});
  });
}

test('four camera playback displays every source frame despite slow frame responses',async({page,request},testInfo)=>{
  const fixture=await setup(request);
  await slowFrames(page);
  await openSession(page,fixture);
  await page.evaluate(()=>{
    const seen:Record<string,number[]>={};
    (window as any).__visibleCameraFrames=seen;
    const sample=()=>{
      document.querySelectorAll<HTMLElement>('.mc-tile').forEach(tile=>{
        const id=tile.dataset.testid!;
        let frame:number|undefined;
        const canvas=tile.querySelector<HTMLElement>('[data-testid="canvas"]');
        if(canvas){const value=canvas.dataset.frame;if(value!==undefined&&value!=='loading')frame=Number(value);}
        else {
          const image=tile.querySelector<HTMLImageElement>('.mc-preview img');
          if(image?.complete&&image.naturalWidth>0&&getComputedStyle(image).visibility!=='hidden'){
            const match=new URL(image.src).pathname.match(/\/frames\/(\d+)$/);
            if(match)frame=Number(match[1]);
          }
        }
        if(frame!==undefined&&!(seen[id]||=[]).includes(frame))seen[id].push(frame);
      });
      (window as any).__frameSampling=requestAnimationFrame(sample);
    };
    sample();
  });
  await page.getByRole('button',{name:'Play all cameras',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause all cameras',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play all cameras',exact:true})).toBeVisible({timeout:20000});
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','23');
  for(const camera of fixture.cameras.slice(1)){
    const image=page.getByTestId('camera-tile-'+camera.id).locator('.mc-preview img');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src',new RegExp(`/frames/23(?:\\?.*)?$`));
  }
  const seen=await page.evaluate(()=>{cancelAnimationFrame((window as any).__frameSampling);return (window as any).__visibleCameraFrames as Record<string,number[]>;});
  await testInfo.attach('visible-source-frames',{body:JSON.stringify(seen,null,2),contentType:'application/json'});
  for(const camera of fixture.cameras)expect.soft(seen['camera-tile-'+camera.id],camera.name+' should visibly display every frame before advancing').toEqual(Array.from({length:24},(_,index)=>index));
});

test('failed passive camera frame can retry without switching the editing camera',async({page,request})=>{
  const fixture=await setup(request,2);
  let attempts=0;
  await page.route(new RegExp(`/api/videos/${fixture.videos[1]}/frames/0(?:\\?.*)?$`),async route=>{
    attempts++;
    if(attempts===1)await route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Transient frame failure"}'});
    else await route.continue();
  });
  await openSession(page,fixture,false);
  const passive=page.getByTestId('camera-tile-'+fixture.cameras[1].id);
  const retry=passive.getByRole('button',{name:'Retry frame',exact:true});
  await expect(retry).toBeVisible();
  await expect(passive.locator('.mc-preview img')).not.toBeVisible();
  await retry.click();
  await expect(passive.locator('.mc-preview img')).toBeVisible();
  await expect(passive.locator('svg[aria-label="Annotations in Camera 2"]')).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page.getByTestId('camera-tile-'+fixture.cameras[0].id)).toHaveClass(/is-active/);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
  expect(attempts).toBe(2);
});

test('returning to a previously loaded passive frame still exposes a new failure and retry',async({page,request})=>{
  const fixture=await setup(request,2);
  await page.addInitScript(({video})=>{
    // Chromium may reuse decoded image resources even when HTTP caching is off.
    // Give each new element a fresh URL so this test can fail a revisit request.
    const prefix=`/api/videos/${video}/frames/`;
    let request=0;
    const fresh=(value:string)=>value.includes(prefix)?value+(value.includes('?')?'&':'?')+'test_request='+(++request):value;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;
    Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value:string){descriptor.set!.call(this,fresh(String(value)));}});
    const original=Element.prototype.setAttribute;
    Element.prototype.setAttribute=function(name:string,value:string){original.call(this,name,this instanceof HTMLImageElement&&name.toLowerCase()==='src'?fresh(String(value)):value);};
  },{video:fixture.videos[1]});
  const attempts:Record<string,number>={};
  await page.route(new RegExp(`/api/videos/${fixture.videos[1]}/frames/(0|12)(?:\\?.*)?$`),async route=>{
    const frame=new URL(route.request().url()).pathname.split('/').pop()!;
    attempts[frame]=(attempts[frame]||0)+1;
    if(frame==='12'||frame==='0'&&attempts[frame]===2){
      await route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Transient frame failure"}'});
    }else {
      const response=await route.fetch();
      // Force the revisit to make a real request instead of reusing frame 0's
      // decoded browser cache; only response caching changes, never the pixels.
      await route.fulfill({response,headers:{...response.headers(),'cache-control':'no-store'}});
    }
  });
  await openSession(page,fixture);
  const passive=page.getByTestId('camera-tile-'+fixture.cameras[1].id);
  const retry=passive.getByRole('button',{name:'Retry frame',exact:true});
  await page.getByLabel('Active camera frame',{exact:true}).fill('12');
  await expect(retry).toBeVisible();
  await page.getByLabel('Active camera frame',{exact:true}).fill('0');
  await expect.poll(()=>attempts['0']).toBe(2);
  // The earlier successful frame 0 must not mark this failed request as loaded.
  await expect(retry).toBeVisible();
  await expect(passive.locator('.mc-preview img')).not.toBeVisible();
  await expect(passive.locator('svg[aria-label="Annotations in Camera 2"]')).toHaveCount(0);
  await retry.click();
  await expect(passive.locator('.mc-preview img')).toBeVisible();
  await expect(passive.locator('.mc-preview')).toHaveAttribute('data-frame','0');
  expect(await passive.locator('.mc-preview img').evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
  await expect(retry).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');
  expect(attempts['0']).toBe(3);
});

test('active frame retry recovers and navigation clears an older frame error',async({page,request})=>{
  const fixture=await setup(request,2);
  const attempts:Record<string,number>={};
  await page.route(new RegExp(`/api/videos/${fixture.videos[0]}/frames/(12|19)(?:\\?.*)?$`),async route=>{
    const frame=new URL(route.request().url()).pathname.split('/').pop()!;
    attempts[frame]=(attempts[frame]||0)+1;
    if(attempts[frame]===1)await route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Transient frame failure"}'});
    else await route.continue();
  });
  await openSession(page,fixture);
  const active=page.getByTestId('camera-tile-'+fixture.cameras[0].id);
  const retry=active.getByRole('button',{name:'Retry frame',exact:true});
  await page.getByLabel('Active camera frame',{exact:true}).fill('12');
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','loading');
  await retry.click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','12');
  await expect(retry).toHaveCount(0);
  expect(attempts['12']).toBe(2);
  await page.getByLabel('Active camera frame',{exact:true}).fill('19');
  await expect(retry).toBeVisible();
  await page.getByLabel('Active camera frame',{exact:true}).fill('8');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','8');
  await expect(retry).toHaveCount(0);
  await expect(active).not.toContainText('Exact frame unavailable');
});

test('three browser pages keep their four-camera previews independent under slow loading',async({page,context,request})=>{
  const fixture=await setup(request);
  const pages=[page,await context.newPage(),await context.newPage()];
  const targets=[7,11,17];
  try{
    await Promise.all(pages.map(async current=>{await slowFrames(current,120);await openSession(current,fixture);}));
    await Promise.all(pages.map((current,index)=>current.getByLabel('Active camera frame',{exact:true}).fill(String(targets[index]))));
    const ready=async(current:Page,frame:number)=>{
      await expect(current.getByTestId('canvas')).toHaveAttribute('data-frame',String(frame));
      for(const camera of fixture.cameras.slice(1)){
        const image=current.getByTestId('camera-tile-'+camera.id).locator('.mc-preview img');
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute('src',new RegExp(`/frames/${frame}(?:\\?.*)?$`));
        expect(await image.evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
      }
    };
    await Promise.all(pages.map((current,index)=>ready(current,targets[index])));
    await pages[1].getByLabel('Active camera frame',{exact:true}).fill('20');
    await Promise.all([ready(pages[0],7),ready(pages[1],20),ready(pages[2],17)]);
  }finally{await Promise.all(pages.slice(1).map(current=>current.close()));}
});
