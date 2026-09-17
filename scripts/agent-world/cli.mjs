import {createRequire} from 'node:module';
import {completedWorld,rememberCompletedWorld} from './completed-world.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {prepareScene}=require('../../.cache/agent-test-build/agent-world/scene-planner.js');
const {AgentStore,digest}=require('../../.cache/agent-test-build/agent-world/store.js');
const {TOOL_CATALOG,evaluatePlan}=require('../../.cache/agent-test-build/agent-world/capabilities.js');
const {ModalTools}=require('../../.cache/agent-test-build/agent-world/modal-tools.js');
const {findProjectAssets,inspectProjectAsset,projectFile}=require('../../.cache/agent-test-build/agent-world/assets.js');
const {researchReferences}=require('../../.cache/agent-test-build/agent-world/research.js');
const {modalReasonRPC}=require('../../.cache/agent-test-build/agent-world/rpc.js');
const {buildPreparedWorld}=require('../../.cache/agent-test-build/agent-world/pipeline.js');
const {generationServices}=require('../../.cache/agent-test-build/agent-world/generation-services.js');
const {DEPLOYMENT_PLAN}=require('../../.cache/agent-test-build/agent-world/deployment.js');
const {validatePlan}=require('../../.cache/agent-test-build/agent-world/contracts.js');
const root=process.cwd(),[command='status',...args]=process.argv.slice(2);
const store=new AgentStore();
try {
  let result;
  if(command==='status')result={tools:TOOL_CATALOG,modalHTTP:new ModalTools({root,store}).status(),
    languageRPC:{provider:'existing-private-modal-qwen',verifiedLive:true,qualification:'Historical structured calls passed; this command does not test current connectivity. Semantic and spatial checks remain required',execution:'Explicit run command; reserves $0.80 per new allocation, reuses a still-funded warm allocation across independent requests'},
    terrain:'deployed; actual 960m tile inference passed; scene-quality acceptance pending',worldRuntime:'engineering preview integrated; full live generation not qualified',installs:0};
  else if(command==='deployment-plan')result=DEPLOYMENT_PLAN;
  else if(command==='find-assets')result=await findProjectAssets(root,args.join(' '));
  else if(command==='inspect-asset')result=await inspectProjectAsset(root,args[0]??'');
  else if(command==='research')result=await researchReferences([args.join(' ')]);
  else if(command==='check-plan') {
    if(!args[0]?.endsWith('.json'))throw Error('Provide a project JSON plan path');
    const input=JSON.parse(await readFile(await projectFile(root,args[0]),'utf8'));
    result=evaluatePlan(validatePlan(input.plan,input.evidence??[]));
  } else if(command==='run') {
    if(!args.includes('--execute'))throw Error('Run requires --execute: it reserves existing budget and calls Modal. Use status for a read-only check.');
    const at=args.indexOf('--prompt-file'),relative=args[at+1];
    if(at<0 || !relative || !/^scripts\/[a-zA-Z0-9_./-]+\.txt$/.test(relative))throw Error('Provide --prompt-file scripts/<name>.txt');
    const prompt=(await readFile(await projectFile(root,relative),'utf8')).trim();
    const job='agent-'+digest({version:1,prompt}).slice(0,24);
    const saved=args.includes('--generate')?await completedWorld(root,job,prompt,store):undefined;
    if(saved){result=saved;}else{
    result=await prepareScene(job,prompt,{root,store,reason:(...a)=>modalReasonRPC(root,...a),
      progress:stage=>process.stderr.write(`${stage}\n`)});
    if(args.includes('--generate'))result={...result,generation:await buildPreparedWorld(result,generationServices(root,job,store,stage=>process.stderr.write(stage+'\n')))};
    rememberCompletedWorld(job,prompt,result,store);
    }
    const folder=path.join(root,'.cache/agent-world/plans');await mkdir(folder,{recursive:true});
    await projectFile(root,'.cache/agent-world/plans');
    await writeFile(path.join(folder,job+'.json'),JSON.stringify(result,null,2)+'\n');
  } else throw Error('Commands: status, deployment-plan, find-assets, inspect-asset, research, check-plan, run');
  console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(error instanceof Error?error.message:'Agent tool failed');process.exitCode=1; }
finally {store.close();}
