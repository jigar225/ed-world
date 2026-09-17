import {BEHAVIOUR_RULES,compileBindings} from './behaviour-runtime';
import {validatePlan,type Evidence,type WorldPlan} from './contracts';

type Schema=Record<string,unknown>;
const text={type:'string',minLength:1,maxLength:500},id={type:'string',pattern:'^[a-z][a-z0-9_-]*$',maxLength:60};
const obj=(properties:Record<string,Schema>):Schema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const list=(items:Schema,maxItems=12,minItems=0):Schema=>({type:'array',items,minItems,maxItems});
const size=list({type:'number',minimum:.01,maximum:1000},3,3);
const params=(name:keyof typeof BEHAVIOUR_RULES)=>obj(Object.fromEntries(Object.entries(BEHAVIOUR_RULES[name]).map(([key,[minimum,maximum]])=>[key,{type:['count','axis'].includes(key)?'integer':'number',minimum,maximum}])));
const item={id,description:text,sizeMeters:size};
const grounds=['earth','moon','unsupported'].map(domain=>obj({domain:{const:domain},description:text,
 widthMeters:domain==='moon'?{enum:[32,64,128,256,512,1024,2048]}:{enum:Array.from({length:256},(_,i)=>(i+1)*30)},
 depthMeters:domain==='moon'?{enum:[32,64,128,256,512,1024,2048]}:{enum:Array.from({length:256},(_,i)=>(i+1)*30)}}));
export const SCENE_RECIPE_SCHEMA=obj({version:{const:1},title:{...text,maxLength:160},objective:text,artDirection:text,
 ground:{anyOf:grounds},
 liquids:list(obj({...item,waves:params('waves')}),4),
 effects:list(obj({...item,sizeMeters:list({type:'number',minimum:1,maximum:1000},3,3),observations:list(text,5,1),particles:params('particles')}),8),
 objects:list(obj({...item,motion:{anyOf:[obj({mechanism:{const:'still'},parameters:obj({})}),...(['rotate','oscillate','drift'] as const).map(mechanism=>obj({mechanism:{const:mechanism},parameters:params(mechanism)}))]}}),8),
 unsupportedRequirements:list(obj({requestQuote:{...text,description:'Exact quote from the student prompt requiring an unavailable capability. Never list a limitation that was not explicitly requested.'},reason:text}),12),limitations:list(text,12)});
export const TERRAIN_DETAIL_SCHEMA=obj({landforms:list(text,8,1),surfaceMaterials:list(text,8,1),
 generationPrompt:text,elevations:list({type:'number',minimum:-20000,maximum:100000},16,16),limitations:list(text,8)});

interface Thing {id:string;description:string;sizeMeters:[number,number,number]}
export interface SceneRecipe {
 version:1;title:string;objective:string;artDirection:string;
 ground:{domain:'earth'|'moon'|'unsupported';description:string;widthMeters:number;depthMeters:number};
 liquids:(Thing&{waves:Record<string,number>})[];
 effects:(Thing&{observations:string[];particles:Record<string,number>})[];
 objects:(Thing&{motion:{mechanism:'still'|'rotate'|'oscillate'|'drift';parameters:Record<string,number>}})[];
 unsupportedRequirements:{requestQuote:string;reason:string}[];limitations:string[];
}
export function compileRecipe(value:unknown,evidence:Evidence[]=[],prompt?:string):{recipe:SceneRecipe;plan:WorldPlan}{
 const r=value as SceneRecipe;
 if(r?.version!==1||!r.ground||!['earth','moon','unsupported'].includes(r.ground.domain))throw Error('Missing ground source');
 const domain=r.ground.domain;
 for(const v of [r.ground.widthMeters,r.ground.depthMeters])if(!Number.isFinite(v)||(domain==='moon'?(![32,64,128,256,512,1024,2048].includes(v)):(v<30||v>7680||v%30!==0)))throw Error('Ground extent does not fit its source');
 if(typeof r.ground.description!=='string'||!r.ground.description.trim())throw Error('Describe the supporting terrain');
 for(const [items,max] of [[r.liquids,4],[r.effects,8],[r.objects,8]] as const)if(!Array.isArray(items)||items.length>max)throw Error('Invalid scene entity list');
 if(!Array.isArray(r.unsupportedRequirements)||r.unsupportedRequirements.length>12||r.unsupportedRequirements.some(x=>!x||typeof x.requestQuote!=='string'||x.requestQuote.trim().length<3||typeof x.reason!=='string'||!x.reason.trim()||!prompt?.toLowerCase().includes(x.requestQuote.toLowerCase())))throw Error('Invalid unsupported requirements');
 if(domain==='moon'&&r.liquids.length)throw Error('Lunar terrain has no liquid surface; retain incompatible requirements explicitly');
 const assets:WorldPlan['assets']=[{id:'ground',kind:'terrain',role:'ground',description:`${domain} solid terrain: ${r.ground.description}`,sizeMeters:[r.ground.widthMeters,r.ground.depthMeters,0],requiredParts:[],referenceIds:[]}];
 const behaviours:WorldPlan['behaviours']=[];
 function asset(t:Thing,kind:'mesh'|'volume',role:'object'|'liquid'|'effect'){
  if(t?.id==='ground')throw Error('ground is reserved for the supporting terrain');
  assets.push({...t,kind,role,requiredParts:[],referenceIds:[]});
 }
 for(const liquid of r.liquids){asset(liquid,'mesh','liquid');behaviours.push({id:liquid.id+'-motion',targets:[liquid.id],mechanism:'waves',parameters:liquid.waves,fidelity:'illustrative',evidenceIds:[],observations:['Visual surface waves; not a fluid solver.']});}
 for(const effect of r.effects){if(effect.sizeMeters.some(v=>v<1))throw Error('Effect sizeMeters describes the whole emitter region, at least 1m per axis for an outdoor walking scene, not one particle');asset(effect,'volume','effect');behaviours.push({id:effect.id+'-motion',targets:[effect.id],mechanism:'particles',parameters:effect.particles,fidelity:'illustrative',evidenceIds:[],observations:effect.observations});}
 for(const object of r.objects){asset(object,'mesh','object');if(!object.motion||!['still','rotate','oscillate','drift'].includes(object.motion.mechanism))throw Error('Invalid solid motion');if(object.motion.mechanism!=='still')behaviours.push({id:object.id+'-motion',targets:[object.id],mechanism:object.motion.mechanism,parameters:object.motion.parameters,fidelity:'illustrative',evidenceIds:[],observations:['Prescribed object motion; not a process-specific physical solver.']});}
 const unavailable=[...r.unsupportedRequirements.map(x=>`${x.requestQuote}: ${x.reason}`),...(domain==='unsupported'?['The requested ground source is not available.']:[])];
 const plan=validatePlan({version:1,title:r.title,objective:r.objective,artDirection:r.artDirection,navigation:'walk',metersPerUnit:1,assets,behaviours,limitations:r.limitations,unavailable},evidence);
 const bindings=compileBindings(plan.behaviours);
 if(bindings.filter(b=>b.mechanism==='particles').reduce((n,b)=>n+b.parameters.count,0)>16384)throw Error('Particle budget exceeds 16384');
 return {recipe:r,plan};
}

export const RECIPE_COVERAGE_SCHEMA=obj({coverage:list(obj({requestQuote:text,targetIds:list(id,12),unsupportedReason:{type:'string',maxLength:500}}),12,1)});
