/** Provider-enforced JSON structure; semantic/reference checks remain in validators. */
import {BEHAVIOUR_RULES} from './behaviour-runtime';
import {SCENE_RECIPE_SCHEMA,TERRAIN_DETAIL_SCHEMA,RECIPE_COVERAGE_SCHEMA} from './scene-recipe';
type Schema=Record<string,unknown>;
const str:Schema={type:'string',minLength:1,maxLength:1000},num:Schema={type:'number'};
const title:Schema={type:'string',minLength:1,maxLength:160};
const identifier:Schema={type:'string',pattern:'^[a-z][a-z0-9_-]*$',maxLength:80};
const choice=(...values:(string|number)[]):Schema=>({enum:values});
const array=(items:Schema,maxItems=96,minItems=0):Schema=>({type:'array',items,maxItems,minItems});
const strings=(max=32,min=0)=>array(str,max,min);
const object=(properties:Record<string,Schema>):Schema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const vector=array(num,3,3),pair=array(num,2,2),version=choice(1);
const behaviourFields={id:identifier,targets:strings(96,1),evidenceIds:strings(12),observations:strings(12,1)};
// Constrain each operator at decoding time, using the same bounds as the runtime.
// Unsupported requirements remain explicit; they must never become visual effects
// merely because a solver is absent.
const behaviour:Schema={anyOf:[...Object.entries(BEHAVIOUR_RULES).map(([mechanism,rules])=>object({
  ...behaviourFields,targets:mechanism==='transfer'?array(str,2,2):behaviourFields.targets,
  mechanism:choice(mechanism),fidelity:['waves','particles'].includes(mechanism)?choice('illustrative'):choice('physical','illustrative'),
  parameters:{type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(rules).map(([key,[minimum,maximum]])=>[key,{type:['axis','count'].includes(key)?'integer':'number',minimum,maximum}]))},
})),object({...behaviourFields,mechanism:choice('unsupported'),fidelity:choice('physical','illustrative'),parameters:{type:'object',properties:{},additionalProperties:false}})],
description:'Use an available operator only when it implements the requested behaviour. For unavailable requirements use mechanism unsupported and name the required solver in observations. Gravity, walk, jump and fall are built-in navigation, not operators.'};
const schemas:Record<string,Schema>={
  'scene-recipe':SCENE_RECIPE_SCHEMA,
  'entity-routing':object({entities:array(object({id:str,category:{enum:['liquid-water','isolated-solid','particle-effect','continuous-ground','unsupported']}}),20)}),
  'particle-appearance':object({effects:array(object({assetId:str,style:{enum:['cloud','mist','rain','dust','spark','generic']}}),8)}),
  'recipe-coverage':RECIPE_COVERAGE_SCHEMA,
  'terrain-detail':TERRAIN_DETAIL_SCHEMA,
  grounding:object({decision:choice('accept','reject'),reason:str,siteId:str,materialPrompt:str,
    bindings:array(object({assetId:str,anchor:choice('shore','surface','above-surface','ground'),heightMeters:num,offsetMeters:pair})),
    operators:array(object({id:str,mechanism:str,parameters:{type:'object',additionalProperties:num}}))}),
  intent:object({version,title,objective:str,researchQueries:array({type:'string',minLength:1,maxLength:120},3)}),
  'world-and-behaviour':object({version,title,objective:str,artDirection:str,navigation:choice('walk','fly','swim'),metersPerUnit:num,
    assets:array(object({id:identifier,description:str,kind:choice('mesh','rigged-mesh','terrain','volume'),sizeMeters:array({type:'number',minimum:0,maximum:1e7},3,3),requiredParts:strings(),referenceIds:strings(12)}),96,1),
    behaviours:array(behaviour),limitations:strings()}),
  spatial:object({version,arrival:vector,gravity:vector,placements:array(object({assetId:str,position:vector,scale:num,upAxis:choice('Y','Z'),dynamic:{type:'boolean'}}))}),
  terrain:object({version,assetId:str,domain:str,representation:choice('heightfield','mesh-volume'),extentMeters:pair,elevationRangeMeters:pair,
    landforms:strings(16),surfaceMaterials:strings(16),waterRegions:strings(16),evidenceIds:strings(16),generationPrompt:str,closeupRequirements:strings(16),
    conditioning:object({width:choice(4),height:choice(4),elevations:array(num,16,16)}),limitations:strings(16)}),
  review:object({issues:array(object({target:str,reason:str}),32)}),
  'asset-review':object({decision:choice('accept','reject'),upAxis:choice('Y','Z'),reasons:strings(12,1)}),
};
export function responseSchema(role:string):Schema|undefined{return schemas[role.replace(/-repair$/,'')];}
