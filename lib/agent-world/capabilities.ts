import type {WorldPlan} from './contracts';
import {compileBindings,BEHAVIOUR_MECHANISMS} from './behaviour-runtime';

export function representationIssues(plan:WorldPlan):{target:string;reason:string}[]{
  const issues:{target:string;reason:string}[]=[];
  for(const b of plan.behaviours)if(['gravity','jump','fall','walk'].includes(b.mechanism))
    issues.push({target:b.id,reason:'Gravity, walking, jumping and falling are built-in navigation/physics, not behaviour operators. Remove this redundant binding, preserve the requested gravity in the objective for the layout planner, and keep the learning objective. An empty behaviours array is valid. Do not replace gravity with transfer/drift/oscillate or create an avatar mesh.'});
  for(const asset of plan.assets){
    const effects=plan.behaviours.filter(b=>b.targets.includes(asset.id));
    // Unsupported solvers remain capability gaps; do not rewrite them into
    // unrelated appearance effects merely to make the plan executable.
    if(effects.some(b=>!BEHAVIOUR_MECHANISMS.some(m=>m===b.mechanism)))continue;
    if(asset.kind==='volume'&&!effects.some(b=>b.mechanism==='particles'))
      issues.push({target:asset.id,reason:`No particles behaviour targets volume "${asset.id}". It will be invisible. Add or retarget the matching particles behaviour so its targets array contains "${asset.id}". Targets name the rendered emitter, not the source material or cause of the process. Preserve separate requested phenomena.`});
    else if(asset.kind==='volume'&&effects.some(b=>!['particles','transfer'].includes(b.mechanism)))
      issues.push({target:asset.id,reason:'A volume uses particles only; use particle velocity_x/y/z instead of drift or oscillate transforms.'});
    if(asset.kind!=='volume'&&effects.some(b=>b.mechanism==='particles'))
      issues.push({target:asset.id,reason:`Particles cannot target ${asset.kind} "${asset.id}". Retarget each particle behaviour to its own volume emitter. Keep the source surface or solid separate. Targets specify the visible animated entity, not the process source.`});
    if(effects.some(b=>b.mechanism==='waves')&&asset.kind!=='mesh')
      issues.push({target:asset.id,reason:'Waves need a separate mesh surface. They cannot animate terrain or a volume.'});
    if(asset.kind==='terrain'&&effects.some(b=>['rotate','oscillate','drift','particles'].includes(b.mechanism)))
      issues.push({target:asset.id,reason:'Terrain is fixed scenery. Give each moving phenomenon its own mesh or particle volume.'});
  }
  return issues;
}

export const TOOL_CATALOG = [
  {id:'research', status:'available', effect:'public-web', description:'Bounded Wikipedia text/image reference retrieval; not broad scientific verification.'},
  {id:'find-assets', status:'available', effect:'project-read', description:'Inspect project GLBs and registry metadata; no filename-only compatibility claim.'},
  {id:'reason', status:'live-tested-with-repairs', effect:'paid-modal', description:'Schema-constrained roles with funded warm lease reuse and shared budget; semantic/spatial validation remains required.'},
  {id:'generate-reference', status:'deployed-inference-tested', effect:'paid-modal', description:'Private FLUX service; actual PNG generation, immutable artifact and receipt verified.'},
  {id:'generate-object', status:'deployed-inference-tested', effect:'paid-modal', description:'Private TRELLIS service; actual textured GLB, measured geometry and six-view review verified.'},
  {id:'inspect-asset', status:'available', effect:'project-read', description:'GLB header, embedded resources, node/mesh/skin/animation inventory.'},
  {id:'evaluate-plan', status:'available', effect:'local', description:'Asset requirements and explicit behaviour qualification gaps.'},
  {id:'plan-terrain', status:'available', effect:'paid-modal', description:'Research-informed landforms, material requirements, scale, coarse conditioning and representation decisions.'},
  {id:'generate-terrain', status:'deployed-inference-tested', effect:'paid-modal', description:'Native 30m Earth heightfield generation passed a live tile check; close-up detail and full scene qualification remain open.'},
  {id:'recorded-terrain', status:'available', effect:'project-read', description:'Bounded Apollo 15 elevation crops with recorded provenance, original physical scale and north-up orientation; no invented planetary coverage.'},
  {id:'gravity-navigation', status:'physics-tested', effect:'local', description:'Shared first-person collision, fixed-speed jumping and falling under world gravity; save/restore includes vertical motion. Not a human biomechanics model.'},
  {id:'assemble-world', status:'available', effect:'local', description:'Assemble selected geometry and terrain outputs into an engineering preview using the existing first-person renderer.'},
] as const;

export function evaluatePlan(plan: WorldPlan) {
  const gaps: {target: string; reason: string}[] = [];
  for (const a of plan.assets) {
    if (a.kind === 'terrain') gaps.push({target:a.id, reason:'Terrain model is deployed; this plan still needs native-scale, landform, material and close-up qualification.'});
    if (a.kind === 'rigged-mesh' || a.requiredParts.length) gaps.push({target:a.id, reason:'Requires verified rig/parts; a generic TRELLIS mesh cannot satisfy this automatically.'});
    if (a.kind === 'volume'&&!plan.behaviours.some(b=>b.mechanism==='particles'&&b.targets.includes(a.id))) gaps.push({target:a.id, reason:'This volume needs a qualified solver; only illustrative particle regions are implemented.'});
  }
  try{compileBindings(plan.behaviours);}catch(error){gaps.push({target:'behaviour',reason:error instanceof Error?error.message:'Behaviour compilation failed'});}
  if(plan.navigation!=='walk'||plan.metersPerUnit!==1)gaps.push({target:'navigation',reason:'Flight, swimming and magnified observer scales are not qualified in the assembled runtime yet.'});
  gaps.push({target:'quality',reason:'Runtime operators are implemented; this plan still needs generated assets, browser acceptance and scientific review.'});
  return {status:'plan-only' as const, readyForStudents:false, gaps,
    note:'A valid plan is not a rendered or scientifically validated world.'};
}
