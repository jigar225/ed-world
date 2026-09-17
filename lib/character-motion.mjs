/** Fixed-step vertical motion shared by every world. No topic-specific motion. */
export function createCharacterMotion(gravityZ) {
  if(!Number.isFinite(gravityZ)||gravityZ>=0)throw Error('Walking requires downward gravity');
  let velocity=0,grounded=false;
  return {
    step(dt,jump=false){
      if(!Number.isFinite(dt)||dt<=0||dt>.05)throw Error('Invalid character timestep');
      if(jump&&grounded){velocity=3;grounded=false;}
      // A contact probe keeps Rapier's ground snapping stable. It is collision
      // constrained, never used for airborne descent or jump acceleration.
      if(grounded){velocity=0;return -.02;}
      const dz=velocity*dt+.5*gravityZ*dt*dt;velocity+=gravityZ*dt;return dz;
    },
    contact(onGround,requestedZ,actualZ){
      grounded=onGround&&requestedZ<=0;
      if(grounded||(requestedZ>0&&actualZ<requestedZ-1e-5))velocity=0;
    },
    save:()=>({velocity,grounded}),
    load(value){if(!value||!Number.isFinite(value.velocity)||typeof value.grounded!=='boolean')throw Error('Invalid saved character motion');velocity=value.velocity;grounded=value.grounded;},
    reset(){velocity=0;grounded=false;},
  };
}
