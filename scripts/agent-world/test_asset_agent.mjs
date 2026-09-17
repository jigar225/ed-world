import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),root=process.cwd();
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const {resolveWorldAsset,measuredScale,centerGLB}=require('../../.cache/agent-test-build/agent-world/asset-agent.js');
const {inspectProjectAsset,inspectGLB,saveArtifact}=require('../../.cache/agent-test-build/agent-world/assets.js');
const path='public/props/fish_school.glb',inventory=await inspectProjectAsset(root,path);
const request={id:'fish',kind:'mesh',description:'qzvxjassetfixture',sizeMeters:[1,1,1],requiredParts:[],referenceIds:[]};
const metrics={min:[-.5,-.5,-.5],max:[.5,.5,.5],size:[1,1,1],triangles:12,animations:0,images:['fixture-image']};
assert.equal(measuredScale(metrics,request,'Y'),1);
assert.throws(()=>measuredScale({...metrics,size:[1,100,1]},request,'Y'),/proportions/);
assert.equal(inspectGLB(centerGLB(await readFile(path),[.1,.2,.3])).meshes,inventory.meshes);
const store=new AgentStore(':memory:');let generations=0,reviews=0,renders=0;
const reference=await saveArtifact(root,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),'png');
const tools={generate:async kind=>{generations++;return kind==='reference'?reference:{path,hash:inventory.hash};},review:async()=>{reviews++;return {decision:'accept',upAxis:'Y',reasons:['Simulated test acceptance, not actual asset qualification']};},render:async()=>{renders++;return metrics;}};
try{
 const result=await resolveWorldAsset(root,'asset-agent-test',request,'fixture',store,tools);assert.equal(result.qualification,'compatible-for-preview');assert.equal(generations,2);assert.equal(reviews,2);assert.equal(renders,1);
 const reused=await resolveWorldAsset(root,'another-job',request,'fixture',store,tools);assert.equal(result.hash,reused.hash);assert.equal(generations,2);assert.equal(reviews,2);
 await assert.rejects(resolveWorldAsset(root,'rig',{...request,kind:'rigged-mesh'},'fixture',store,tools),/rig/);
 const before=generations;
 await assert.rejects(resolveWorldAsset(root,'reject-reference',{...request,id:'scene'},'new brief',store,{...tools,review:async()=>({decision:'reject',upAxis:'Z',reasons:['Full scene, not an isolated solid']})}),/Reference is unsuitable/);
 assert.equal(generations,before+1,'Rejected reference must never reach object generation');
 await assert.rejects(resolveWorldAsset(root,'reject',{...request,id:'other'},'new brief',store,{...tools,review:async prompt=>({decision:JSON.parse(prompt).stage==='reference'?'accept':'reject',upAxis:'Y',reasons:['Wrong geometry subject']})}),/failed visual review/);
 console.log('PASS: asset measurement, scene recentering, visual review requirement, immutable reuse, rig rejection and failed-generation stop. Mock reviewer only.');
}finally{store.close();}
