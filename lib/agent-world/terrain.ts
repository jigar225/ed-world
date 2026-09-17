import type {AssetRequest, Evidence} from './contracts';
import {terrainSource} from './terrain-sources';

export interface TerrainPlan {
  version: 1; assetId: string; domain: string; representation: 'heightfield' | 'mesh-volume';
  extentMeters: [number, number]; elevationRangeMeters: [number, number];
  landforms: string[]; surfaceMaterials: string[]; waterRegions: string[];
  evidenceIds: string[]; generationPrompt: string; closeupRequirements: string[];
  conditioning: {width: number; height: number; elevations: number[]};
  limitations: string[];
}
export interface TerrainOutput {
  version: 1; assetId: string; width: number; height: number;
  extentMeters: [number, number]; elevations: number[];
  provenance: {kind:'model-generated' | 'recorded-model-output' | 'recorded-dataset' | 'test-fixture'; model:string; requestHash:string};
}
const finite=(x:unknown,min:number,max:number):number=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error('Invalid terrain number');return x;};
const text=(x:unknown,max=2000):string=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('Invalid terrain text');return x.trim();};
const strings=(x:unknown,max=16):string[]=>{if(!Array.isArray(x)||x.length>max)throw Error('Invalid terrain list');return x.map(v=>text(v));};
const pair=(x:unknown,min:number,max:number):[number,number]=>{if(!Array.isArray(x)||x.length!==2)throw Error('Invalid terrain pair');return x.map(v=>finite(v,min,max)) as [number,number];};
function grid(x:unknown,maximum:number) {
  const g=x as {width:unknown;height:unknown;elevations:unknown};
  const width=finite(g?.width,2,maximum),height=finite(g?.height,2,maximum);
  if(!Number.isInteger(width)||!Number.isInteger(height)||!Array.isArray(g.elevations)||g.elevations.length!==width*height)throw Error('Terrain grid dimensions do not match');
  return {width,height,elevations:g.elevations.map(v=>finite(v,-20000,100000))};
}
export function validateTerrainPlan(value:unknown,asset:AssetRequest,evidence:Evidence[]):TerrainPlan {
  const x=value as Record<string,unknown>;
  if(x?.version!==1||x.assetId!==asset.id||asset.kind!=='terrain')throw Error('Terrain identity mismatch');
  if(!['heightfield','mesh-volume'].includes(x.representation as string))throw Error('Unsupported terrain representation');
  const extentMeters=pair(x.extentMeters,1e-3,1e7),elevationRangeMeters=pair(x.elevationRangeMeters,-20000,100000);
  if(elevationRangeMeters[0]>=elevationRangeMeters[1])throw Error('Invalid elevation interval');
  const conditioning=grid(x.conditioning,16);
  if(conditioning.elevations.some(h=>h<elevationRangeMeters[0]||h>elevationRangeMeters[1]))throw Error('Conditioning exceeds elevation interval');
  const evidenceIds=strings(x.evidenceIds);
  if(evidenceIds.some(id=>!evidence.some(s=>s.id===id)))throw Error('Unknown terrain evidence');
  return {version:1,assetId:asset.id,domain:text(x.domain,160),representation:x.representation as TerrainPlan['representation'],extentMeters,elevationRangeMeters,
    landforms:strings(x.landforms),surfaceMaterials:strings(x.surfaceMaterials),waterRegions:strings(x.waterRegions),evidenceIds,
    generationPrompt:text(x.generationPrompt,4000),closeupRequirements:strings(x.closeupRequirements),conditioning,limitations:strings(x.limitations)};
}
export function validateTerrainCandidate(value:unknown,plan:TerrainPlan):TerrainOutput {
  const x=value as Record<string,unknown>;
  if(x?.version!==1||x.assetId!==plan.assetId||plan.representation!=='heightfield')throw Error('Terrain output cannot satisfy this plan');
  const dimensions=grid(x,257),extentMeters=pair(x.extentMeters,1e-3,1e7);
  if(extentMeters.some((v,i)=>Math.abs(v-plan.extentMeters[i])>1e-6))throw Error('Terrain output changed physical extent');
  const p=x.provenance as Record<string,unknown>;
  if(!p||!['model-generated','recorded-model-output','recorded-dataset','test-fixture'].includes(p.kind as string))throw Error('Missing terrain provenance');
  return {version:1,assetId:plan.assetId,...dimensions,extentMeters,
    provenance:{kind:p.kind as TerrainOutput['provenance']['kind'],model:text(p.model,160),requestHash:text(p.requestHash,160)}};
}
export function validateTerrainOutput(value:unknown,plan:TerrainPlan):TerrainOutput {
  const output=validateTerrainCandidate(value,plan);
  if(output.elevations.some(h=>h<plan.elevationRangeMeters[0]||h>plan.elevationRangeMeters[1]))throw Error('Terrain output exceeds declared elevation interval');
  return output;
}
export function terrainDeploymentRequest(plan:TerrainPlan) {
  try{if(terrainSource(plan)==='lunar-dem')return {tool:'recorded-terrain',assetId:plan.assetId,status:'available-local-dataset',candidate:'bundled-lroc-apollo15',input:plan,requirements:['Preserve physical extent and dataset provenance','Keep the crop inside recorded coverage'],caveat:'Recorded Apollo 15 crop; not generated geology or coverage of any lunar location.'};}catch{}
  return {tool:'generate-terrain',assetId:plan.assetId,status:plan.representation==='heightfield'?'deployed-requires-plan-qualification':'no-qualified-volume-model',
    candidate:plan.representation==='heightfield'?'terrain-diffusion':'no-qualified-volume-model',
    input:plan,requirements:['Generate actual elevation/geometry, not an RGB landscape','Preserve physical extent and separate moving water/clouds','Return provenance and measurable geometry'],
    caveat:'Terrain Diffusion 30m/90m models cover regional landforms; close-up detail and non-Earth domains need independent qualification.'};
}
export const TERRAIN_FORMAT='{version:1,assetId,domain,representation:"heightfield|mesh-volume",extentMeters:[x,y],elevationRangeMeters:[min,max],landforms:string[],surfaceMaterials:string[],waterRegions:string[],evidenceIds:string[],generationPrompt,closeupRequirements:string[],conditioning:{width:4,height:4,elevations:number[16]},limitations:string[]}';
