import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const id=process.argv[2];assert.match(id??'',/^[a-f0-9]{64}$/);
const out='.cache/agent-tests/gravity-'+id.slice(0,12);await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:900});
const snap=()=>page.evaluate(()=>window.__ED_AGENT_VIEWER.snapshot());
try{
 await page.goto('http://127.0.0.1:3011/create?qa=1&world='+id,{waitUntil:'networkidle0',timeout:90000});
 await page.waitForFunction(()=>window.__ED_AGENT_VIEWER,{timeout:90000});
 await page.waitForFunction(()=>window.__ED_AGENT_VIEWER.snapshot().motion.grounded);
 await page.screenshot({path:out+'/arrival.png'});
 await page.click('button::-p-text(Enter world)');await page.waitForFunction(()=>!!document.pointerLockElement);
 const start=await snap();await page.keyboard.press('Space');
 await page.waitForFunction(z=>window.__ED_AGENT_VIEWER.snapshot().camera[2]>z+.3,{timeout:15000},start.camera[2]);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);
 await page.click('button::-p-text(Pause)');const midair=await snap();assert.equal(midair.motion.grounded,false);
 await page.click('button::-p-text(Save progress)');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Progress saved');
 await page.screenshot({path:out+'/jump.png'});
 await page.click('button::-p-text(Resume)');
 await page.waitForFunction(()=>window.__ED_AGENT_VIEWER.snapshot().motion.grounded,{timeout:30000});
 const landed=await snap();assert(Math.abs(landed.camera[2]-start.camera[2])<.2);
 await page.click('button::-p-text(Pause)');await page.click('button::-p-text(Restore)');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='Progress restored');
 await new Promise(r=>setTimeout(r,100));const restored=await snap();assert.deepEqual(restored.motion,midair.motion);assert.deepEqual(restored.camera,midair.camera);
 const manifest=await page.evaluate(()=>window.__ED_AGENT_VIEWER.manifest);assert.equal(manifest.gravity[2],-1.62);assert.equal(manifest.environment.atmosphere,'vacuum');assert.equal(manifest.terrainSources[0].provenance.kind,'recorded-dataset');assert.deepEqual(errors,[]);
 await writeFile(out+'/report.json',JSON.stringify({passed:true,id,start,midair,landed,restored,errors,checks:['live-prompt-world','recorded-lunar-source','vacuum-environment','lunar-gravity','space-jumps','terrain-landing','midair-save-restore'],limitation:'Physics/interaction test; visual inspection and scientific review are separate.'},null,2));
 console.log('PASS: actual lunar world, jumping/landing, midair save/restore, no browser errors.');
}catch(e){await page.screenshot({path:out+'/failure.png'});throw e;}finally{await browser.close();}
