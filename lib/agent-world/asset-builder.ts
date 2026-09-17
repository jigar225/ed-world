import type {AssetRequest} from './contracts';
import {ModalTools} from './modal-tools';
import {AgentStore, digest} from './store';

/** Agent-selected asset request → shared-style reference → 3D artifact.
 * Only structural qualification is performed here; assembly/visual review remains required.
 */
export async function buildObjectAsset(job: string, request: AssetRequest, artDirection: string,
  tools: ModalTools, store: AgentStore, signal?: AbortSignal) {
  if(request.kind !== 'mesh' || request.requiredParts.length)throw Error('This generator cannot guarantee the requested terrain, volume, rig or separable parts');
  if(!request.description.trim() || request.description.length>2000 || !artDirection.trim() || artDirection.length>2000)throw Error('Invalid asset brief');
  const reference=await tools.call(job,'generate-reference',{
    prompt:`Create an isolated reference for one 3D asset. Subject: ${request.description}. Shared world appearance: ${artDirection}. Show the entire object on a plain neutral background, with consistent proportions, no labels or text.`,
    seed:parseInt(digest({request,artDirection}).slice(0,8),16),
  },signal) as {path:string};
  const geometry=await tools.call(job,'generate-object',{referencePath:reference.path},signal) as {hash:string;path:string;inventory:unknown};
  const manifest={...geometry,requestId:request.id,description:request.description,referenceIds:request.referenceIds,
    requestedSizeMeters:request.sizeMeters,actualScale:'unverified',referencePath:reference.path,
    qualification:'structural-only',readyForAssembly:false};
  // Enrich the model artifact registration without overwriting its immutable provenance.
  store.checkpoint(job,'asset-request-result',{request,artDirection},manifest);
  return manifest;
}
