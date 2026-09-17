import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd();
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const {validatePlan,validateIntent}=require('../../.cache/agent-test-build/agent-world/contracts.js');
const {evaluatePlan}=require('../../.cache/agent-test-build/agent-world/capabilities.js');
const {representationIssues}=require('../../.cache/agent-test-build/agent-world/capabilities.js');
const {spatialIssues}=require('../../.cache/agent-test-build/agent-world/assembly.js');
const {ModalTools,modalURL}=require('../../.cache/agent-test-build/agent-world/modal-tools.js');
const {buildObjectAsset}=require('../../.cache/agent-test-build/agent-world/asset-builder.js');
const {inspectGLB,inspectProjectAsset,projectFile}=require('../../.cache/agent-test-build/agent-world/assets.js');
await mkdir(path.join(root,'.cache/agent-tests'),{recursive:true});
const scratch=await mkdtemp(path.join(root,'.cache/agent-tests/run-'));
await mkdir(path.join(scratch,'public/props'),{recursive:true});
const store=new AgentStore(path.join(scratch,'tools.sqlite'));
const evidence=[{id:'ref-water',title:'Fixture source',url:'https://example.org/water',excerpt:'Test evidence',usage:'reference-only',retrievedAt:'2026-09-14T00:00:00Z'}];
const clone=x=>JSON.parse(JSON.stringify(x));
function plan(title,kind,mechanism,fidelity='illustrative') {
  return {version:1,title,objective:'Observe a process',artDirection:'Reference-informed coherent scene',navigation:'walk',metersPerUnit:1,
    assets:[{id:'subject',description:title,kind,sizeMeters:[1,1,1],requiredParts:[],referenceIds:['ref-water']}],
    behaviours:[{id:'process',targets:['subject'],mechanism,fidelity,parameters:{speed:1},evidenceIds:['ref-water'],observations:['Changing the input changes the declared output']}],limitations:[]};
}
function glb(document) {
  const json=Buffer.from(JSON.stringify(document).padEnd(Math.ceil(JSON.stringify(document).length/4)*4,' '));
  const b=Buffer.alloc(20+json.length);b.writeUInt32LE(0x46546c67);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);
  b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;
}
const mesh=glb({asset:{version:'2.0'},meshes:[{primitives:[]}],nodes:[{name:'test'}]});
let assertions=0;
try {
  assert.deepEqual(validateIntent({version:1,title:'Lake',objective:'Observe water',researchQueries:['water','clouds','rain','mist']}).researchQueries,['water','clouds','rain']);
  assert.throws(()=>validateIntent({version:1,title:'Lake',objective:'Observe water',researchQueries:['water',42]}));
  assert.equal(representationIssues(plan('Invisible drift','volume','drift')).length,1);
  assert(representationIssues(plan('Wrong particle target','mesh','particles')).some(i=>i.reason.includes('cannot target mesh')));
  assert.equal(representationIssues(plan('Unimplemented biology','volume','transport')).length,0);
  const collisionPlan=plan('Boulder','mesh','rotate');
  assert.ok(spatialIssues({version:1,arrival:[0,0,0],gravity:[0,0,-9.81],placements:[{assetId:'subject',position:[0,0,0],scale:1,upAxis:'Y',dynamic:true}]},collisionPlan).length>=2);
  const cases=[['Water cycle','terrain','water_transfer'],['Moon','mesh','custom-gravity','physical'],['Engine','mesh','linkage','physical'],['Cell','volume','transport'],['River','rigged-mesh','swim']];
  for(const args of cases) {
    const p=validatePlan(plan(...args),evidence);
    assert.equal(evaluatePlan(p).readyForStudents,false);
    assertions++;
  }
  const bad=plan('Invalid','mesh','gravity');bad.behaviours[0].targets=['missing'];assert.throws(()=>validatePlan(bad,evidence),/Unknown/);
  const fake=plan('Fake source','mesh','gravity');fake.assets[0].referenceIds=['invented'];assert.throws(()=>validatePlan(fake,evidence),/Unknown/);
  const duplicate=plan('Duplicate','mesh','gravity');duplicate.assets.push(clone(duplicate.assets[0]));assert.throws(()=>validatePlan(duplicate,evidence),/Duplicate/);
  const units=plan('Units','mesh','gravity');units.metersPerUnit=NaN;assert.throws(()=>validatePlan(units,evidence),/numeric/);
  const unsafe=plan('No code','mesh','gravity');unsafe.code='fetch("private")';assert.equal('code' in validatePlan(unsafe,evidence),false);assertions++;

  const c=store.begin('crash','reason',{prompt:'one'});store.close();
  const reopened=new AgentStore(path.join(scratch,'tools.sqlite'));
  assert.throws(()=>reopened.begin('crash','reason',{prompt:'one'}),/unresolved/);reopened.uncertain(c.record.id);reopened.close();assertions++;
  // Separate connection remains open for the rest of this suite.
  const nextStore=new AgentStore(path.join(scratch,'next.sqlite'));
  try {
    let calls=0,funds=0;
    const env={AGENT_MODAL_LLM_URL:'https://example.modal.run/completions',AGENT_MODAL_LLM_MODEL:'test',KIMI_MODAL_KEY:'private-test-key',KIMI_MODAL_SECRET:'private-test-secret',
      FLUX_MODAL_URL:'https://flux.modal.run',TRELLIS_MODAL_URL:'https://trellis.modal.run',FOUNDRY_SHARED_SECRET:'private-foundry-secret'};
    const fund=async()=>{funds++;return {receiptId:'test-reservation'};};
    const provider=async(url,request)=>{calls++;assert.equal(request.redirect,'error');return String(url).includes('trellis')?new Response(mesh):new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"answer":42}'}}]}));};
    const tools=new ModalTools({root:scratch,store:nextStore,env,fund,fetch:provider});
    assert.equal((await tools.call('j','reason',{system:'Plan',prompt:'Moon'})).answer,42);
    assert.equal((await tools.call('j','reason',{system:'Plan',prompt:'Moon'})).answer,42);assert.equal(calls,1);assert.equal(funds,1);
    assert(!JSON.stringify(tools.status()).includes('private-test'));
    await assert.rejects(new ModalTools({root:scratch,store:nextStore,env,fetch:provider}).call('unfunded','reason',{system:'x',prompt:'x'}),/funding adapter/);assert.equal(calls,1);
    for(const url of ['http://localhost','https://api.moonshot.ai','https://example.modal.run.evil.com','https://user:pass@example.modal.run','https://example.modal.run?token=x'])assert.throws(()=>modalURL(url));
    assert.equal(modalURL('https://example.us-west.modal.direct/v1'),'https://example.us-west.modal.direct/v1');
    const failing=new ModalTools({root:scratch,store:nextStore,env,fund,fetch:async()=>{calls++;throw Error('private-test-secret');}});
    await assert.rejects(failing.call('lost','reason',{system:'x',prompt:'y'}),e=>!e.message.includes('private-test-secret')&&e.message.includes('reconciliation'));
    const before=calls;await assert.rejects(failing.call('lost','reason',{system:'x',prompt:'y'}),/unresolved/);assert.equal(calls,before);
    const controller=new AbortController();controller.abort();await assert.rejects(tools.call('cancel','reason',{system:'x',prompt:'x'},controller.signal));assert.equal(calls,before);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    const generatedCalls=[];
    const assetTools=new ModalTools({root:scratch,store:nextStore,env,fund,fetch:async(url)=>{
      generatedCalls.push(String(url));return new Response(String(url).includes('flux')?png:mesh);
    }});
    const request=plan('Rock','mesh','still').assets[0];
    const asset=await buildObjectAsset('asset',request,'Weathered stone',assetTools,nextStore);
    assert.equal(asset.readyForAssembly,false);assert.equal(asset.actualScale,'unverified');
    assert.equal(generatedCalls.length,2);
    await buildObjectAsset('asset',request,'Weathered stone',assetTools,nextStore);assert.equal(generatedCalls.length,2);
    await assert.rejects(buildObjectAsset('rig',{...request,kind:'rigged-mesh'},'Style',assetTools,nextStore),/cannot guarantee/);
    assert.equal(generatedCalls.length,2);
    await writeFile(path.join(scratch,asset.referencePath),Buffer.from('tampered'));
    await assert.rejects(assetTools.call('tamper','generate-object',{referencePath:asset.referencePath}),/checksum/);
    assert.equal(generatedCalls.length,2);
    assertions++;
  } finally {nextStore.close();}

  const inventory=inspectGLB(mesh);assert.equal(inventory.qualification,'structural-only');assert.equal(inventory.skins,0);
  assert.throws(()=>inspectGLB(glb({asset:{version:'2.0'},meshes:[{}],images:[{uri:'https://private.invalid/a.png'}]})),/external/);
  assert.throws(()=>inspectGLB(Buffer.from('not glb')),/header/);
  await writeFile(path.join(scratch,'public/props/test.glb'),mesh);
  assert.equal((await inspectProjectAsset(scratch,'public/props/test.glb')).hash,inventory.hash);
  await assert.rejects(inspectProjectAsset(scratch,'.env'),/approved/);
  await assert.rejects(projectFile(scratch,'../anything'),/relative/);
  await symlink(path.join(root,'package.json'),path.join(scratch,'public/props/outside.glb'));
  await assert.rejects(inspectProjectAsset(scratch,'public/props/outside.glb'),/escapes/);assertions++;
  console.log(`PASS: ${assertions} groups; unsupported scenario contracts, invalid references/units, crash recovery, funding gate, Modal-only routing, cancellation, secret redaction, asset containment. No external requests or models.`);
} finally { /* scratch retained inside project for inspection; no personal directories touched */ }
