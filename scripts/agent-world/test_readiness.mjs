import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {recordedTerrain,terrainSource}=require('../../.cache/agent-test-build/agent-world/terrain-sources.js');
const {validateTerrainCandidate}=require('../../.cache/agent-test-build/agent-world/terrain.js');
const {prepareScene}=require('../../.cache/agent-test-build/agent-world/scene-planner.js');
const {validatePlan}=require('../../.cache/agent-test-build/agent-world/contracts.js');
const {representationIssues}=require('../../.cache/agent-test-build/agent-world/capabilities.js');
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const plan={assetId:'surface',domain:'lunar',representation:'heightfield',extentMeters:[512,512],waterRegions:[]};
const output=validateTerrainCandidate(await recordedTerrain(process.cwd(),plan),plan);
assert.equal(output.width,257);assert.equal(output.height,257);assert.equal(output.provenance.kind,'recorded-dataset');
assert(Math.max(...output.elevations)>Math.min(...output.elevations));
assert.deepEqual(output,await recordedTerrain(process.cwd(),plan));
assert.throws(()=>terrainSource({...plan,extentMeters:[4000,4000]}));assert.throws(()=>terrainSource({...plan,domain:'Mars'}));assert.throws(()=>terrainSource({...plan,waterRegions:['lake']}));
// Full-coverage corners preserve source values and flip north-up raster rows.
const full=await recordedTerrain(process.cwd(),{...plan,extentMeters:[2048,2048]});
const bytes=await readFile('public/terrain/moon-dem.bin'),meta=JSON.parse(await readFile('public/terrain/moon-dem.json'));
const heightAt=i=>meta.minHeight+bytes.readUInt16LE(i*2)/65535*(meta.maxHeight-meta.minHeight);
assert.equal(full.elevations[0],heightAt(1024*1023));assert.equal(full.elevations.at(-1),heightAt(1023));
const bad={version:1,title:'Gravity test',objective:'Experience gravity through jumping',artDirection:'Plain test',navigation:'walk',metersPerUnit:1,assets:[{id:'floor',description:'Floor',kind:'mesh',sizeMeters:[10,10,1],referenceIds:[],requiredParts:[]}],behaviours:[{id:'gravity',targets:['floor'],mechanism:'transfer',parameters:{rate:1},fidelity:'physical',evidenceIds:[],observations:['Jump and fall']}],limitations:[]};
const flat={...bad,behaviours:[],assets:[{...bad.assets[0],kind:'terrain',sizeMeters:[512,512,0]}]};assert.equal(validatePlan(flat,[]).assets[0].sizeMeters[2],0);assert.throws(()=>validatePlan({...flat,assets:[{...flat.assets[0],sizeMeters:[0,512,0]}]},[]),/sizeMeters/);assert.throws(()=>validatePlan({...flat,assets:[{...flat.assets[0],kind:'mesh'}]},[]),/sizeMeters/);assert(representationIssues({...bad,behaviours:[{...bad.behaviours[0],mechanism:'gravity'}]}).some(i=>i.target==='gravity'));
// Exercise the production planner: schema repair, lunar navigation and durable replay.
const store=new AgentStore(':memory:');let recipeCalls=0,modelCalls=0;
const recipe={version:1,title:'Moon gravity',objective:'Explore lunar gravity',artDirection:'Bare lunar ground',ground:{domain:'moon',description:'Recorded lunar surface',widthMeters:512,depthMeters:512},liquids:[],effects:[],objects:[],unsupportedRequirements:[],limitations:[]};
const deps={root:process.cwd(),store,research:async()=>({sources:[],limitations:[]}),reason:async(job,role)=>{
 modelCalls++;
 if(role==='intent')return {version:1,title:recipe.title,objective:recipe.objective,researchQueries:[]};
 if(role==='scene-recipe'||role==='scene-recipe-repair'){recipeCalls++;return recipeCalls===1?{...recipe,ground:{...recipe.ground,widthMeters:513}}:recipe;}
 if(role==='recipe-coverage')return {coverage:[{requestQuote:'gravity on moon',targetIds:['ground'],unsupportedReason:''}]};
 if(role==='terrain-detail')return {landforms:['lunar plain'],surfaceMaterials:['regolith'],generationPrompt:'Recorded lunar surface',elevations:Array(16).fill(0),limitations:[]};
 throw Error('Unexpected production role: '+role);
}};
try {
 const result=await prepareScene('lunar-readiness','gravity on moon',deps);
 assert.equal(recipeCalls,2);assert.deepEqual(result.plan.behaviours,[]);
 assert.equal(result.plan.objective,recipe.objective);assert.equal(result.layout.gravity[2],-1.62);
 assert.equal(result.evaluation.readyForStudents,false);
 const before=modelCalls;await prepareScene('lunar-readiness','gravity on moon',deps);
 assert.equal(modelCalls,before,'Replay must reuse the repaired production plan');
} finally {store.close();}
console.log('PASS: recorded terrain orientation/provenance/domain guards, production schema repair, lunar gravity and checkpoint replay.');
