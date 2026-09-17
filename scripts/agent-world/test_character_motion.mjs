import assert from 'node:assert/strict';
import RAPIER from 'rapier';
import {createCharacterMotion} from '../../lib/character-motion.mjs';
await RAPIER.init();
function trial(g){
 const world=new RAPIER.World({x:0,y:0,z:-g});world.timestep=1/120;
 world.createCollider(RAPIER.ColliderDesc.cuboid(20,20,.5).setTranslation(0,0,-.5));
 const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,0,.86));
 const collider=world.createCollider(RAPIER.ColliderDesc.capsule(.55,.25).setRotation({x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2}),body);
 const controller=world.createCharacterController(.02);controller.setUp({x:0,y:0,z:1});controller.enableSnapToGround(.25);
 const motion=createCharacterMotion(-g);
 function step(jump=false){const dz=motion.step(1/120,jump);controller.computeColliderMovement(collider,{x:0,y:0,z:dz});const d=controller.computedMovement(),p=body.translation();motion.contact(controller.computedGrounded(),dz,d.z);body.setNextKinematicTranslation({x:p.x,y:p.y,z:p.z+d.z});world.step();return body.translation().z;}
 for(let i=0;i<240;i++)step();assert(motion.save().grounded);const floor=body.translation().z;
 let peak=step(true),frames=1;
 while(!motion.save().grounded&&frames<1000){peak=Math.max(peak,step());frames++;}
 assert(motion.save().grounded);for(let i=0;i<240;i++)step();assert(Math.abs(body.translation().z-floor)<.025);assert(Math.abs(peak-floor-9/(2*g))<.03);
 assert(Math.abs(frames/120-6/g)<.06);
 const saved=motion.save();motion.reset();motion.load(saved);assert.deepEqual(motion.save(),saved);
 world.free();return {gravity:g,height:peak-floor,airtime:frames/120};
}
const earth=trial(9.81),moon=trial(1.62);assert(moon.height>earth.height*5.9);assert(moon.airtime>earth.airtime*5.9);
assert.throws(()=>createCharacterMotion(0));console.log('PASS: real Rapier capsule jumps, lands, matches ballistic height/airtime and restores motion',JSON.stringify({earth,moon}));
