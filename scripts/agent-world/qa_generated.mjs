import puppeteer from 'puppeteer-core';
import {particleGroundHeight} from '../../lib/particle-ground.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const origin=process.env.AGENT_QA_ORIGIN||'http://127.0.0.1:3011',out='.cache/agent-tests/generated-browser'+(process.argv[2]?'-'+process.argv[2].slice(0,12):'');
await mkdir(out,{recursive:true});
const result=JSON.parse(await readFile('.cache/agent-world/plans/agent-016b22a474470437cbb182ae.json','utf8'));
const id=process.argv[2]??result.generation?.world?.id;assert(id,'Generate and assemble a world first');
const browser=await puppeteer.launch({channel:'chrome',headless:true,args:['--use-angle=metal'],protocolTimeout:120000});
const page=await browser.newPage(),errors=[],external=[];await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.setRequestInterception(true);page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/')){external.push(r.url());void r.abort();}else void r.continue();});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),snapshot=()=>page.evaluate(()=>window.__ED_AGENT_VIEWER.snapshot());
const click=async label=>(await page.waitForSelector(`button::-p-text(${label})`)).click();
try{
 await page.goto(origin+'/create?qa=1',{waitUntil:'networkidle0',timeout:90000});await page.click(`[data-world-id="${id}"]`);
 await page.waitForFunction(()=>window.__ED_AGENT_VIEWER||document.querySelector('[role="alert"]'),{timeout:90000});
 assert(await page.evaluate(()=>!!window.__ED_AGENT_VIEWER),await page.$eval('body',e=>e.innerText));
 assert.equal(await page.evaluate(()=>window.__ED_AGENT_VIEWER.manifest.living.source),'generated');
 await pause(1200);await page.screenshot({path:out+'/arrival.png'});const first=await snapshot();await pause(2000);const next=await snapshot();await page.screenshot({path:out+'/motion.png'});
 const support=await page.evaluate(()=>({surfaces:window.__ED_AGENT_VIEWER.manifest.living.groundSurfaces??[],emitters:window.__ED_AGENT_VIEWER.manifest.living.emitters}));
 for(const emitter of support.emitters.filter(e=>e.ground)){const surface=support.surfaces.find(s=>s.assetId===emitter.ground.assetId);assert(surface);for(const state of [first,next]){const values=state.particles[emitter.assetId];for(let i=0;i<values.length;i+=3){const point=values.slice(i,i+3).map((v,n)=>v+emitter.position[n]);const h=particleGroundHeight(surface,point[0],point[1]);if(h!==null)assert(point[2]>=h-.001,'Visible sampled ground particles must not be buried');}}}
 for(const [id,values]of Object.entries(first.particles))assert.notDeepEqual(next.particles[id],values,`${id} must move`);
 for(const id of Object.keys(first.waves))assert(next.waves[id][0]>first.waves[id][0]);
 await click('Pause');const stopped=await snapshot();await pause(400);assert.equal((await snapshot()).elapsed,stopped.elapsed);
 await click('Save progress');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Progress saved');
 await click('Resume');await click('Enter world');await page.waitForFunction(()=>!!document.pointerLockElement);
 const before=await snapshot();await page.keyboard.down('KeyW');await page.waitForFunction(p=>Math.hypot(...window.__ED_AGENT_VIEWER.snapshot().camera.map((v,i)=>v-p[i]))>.35,{timeout:12000},before.camera);await page.keyboard.up('KeyW');const moved=await snapshot();
 await page.mouse.move(650,320);await pause(200);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);await page.screenshot({path:out+'/walk.png'});
 await click('Pause');await click('Restore');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Progress restored');await pause(100);const restored=await snapshot();assert.deepEqual(restored.particles,stopped.particles);assert(Math.hypot(...restored.camera.map((v,i)=>v-stopped.camera[i]))<1e-6);
 await click('Your worlds');await page.click(`[data-world-id="${id}"]`);await page.waitForFunction(()=>window.__ED_AGENT_VIEWER);await click('Pause');await click('Restore');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Progress restored');await pause(100);assert.deepEqual((await snapshot()).particles,stopped.particles);
 const focusIds=await page.evaluate(()=>window.__ED_AGENT_VIEWER.manifest.living.bindings.map(b=>b.id));
 for(const id of focusIds){const camera=(await snapshot()).camera;await page.$eval(`input[aria-label="${id}"]`,e=>e.closest('label').querySelector('button').click());await pause(100);assert.deepEqual((await snapshot()).camera,camera,'Look changes direction without teleporting the learner');await page.screenshot({path:out+'/focus-'+id+'.png'});}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(out+'/report.json',JSON.stringify({passed:true,id,first,next,moved,errors,external,checks:['actual-generated-package','sampled-ground-particle-clearance','all-particle-regions-move','wave-phase-moves','pause','walk-on-geometry','save-restore-reopen','effect-camera-focus'],limitation:'Visual screenshots require separate inspection; this is not scientific validation.'},null,2));console.log('PASS: actual generated world navigation, moving effects, pause and persistence.');
}catch(error){await page.screenshot({path:out+'/failure.png'});await writeFile(out+'/failure.json',JSON.stringify({error:String(error),errors,external},null,2));throw error;}finally{await browser.close();}
