import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';

let projectId:string,videoId:string;
const release=(can_install=false)=>({status:'available',current_version:'3.0.0',latest_version:'3.1.0',release_notes:'Faster review\nMore annotation classes',release_url:'https://github.com/frameinsight/frameinsight/releases/tag/v3.1.0',can_install,asset:{name:'Window_setup.exe',size:12345678}});
const state=async(request:any)=>(await request.get('/api/projects/'+projectId)).json();
async function open(page:Page){await page.goto('/');await page.getByTestId('open-project-'+projectId).click();await page.getByTestId('open-video-'+videoId).click();await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');}
async function draw(page:Page,a=[100,80],b=[200,300]){const v=await page.getByTestId('canvas').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x+Number(e.getAttribute('data-offset-x')),y:r.y+Number(e.getAttribute('data-offset-y')),s:Number(e.getAttribute('data-scale'))}});await page.mouse.move(v.x+a[0]*v.s,v.y+a[1]*v.s);await page.mouse.down();await page.mouse.move(v.x+b[0]*v.s,v.y+b[1]*v.s,{steps:5});await page.mouse.up();}

test.beforeEach(async({request,page})=>{
 await page.route('**/api/updates/status',route=>route.fulfill({json:{status:'idle',progress:0}}));
 projectId=(await(await request.post('/api/projects',{data:{name:'Updater acceptance '+Date.now(),classes:['Person']}})).json()).id;
 videoId=(await(await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await state(request)).videos[videoId].status).toBe('ready');
});

test('startup update can be inspected and skipped without changing work or triggering annotation shortcuts',async({page,request})=>{
 await page.route('**/api/updates/check*',route=>route.fulfill({json:release()}));await open(page);const before=await state(request);
 await expect(page.getByLabel('Update available')).toContainText('3.1.0');await page.getByRole('button',{name:'View update',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Faster review');await expect(page.getByRole('dialog')).toContainText('More annotation classes');await expect(page.getByRole('link',{name:'View release on GitHub ↗'})).toHaveAttribute('href',release().release_url);
 await page.keyboard.press('n');await page.keyboard.press('Delete');expect((await state(request)).state).toEqual(before.state);
 await page.getByRole('button',{name:'Skip for now',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('Update available')).toHaveCount(0);expect((await state(request)).revision).toBe(before.revision);
 await page.getByTestId('canvas').press('n');await draw(page);await expect(page.locator('.save-status')).toHaveText('Saved');expect(Object.keys((await state(request)).state.observations)).toHaveLength(1);
});

test('download waits for real pending saves, shows progress and saves a verified installer in manual mode',async({page,request})=>{
 let downloads=0,installs=0,finishDownload=false,releaseSave!:()=>void;
 await page.route('**/api/updates/check*',route=>route.fulfill({json:release()}));
 await page.route('**/api/updates/download',async route=>{downloads++;expect(route.request().postDataJSON()).toEqual({version:'3.1.0'});await route.fulfill({json:{status:'downloading',progress:.1,version:'3.1.0',can_install:false}})});
 await page.route('**/api/updates/status',route=>{if(!downloads)return route.fulfill({json:{status:'idle',progress:0}});return route.fulfill({json:finishDownload?{status:'ready',progress:1,version:'3.1.0',can_install:false}:{status:'downloading',progress:.5,version:'3.1.0',can_install:false}})});
 await page.route('**/api/updates/install',async route=>{installs++;await route.fulfill({json:{action:'download',download_url:'/test-update-installer.exe'}})});
 await page.route('**/test-update-installer.exe',route=>route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Window_setup.exe"'},body:'playwright fixture, not executable'}));
 await open(page);await page.getByTestId('canvas').press('n');await draw(page);await expect(page.locator('.save-status')).toHaveText('Saved');const before=await state(request);
 const gate=new Promise<void>(resolve=>{releaseSave=resolve});let saving=false;
 await page.route(`**/api/projects/${projectId}/operations`,async route=>{if(route.request().method()==='POST'){saving=true;await gate;}await route.continue()});
 try{
  await draw(page,[150,190],[160,190]);await expect.poll(()=>saving).toBe(true);await page.getByRole('button',{name:'View update',exact:true}).click();await page.getByRole('button',{name:/^Update ·/}).click();await expect(page.getByRole('dialog')).toContainText('Saving…');expect(downloads).toBe(0);
  releaseSave();await expect.poll(()=>downloads).toBe(1);await expect(page.getByRole('status')).toContainText('Downloading and verifying');await expect(page.getByRole('status')).toContainText('50%');finishDownload=true;await expect(page.getByRole('button',{name:'Save installer',exact:true})).toBeEnabled();expect((await state(request)).revision).toBeGreaterThan(before.revision);
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Save installer',exact:true}).click();expect((await event).suggestedFilename()).toBe('Window_setup.exe');expect(installs).toBe(1);await expect(page.getByTestId('canvas')).toBeVisible();
 }finally{releaseSave();}
});

test('managed install requests a saved verified version and shows restart instructions',async({page,request})=>{
 await page.route('**/api/updates/check*',route=>route.fulfill({json:release(true)}));await page.route('**/api/updates/download',route=>route.fulfill({json:{status:'ready',progress:1,version:'3.1.0',can_install:true}}));let installed:any;
 await page.route('**/api/updates/install',route=>{installed=route.request().postDataJSON();return route.fulfill({json:{action:'closing',message:'Installer launched safely.'}})});
 await open(page);const before=await state(request);await page.getByRole('button',{name:'View update',exact:true}).click();await page.getByRole('button',{name:/^Update ·/}).click();await expect(page.getByRole('button',{name:'Install update',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Install update',exact:true}).click();await expect(page.getByRole('status')).toContainText('Reopen Frameinsight after installation finishes');expect(installed).toEqual({version:'3.1.0'});expect((await state(request)).state).toEqual(before.state);
});

test('offline checking stays nonblocking and retry can discover a release',async({page,request})=>{
 let checks=0;await page.route('**/api/updates/check*',route=>{checks++;return route.fulfill({json:checks<=2?{status:'offline',current_version:'3.0.0',can_install:false,message:'Update service unavailable. Continue annotating.'}:release()})});
 await open(page);await expect(page.getByLabel('Update available')).toHaveCount(0);await page.getByTestId('canvas').press('n');await draw(page);await expect(page.locator('.save-status')).toHaveText('Saved');const before=await state(request);
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();await expect(page.getByRole('status')).toContainText('Continue annotating');await page.getByRole('button',{name:'Check again',exact:true}).click();await expect(page.getByRole('heading',{name:'Frameinsight 3.1.0',exact:true})).toBeVisible();expect(checks).toBe(3);await page.getByRole('button',{name:'Skip for now',exact:true}).click();expect((await state(request)).state).toEqual(before.state);
});

test('an existing download resumes status checks after a temporary connection error without starting another download',async({page,request})=>{
 let checks=0,downloads=0;await page.route('**/api/updates/check*',route=>route.fulfill({json:release()}));
 await page.route('**/api/updates/download',route=>{downloads++;return route.fulfill({json:{status:'error',message:'Unexpected duplicate download'}})});
 await page.route('**/api/updates/status',route=>{checks++;if(checks===2)return route.abort('failed');return route.fulfill({json:checks<4?{status:'downloading',progress:.4,version:'3.1.0',can_install:false}:{status:'ready',progress:1,version:'3.1.0',can_install:false,download_url:'/api/updates/file'}})});
 await open(page);const before=await state(request);await page.getByRole('button',{name:'View update',exact:true}).click();await expect(page.getByRole('button',{name:'Save installer',exact:true})).toBeEnabled({timeout:10000});await expect(page.getByRole('link',{name:'Save verified installer for manual installation'})).toHaveAttribute('href','/api/updates/file');expect(checks).toBeGreaterThanOrEqual(4);expect(downloads).toBe(0);expect((await state(request)).state).toEqual(before.state);
});

test('a verified cached installer stays usable while the release check is offline',async({page,request})=>{
 let downloads=0,installed:any;
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'offline',current_version:'3.0.0',can_install:false,message:'The release service is offline.'}}));
 await page.route('**/api/updates/status',route=>route.fulfill({json:{status:'ready',progress:1,version:'3.1.0',can_install:false,download_url:'/cached-update.exe'}}));
 await page.route('**/api/updates/download',route=>{downloads++;return route.fulfill({json:{status:'error',message:'Should use the cached verified installer'}})});
 await page.route('**/api/updates/install',route=>{installed=route.request().postDataJSON();return route.fulfill({json:{action:'download',download_url:'/cached-update.exe'}})});
 await page.route('**/cached-update.exe',route=>route.fulfill({status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="Window_setup.exe"'},body:'playwright cached fixture, not executable'}));
 await open(page);await page.getByTestId('canvas').press('n');await draw(page);await expect(page.locator('.save-status')).toHaveText('Saved');const before=await state(request);
 await page.getByRole('button',{name:'Check for updates',exact:true}).click();await expect(page.getByRole('button',{name:'Save installer',exact:true})).toBeEnabled();await expect(page.getByRole('link',{name:'Save verified installer for manual installation'})).toHaveAttribute('href','/cached-update.exe');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save installer',exact:true}).click();expect((await download).suggestedFilename()).toBe('Window_setup.exe');expect(installed).toEqual({version:'3.1.0'});expect(downloads).toBe(0);expect((await state(request)).state).toEqual(before.state);
});
