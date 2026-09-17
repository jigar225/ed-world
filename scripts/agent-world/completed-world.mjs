import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {projectFile}=require('../../.cache/agent-test-build/agent-world/assets.js');
const {calibrateDecision}=require('../../.cache/agent-test-build/agent-world/grounding.js');
const {agentWorldAsset}=require('../../.cache/agent-test-build/agent-world/assembly.js');
const key=prompt=>({version:1,prompt:prompt.trim()});
export function rememberCompletedWorld(job,prompt,result,store){
 if(result?.generation?.world)store.checkpoint(job,'completed-world',key(prompt),result);
}
/** Exact-prompt reuse of a completed immutable package requires no model call. */
export async function completedWorld(root,job,prompt,store){
 if(!/^agent-[a-f0-9]{24}$/.test(job))throw Error('Invalid canonical job');
 let result=store.checkpoint(job,'completed-world',key(prompt));
 if(!result){
  try{result=JSON.parse(await readFile(await projectFile(root,`.cache/agent-world/plans/${job}.json`),'utf8'));}
  catch(error){if(error.code==='ENOENT')return undefined;throw Error('Saved world record could not be read safely');}
 }
 const typed=result?.plan?.assets?.some(a=>a.role);
 if(typed&&!(result.generation?.assemblyRevision>=3))return undefined;
 const world=result?.generation?.world;
 if(!world||result.job!==job||result.prompt?.trim()!==prompt.trim())return undefined;
 const manifest=JSON.parse(await readFile(await agentWorldAsset(root,world.id,'manifest.json'),'utf8'));
 if(typed&&(!manifest.grounding||JSON.stringify(calibrateDecision(manifest.grounding,{plan:result.plan}))!==JSON.stringify(manifest.grounding)))return undefined;
 if(manifest.living.source!=='generated')throw Error('Completed world is not a generated package');
 for(const [name,metadata]of Object.entries(manifest.assets)){
  const bytes=await readFile(await agentWorldAsset(root,world.id,name));
  if(bytes.length!==metadata.bytes||createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)throw Error('Saved world asset failed integrity verification');
 }
 rememberCompletedWorld(job,prompt,result,store);return result;
}
