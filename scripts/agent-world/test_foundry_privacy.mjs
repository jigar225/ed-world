import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd();
mkdirSync(path.join(root,'.cache/agent-tests'),{recursive:true});
const scratch=mkdtempSync(path.join(root,'.cache/agent-tests/foundry-'));
process.chdir(scratch);
Object.assign(process.env,{FOUNDRY_PROVIDER:'modal',FLUX_MODAL_URL:'https://test.modal.run/flux',TRELLIS_MODAL_URL:'https://test.modal.run/trellis',FOUNDRY_SHARED_SECRET:'test',FAL_KEY:'must-not-use',GEMINI_API_KEY:'must-not-use'});
const {forgeProp,foundryConfigured}=require('../../.cache/agent-foundry-test/foundry.js');
const original=global.fetch,calls=[];
global.fetch=async url=>{calls.push(String(url));return new Response('fixture failure',{status:500});};
try {
  assert.equal(foundryConfigured(),true);
  await assert.rejects(forgeProp('private test subject','test-subject'));
  assert.deepEqual(calls,['https://test.modal.run/flux'],'Modal failure must never fall back to external providers');
  delete process.env.FLUX_MODAL_URL;assert.equal(foundryConfigured(),false);
  process.env.FOUNDRY_PROVIDER='unknown';assert.equal(foundryConfigured(),false);
  console.log('PASS: Modal foundry failure sends no prompts to FAL, Gemini or Pollinations.');
} finally {global.fetch=original;process.chdir(root);}
