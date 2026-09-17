/** Explicit, budgeted revision of a saved scene from actual render evidence. */
import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const {projectFile,saveArtifact}=require('../../.cache/agent-test-build/agent-world/assets.js');
const {groundingSchema,decodeGrounding}=require('../../.cache/agent-test-build/agent-world/grounding-schema.js');
const {validateDecision}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const {analyzeTerrain,terrainSummary}=require('../../.cache/agent-test-build/agent-world/terrain-analysis.js');
const {modalSceneRevisionRPC}=require('../../.cache/agent-test-build/agent-world/rpc.js');
if(!process.argv.includes('--execute'))throw Error('Explicit --execute required for budgeted Modal review');
const root=process.cwd(),input=JSON.parse(await readFile(await projectFile(root,process.argv[2]),'utf8'));
const prepared=JSON.parse(await readFile(await projectFile(root,input.plan),'utf8'));
const manifest=JSON.parse(await readFile(await projectFile(root,`.cache/agent-world/worlds/${prepared.generation.world.id}/manifest.json`),'utf8'));
const store=new AgentStore();try{
 const t=store.checkpoint(prepared.job,'terrain-candidate',prepared.terrain[0]);if(!t)throw Error('Saved terrain candidate missing');
 const images=[];for(const relative of input.images){const a=await saveArtifact(root,await readFile(await projectFile(root,relative)),'png');images.push(a.path);}
 const payload={originalRequest:prepared.prompt,assets:prepared.plan.assets,behaviours:prepared.plan.behaviours.map(({id,targets})=>({id,targets})),terrain:terrainSummary(t,analyzeTerrain(t)),current:manifest.grounding,visualFeedback:input.feedback};
 const decision=decodeGrounding(await modalSceneRevisionRPC(root,prepared.job,
 'Revise a generated learning scene using actual browser screenshots and engineering visual feedback. Return corrected bindings and operators as objects keyed by IDs. Preserve the original lesson, measured site, all asset/behaviour IDs, and materialPrompt EXACTLY (texture is already generated). Change only placement and motion parameters needed to fix the observed problems. These remain illustrative motion effects. Use particles for volumes, waves for the water mesh. All height/XY values are relative offsets from the anchor. Follow the feedback concretely; do not merely describe a correction in the reason. Do not reject a valid site because the old animation parameters were wrong: correct the parameters. If a requested change is incompatible with the original subject, reject and explain.',JSON.stringify(payload),images,groundingSchema(prepared.plan)));
 validateDecision(decision,prepared,analyzeTerrain(t));if(decision.decision!=='accept')throw Error(decision.reason);
 const receipt={sourceWorld:manifest.id,decision,images,feedback:input.feedback};
 const saved=await saveArtifact(root,Buffer.from(JSON.stringify(receipt)),'json');
 store.checkpoint(prepared.job,'grounding-refinement',{version:1,terrainHash:t.provenance.requestHash},{...receipt,receipt:saved.path});
 console.log(JSON.stringify({receipt:saved.path,decision},null,2));
}finally{store.close();}
