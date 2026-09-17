import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {responseSchema}=require('../../.cache/agent-test-build/agent-world/schemas.js');
const {compileBindings,BEHAVIOUR_RULES}=require('../../.cache/agent-test-build/agent-world/behaviour-runtime.js');
const schema=responseSchema('world-and-behaviour'),branches=schema.properties.behaviours.items.anyOf;
for(const [mechanism,rules] of Object.entries(BEHAVIOUR_RULES)){
 const branch=branches.find(b=>b.properties.mechanism.enum[0]===mechanism),p=branch.properties;
 assert(branch);assert.equal(p.parameters.additionalProperties,false);
 assert.deepEqual(Object.keys(p.parameters.properties).sort(),Object.keys(rules).sort());
 if(['particles','waves'].includes(mechanism))assert.deepEqual(p.fidelity.enum,['illustrative']);
 if(mechanism==='transfer'){assert.equal(p.targets.minItems,2);assert.equal(p.targets.maxItems,2);}
 const request={id:'motion',targets:mechanism==='transfer'?['a','b']:['a'],mechanism,fidelity:'illustrative',parameters:{},evidenceIds:[],observations:['Test']};
 for(const [key,[min,max,defaultValue]] of Object.entries(rules)){
  const field=p.parameters.properties[key];assert.equal(field.minimum,min);assert.equal(field.maximum,max);
  assert.equal(field.type,['axis','count'].includes(key)?'integer':'number');
  for(const value of [min,defaultValue,max])assert.equal(compileBindings([{...request,parameters:{[key]:value}}])[0].parameters[key],value);
  assert.throws(()=>compileBindings([{...request,parameters:{[key]:max+1}}]),/range/);
 }
}
const unsupported=branches.find(b=>b.properties.mechanism.enum[0]==='unsupported');assert(unsupported);
assert.throws(()=>compileBindings([{id:'missing',targets:['a'],mechanism:'unsupported',fidelity:'physical',parameters:{}}]),/Unsupported behaviour/);
assert.equal(responseSchema('world-and-behaviour-repair'),schema);
assert(JSON.stringify(schema).length<25000);
console.log('PASS: decoding schemas match runtime operator bounds, integer fields, target count, illustrative fidelity and explicit unsupported requirements.');
