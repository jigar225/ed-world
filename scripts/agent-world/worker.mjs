import {createRequire} from 'node:module';
import {completedWorld,rememberCompletedWorld} from './completed-world.mjs';
const require=createRequire(import.meta.url);
const {prepareScene}=require('../../.cache/agent-test-build/agent-world/scene-planner.js');
const {agentJobs}=require('../../.cache/agent-test-build/agent-world/jobs.js');
const {AgentStore,digest}=require('../../.cache/agent-test-build/agent-world/store.js');

const {generationServices}=require('../../.cache/agent-test-build/agent-world/generation-services.js');
const {buildPreparedWorld}=require('../../.cache/agent-test-build/agent-world/pipeline.js');
const {modalReasonRPC}=require('../../.cache/agent-test-build/agent-world/rpc.js');
if(!process.argv.includes('--execute'))throw Error('Worker requires --execute; it can reserve existing budget for queued Modal planning jobs.');
const root=process.cwd(),db=agentJobs(),store=new AgentStore();
let stopping=false,activeController;
for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>{stopping=true;activeController?.abort();});
const worker=(process.argv.includes('--generate')?'agent-generation-':'agent-preparation-')+process.pid;
db.heartbeat(worker);
const heartbeat=setInterval(()=>db.heartbeat(worker),10000);
try {
  while(!stopping) {
    const job=db.claim();
    if(!job){if(process.argv.includes('--once'))break;await new Promise(r=>setTimeout(r,1000));continue;}
    const controller=new AbortController();activeController=controller;let phase='understand';
    const lease=setInterval(()=>{try{db.update(job,phase);}catch{controller.abort();}},10000);
    try {
      const contentJob='agent-'+digest({version:1,prompt:job.topic.trim()}).slice(0,24);
      const saved=process.argv.includes('--generate')?await completedWorld(root,contentJob,job.topic,store):undefined;
      if(saved){db.finish(job,'needs_review',saved);if(process.argv.includes('--once'))break;continue;}
      const result=await prepareScene(contentJob,job.topic,{root,store,
        reason:(...args)=>modalReasonRPC(root,...args),
        progress:stage=>{phase=stage;db.update(job,stage);}},controller.signal);
      // Generation remains opt-in until the last-stage deployments are qualified.
      const generation=process.argv.includes('--generate')?await buildPreparedWorld(result,generationServices(root,contentJob,store,stage=>{phase=stage;db.update(job,stage);}),controller.signal):undefined;
      const completed={...result,generation};rememberCompletedWorld(contentJob,job.topic,completed,store);
      db.finish(job,'needs_review',completed);
    } catch(error) {
      if(!stopping)db.finish(job,'failed',null,`World creation stopped at ${phase}: ${error instanceof Error?error.message.slice(0,400):'Unknown error'}. Completed stages are saved.`);
    } finally {clearInterval(lease);activeController=undefined;}
    if(process.argv.includes('--once'))break;
  }
} finally {clearInterval(heartbeat);db.db.prepare('DELETE FROM workers WHERE id=?').run(worker);db.db.close();store.close();}
