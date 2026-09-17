import type {WorldPlan} from './contracts';
import type {GroundingDecision} from './grounding';
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const num=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const vector={type:'array',items:num(-200,200),minItems:2,maxItems:2,description:'Horizontal OFFSET from the selected site anchor, in meters. Usually [0,0]. Never absolute map coordinates.'};
/** Make invalid IDs, volume transforms and unsupported parameter names impossible at decoding. */
export function groundingSchema(plan:WorldPlan,siteIds?:string[]){
 const particle=object({count:{type:'integer',minimum:1,maximum:4096},lifetime:num(.1,120),velocity_x:num(-100,100),velocity_y:num(-100,100),velocity_z:num(-100,100),spread_x:num(0,1000),spread_y:num(0,1000),spread_z:num(0,1000),size:num(.001,10),opacity:num(0,1),red:num(0,1),green:num(0,1),blue:num(0,1)});
 const variants:Record<string,unknown>={waves:object({amplitude:num(0,5),wavelength:num(.1,100),speed:num(0,20)}),particles:particle,rotate:object({axis:{enum:[0,1,2]},speed:num(-20,20)}),oscillate:object({axis:{enum:[0,1,2]},amplitude:num(0,100),frequency:num(0,20)}),drift:object({axis:{enum:[0,1,2]},speed:num(-100,100),distance:num(.01,10000)}),transfer:object({initial_from:num(0,1e9),initial_to:num(0,1e9),rate:num(0,1e6)})};
 return object({decision:{enum:['accept','reject']},reason:{type:'string',maxLength:800},siteId:siteIds?{enum:siteIds}:{type:'string',maxLength:80},materialPrompt:{type:'string',maxLength:400},
  bindings:object(Object.fromEntries(plan.assets.filter(a=>a.kind!=='terrain').map(a=>[a.id,object({anchor:{enum:a.role==='liquid'?['surface']:a.kind==='volume'?['above-surface','ground','shore']:a.role==='object'?['ground','shore','above-surface']:['surface','ground','shore','above-surface']},heightMeters:{...(a.role==='liquid'?{const:0}:num(0,a.role==='effect'?60:200)),description:'Vertical OFFSET in meters, not absolute altitude. Ground/shore solids are snapped to measured support regardless of this offset; use above-surface for airborne solids. Zero for water, small for mist, overhead for clouds/rain.'},offsetMeters:a.role==='liquid'?{const:[0,0]}:a.role==='effect'?{...vector,items:num(-30,30)}:vector})]))),
  operators:object(Object.fromEntries(plan.behaviours.map(b=>{const volume=b.targets.every(id=>plan.assets.some(a=>a.id===id&&a.kind==='volume'));const typed=b.targets.every(id=>plan.assets.some(a=>a.id===id&&a.role));const available=typed?[b.mechanism]:b.mechanism==='transfer'?['transfer']:volume?['particles']:['waves','rotate','oscillate','drift'];return [b.id,{anyOf:available.map(name=>object({mechanism:{const:name},parameters:typed&&name==='particles'?particleSchema(b.parameters,plan.assets.some(a=>a.role==='liquid')):variants[name]}))}];}))) });
}
export function decodeGrounding(value:unknown):GroundingDecision{
 const d=value as Omit<GroundingDecision,'bindings'|'operators'>&{bindings:Record<string,Omit<GroundingDecision['bindings'][number],'assetId'>>;operators:Record<string,Omit<GroundingDecision['operators'][number],'id'>>};
 return {...d,bindings:Object.entries(d.bindings).map(([assetId,b])=>({assetId,...b})),operators:Object.entries(d.operators).map(([id,b])=>({id,...b}))};
}

function particleSchema(p:Record<string,number>,water:boolean){
 const vz=p.velocity_z??0;
 return object({count:{type:'integer',minimum:1,maximum:4096},lifetime:num(.1,120),velocity_x:num(-100,100),velocity_y:num(-100,100),velocity_z:vz===0?{const:0}:vz>0?num(.01,100):num(-100,-.01),spread_x:num(0,100),spread_y:num(0,100),spread_z:num(0,water&&vz>0?.2:60),size:num(.001,10),opacity:num(0,1),red:num(0,1),green:num(0,1),blue:num(0,1)});
}
