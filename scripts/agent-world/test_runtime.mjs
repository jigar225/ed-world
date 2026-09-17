import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
const require=createRequire(import.meta.url),root=process.cwd();
const {compileBindings,createBehaviourRuntime}=require('../../.cache/agent-test-build/agent-world/behaviour-runtime.js');
const {validateTerrainPlan,validateTerrainOutput}=require('../../.cache/agent-test-build/agent-world/terrain.js');
const {terrainGLB}=require('../../.cache/agent-test-build/agent-world/terrain-mesh.js');
const {assembleWorld,agentWorldAsset}=require('../../.cache/agent-test-build/agent-world/assembly.js');
const {buildPreparedWorld,generationRequirements}=require('../../.cache/agent-test-build/agent-world/pipeline.js');
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const {saveArtifact,inspectGLB}=require('../../.cache/agent-test-build/agent-world/assets.js');
const request=(id,mechanism,targets,parameters)=>({id,mechanism,targets,parameters,fidelity:'illustrative',evidenceIds:[],observations:['Fixture movement check']});
const bindings=compileBindings([request('spin','rotate',['marker'],{speed:1}),request('cycle','transfer',['liquid','vapour'],{initial_from:10,initial_to:2,rate:1})]);
const runtime=createBehaviourRuntime(bindings);
for(let n=0;n<240;n++)runtime.step(1/120);
assert(Math.abs(runtime.observe().quantities.liquid-8)<1e-9);assert(Math.abs(runtime.observe().quantities.vapour-4)<1e-9);
const saved=runtime.save(),angle=runtime.effects().marker.rotation[2];
runtime.setControl('spin',0);for(let n=0;n<120;n++)runtime.step(1/120);assert.equal(runtime.effects().marker.rotation[2],angle);
runtime.load(saved);assert.deepEqual(runtime.save(),saved);
const replay=createBehaviourRuntime(bindings);replay.load(saved);
for(let n=0;n<120;n++){runtime.step(1/120);replay.step(1/120);}assert.deepEqual(runtime.save(),replay.save());
assert.throws(()=>runtime.load({...saved,quantities:{liquid:999,vapour:999}}),/conserved/);
assert.throws(()=>compileBindings([request('unknown','whatever',['marker'],{})]),/Unsupported/);
assert.throws(()=>compileBindings([request('a','rotate',['marker'],{}),request('b','rotate',['marker'],{})]),/writers/);
assert.throws(()=>runtime.step(10),/bounded/);
const ground={id:'ground',description:'Engineering terrain fixture',kind:'terrain',sizeMeters:[30,30,3],requiredParts:[],referenceIds:[]};
const terrain=validateTerrainPlan({version:1,assetId:'ground',domain:'Engineering fixture',representation:'heightfield',extentMeters:[30,30],elevationRangeMeters:[-1,3],landforms:['flat test patch'],surfaceMaterials:['test surface'],waterRegions:[],evidenceIds:[],generationPrompt:'Fixture only',closeupRequirements:[],conditioning:{width:2,height:2,elevations:[0,0,0,0]},limitations:['Not generated terrain']},ground,[]);
const output=validateTerrainOutput({version:1,assetId:'ground',width:5,height:5,extentMeters:[30,30],elevations:Array(25).fill(0),provenance:{kind:'test-fixture',model:'none',requestHash:'fixture-v1'}},terrain);
assert.equal(inspectGLB(terrainGLB(output)).meshes,1);
assert.throws(()=>validateTerrainOutput({...output,extentMeters:[10,10]},terrain),/physical extent/);
assert.throws(()=>validateTerrainOutput({...output,elevations:[0]},terrain),/dimensions/);
assert.throws(()=>validateTerrainOutput(output,{...terrain,representation:'mesh-volume'}),/cannot satisfy/);

// A clearly labelled geometric fixture for runtime testing, never a generated-world demo.
function boxGLB(){
  const g=new THREE.BoxGeometry(1,1,1),pos=g.getAttribute('position').array,norm=g.getAttribute('normal').array,index=new Uint32Array(g.index.array);
  const buffers=[Buffer.from(pos.buffer),Buffer.from(norm.buffer),Buffer.from(index.buffer)],bin=Buffer.concat(buffers);
  const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.8,.32,.1,1],metallicFactor:.15,roughnessFactor:.45}}],buffers:[{byteLength:bin.length}],
    bufferViews:buffers.map((b,i)=>({buffer:0,byteOffset:buffers.slice(0,i).reduce((s,b)=>s+b.length,0),byteLength:b.length})),accessors:[{bufferView:0,componentType:5126,count:pos.length/3,type:'VEC3',min:[-.5,-.5,-.5],max:[.5,.5,.5]},{bufferView:1,componentType:5126,count:norm.length/3,type:'VEC3'},{bufferView:2,componentType:5125,count:index.length,type:'SCALAR'}]};
  const raw=JSON.stringify(doc),json=Buffer.from(raw.padEnd(Math.ceil(raw.length/4)*4,' ')),b=Buffer.alloc(28+json.length+bin.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);b.writeUInt32LE(bin.length,20+json.length);b.writeUInt32LE(0x004e4942,24+json.length);bin.copy(b,28+json.length);g.dispose();return b;
}
const marker=await saveArtifact(root,boxGLB(),'glb');
const surface=await saveArtifact(root,terrainGLB({...output,assetId:'surface',width:17,height:17,extentMeters:[3,3],elevations:Array(289).fill(0)}),'glb');
const plan={version:1,title:'Engineering motion fixture',objective:'Verify controls, movement and persistence. This is not a generated learning world.',artDirection:'Test geometry',navigation:'walk',metersPerUnit:1,
  assets:[ground,{id:'surface',description:'Illustrative wave mesh fixture',kind:'mesh',sizeMeters:[3,3,.1],requiredParts:[],referenceIds:[]},{id:'mist',description:'Illustrative particle region fixture',kind:'volume',sizeMeters:[1,1,3],requiredParts:[],referenceIds:[]},{id:'marker',description:'Test marker',kind:'mesh',sizeMeters:[1,1,1],requiredParts:[],referenceIds:[]}],behaviours:[request('ripple','waves',['surface'],{amplitude:.15,speed:2}),request('spin','rotate',['marker'],{speed:1}),request('flow','particles',['mist'],{count:128,velocity_z:1,lifetime:3})],limitations:['Not a visual-quality or science acceptance result']};
const layout={version:1,arrival:[0,0,1],gravity:[0,0,-9.81],placements:[{assetId:'surface',position:[3,-2,.15],scale:1,upAxis:'Z',dynamic:false},{assetId:'mist',position:[3,1,0],scale:1,upAxis:'Z',dynamic:false},{assetId:'ground',position:[0,0,0],scale:1,upAxis:'Z',dynamic:false},{assetId:'marker',position:[4,0,1],scale:1,upAxis:'Z',dynamic:false}]};
const input={plan,layout,selectedAssets:{marker:marker.path,surface:surface.path},terrain:[{plan:terrain,output}],source:'engineering-fixture'};
await assert.rejects(assembleWorld(root,{...input,source:'generated'}),/Fixture terrain/);
await assert.rejects(assembleWorld(root,{...input,layout:{...layout,placements:layout.placements.map(p=>({...p,dynamic:p.assetId==='marker'}))}}),/both own/);
const world=await assembleWorld(root,input);
assert.equal(world.readyForStudents,false);assert.equal(world.id,(await assembleWorld(root,input)).id);
await assert.rejects(agentWorldAsset(root,world.id,'../../.env'),/Invalid/);
const manifest=JSON.parse(await readFile(await agentWorldAsset(root,world.id,'manifest.json'),'utf8'));assert.equal(manifest.living.source,'engineering-fixture');
await mkdir(path.join(root,'.cache/agent-tests'),{recursive:true});await writeFile(path.join(root,'.cache/agent-tests/runtime-fixture.json'),JSON.stringify(world));
console.log('PASS: terrain provenance/extent/geometry, temporal controls, conservation, deterministic save/replay, conflicting ownership, package assembly, immutable identity, asset access. Fixture saved for browser QA only.');

assert.equal(manifest.living.emitters[0].assetId,'mist');
assert.throws(()=>compileBindings([{...request('rain','particles',['mist'],{}),fidelity:'physical'}]),/illustrative/);
const particleRuntime=createBehaviourRuntime(compileBindings([request('flow','particles',['mist'],{})]));
particleRuntime.step(.02);const particleSaved=particleRuntime.save();particleRuntime.step(.02);particleRuntime.load(particleSaved);assert.equal(particleRuntime.effects().mist.particles.time,.02);
const pipelineStore=new AgentStore(':memory:');let resolves=0,generates=0;
const prepared={job:'pipeline-fixture',plan,layout,terrain:[terrain],critique:{issues:[]}};
assert.equal(generationRequirements({...prepared,critique:{issues:[{target:'mist',reason:'Placement needs measured ground'}]}},true).canBuild,true);
assert.equal(generationRequirements({...prepared,critique:{issues:[{target:'missing-rig',reason:'Requested rig unavailable'}]}},true).canBuild,false);
assert.equal(generationRequirements({...prepared,plan:{...plan,navigation:'swim'}},true).canBuild,false);
const services={root,store:pipelineStore,mode:'engineering-test',resolveAsset:async request=>{resolves++;return {...(request.id==='surface'?surface:marker),scale:1,upAxis:'Z',qualification:'compatible-for-preview'};},generateTerrain:async()=>{generates++;return output;}};
try {
  const mismatch={...prepared,job:'terrain-mismatch'};let terrainCalls=0;
  const mismatchServices={...services,generateTerrain:async()=>{terrainCalls++;return {...output,elevations:output.elevations.map(()=>10)};}};
  const needsReview=await buildPreparedWorld(mismatch,mismatchServices);
  assert.equal(needsReview.status,'needs-terrain-review');assert.equal(needsReview.candidate.preserved,true);
  assert.deepEqual(needsReview.candidate.measuredElevationRange,[10,10]);
  assert.equal((await buildPreparedWorld(mismatch,mismatchServices)).status,'needs-terrain-review');
  assert.equal(terrainCalls,1);assert.equal(resolves,0);
  assert.equal((await buildPreparedWorld({...prepared,critique:{issues:[{target:'ground',reason:'Review required'}]}},services)).status,'needs-capability');assert.equal(resolves+generates,0);
  assert.equal((await buildPreparedWorld({...prepared,layout:{...layout,placements:layout.placements.map(p=>({...p,dynamic:p.assetId==='marker'}))}},services)).status,'needs-capability');
  assert.equal((await buildPreparedWorld({...prepared,plan:{...plan,navigation:'swim'}},services)).status,'needs-capability');assert.equal(resolves+generates,0);
  const built=await buildPreparedWorld(prepared,services);assert.equal(built.status,'engineering-preview');assert.equal(built.world.id,world.id);
  await buildPreparedWorld(prepared,services);assert.equal(resolves,2);assert.equal(generates,1);
  await assert.rejects(buildPreparedWorld(prepared,{...services,mode:undefined}),/fixture terrain/);
  const qualified=pipelineStore.checkpoint(prepared.job,'qualified-asset',{request:plan.assets.find(a=>a.id==='marker'),artDirection:plan.artDirection});
  pipelineStore.checkpoint(prepared.job,'qualified-asset',{request:plan.assets.find(a=>a.id==='marker'),artDirection:plan.artDirection},{...qualified,hash:'invalid'});
  await assert.rejects(buildPreparedWorld(prepared,services),/checksum/);
  console.log('PASS: orchestration capability gate, resume without new generation, checksums and fixture isolation; particle fidelity and replay.');
}finally{pipelineStore.close();}
