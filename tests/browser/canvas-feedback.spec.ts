import {test,expect,type Page} from '../../frontend/node_modules/@playwright/test';
import {selectOption} from './select';
let projectId:string,videoId:string;
const canvas=(page:Page)=>page.getByTestId('canvas');
async function point(page:Page,x:number,y:number){return canvas(page).evaluate((el,p)=>{const r=el.getBoundingClientRect(),s=Number(el.getAttribute('data-scale'));return {x:r.x+Number(el.getAttribute('data-offset-x'))+p.x*s,y:r.y+Number(el.getAttribute('data-offset-y'))+p.y*s}}, {x,y})}
async function drag(page:Page,a:number[],b:number[],dismissRegistration=true){const start=await point(page,a[0],a[1]),end=await point(page,b[0],b[1]);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();if(dismissRegistration&&await page.getByRole('dialog',{name:'Track ID, class & color'}).isVisible())await page.keyboard.press('Escape');await expect(page.locator('.save-status')).toHaveText('Saved')}
async function state(request:any){return (await request.get(`/api/projects/${projectId}`)).json()}
async function settings(page:Page){await page.getByRole('button',{name:'Canvas settings',exact:true}).click();await expect(page.getByRole('dialog',{name:'Canvas settings',exact:true})).toBeVisible()}
async function closeSettings(page:Page){await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0)}
async function labels(page:Page){return JSON.parse((await canvas(page).getAttribute('data-labels'))||'[]')}
async function reopen(page:Page){await page.reload();await page.getByTestId('open-project-'+projectId).click();await page.getByTestId('open-video-'+videoId).click();await expect(canvas(page)).toHaveAttribute('data-frame','0')}
test.beforeEach(async({page,request})=>{
 projectId=(await(await request.post('/api/projects',{data:{name:'Canvas feedback '+Date.now(),classes:['person_visible','person_extended']}})).json()).id;
 videoId=(await(await request.post(`/api/projects/${projectId}/videos/local`,{data:{path:'tests/fixtures/numbered.mp4'}})).json()).video_id;
 await expect.poll(async()=>(await state(request)).videos[videoId].status).toBe('ready');
 await page.route('**/api/updates/check*',route=>route.fulfill({json:{status:'current',current_version:'test',can_install:false}}));
 await page.goto('/');await page.getByTestId('open-project-'+projectId).click();await page.getByTestId('open-video-'+videoId).click();await expect(canvas(page)).toHaveAttribute('data-frame','0');
});

test('class colors match the palette across tracks, labels, class pills and timeline; view changes preserve saved data',async({page,request})=>{
 await canvas(page).press('n');await drag(page,[100,80],[200,280]);
 await page.getByRole('button',{name:'Select class person_extended',exact:true}).click();await drag(page,[90,70],[210,320]);
 await canvas(page).press('n');await drag(page,[300,70],[420,320]);
 await page.getByRole('button',{name:'Select class person_visible',exact:true}).click();await drag(page,[310,80],[410,280]);
 const before=await state(request),tracks=Object.values(before.state.identities) as any[];
 expect(tracks[0].color).not.toBe(tracks[1].color);
 for(const b of await labels(page))expect(b.color).toBe(before.class_colors[b.className]);
 const rgb=(hex:string)=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';
 for(const name of ['person_visible','person_extended']){
  const color=rgb(before.class_colors[name]);
  await expect(page.getByRole('button',{name:'Select class '+name,exact:true}).locator('i')).toHaveCSS('background-color',color);
  for(const dot of await page.locator('.person-classes small[title="'+name+'"] i').all())await expect(dot).toHaveCSS('background-color',color);
 }
 await expect(page.locator('.timeline-track .present').first()).toHaveCSS('background-color',rgb(before.class_colors.person_visible));
 await settings(page);await selectOption(page,'View by','Track — use each track’s color');await closeSettings(page);
 for(const b of await labels(page))expect(b.color).toBe(before.state.identities[b.identity].color);
 await settings(page);await selectOption(page,'View by','Class — use project class colors');await closeSettings(page);
 for(const b of await labels(page))expect(b.color).toBe(before.class_colors[b.className]);
 expect((await state(request)).state).toEqual(before.state);
 await reopen(page);for(const b of await labels(page))expect(b.color).toBe(before.class_colors[b.className]);
});

test('label modes and confirmation preference persist without modifying annotations; I remains available',async({page,request})=>{
 await canvas(page).press('n');await drag(page,[100,80],[200,280]);await canvas(page).press('n');await drag(page,[300,80],[400,280]);
 const smart=await labels(page);expect(smart.filter((b:any)=>b.name)).toHaveLength(1);
 await settings(page);await selectOption(page,'Box labels','All labels');await closeSettings(page);
 const before=await state(request),full=await labels(page);expect(full).toHaveLength(2);
 for(const [choice,count] of [['Selected box only',1],['Compact IDs only',2],['Hide labels',0]] as const){
  await settings(page);await selectOption(page,'Box labels',choice);await closeSettings(page);expect(await labels(page)).toHaveLength(count);
  if(choice==='Compact IDs only')for(const b of await labels(page)){expect(b.name).toBe('');expect(b.width).toBeLessThan(full.find((old:any)=>old.key===b.key).width)}
 }
 expect((await state(request)).state).toEqual(before.state);
 // Hidden badges no longer catch clicks; their boxes still move and undo normally.
 await drag(page,[350,180],[355,180]);expect((await state(request)).state).not.toEqual(before.state);await canvas(page).press('Control+z');await expect(page.locator('.save-status')).toHaveText('Saved');expect((await state(request)).state).toEqual(before.state);
 await settings(page);await page.getByRole('checkbox',{name:'Confirm new tracks',exact:true}).uncheck();await closeSettings(page);
 await reopen(page);expect(await labels(page)).toHaveLength(0);
 await canvas(page).press('n');await drag(page,[450,80],[550,280],false);await expect(page.getByRole('dialog')).toHaveCount(0);
 await canvas(page).press('i');await expect(page.getByRole('dialog',{name:'Track ID, class & color'})).toBeVisible();await expect(page.getByLabel('Track ID',{exact:true})).toHaveValue('3');await page.keyboard.press('Escape');
 await settings(page);await expect(page.getByRole('checkbox',{name:'Confirm new tracks',exact:true})).not.toBeChecked();await page.getByRole('checkbox',{name:'Confirm new tracks',exact:true}).check();await closeSettings(page);
 await canvas(page).press('n');const start=await point(page,20,80),end=await point(page,70,280);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();await expect(page.getByRole('dialog',{name:'Track ID, class & color'})).toBeVisible();
});

test('selected dimensions persist without dragging and use source pixels across zoom, edits and reload',async({page,request})=>{
 // Earlier versions saved false while changing unrelated preferences. It must
 // no longer suppress the selected box's readout after upgrading.
 await page.evaluate(()=>localStorage.setItem('frameinsight:canvasPreferences',JSON.stringify({labels:'all',keepDimensions:false,confirmNewTracks:false})));
 await reopen(page);
 await settings(page);await page.getByRole('checkbox',{name:'Confirm new tracks',exact:true}).uncheck();await closeSettings(page);
 await canvas(page).press('n');let start=await point(page,100,80),end=await point(page,200,280);
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});
 const dimensions=page.getByTestId('box-dimensions');await expect(dimensions).toBeVisible();expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(100,0);expect(Number(await dimensions.getAttribute('data-height'))).toBeCloseTo(200,0);
 await page.mouse.up();await expect(dimensions).toBeVisible();await expect(page.locator('.save-status')).toHaveText('Saved');
 const before=await state(request);await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(100,0);expect(Number(await dimensions.getAttribute('data-height'))).toBeCloseTo(200,0);
 await drag(page,[150,180],[160,180]);expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(100,0);
 await drag(page,[210,180],[230,180]);expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(120,0);expect(Number(await dimensions.getAttribute('data-height'))).toBeCloseTo(200,0);
 await canvas(page).press('Control+z');await canvas(page).press('Control+z');await expect(page.locator('.save-status')).toHaveText('Saved');expect((await state(request)).state).toEqual(before.state);
 await reopen(page);await page.getByRole('button',{name:'Select Track 1',exact:true}).click();await expect(dimensions).toBeVisible();
 const unchanged=await state(request);
 // Hidden/absent boxes must not leave stale dimensions on the next frame.
 await page.getByRole('button',{name:'Hide class person_visible',exact:true}).click();await expect(dimensions).toHaveCount(0);
 await page.getByRole('button',{name:'Show class person_visible',exact:true}).click();await expect(dimensions).toBeVisible();
 await page.getByLabel('Go to frame').fill('1');await expect(canvas(page)).toHaveAttribute('data-frame','1');await expect(dimensions).toHaveCount(0);
 await page.getByLabel('Go to frame').fill('0');await expect(canvas(page)).toHaveAttribute('data-frame','0');await expect(dimensions).toBeVisible();
 expect((await state(request)).state).toEqual(unchanged.state);
 // Selecting a different box without moving it immediately changes the readout.
 await canvas(page).press('n');await drag(page,[300,80],[360,240]);
 expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(60,0);expect(Number(await dimensions.getAttribute('data-height'))).toBeCloseTo(160,0);
 const first=await point(page,150,180);await page.mouse.click(first.x,first.y);
 expect(Number(await dimensions.getAttribute('data-width'))).toBeCloseTo(100,0);expect(Number(await dimensions.getAttribute('data-height'))).toBeCloseTo(200,0);
 await page.getByRole('button',{name:'Hide Track 1',exact:true}).click();await expect(dimensions).toHaveCount(0);
});

test('overlap chooser selects each class without hiding or modifying identical boxes',async({page,request})=>{
 await canvas(page).press('n');await drag(page,[100,80],[200,280]);
 await page.getByRole('button',{name:'Copy to class…',exact:true}).click();await selectOption(page,'Target class','person_extended');await page.getByRole('button',{name:'Copy boxes',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.save-status')).toHaveText('Saved');
 const before=await state(request),center=await point(page,150,180);
 for(const name of ['person_visible','person_extended']){
  await page.mouse.click(center.x,center.y,{button:'right'});await page.getByRole('menuitem',{name:'Select overlapping box',exact:true}).click();
  await page.getByRole('menuitem',{name:'Track 1 · '+name,exact:true}).click();await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select class '+name,exact:true})).toHaveAttribute('aria-pressed','true');
 }
 expect((await state(request)).state).toEqual(before.state);
 await page.getByRole('button',{name:'Hide class person_extended',exact:true}).click();await page.mouse.click(center.x,center.y,{button:'right'});await expect(page.getByRole('menuitem',{name:'Select overlapping box',exact:true})).toHaveCount(0);
});

test('top-edge labels avoid boxes and disappear during editing without changing the other class',async({page,request})=>{
 await canvas(page).press('n');await drag(page,[100,1],[160,140]);
 await page.getByRole('button',{name:'Select class person_extended',exact:true}).click();await drag(page,[90,0],[170,220]);
 await page.getByRole('button',{name:'Select class person_visible',exact:true}).click();
 const before=await state(request),observation=Object.values(before.state.observations)[0] as any;
 const corners=await Promise.all([point(page,90,0),point(page,170,220)]),bounds=(await canvas(page).boundingBox())!;
 for(const b of await labels(page))expect(b.x+b.width<=corners[0].x-bounds.x||b.x>=corners[1].x-bounds.x||b.y+b.height<=corners[0].y-bounds.y||b.y>=corners[1].y-bounds.y).toBe(true);
 const target=await point(page,130,50);
 await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+15,target.y+15,{steps:5});
 expect(await labels(page)).toHaveLength(0);await expect(page.getByTestId('box-dimensions')).toBeVisible();
 await page.mouse.up();await expect(page.locator('.save-status')).toHaveText('Saved');expect(await labels(page)).toHaveLength(2);
 await expect(page.getByRole('button',{name:'Select class person_visible',exact:true})).toHaveAttribute('aria-pressed','true');
 const after=await state(request),changed=after.state.observations[observation.id];
 expect(changed.boxes['class:person_visible']).not.toEqual(observation.boxes['class:person_visible']);
 expect(changed.boxes['class:person_extended']).toEqual(observation.boxes['class:person_extended']);
});
