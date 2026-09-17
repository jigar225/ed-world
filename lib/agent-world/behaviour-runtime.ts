import type {BehaviourRequest} from './contracts';
export type Mechanism='rotate'|'oscillate'|'drift'|'waves'|'transfer'|'particles';
export interface Binding {id:string;targets:string[];mechanism:Mechanism;parameters:Record<string,number>;fidelity:'physical'|'illustrative'}
export interface BehaviourSnapshot {version:1;signature:string;time:number;controls:Record<string,number>;quantities:Record<string,number>}
export interface EntityEffect {position:[number,number,number];rotation:[number,number,number];waves?:{amplitude:number;wavelength:number;speed:number;time:number};particles?:{time:number;parameters:Record<string,number>}}
export const BEHAVIOUR_RULES:Record<Mechanism,Record<string,[number,number,number]>>={
  rotate:{axis:[0,2,2],speed:[-20,20,1]},
  oscillate:{axis:[0,2,2],amplitude:[0,100,.1],frequency:[0,20,.5]},
  drift:{axis:[0,2,0],speed:[-100,100,1],distance:[.001,10000,10]},
  waves:{amplitude:[0,5,.05],wavelength:[.01,10000,2],speed:[-100,100,1]},
  transfer:{initial_from:[0,1e9,100],initial_to:[0,1e9,0],rate:[0,1e6,1]},
  particles:{count:[1,4096,256],lifetime:[.1,120,5],velocity_x:[-100,100,0],velocity_y:[-100,100,0],velocity_z:[-100,100,1],spread_x:[0,10000,1],spread_y:[0,10000,1],spread_z:[0,10000,.1],size:[.001,10,.05],opacity:[0,1,.4],red:[0,1,1],green:[0,1,1],blue:[0,1,1]},
};
const rules=BEHAVIOUR_RULES;
export const BEHAVIOUR_MECHANISMS=Object.keys(rules) as Mechanism[];
export const BEHAVIOUR_FORMAT=JSON.stringify(rules);
/** Describe the executed operator, not an unverified model-written acceptance goal. */
export function describeBinding(binding:Binding|undefined):string[]{
  if(!binding)return [];
  const p=binding.parameters;
  switch(binding.mechanism){
    case 'particles':return [`At normal playback, visual particles travel at a fixed velocity of (${p.velocity_x}, ${p.velocity_y}, ${p.velocity_z}) m/s and restart after ${p.lifetime} seconds.`, 'This is an illustration of motion. Turbulence, erosion, deposition and fluid dynamics are not calculated.'];
    case 'waves':return [`The surface displays repeating waves with a primary amplitude of ${p.amplitude} m and wavelength of ${p.wavelength} m. This is a visual wave model; it does not calculate fluid flow.`];
    case 'rotate':return [`The object rotates about its ${['X','Y','Z'][p.axis]} axis at ${p.speed} radians per second at normal playback.`];
    case 'oscillate':return [`The whole object oscillates along its ${['X','Y','Z'][p.axis]} axis with amplitude ${p.amplitude} m and frequency ${p.frequency} Hz.`];
    case 'drift':return [`The object moves along its ${['X','Y','Z'][p.axis]} axis at ${p.speed} m/s and repeats over ${p.distance} m at normal playback.`];
    case 'transfer':return [`An abstract quantity transfers between two reservoirs at ${p.rate} model units per second, conserving their combined total. This does not calculate fluid flow.`];
  }
}
export function compileBindings(requests:BehaviourRequest[]):Binding[] {
  const ids=new Set<string>(),writers=new Set<string>(),reservoirs=new Set<string>();
  return requests.map(b=>{
    if(ids.has(b.id))throw Error('Duplicate behaviour');ids.add(b.id);
    if(!Object.hasOwn(rules,b.mechanism))throw Error(`Unsupported behaviour: ${b.mechanism}`);
    const mechanism=b.mechanism as Mechanism,spec=rules[mechanism];
    if(!b.targets.length||new Set(b.targets).size!==b.targets.length)throw Error('Invalid behaviour targets');
    if(Object.keys(b.parameters).some(k=>!Object.hasOwn(spec,k)))throw Error('Unknown behaviour parameter');
    const parameters:Record<string,number>={};
    for(const [key,[min,max,fallback]]of Object.entries(spec)) {
      const value=b.parameters[key]??fallback;
      if(!Number.isFinite(value)||value<min||value>max||(['axis','count'].includes(key)&&!Number.isInteger(value)))throw Error('Behaviour parameter out of range');
      parameters[key]=value;
    }
    if(['waves','particles'].includes(mechanism)&&b.fidelity!=='illustrative')throw Error('Appearance effects must be labelled illustrative');
    if(mechanism==='transfer') {
      if(b.targets.length!==2)throw Error('Transfer requires two reservoirs');
      for(const id of b.targets){if(reservoirs.has(id))throw Error('Coupled transfers need a shared reviewed process solver');reservoirs.add(id);}
    } else for(const id of b.targets) {
      const channel=mechanism==='particles'?'particles':mechanism==='waves'?'surface':mechanism==='rotate'?'rotation':'position';
      if(writers.has(id+channel))throw Error('Multiple writers for an entity state');writers.add(id+channel);
    }
    return {id:b.id,targets:[...b.targets],mechanism,parameters,fidelity:b.fidelity};
  });
}
export function createBehaviourRuntime(bindings:Binding[]) {
  // Recheck deserialized packages, including operator allow-list and ownership.
  bindings=compileBindings(bindings.map(b=>({...b,evidenceIds:[],observations:['Runtime binding']})));
  const signature=JSON.stringify(bindings),controls:Record<string,number>={},quantities:Record<string,number>={};let time=0;
  function reset(){time=0;for(const key of Object.keys(controls))delete controls[key];for(const key of Object.keys(quantities))delete quantities[key];
    for(const b of bindings){controls[b.id]=1;if(b.mechanism==='transfer'){quantities[b.targets[0]]=b.parameters.initial_from;quantities[b.targets[1]]=b.parameters.initial_to;}}}
  reset();
  function validateSnapshot(value:BehaviourSnapshot) {
    if(value?.version!==1||value.signature!==signature||!Number.isFinite(value.time)||value.time<0)throw Error('Incompatible behaviour snapshot');
    if(JSON.stringify(Object.keys(value.controls??{}).sort())!==JSON.stringify(Object.keys(controls).sort())||JSON.stringify(Object.keys(value.quantities??{}).sort())!==JSON.stringify(Object.keys(quantities).sort()))throw Error('Snapshot state keys differ');
    if(Object.values(value.controls).some(v=>!Number.isFinite(v)||v<0||v>3)||Object.values(value.quantities).some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid saved state');
    for(const b of bindings.filter(b=>b.mechanism==='transfer')){
      const total=b.parameters.initial_from+b.parameters.initial_to;
      if(Math.abs(value.quantities[b.targets[0]]+value.quantities[b.targets[1]]-total)>Math.max(1,total)*1e-9)throw Error('Snapshot violates conserved total');
    }
  }
  // Integrate phase separately so adjusting a control does not teleport an object.
  const phases:Record<string,number>={};for(const b of bindings)phases[b.id]=0;
  return {
    step(dt:number) {
      if(!Number.isFinite(dt)||dt<0||dt>1/20)throw Error('Runtime requires bounded simulation steps');
      time+=dt;
      for(const b of bindings){const factor=controls[b.id];phases[b.id]+=dt*factor;
        if(b.mechanism==='transfer'){const amount=Math.min(quantities[b.targets[0]],b.parameters.rate*factor*dt);quantities[b.targets[0]]-=amount;quantities[b.targets[1]]+=amount;}}
    },
    effects():Record<string,EntityEffect> {
      const effects:Record<string,EntityEffect>={};
      for(const b of bindings)for(const target of b.targets){
        const effect=effects[target]??={position:[0,0,0],rotation:[0,0,0]},p=b.parameters,t=phases[b.id];
        if(b.mechanism==='rotate')effect.rotation[p.axis]=p.speed*t;
        if(b.mechanism==='oscillate')effect.position[p.axis]=p.amplitude*Math.sin(t*p.frequency*Math.PI*2);
        if(b.mechanism==='drift')effect.position[p.axis]=((t*p.speed%p.distance)+p.distance)%p.distance;
        if(b.mechanism==='waves')effect.waves={amplitude:p.amplitude,wavelength:p.wavelength,speed:p.speed,time:t};
        if(b.mechanism==='particles')effect.particles={time:t,parameters:p};
      }
      return effects;
    },
    setControl(id:string,value:number){if(!Object.hasOwn(controls,id)||!Number.isFinite(value)||value<0||value>3)throw Error('Invalid behaviour control');controls[id]=value;},
    observe:()=>({time,controls:{...controls},quantities:{...quantities}}),
    save:()=>({version:1 as const,signature,time,controls:{...controls},quantities:{...quantities},phases:{...phases}}),
    validate(value:BehaviourSnapshot&{phases:Record<string,number>}){validateSnapshot(value);
      if(JSON.stringify(Object.keys(value.phases??{}).sort())!==JSON.stringify(Object.keys(phases).sort())||Object.values(value.phases).some(v=>!Number.isFinite(v)||v<0||v>value.time*3+1e-8))throw Error('Invalid saved phases');},
    load(value:BehaviourSnapshot&{phases:Record<string,number>}){this.validate(value);time=value.time;Object.assign(controls,value.controls);Object.assign(quantities,value.quantities);Object.assign(phases,value.phases);},
    reset(){reset();for(const id of Object.keys(phases))phases[id]=0;},
  };
}
