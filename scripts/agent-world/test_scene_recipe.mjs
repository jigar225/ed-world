import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {compileRecipe,SCENE_RECIPE_SCHEMA}=require('../../.cache/agent-test-build/agent-world/scene-recipe.js');
const {prepareScene}=require('../../.cache/agent-test-build/agent-world/scene-planner.js');
const {generationRequirements}=require('../../.cache/agent-test-build/agent-world/pipeline.js');
const {digest}=require('../../.cache/agent-test-build/agent-world/store.js');
const recipe={version:1,title:'Weather',objective:'Observe a water cycle',artDirection:'Natural landscape',ground:{domain:'earth',description:'Basin and dry shoreline',widthMeters:960,depthMeters:960},liquids:[{id:'lake',description:'Lake surface',sizeMeters:[100,100,1],waves:{}}],effects:[{id:'mist',description:'Illustrative rising droplets',sizeMeters:[12,12,10],observations:['Visible proxy for invisible water vapor'],particles:{velocity_z:1}}],objects:[],unsupportedRequirements:[],limitations:['Illustrative effects']};
const {plan}=compileRecipe(recipe);
assert.deepEqual(plan.assets.map(a=>[a.id,a.kind,a.role]),[['ground','terrain','ground'],['lake','mesh','liquid'],['mist','volume','effect']]);
assert.deepEqual(plan.behaviours.map(b=>[b.mechanism,b.targets]),[['waves',['lake']],['particles',['mist']]]);
assert(JSON.stringify(SCENE_RECIPE_SCHEMA).length<25000);
for(const mutate of [r=>r.effects[0].id='lake',r=>r.effects[0].id='ground',r=>r.ground.widthMeters=961,r=>r.effects[0].particles.count=20000,r=>{r.ground.domain='moon';r.ground.widthMeters=512;r.ground.depthMeters=512;}]){const r=structuredClone(recipe);mutate(r);assert.throws(()=>compileRecipe(r));}
const checkpoints=new Map();let calls=[];
const deps={root:process.cwd(),store:{checkpoint(job,stage,input,output){const k=digest({job,stage,input});if(output!==undefined)checkpoints.set(k,output);return checkpoints.get(k);}},research:async()=>({sources:[],limitations:[]}),reason:async(job,role)=>{calls.push(role);if(role==='intent')return {version:1,title:'Weather',objective:'Observe a water cycle',researchQueries:[]};if(role==='scene-recipe')return structuredClone(recipe);if(role==='recipe-coverage')return {coverage:[{requestQuote:'evaporation',targetIds:['mist'],unsupportedReason:''}]};if(role==='entity-routing')return {entities:[{id:'lake',category:'liquid-water'}]};if(role==='particle-appearance')return {effects:[{assetId:'mist',style:'mist'}]};if(role==='terrain-detail')return {landforms:['basin'],surfaceMaterials:['sand'],generationPrompt:'A basin',elevations:[10,10,10,10,10,0,0,10,10,0,0,10,10,10,10,10],limitations:[]};throw Error('Unexpected role '+role);}};
const prepared=await prepareScene('recipe-test','Show evaporation over a lake',deps);
assert.deepEqual(calls,['intent','scene-recipe','entity-routing','recipe-coverage','terrain-detail','particle-appearance']);
assert.equal(generationRequirements(prepared,true).canBuild,true);
assert.deepEqual(prepared.terrain[0].extentMeters,[960,960]);
await prepareScene('recipe-test','Show evaporation over a lake',deps);assert.equal(calls.length,6);
prepared.critique.issues=[{target:'mist',reason:'Omitted requested process'}];assert.equal(generationRequirements(prepared,true).canBuild,false,'Semantic errors must not be deferred as spatial adjustments');
prepared.critique.issues=[];prepared.plan.unavailable=['Fluid solver unavailable'];assert.equal(generationRequirements(prepared,true).canBuild,false);
console.log('PASS: semantic recipe routing, support, source extents, operator bounds, checkpoint reuse and capability/semantic rejection.');
// A review may request one semantic correction, but cannot launch an unbounded loop.
let reviews=0,revisions=0;
const revised=await prepareScene('recipe-revision-test','Show the full water cycle',{...deps,reason:async(job,role,...args)=>{if(role==='recipe-coverage')return {coverage:[{requestQuote:'water cycle',targetIds:++reviews===1?[]:['clouds'],unsupportedReason:reviews===1?'Add the requested cloud layer':''}]};if(role==='entity-routing')return {entities:[{id:'lake',category:'liquid-water'}]};if(role==='particle-appearance')return {effects:[{assetId:'mist',style:'mist'},{assetId:'clouds',style:'cloud'}]};if(role==='scene-recipe'){revisions++;const r=structuredClone(recipe);if(revisions>1)r.effects.push({...structuredClone(r.effects[0]),id:'clouds',description:'Drifting clouds'});return r;}return deps.reason(job,role,...args);}});
assert.equal(reviews,2);assert.equal(revisions,2);assert(revised.plan.assets.some(a=>a.id==='clouds'));
const {validateDecision}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const typed={plan:compileRecipe({...recipe,objects:[{id:'rock',description:'Rock',sizeMeters:[2,2,2],motion:{mechanism:'still',parameters:{}}}]}).plan,terrain:[]};
const decision={decision:'accept',reason:'Test measured basin',siteId:'basin',materialPrompt:'Sand',bindings:[{assetId:'lake',anchor:'surface',heightMeters:0,offsetMeters:[0,0]},{assetId:'mist',anchor:'above-surface',heightMeters:0,offsetMeters:[0,0]},{assetId:'rock',anchor:'ground',heightMeters:0,offsetMeters:[0,0]}],operators:typed.plan.behaviours.map(b=>({id:b.id,mechanism:b.mechanism,parameters:b.parameters}))};
validateDecision(decision,typed,[{id:'basin',kind:'basin'}]);
const wrong=structuredClone(decision);wrong.bindings[2].anchor='surface';assert.throws(()=>validateDecision(wrong,typed,[{id:'basin',kind:'basin'}]),/solid object cannot/);
const changed=structuredClone(decision);changed.operators[1].mechanism='transfer';assert.throws(()=>validateDecision(changed,typed,[{id:'basin',kind:'basin'}]),/cannot change a compiled operator/);
console.log('PASS: bounded semantic revision and grounding cannot reroute solids or replace compiled operators.');

assert.throws(()=>compileRecipe({...recipe,unsupportedRequirements:[{requestQuote:'fluid simulation',reason:'Unavailable'}]},[],'Show a lake'),/unsupported requirements/);
assert(compileRecipe({...recipe,unsupportedRequirements:[{requestQuote:'fluid simulation',reason:'Unavailable'}]},[],'Use fluid simulation').plan.unavailable.length);

const {requestExcerptMatches}=require('../../.cache/agent-test-build/agent-world/scene-planner.js');
assert(requestExcerptMatches('Show evaporation, clouds, and rain over a lake.','Show clouds'));
assert(!requestExcerptMatches('Show evaporation, clouds, and rain over a lake.','Show fluid simulation'));
const copiedCoordinates=structuredClone(decision);copiedCoordinates.bindings[1].heightMeters=77;assert.throws(()=>validateDecision(copiedCoordinates,typed,[{id:'basin',kind:'basin'}]),/within60m/);
const backwards=structuredClone(decision);backwards.operators[1].parameters.velocity_z=-1;assert.throws(()=>validateDecision(backwards,typed,[{id:'basin',kind:'basin'}]),/vertical motion direction/);
const floatingSource=structuredClone(decision);floatingSource.bindings[1].heightMeters=20;assert.throws(()=>validateDecision(floatingSource,typed,[{id:'basin',kind:'basin'}]),/source water surface/);
const rainScene=structuredClone(typed);rainScene.plan.behaviours[1].parameters={velocity_z:-2};
const shortRain=structuredClone(decision);shortRain.bindings[1].heightMeters=20;shortRain.operators[1].parameters={velocity_z:-2,lifetime:2};assert.throws(()=>validateDecision(shortRain,rainScene,[{id:'basin',kind:'basin'}]),/must reach the surface/);
console.log('PASS: absolute-coordinate mistakes, reversed motion, detached sources and incomplete falling trajectories are rejected.');
const {calibrateDecision}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const calibrated=calibrateDecision(shortRain,rainScene);assert.equal(calibrated.operators[1].parameters.lifetime,10);assert.equal(shortRain.operators[1].parameters.lifetime,2);validateDecision(calibrated,rainScene,[{id:'basin',kind:'basin'}]);
// Misclassified material entries must be repaired before the generation pipeline.
let routeRecipes=0;
const routed=await prepareScene('route-repair-test','Show evaporation over a lake',{...deps,reason:async(job,role,system,input,...rest)=>{
 if(role==='scene-recipe'){const r=structuredClone(recipe);if(++routeRecipes===1)r.liquids.push({id:'misplaced-mist',description:'Rising mist particles',sizeMeters:[5,5,5],waves:{}});return r;}
 if(role==='entity-routing')return {entities:JSON.parse(input).map(a=>({id:a.id,category:a.id==='lake'?'liquid-water':'particle-effect'}))};
 return deps.reason(job,role,system,input,...rest);
}});
assert.equal(routeRecipes,2);assert(!routed.plan.assets.some(a=>a.id==='misplaced-mist'));assert(routed.plan.assets.some(a=>a.id==='mist'&&a.kind==='volume'));
console.log('PASS: incorrect material routing is corrected before terrain or object generation.');
const dry=structuredClone(rainScene);dry.plan.assets=dry.plan.assets.filter(a=>a.role!=='liquid');dry.plan.behaviours=dry.plan.behaviours.filter(b=>b.mechanism==='particles');
const omittedSource=structuredClone(shortRain);omittedSource.bindings=omittedSource.bindings.filter(b=>b.assetId!=='lake');omittedSource.bindings.find(b=>b.assetId==='mist').heightMeters=0;omittedSource.operators=omittedSource.operators.filter(o=>o.mechanism==='particles');Object.assign(omittedSource.operators[0].parameters,{count:1000,spread_x:0,spread_y:0});
const snowfall=calibrateDecision(omittedSource,dry);assert.equal(snowfall.bindings.find(b=>b.assetId==='mist').heightMeters,4);assert.equal(snowfall.operators[0].parameters.spread_x,12);validateDecision(snowfall,dry,[{id:'basin',kind:'basin'}]);
