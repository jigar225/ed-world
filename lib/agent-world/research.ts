import {createHash} from 'node:crypto';
import {retrieveSceneReferences} from '../scene-references';
import type {AgentStore} from './store';
import type {Evidence} from './contracts';

export interface AgentDependencies {
  root: string; store: AgentStore;
  reason: (job: string, role: string, system: string, prompt: string, signal?: AbortSignal) => Promise<unknown>;
  research?: (queries: string[], signal?: AbortSignal) => Promise<{sources: Evidence[]; limitations: string[]}>;
  progress?: (stage: string) => void;
}
export async function researchReferences(queries: string[], signal?: AbortSignal) {
  const result=await retrieveSceneReferences(queries,signal);
  return {sources:result.sources.map(s=>({id:'ref-'+createHash('sha256').update(s.url).digest('hex').slice(0,16),
    title:s.title,url:s.url,excerpt:s.excerpt,usage:'reference-only' as const,retrievedAt:new Date().toISOString()})),
    limitations:[...result.limitations,'Wikipedia discovery is not authoritative scientific validation. Retrieved images are not licensed world textures.']};
}
