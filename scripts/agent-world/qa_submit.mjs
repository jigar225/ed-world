import puppeteer from 'puppeteer-core';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
const prompt=(await readFile(process.argv[2],'utf8')).trim(),origin='http://127.0.0.1:3011';
const browser=await puppeteer.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});const page=await browser.newPage();
try{
 await page.goto(origin+'/create',{waitUntil:'networkidle0',timeout:90000});
 await page.type('#agent-prompt',prompt);
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Create world'&&!b.disabled));
 const response=page.waitForResponse(r=>r.url()===origin+'/api/agent/jobs'&&r.request().method()==='POST');
 await page.click('button::-p-text(Create world)');const r=await response;assert.equal(r.status(),202);const initial=await r.json();
 await writeFile('.cache/agent-world/ui-submission.json',JSON.stringify({id:initial.id,prompt,submittedVia:'local-browser-form'},null,2));console.log('Queued through local UI:',initial.id);
 let state=initial;
 while(['queued','running'].includes(state.state)){
  await new Promise(resolve=>setTimeout(resolve,5000));state=await page.evaluate(async id=>await(await fetch('/api/agent/jobs?id='+id)).json(),initial.id);console.log(state.phase);
 }
 await writeFile('.cache/agent-world/ui-submission-result.json',JSON.stringify(state,null,2));
 if(!state.result?.generation?.world)throw Error(state.error??JSON.stringify(state.result?.generation??state.result));
 await page.reload({waitUntil:'networkidle0'});await page.click(`[data-world-id="${state.result.generation.world.id}"]`);await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent==='World ready'||document.querySelector('[role="alert"]'),{timeout:90000});
 assert.equal(await page.$('[role="alert"]'),null);await page.screenshot({path:'.cache/agent-world/ui-generated-world.png'});console.log('PASS: prompt submission, worker completion, library and actual world opening',state.result.generation.world.id);
}finally{await browser.close();}
