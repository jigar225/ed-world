import type {AssetRequest,WorldPlan} from './contracts';
import type {TerrainPlan,TerrainOutput} from './terrain';
import {validateTerrainCandidate,validateTerrainOutput} from './terrain';
import {validateLayout,spatialIssues,assembleWorld,type Layout} from './assembly';
import {compileBindings} from './behaviour-runtime';
import {inspectProjectAsset,saveArtifact,projectFile} from './assets';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basinSurface} from './surface-mesh';
import type {groundOnTerrain} from './grounding';
import {AgentStore} from './store';

export interface PreparedWorld {job:string;prompt?:string;plan:WorldPlan;layout:Layout;terrain:TerrainPlan[];critique:{issues:{target:string;reason:string}[]}}
export interface GenerationServices {
  root:string;store:AgentStore;
  /** Test artifacts stay hidden from the normal library and cannot claim generation. */
  mode?:'engineering-test';
  /** Only selections already checked for this request; filename similarity alone is insufficient. */
  resolveAsset:(request:AssetRequest,artDirection:string,signal?:AbortSignal)=>Promise<{path:string;hash:string;scale:number;upAxis:'Y'|'Z';qualification:'compatible-for-preview';measuredSize?:number[]}>;
  generateTerrain:(plan:TerrainPlan,signal?:AbortSignal)=>Promise<TerrainOutput>;
  ground?:(prepared:PreparedWorld,terrain:{plan:TerrainPlan;output:TerrainOutput}[],signal?:AbortSignal)=>ReturnType<typeof groundOnTerrain>;
  generateMaterial?:(prompt:string,signal?:AbortSignal)=>Promise<{path:string;hash:string}>;
  progress?:(stage:string)=>void;
}
export function generationRequirements(prepared:PreparedWorld,deferGrounding=false) {
  // Relative placement and motion calibration are resolved against measured terrain.
  // Unknown/missing entities and unsupported capabilities still block before compute.
  const groundable=new Set(['layout','arrival','gravity',...prepared.plan.assets.map(a=>a.id),...prepared.plan.behaviours.map(b=>b.id)]);
  const typed=prepared.plan.assets.some(a=>a.role);
  const gaps=prepared.critique.issues.filter(i=>typed||!deferGrounding||!groundable.has(i.target));
  gaps.push(...(prepared.plan.unavailable??[]).map(reason=>({target:'capability',reason})));
  if(prepared.plan.assets.some(a=>a.role)&&prepared.plan.assets.filter(a=>a.role==='ground'&&a.kind==='terrain').length!==1)gaps.push({target:'structure',reason:'Compiled scenes require one explicit solid terrain support'});
  if(prepared.plan.navigation!=='walk'||prepared.plan.metersPerUnit!==1)gaps.push({target:'navigation',reason:'Magnified interiors, flight and swimming require a qualified navigation adapter.'});
  try{
    const bindings=compileBindings(prepared.plan.behaviours);
    const layout=validateLayout(prepared.layout,prepared.plan);
    if(!deferGrounding)gaps.push(...spatialIssues(layout,prepared.plan,prepared.terrain));
    const particles=bindings.filter(b=>b.mechanism==='particles');
    if(particles.reduce((n,b)=>n+b.parameters.count*b.targets.length,0)>16384)throw Error('Particle budget exceeds 16384');
    if(particles.some(b=>b.targets.some(id=>!prepared.plan.assets.some(a=>a.id===id&&a.kind==='volume'))))throw Error('Particles require separate volume regions');
    for(const placement of layout.placements){
      const request=prepared.plan.assets.find(a=>a.id===placement.assetId)!;
      const operators=bindings.filter(b=>b.targets.includes(request.id));
      if(placement.dynamic&&operators.some(b=>['rotate','drift','oscillate','waves'].includes(b.mechanism)))throw Error('Physics and behaviour cannot both own the same transform');
      if(['terrain','volume'].includes(request.kind)&&(placement.dynamic||placement.scale!==1))throw Error('Terrain and effect regions require fixed physical scale');
    }
  }catch(error){gaps.push({target:'behaviour',reason:error instanceof Error?error.message:'Behaviour cannot compile'});}
  if(prepared.plan.assets.every(a=>a.kind==='volume'))gaps.push({target:'structure',reason:'Walking requires structural geometry.'});
  for(const asset of prepared.plan.assets) {
    if(asset.kind==='rigged-mesh'||asset.requiredParts.length)gaps.push({target:asset.id,reason:'Requires a qualified rig or part-assembly adapter.'});
    if(asset.kind==='volume'&&(!prepared.plan.behaviours.some(b=>b.mechanism==='particles'&&b.targets.includes(asset.id))||prepared.plan.behaviours.some(b=>b.targets.includes(asset.id)&&!['particles','transfer'].includes(b.mechanism))))gaps.push({target:asset.id,reason:'Volume requires a supported particle effect; scientific volume solvers remain unqualified.'});
    if(asset.kind==='terrain'&&!prepared.terrain.some(t=>t.assetId===asset.id&&t.representation==='heightfield'))gaps.push({target:asset.id,reason:'No supported heightfield plan; volume terrain needs a different generator.'});
  }
  return {canBuild:gaps.length===0,gaps};
}
/** Whole-package orchestration. Deployment is external; this never installs or deploys models. */
export async function buildPreparedWorld(prepared:PreparedWorld,services:GenerationServices,signal?:AbortSignal) {
  const requirements=generationRequirements(prepared,!!services.ground&&prepared.terrain.length>0);
  if(!requirements.canBuild)return {status:'needs-capability' as const,...requirements};
  const {root,store}=services;
  let grounded:Awaited<ReturnType<typeof groundOnTerrain>>|undefined;
  if(services.ground&&prepared.terrain.length){
    const candidates=[];
    for(const plan of prepared.terrain){
      services.progress?.('terrain-'+plan.assetId);
      let output=store.checkpoint(prepared.job,'terrain-candidate',plan) as TerrainOutput|undefined;
      const realizationKey={assetId:plan.assetId,domain:plan.domain,extentMeters:plan.extentMeters,representation:plan.representation};
      if(!output){const saved=store.checkpoint(prepared.job,'terrain-realization',realizationKey) as {plan:TerrainPlan;output:TerrainOutput}|undefined;if(saved)output=validateTerrainCandidate(saved.output,plan);}
      if(!output){output=validateTerrainCandidate(await services.generateTerrain(plan,signal),plan);store.checkpoint(prepared.job,'terrain-candidate',plan,output);}
      if(!store.checkpoint(prepared.job,'terrain-realization',realizationKey))store.checkpoint(prepared.job,'terrain-realization',realizationKey,{plan,output});
      output=validateTerrainCandidate(output,plan);if(output.provenance.kind==='test-fixture')throw Error('Live grounding cannot accept fixture terrain');candidates.push({plan,output});
    }
    services.progress?.('grounding');grounded=await services.ground(prepared,candidates,signal);
    prepared={...prepared,plan:grounded.plan,layout:grounded.layout,terrain:grounded.terrain.map(t=>t.plan)};
  }
  const layout=validateLayout(prepared.layout,prepared.plan);
  const selectedAssets:Record<string,string>={},terrain:{plan:TerrainPlan;output:TerrainOutput}[]=[];
  // Sequential execution bounds GPU fan-out. Checkpoint every accepted output.
  for(const request of prepared.plan.assets) {
    signal?.throwIfAborted();services.progress?.('asset-'+request.id);
    if(request.kind==='volume')continue;
    if(request.kind==='terrain') {
      const plan=prepared.terrain.find(t=>t.assetId===request.id)!;
      let output=grounded?.terrain.find(t=>t.plan.assetId===plan.assetId)?.output??store.checkpoint(prepared.job,'generated-terrain',plan) as TerrainOutput|undefined;
      if(!output)output=store.checkpoint(prepared.job,'terrain-candidate',plan) as TerrainOutput|undefined;
      if(!output){
        output=validateTerrainCandidate(await services.generateTerrain(plan,signal),plan);
        store.checkpoint(prepared.job,'terrain-candidate',plan,output);
      }
      output=validateTerrainCandidate(output,plan);
      if(output.provenance.kind==='test-fixture'&&services.mode!=='engineering-test')throw Error('Live generation cannot use fixture terrain');
      try{output=validateTerrainOutput(output,plan);}catch(error){
        return {status:'needs-terrain-review' as const,canBuild:false,
          gaps:[{target:request.id,reason:error instanceof Error?error.message:'Terrain does not match the plan'}],
          candidate:{assetId:request.id,extentMeters:output.extentMeters,grid:[output.width,output.height],
            measuredElevationRange:[Math.min(...output.elevations),Math.max(...output.elevations)],plannedElevationRange:plan.elevationRangeMeters,
            provenance:output.provenance,preserved:true},
          remaining:['Review the saved terrain landform and revise placement against actual geometry before assembly. No automatic terrain regeneration.']};
      }
      store.checkpoint(prepared.job,'generated-terrain',plan,output);
      terrain.push({plan,output});
    } else {
      const surface=grounded?.surfaces.get(request.id);
      if(surface){
        const artifact=await saveArtifact(root,basinSurface(grounded!.terrain[0].output,surface),'glb');selectedAssets[request.id]=artifact.path;continue;
      }
      if(request.role==='liquid')throw Error('Liquid surface was not constructed from grounded terrain; isolated-object generation is prohibited');
      const input={request,artDirection:prepared.plan.artDirection};
      let asset=store.checkpoint(prepared.job,'qualified-asset',input) as Awaited<ReturnType<GenerationServices['resolveAsset']>>|undefined;
      if(!asset){asset=await services.resolveAsset(request,prepared.plan.artDirection,signal);}
      if(asset.qualification!=='compatible-for-preview'||!Number.isFinite(asset.scale)||asset.scale<=0||!['Y','Z'].includes(asset.upAxis))throw Error('Asset compatibility was not checked');
      const inspected=await inspectProjectAsset(root,asset.path);
      if(inspected.hash!==asset.hash)throw Error('Qualified asset checksum changed');
      if(!inspected.meshes)throw Error('Asset has no geometry');
      store.checkpoint(prepared.job,'qualified-asset',input,asset);
      selectedAssets[request.id]=asset.path;
      const placement=layout.placements.find(p=>p.assetId===request.id)!;placement.scale=asset.scale;placement.upAxis=asset.upAxis;
      const binding=grounded?.decision.bindings.find(b=>b.assetId===request.id);
      if(binding&&['ground','shore'].includes(binding.anchor)&&asset.measuredSize)placement.position[2]+=(asset.measuredSize[asset.upAxis==='Y'?1:2]*asset.scale-request.sizeMeters[2])/2;
    }
  }
  signal?.throwIfAborted();services.progress?.('assemble');
  let material:Buffer|undefined;
  if(grounded&&services.generateMaterial){services.progress?.('ground-material');const key={terrainHash:grounded.terrain[0].output.provenance.requestHash,artDirection:prepared.plan.artDirection};let asset=store.checkpoint(prepared.job,'terrain-material',key) as {path:string;hash:string}|undefined;if(!asset){asset=await services.generateMaterial(grounded.decision.materialPrompt,signal);store.checkpoint(prepared.job,'terrain-material',key,asset);}material=await readFile(await projectFile(root,asset.path));if(createHash('sha256').update(material).digest('hex')!==asset.hash)throw Error('Ground material checksum changed');}
  const world=await assembleWorld(root,{plan:prepared.plan,layout,selectedAssets,terrain,source:services.mode==='engineering-test'?'engineering-fixture':'generated',lookAt:grounded?.lookAt,grounding:grounded?.decision,terrainMaterial:material});
  store.checkpoint(prepared.job,'assembled-world',{plan:prepared.plan,layout,selectedAssets,terrain},world);
  return {status:'engineering-preview' as const,world,assemblyRevision:4,
    remaining:['Real browser navigation and temporal QA','Scientific review and close-up visual acceptance']};
}
