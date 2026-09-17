import path from 'node:path';
import {SceneJobs} from '../scene-jobs';
let instance: SceneJobs | undefined;
/** Reuse the existing queue implementation, without consuming historical world jobs. */
export function agentJobs() {
  return instance ??= new SceneJobs(path.join(process.cwd(), '.cache', 'agent-world', 'jobs.sqlite'));
}

export function generationWorkerReady(){return !!agentJobs().db.prepare("SELECT id FROM workers WHERE id LIKE 'agent-generation-%' AND heartbeat>? LIMIT 1").get(Date.now()-30000);}
