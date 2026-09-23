import {test,expect} from '../../frontend/node_modules/@playwright/test';
import fs from 'node:fs';
test('real-clip navigation measurement records actual worker status',async({page,request})=>{
 const projects=await (await request.get('/api/projects')).json();const p=projects.find((p:any)=>p.name==='Cam01 · Occlusion review');test.skip(!p,'Real user clip not imported on this machine');
 const project=await (await request.get('/api/projects/'+p.id)).json();const vid=Object.keys(project.videos)[0];await page.goto('/');
 await page.getByTestId('open-project-'+p.id).click();const coldStart=Date.now();await page.getByTestId('open-video-'+vid).click();await page.getByLabel('Go to frame').fill('0');await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame','0');const coldLoadMs=Date.now()-coldStart;
 await page.getByTestId('canvas').click({position:{x:20,y:20}});
 await page.evaluate(()=>{(window as any).__navigationTimings=[];let started=0;let target='';window.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='d'){started=performance.now();target=e.key==='f'?'1':'0'}},true);const el=document.querySelector('[data-testid=canvas]')!;new MutationObserver(()=>{if(started&&el.getAttribute('data-frame')===target){const start=started;started=0;const dom=performance.now()-start;requestAnimationFrame(()=>requestAnimationFrame(()=>{(window as any).__navigationTimings.push({dom_ready_ms:dom,next_paint_ms:performance.now()-start})}))}}).observe(el,{attributes:true,attributeFilter:['data-frame']})});
 const samples=[];
 // Alternating cached adjacent source indices, measured through input and rendered frame state.
 for(let i=0;i<40;i++){const start=Date.now();await page.keyboard.press(i%2===0?'f':'d');await expect(page.getByTestId('canvas')).toHaveAttribute('data-frame',i%2===0?'1':'0');samples.push(Date.now()-start)}
 const timings=await page.evaluate(()=>(window as any).__navigationTimings||[]);
 const sorted=samples.slice().sort((a,b)=>a-b);const diagnostic=await (await request.get('/api/system/diagnostics')).json();
 const report={method:'Google Chrome headless, real F/D key events to DOM frame-ready marker; includes Playwright command overhead, not a compositor/input latency instrument',source_dimensions:[2880,1620],viewport:[1440,960],cold_reload_ms:coldLoadMs,warm_samples_ms:samples,warm_median_ms:sorted[20],warm_p95_ms:sorted[Math.ceil(sorted.length*.95)-1],in_browser_timings:timings,dom_ready_p95_ms:timings.map((t:any)=>t.dom_ready_ms).sort((a:number,b:number)=>a-b)[Math.ceil(timings.length*.95)-1],next_paint_p95_ms:timings.map((t:any)=>t.next_paint_ms).sort((a:number,b:number)=>a-b)[Math.ceil(timings.length*.95)-1],worker:diagnostic.worker,hardware:diagnostic.gpu,date:new Date().toISOString()};
 fs.writeFileSync('../docs/navigation-benchmark.json',JSON.stringify(report,null,2));await page.screenshot({path:'../docs/editor-screenshot.png',fullPage:true});
});
