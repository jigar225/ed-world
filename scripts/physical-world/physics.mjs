import RAPIER from 'rapier';
import * as THREE from 'three';

export const PHYSICS_VERSION = 'rapier-0.20.0-lab-1';
export const vector = a => ({x:a[0],y:a[1],z:a[2]});
export const rotation = a => ({x:a[0],y:a[1],z:a[2],w:a[3]});
const array = p => [p.x,p.y,p.z];
const quaternion = q => [q.x,q.y,q.z,q.w];
let initialized;
export const initPhysics = () => initialized ??= RAPIER.init();

// Jacobi diagonalization preserves the source tensor, including products of inertia.
export function principalInertia(tensor) {
  const [xx,xy,xz,yy,yz,zz]=tensor;
  const a=[[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]], v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let n=0;n<40;n++){
    let p=0,q=1;for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q]))[p,q]=[i,j];
    if(Math.abs(a[p][q])<1e-12)break;
    const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]), c=Math.cos(angle),s=Math.sin(angle);
    const pp=a[p][p],qq=a[q][q],pq=a[p][q];
    for(let k=0;k<3;k++)if(k!==p&&k!==q){const kp=a[k][p],kq=a[k][q];a[k][p]=a[p][k]=c*kp-s*kq;a[k][q]=a[q][k]=s*kp+c*kq;}
    a[p][p]=c*c*pp-2*s*c*pq+s*s*qq;a[q][q]=s*s*pp+2*s*c*pq+c*c*qq;a[p][q]=a[q][p]=0;
    for(let k=0;k<3;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-s*kq;v[k][q]=s*kp+c*kq;}
  }
  const values=[a[0][0],a[1][1],a[2][2]];
  if(!values.every(x=>Number.isFinite(x)&&x>0))throw Error('Source inertia is not positive definite');
  const matrix=new THREE.Matrix4().set(v[0][0],v[0][1],v[0][2],0,v[1][0],v[1][1],v[1][2],0,v[2][0],v[2][1],v[2][2],0,0,0,0,1);
  return {values, quaternion:new THREE.Quaternion().setFromRotationMatrix(matrix)};
}

export function validateManifest(m){
  if(m.schemaVersion!==1||m.kind!=='physical-asset'||m.units!=='meters'||m.upAxis!=='Z')throw Error('Unsupported package contract');
  const ids=new Set();
  for(const body of m.bodies){
    if(ids.has(body.id))throw Error('Duplicate body ID');ids.add(body.id);
    if(!body.pose.position.every(Number.isFinite)||!body.pose.quaternion.every(Number.isFinite))throw Error('Non-finite body pose');
    principalInertia(body.inertiaTensor);
  }
  for(const j of m.joints){
    if(!ids.has(j.parent)||!ids.has(j.child))throw Error('Missing joint body');
    if(!['fixed','revolute','prismatic'].includes(j.type))throw Error('Unsupported joint');
    if(j.type==='prismatic'){
      const a=m.bodies.find(b=>b.id===j.parent).pose.quaternion,b=m.bodies.find(b=>b.id===j.child).pose.quaternion;
      if(Math.abs(a.reduce((s,x,i)=>s+x*b[i],0))<1-1e-6)throw Error('Prismatic bodies with different initial orientations need a different adapter');
    }
  }
}

export async function createPhysics(manifest, collisionVertices, {anchorRoots=true,gravity=[0,0,0],version=PHYSICS_VERSION}={}){
  await initPhysics();validateManifest(manifest);
  if(!Array.isArray(gravity)||gravity.length!==3||!gravity.every(Number.isFinite))throw Error('Invalid gravity');
  gravity=[...gravity];
  let world=new RAPIER.World(vector(gravity));world.timestep=1/120;
  const bodies=new Map(),joints=new Map(),targets=new Map(),children=new Set(manifest.joints.map(j=>j.child));
  try{
    for(const item of manifest.bodies){
      const anchor=anchorRoots&&!children.has(item.id);
      const desc=(item.fixed||anchor?RAPIER.RigidBodyDesc.fixed():item.kinematic?RAPIER.RigidBodyDesc.kinematicPositionBased():RAPIER.RigidBodyDesc.dynamic());
      desc.setTranslation(...item.pose.position).setRotation(rotation(item.pose.quaternion)).setCcdEnabled(true);
      const inertia=principalInertia(item.inertiaTensor);
      const inertialRotation=new THREE.Quaternion().fromArray(item.inertialPose.quaternion).multiply(inertia.quaternion);
      desc.setAdditionalMassProperties(item.mass,vector(item.inertialPose.position),vector(inertia.values),inertialRotation);
      const body=world.createRigidBody(desc);bodies.set(item.id,body);
      for(let i=0;i<item.collisions.length;i++){
        const part=item.collisions[i],g=part.geometry;let collider;
        if(g.type==='box')collider=RAPIER.ColliderDesc.cuboid(...g.size.map(x=>x/2));
        else if(g.type==='sphere')collider=RAPIER.ColliderDesc.ball(g.radius);
        else if(g.type==='cylinder')collider=RAPIER.ColliderDesc.cylinder(g.length/2,g.radius);
        else if(g.type==='mesh'){
          const mesh=collisionVertices.get(`${item.id}/${i}`);
          collider=item.fixed&&mesh?.indices?RAPIER.ColliderDesc.trimesh(mesh.vertices,mesh.indices):RAPIER.ColliderDesc.convexHull(mesh?.vertices||mesh);
        }
        if(!collider)throw Error(`Collision geometry failed for ${item.id}/${i}`);
        const q=new THREE.Quaternion().fromArray(part.pose.quaternion);
        if(g.type==='cylinder')q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
        collider.setTranslation(...part.pose.position).setRotation(q).setDensity(0).setFriction(part.friction);
        world.createCollider(collider,body);
      }
    }
    for(const item of manifest.joints){
      const p=vector(item.frameParent.position),c=vector(item.frameChild.position);let data;
      if(item.type==='fixed')data=RAPIER.JointData.fixed(p,rotation(item.frameParent.quaternion),c,rotation(item.frameChild.quaternion));
      else if(item.type==='revolute')data=RAPIER.JointData.revoluteWithAxes(p,c,vector(item.axisParent),vector(item.axisChild));
      else data=RAPIER.JointData.prismatic(p,c,vector(item.axisParent));
      const joint=world.createImpulseJoint(data,bodies.get(item.parent),bodies.get(item.child),true);
      joint.setContactsEnabled(false);joints.set(item.id,joint);
      if(item.limits){joint.setLimits(...item.limits);targets.set(item.id,Math.max(item.limits[0],Math.min(item.limits[1],0)));}
    }
  }catch(error){world.free();throw error;}
  const bodyHandles=Object.fromEntries([...bodies].map(([id,b])=>[id,b.handle]));
  const jointHandles=Object.fromEntries([...joints].map(([id,j])=>[id,j.handle]));
  const initial=world.takeSnapshot();
  // Regional terrain colliders legitimately exceed the old 5 MB lab limit.
  // Bound restored data by this package's measured snapshot size, plus runtime bodies.
  const snapshotByteLimit=Math.max(5_000_000,Math.ceil(initial.byteLength*1.25)+1_000_000);
  function setTarget(id,value){
    const spec=manifest.joints.find(j=>j.id===id);
    if(!spec?.limits||!Number.isFinite(value))throw Error('Invalid motor target');
    value=Math.max(spec.limits[0],Math.min(spec.limits[1],value));
    const joint=joints.get(id);
    // Explicit inspection actuator, not a claim about the source's motor strength.
    joint.configureMotorPosition(value,120,18);targets.set(id,value);
    bodies.get(spec.parent).wakeUp();bodies.get(spec.child).wakeUp();
  }
  function restore(bytes){
    const replacement=RAPIER.World.restoreSnapshot(bytes);
    const nextBodies=new Map(),nextJoints=new Map();
    try{
      for(const [id,handle]of Object.entries(bodyHandles)){const b=replacement.getRigidBody(handle);if(!b)throw Error('Snapshot body mismatch');nextBodies.set(id,b);}
      for(const [id,handle]of Object.entries(jointHandles)){const j=replacement.getImpulseJoint(handle);if(!j)throw Error('Snapshot joint mismatch');nextJoints.set(id,j);}
    }catch(e){replacement.free();throw e;}
    world.free();world=replacement;bodies.clear();joints.clear();
    for(const [id,b]of nextBodies)bodies.set(id,b);for(const [id,j]of nextJoints)joints.set(id,j);
  }
  function state(){return Object.fromEntries([...bodies].map(([id,b])=>[id,{position:array(b.translation()),quaternion:quaternion(b.rotation()),velocity:array(b.linvel()),angularVelocity:array(b.angvel())}]));}
  return {
    bodies,joints,targets,setTarget,state,getWorld:()=>world,
    step(){world.step();for(const b of bodies.values())if(!array(b.translation()).every(Number.isFinite))throw Error('Non-finite physics state');},
    save({binary=false}={}){const bytes=world.takeSnapshot();return {version,packageId:manifest.id,anchorRoots,gravity,bodyHandles,jointHandles,targets:Object.fromEntries(targets),bytes:binary?bytes:Array.from(bytes)};},
    load(saved){
      if(saved.version!==version||saved.packageId!==manifest.id||saved.anchorRoots!==anchorRoots||JSON.stringify(saved.bodyHandles)!==JSON.stringify(bodyHandles)||JSON.stringify(saved.jointHandles)!==JSON.stringify(jointHandles))throw Error('Saved state is incompatible with this package/runtime');
      if(JSON.stringify(saved.gravity||[0,0,0])!==JSON.stringify(gravity))throw Error('Saved gravity differs from this world');
      if((!Array.isArray(saved.bytes)&&!(saved.bytes instanceof Uint8Array))||saved.bytes.length>snapshotByteLimit||!(saved.bytes instanceof Uint8Array)&&!saved.bytes.every(x=>Number.isInteger(x)&&x>=0&&x<=255))throw Error('Invalid saved physics bytes');
      if(JSON.stringify(Object.keys(saved.targets||{}).sort())!==JSON.stringify([...targets.keys()].sort()))throw Error('Saved target set does not match joints');
      for(const [id,v]of Object.entries(saved.targets||{}))if(!targets.has(id)||!Number.isFinite(v))throw Error('Invalid saved target');
      // Snapshot already contains motors and sleeping state. Reissuing targets wakes
      // bodies and changes the resumed trajectory, so restore only UI metadata here.
      restore(new Uint8Array(saved.bytes));for(const [id,v]of Object.entries(saved.targets))targets.set(id,v);
    },
    reset(){restore(initial);for(const [id]of targets)setTarget(id,0);},
    free(){world.free();},
  };
}
