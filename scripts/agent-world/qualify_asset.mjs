/** Explicit single-asset qualification using the same production tools and budget. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {AgentStore}=require('../../.cache/agent-test-build/agent-world/store.js');
const {generationServices}=require('../../.cache/agent-test-build/agent-world/generation-services.js');
const {projectFile}=require('../../.cache/agent-test-build/agent-world/assets.js');
const {validatePlan}=require('../../.cache/agent-test-build/agent-world/contracts.js');
if(!process.argv.includes('--execute'))throw Error('Explicit --execute required');
const brief=JSON.parse(await readFile(await projectFile(process.cwd(),process.argv[2]),'utf8'));
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(brief.job))throw Error('Invalid job identity');
const checked=validatePlan({version:1,title:'Asset qualification',objective:'Inspect this requested asset',navigation:'walk',metersPerUnit:1,
  artDirection:brief.artDirection,assets:[brief.request],behaviours:[],limitations:[]},brief.evidence??[]);
const store=new AgentStore();
try{
 const tools=generationServices(process.cwd(),brief.job,store,stage=>process.stderr.write(stage+'\n'));
 const result=await tools.resolveAsset(checked.assets[0],checked.artDirection);
 await writeFile(await projectFile(process.cwd(),'.cache/agent-world')+'/asset-qualification-report.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{store.close();}
