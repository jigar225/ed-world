import {AgentStore} from './store';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import type {WorldPlan} from './contracts';
import {inspectProjectAsset,projectFile} from './assets';
import {compileBindings,describeBinding} from './behaviour-runtime';
import type {TerrainOutput,TerrainPlan} from './terrain';
import {validateTerrainOutput} from './terrain';
import {terrainGLB} from './terrain-mesh';

export interface Layout {version:1;arrival:[number,number,number];gravity:[number,number,number];placements:{assetId:string;position:[number,number,number];scale:number;upAxis:'Y'|'Z';dynamic:boolean}[]}
export function validateLayout(value:unknown,plan:WorldPlan):Layout {
  const x=value as Layout;
  const vector=(v:unknown):[number,number,number]=>{if(!Array.isArray(v)||v.length!==3||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e7))throw Error('Invalid placement');return [...v] as [number,number,number];};
  if(x?.version!==1||!Array.isArray(x.placements)||x.placements.length!==plan.assets.length)throw Error('Incomplete spatial layout');
  const ids=new Set<string>();
  const placements=x.placements.map(p=>{
    if(!p||!plan.assets.some(a=>a.id===p.assetId)||ids.has(p.assetId))throw Error('Invalid layout identity');ids.add(p.assetId);
    if(!Number.isFinite(p.scale)||p.scale<=0||p.scale>1e9||!['Y','Z'].includes(p.upAxis)||typeof p.dynamic!=='boolean')throw Error('Invalid layout transform');
    return {assetId:p.assetId,position:vector(p.position),scale:p.scale,upAxis:p.upAxis,dynamic:p.dynamic};
  });
  const gravity=vector(x.gravity);if(gravity.some(v=>Math.abs(v)>1000))throw Error('Gravity exceeds runtime range');
  return {version:1,arrival:vector(x.arrival),gravity,placements};
}
export const LAYOUT_FORMAT='{version:1,arrival:[x,y,z],gravity:[x,y,z],placements:[{assetId,position:[x,y,z],scale:number,upAxis:"Y|Z",dynamic:boolean}]}';
/** Planning checks before paid geometry. Actual geometry still needs spatial QA. */
export function spatialIssues(layout:Layout,plan:WorldPlan,terrain:TerrainPlan[]=[]){
  const issues:{target:string;reason:string}[]=[];
  if(plan.navigation==='walk'&&(Math.abs(layout.gravity[0])>1e-6||Math.abs(layout.gravity[1])>1e-6||layout.gravity[2]>=0))
    issues.push({target:'gravity',reason:'Walking is Z-up: gravity must point down negative Z, with X=0 and Y=0. Choose the physical magnitude for the world; Earth is [0,0,-9.81].'});
  for(const p of layout.placements){
    const asset=plan.assets.find(a=>a.id===p.assetId)!;
    const effects=plan.behaviours.filter(b=>b.targets.includes(asset.id));
    if(['terrain','volume'].includes(asset.kind)&&(p.dynamic||p.scale!==1))
      issues.push({target:asset.id,reason:'Terrain and particle regions require dynamic:false and scale:1. Particle velocity animates the effect; dynamic means gravity-driven rigid-body physics.'});
    if(p.dynamic&&effects.some(b=>['rotate','oscillate','drift','waves'].includes(b.mechanism)))
      issues.push({target:asset.id,reason:'Use dynamic:false for a behaviour-driven mesh. Physics and an animation cannot both own its transform.'});
    if(asset.kind==='terrain'&&p.upAxis!=='Z')issues.push({target:asset.id,reason:'Generated terrain is Z-up. Use upAxis:Z.'});
    if(asset.kind==='mesh'&&!effects.some(b=>b.mechanism==='waves')&&layout.arrival.every((v,i)=>Math.abs(v-p.position[i])<asset.sizeMeters[i]*p.scale/2+.3))
      issues.push({target:'arrival',reason:`Arrival is inside the planned bounds of ${asset.id}. Choose a clear position beside the subject, with eye height above ground.`});
    if(asset.kind==='volume')for(const ground of terrain){
      const at=layout.placements.find(p=>p.assetId===ground.assetId);if(!at||ground.representation!=='heightfield')continue;
      const u=(p.position[0]-at.position[0])/ground.extentMeters[0]+.5,v=(p.position[1]-at.position[1])/ground.extentMeters[1]+.5;
      if(u<0||u>1||v<0||v>1)continue;
      const g=ground.conditioning,x=u*(g.width-1),y=v*(g.height-1),ix=Math.min(g.width-2,Math.floor(x)),iy=Math.min(g.height-2,Math.floor(y)),fx=x-ix,fy=y-iy;
      const z=at.position[2]+(1-fy)*((1-fx)*g.elevations[iy*g.width+ix]+fx*g.elevations[iy*g.width+ix+1])+fy*((1-fx)*g.elevations[(iy+1)*g.width+ix]+fx*g.elevations[(iy+1)*g.width+ix+1]);
      for(const effect of effects.filter(b=>b.mechanism==='particles')){
        const q=effect.parameters,top=p.position[2]+(q.spread_z??1)/2+Math.max(0,(q.velocity_z??1)*(q.lifetime??5));
        if(top<z)issues.push({target:asset.id,reason:'The entire particle trajectory lies below the planned heightfield, invisible to a walking observer. Start falling particles above the visible region, with a lifetime that reaches it.'});
      }
    }
  }
  const meshes=layout.placements.filter(p=>plan.assets.find(a=>a.id===p.assetId)?.kind==='mesh');
  if(meshes.length>1&&meshes.every(p=>p.position.every((v,i)=>v===meshes[0].position[i])))
    issues.push({target:'layout',reason:'Every independent mesh has the same center. Provide deliberate positions relative to the terrain, surface, shore and viewing location; do not copy one coordinate to every entity.'});
  return issues;
}
const pose=(position=[0,0,0])=>({position,quaternion:[0,0,0,1]});
export async function assembleWorld(root:string,input:{plan:WorldPlan;layout:Layout;selectedAssets:Record<string,string>;terrain:{plan:TerrainPlan;output:TerrainOutput}[];source:'generated'|'engineering-fixture';lookAt?:number[];grounding?:unknown;terrainMaterial?:Buffer}) {
  const {plan}=input,layout=validateLayout(input.layout,plan),bindings=compileBindings(plan.behaviours);
  if(plan.navigation!=='walk'||plan.metersPerUnit!==1)throw Error('This runtime requires walk navigation at physical meter scale');
  if(Math.abs(layout.gravity[0])>1e-6||Math.abs(layout.gravity[1])>1e-6||layout.gravity[2]>=0)throw Error('Z-up walking requires downward Z gravity');
  if(plan.assets.every(a=>a.kind==='volume'))throw Error('A walkable world requires structural geometry');
  const particleBindings=bindings.filter(b=>b.mechanism==='particles');
  if(particleBindings.reduce((n,b)=>n+b.parameters.count*b.targets.length,0)>16384)throw Error('Particle budget exceeds 16384');
  if(particleBindings.some(b=>b.targets.some(id=>!plan.assets.some(a=>a.id===id&&a.kind==='volume'))))throw Error('Particles require separate volume regions');
  const blobs=new Map<string,Buffer>(),assets:Record<string,{sha256:string;bytes:number}>={},bodies:unknown[]=[];
  const emitters:{assetId:string;appearance?:string;position:number[];ground?:{assetId:string;clearance:number}}[]=[];
  const terrainById=new Map(input.terrain.map(t=>[t.plan.assetId,t]));
  const transformTargets=new Set(bindings.filter(b=>['rotate','oscillate','drift'].includes(b.mechanism)).flatMap(b=>b.targets));
  const waveTargets=new Set(bindings.filter(b=>b.mechanism==='waves').flatMap(b=>b.targets));
  for(const request of plan.assets) {
    const placement=layout.placements.find(p=>p.assetId===request.id)!;
    if(request.kind==='volume') {
      const operators=bindings.filter(b=>b.targets.includes(request.id));
      if(request.requiredParts.length||placement.dynamic||placement.scale!==1||!operators.some(b=>b.mechanism==='particles')||operators.some(b=>!['particles','transfer'].includes(b.mechanism)))throw Error('Volume requires a fixed particle region with supported operators');
      const binding=(input.grounding as {bindings?:{assetId:string;anchor:string;heightMeters:number}[]}|undefined)?.bindings?.find(b=>b.assetId===request.id);
      const supported=binding&&['ground','shore'].includes(binding.anchor)&&input.terrain.length===1?input.terrain[0]:undefined;
      emitters.push({assetId:request.id,...(request.appearance?{appearance:request.appearance}:{}),position:placement.position,...(supported?{ground:{assetId:supported.plan.assetId,clearance:binding!.heightMeters}}:{})});continue;
    }
    let bytes:Buffer,upAxis=placement.upAxis;
    if(request.kind==='terrain') {
      const terrain=terrainById.get(request.id);if(!terrain)throw Error(`Terrain output missing: ${request.id}`);
      const output=validateTerrainOutput(terrain.output,terrain.plan);
      if(input.source==='generated'&&output.provenance.kind==='test-fixture')throw Error('Fixture terrain cannot be promoted as generated content');
      bytes=terrainGLB(output,input.terrainMaterial);upAxis='Z';
      if(placement.scale!==1||placement.dynamic||transformTargets.has(request.id))throw Error('Terrain must preserve physical scale and remain fixed');
    } else {
      if(request.kind!=='mesh'||request.requiredParts.length)throw Error(`Asset needs an unsupported rig, volume or assembly: ${request.id}`);
      const relative=input.selectedAssets[request.id];if(!relative)throw Error(`No qualified asset selected: ${request.id}`);
      await inspectProjectAsset(root,relative);bytes=await readFile(await projectFile(root,relative));
    }
    if(placement.dynamic&&transformTargets.has(request.id))throw Error('Physics and behaviour cannot both own the same transform');
    if(waveTargets.has(request.id)&&(placement.dynamic||request.kind==='terrain'||upAxis!=='Z'))throw Error('Wave appearance requires a separate fixed Z-up surface');
    const hash=createHash('sha256').update(bytes).digest('hex'),name=hash+'.glb';blobs.set(name,bytes);assets[name]={sha256:hash,bytes:bytes.length};
    const geometry={type:'mesh',asset:name,meshUpAxis:upAxis,scale:[placement.scale,placement.scale,placement.scale]};
    const kinematic=transformTargets.has(request.id);
    bodies.push({id:request.id,fixed:!placement.dynamic&&!kinematic,kinematic,pose:pose(placement.position),mass:1,inertiaTensor:[1,0,0,1,0,1],inertialPose:pose(),
      visuals:[{pose:pose(),geometry,color:[1,1,1,1]}],collisions:waveTargets.has(request.id)?[]:[{pose:pose(),geometry,friction:.7}]});
  }
  const base={kind:'physical-world',schemaVersion:1,title:plan.title,entities:plan.assets.map(a=>({id:a.id,description:a.description,bodyIds:a.kind==='volume'?[]:[a.id]})),assets,
    environment:{atmosphere:input.terrain.some(t=>t.output.provenance.kind==='recorded-dataset'&&/^(moon|lunar)\b/i.test(t.plan.domain))?'vacuum':'air'},
    terrainSources:input.terrain.map(t=>({assetId:t.plan.assetId,domain:t.plan.domain,extentMeters:t.output.extentMeters,sampleMeters:t.output.extentMeters[0]/(t.output.width-1),provenance:t.output.provenance})),
    gravity:layout.gravity,arrival:{position:layout.arrival,...(input.lookAt?{lookAt:input.lookAt}:{})},...(input.grounding?{grounding:input.grounding}:{}),physics:{schemaVersion:1,kind:'physical-asset',units:'meters',upAxis:'Z',bodies,joints:[]},
    living:{version:1,bindings,emitters,...(emitters.some(e=>e.ground)?{groundSurfaces:input.terrain.filter(t=>emitters.some(e=>e.ground?.assetId===t.plan.assetId)).map(t=>({assetId:t.plan.assetId,position:layout.placements.find(p=>p.assetId===t.plan.assetId)!.position,width:t.output.width,height:t.output.height,extentMeters:t.output.extentMeters,elevations:t.output.elevations}))}:{}),explanations:bindings.map(b=>({id:b.id,observations:describeBinding(b),intendedObservations:plan.behaviours.find(r=>r.id===b.id)?.observations??[],fidelity:b.fidelity})),objective:plan.objective,limitations:[...plan.limitations,'Engineering preview: geometry, scientific fidelity and sustained performance require acceptance.'],source:input.source},
    quality:{status:'engineering-preview',readyForStudents:false}};
  const id=createHash('sha256').update(JSON.stringify(base)).digest('hex'),manifest={...base,id,physics:{...base.physics,id}};
  const directory=path.join(root,'.cache/agent-world/worlds',id);await mkdir(directory,{recursive:true});
  await projectFile(root,`.cache/agent-world/worlds/${id}`);
  for(const [name,data]of blobs)await writeFile(path.join(directory,name),data,{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST')throw e;const existing=await readFile(await projectFile(root,`.cache/agent-world/worlds/${id}/${name}`));if(!existing.equals(data))throw Error('Existing package artifact is corrupted');});
  const temp=path.join(directory,'manifest.tmp');await writeFile(temp,JSON.stringify(manifest));await rename(temp,path.join(directory,'manifest.json'));
  return {id,title:plan.title,manifestUrl:`/api/agent/worlds/${id}/manifest.json`,status:'engineering-preview',readyForStudents:false};
}
export async function listAgentWorlds(root:string) {
  let files:string[];try{files=await readdir(await projectFile(root,'.cache/agent-world/worlds'));}catch{return [];}
  const store=new AgentStore(path.join(root,'.cache/agent-world/tools.sqlite'));
  const heads=new Map<string,string>();try{for(const row of store.db.prepare("SELECT job,result FROM checkpoints WHERE stage='assembled-world' ORDER BY rowid DESC").all() as {job:string;result:string}[]){if(!heads.has(row.job)){const world=JSON.parse(row.result);heads.set(row.job,world.id);}}}finally{store.close();}
  const current=new Set(heads.values()),worlds=[];
  for(const id of files.filter(f=>/^[a-f0-9]{64}$/.test(f)))try{
    const file=await projectFile(root,`.cache/agent-world/worlds/${id}/manifest.json`),m=JSON.parse(await readFile(file,'utf8'));
    if(m.id===id&&m.living&&(m.living.source==='engineering-fixture'||!current.size||current.has(id)))worlds.push({id,title:m.title,manifestUrl:`/api/agent/worlds/${id}/manifest.json`,status:m.quality.status,source:m.living.source});
  }catch{}
  return worlds;
}
export async function agentWorldAsset(root:string,id:string,name:string) {
  if(!/^[a-f0-9]{64}$/.test(id)||!(name==='manifest.json'||/^[a-f0-9]{64}\.glb$/.test(name)))throw Error('Invalid package asset');
  const base=`.cache/agent-world/worlds/${id}`;
  const manifest=JSON.parse(await readFile(await projectFile(root,base+'/manifest.json'),'utf8'));
  if(manifest.id!==id||!manifest.living||(name!=='manifest.json'&&!Object.hasOwn(manifest.assets,name)))throw Error('Unregistered asset');
  return projectFile(root,base+'/'+name);
}
