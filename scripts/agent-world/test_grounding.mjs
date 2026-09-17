import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analyzeTerrain,sampleHeight}=require('../../.cache/agent-test-build/agent-world/terrain-analysis.js');
const {basinSurface}=require('../../.cache/agent-test-build/agent-world/surface-mesh.js');
const {validateDecision}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const t={width:7,height:7,extentMeters:[180,180],elevations:Array.from({length:49},(_,i)=>{const x=i%7,y=Math.floor(i/7);return x>=2&&x<=4&&y>=2&&y<=4?0:10;})};
const sites=analyzeTerrain(t),basin=sites.find(s=>s.kind==='basin');assert(basin);assert.equal(basin.center[2],9.8);
const open={...t,elevations:t.elevations.map((v,i)=>Math.floor(i/7)===3?0:v)};assert.equal(analyzeTerrain(open).filter(s=>s.kind==='basin').length,0);
// The mesh has diagonal edges: a diagonal outlet must drain the basin too.
const diagonal={...t,elevations:t.elevations.map((v,i)=>i%7+Math.floor(i/7)===6?0:v)};assert.equal(analyzeTerrain(diagonal).filter(s=>s.kind==='basin').length,0);
const saddle={width:2,height:2,extentMeters:[2,2],elevations:[0,10,20,0]};assert.equal(sampleHeight(saddle,0,0),15);assert.equal(sampleHeight(saddle,1,1),0);assert.throws(()=>sampleHeight(saddle,2,0),/outside/);
const bytes=basinSurface(t,basin),len=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+len)),bin=bytes.subarray(28+len),view=doc.bufferViews[0],accessor=doc.accessors[0];
assert(doc.accessors[2].count>0);
for(let i=0;i<accessor.count;i++){
 const x=bin.readFloatLE(view.byteOffset+i*12)+basin.center[0],y=bin.readFloatLE(view.byteOffset+i*12+4)+basin.center[1];
 assert(sampleHeight(t,x,y)<=basin.center[2]+1e-5,'Water geometry must remain in the measured depression');
}
const p={plan:{assets:[{id:'water',kind:'mesh'},{id:'mist',kind:'volume'}],behaviours:[{id:'ripple',targets:['water'],fidelity:'illustrative'},{id:'rise',targets:['mist'],fidelity:'illustrative'}]},terrain:[{waterRegions:['lake']}]};
const decision={decision:'accept',reason:'Measured basin supports surface water',siteId:basin.id,materialPrompt:'Sand',bindings:[{assetId:'water',anchor:'surface',heightMeters:0,offsetMeters:[0,0]},{assetId:'mist',anchor:'above-surface',heightMeters:0,offsetMeters:[0,0]}],operators:[{id:'ripple',mechanism:'waves',parameters:{}},{id:'rise',mechanism:'particles',parameters:{}}]};
validateDecision(decision,p,sites);
const bad=structuredClone(decision);bad.bindings[1].anchor='surface';assert.throws(()=>validateDecision(bad,p,sites),/volumes use above-surface/);
const bob=structuredClone(decision);bob.operators[0].mechanism='oscillate';assert.throws(()=>validateDecision(bob,p,sites),/requires waves/);
console.log('PASS: closed/open/diagonal basin drainage, triangle interpolation, water clipping and semantic grounding contracts.');
// Grounded solids must contact measured support even when a model copied an old altitude estimate.
const {groundOnTerrain}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const assets=[{id:'terrain',kind:'terrain',sizeMeters:[180,180,10]},{id:'rock',kind:'mesh',sizeMeters:[3,3,3]},...p.plan.assets.map(a=>({...a,sizeMeters:[3,3,3]}))];
const prepared={job:'ground-contact-test',prompt:'Boulder on dry ground',plan:{...p.plan,assets},terrain:p.terrain,critique:{issues:[]},layout:{version:1,arrival:[0,0,20],gravity:[0,0,-9.81],placements:assets.map(a=>({assetId:a.id,position:[0,0,0],upAxis:'Z',scale:1,dynamic:false}))}};
const contactDecision={...decision,bindings:[...decision.bindings,{assetId:'rock',anchor:'shore',heightMeters:5,offsetMeters:[0,0]}]};
const output={...t,assetId:'terrain',provenance:{requestHash:'test-contact'}};
const grounded=await groundOnTerrain(process.cwd(),prepared,[{plan:{limitations:[]},output}],{checkpoint:(job,stage)=>stage==='measured-grounding'?contactDecision:undefined});
const rock=grounded.layout.placements.find(p=>p.assetId==='rock');assert.equal(rock.position[2],sampleHeight(output,...rock.position.slice(0,2))+1.5);
console.log('PASS: solid ground attachment uses actual support, not a stale model altitude.');
