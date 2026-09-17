import * as THREE from 'three';
import RAPIER from 'rapier';
import {createCharacterMotion} from './character-motion.mjs';
import {particleGroundHeight} from './particle-ground.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {Sky} from 'three/addons/objects/Sky.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createPhysics} from '../scripts/physical-world/physics.mjs';
import {saveWorldState,loadWorldState} from './physical-world-state.mjs';
import {createBehaviourRuntime} from './agent-world/behaviour-runtime';

const pose=(object,value)=>{object.position.fromArray(value.position);object.quaternion.fromArray(value.quaternion);};

export async function createWorldViewer(canvas, manifestURL, onStatus=()=>{}){
  const url=new URL(manifestURL,location.href);
  if(url.origin!==location.origin)throw Error('World package must be served by this app');
  const response=await fetch(url);if(!response.ok)throw Error('Saved world could not be opened');
  const manifest=await response.json();
  if(manifest.kind!=='physical-world'||manifest.schemaVersion!==1)throw Error('Unsupported world package');
  const behaviour=manifest.living?createBehaviourRuntime(manifest.living.bindings):null;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c6d3dc');
  const camera=new THREE.PerspectiveCamera(65,1,.03,500);camera.up.set(0,0,1);
  const outdoor=!!manifest.grounding,vacuum=manifest.environment?.atmosphere==='vacuum',sky=outdoor&&!vacuum?new Sky():null;
  if(vacuum){scene.background=new THREE.Color('#000000');camera.far=20000;camera.updateProjectionMatrix();}
  const environment=sky??new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  if(sky){sky.scale.setScalar(20000);sky.material.uniforms.up.value.set(0,0,1);sky.material.uniforms.sunPosition.value.set(-.4,-.3,.65);sky.material.uniforms.cloudCoverage.value=0;sky.material.uniforms.showSunDisc.value=false;scene.add(sky);scene.fog=new THREE.FogExp2(0xb9cad5,.00012);camera.far=20000;camera.updateProjectionMatrix();}
  const envScene=new THREE.Scene();envScene.add(environment);
  const envTexture=pmrem.fromScene(envScene,.04).texture;scene.environment=vacuum?null:envTexture;if(outdoor)scene.environmentIntensity=.12;
  if(sky){scene.add(sky);sky.material.uniforms.showSunDisc.value=true;}else environment.dispose();pmrem.dispose();
  const hemisphere=new THREE.HemisphereLight(0xeaf4ff,0x776957,vacuum?.025:outdoor?.5:1.1);if(outdoor)hemisphere.position.set(0,0,1);scene.add(hemisphere);
  const sun=new THREE.DirectionalLight(0xfff1da,3);sun.position.set(-8,-5,16);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0002;scene.add(sun);scene.add(sun.target);
  const root=new THREE.Group();scene.add(root);
  const bodies=new Map(),meshes=[],cache=new Map(),collisions=new Map(),resources=new Set(),waveUniforms=new Map(),particleViews=new Map();
  const track=object=>object.traverse(child=>{if(child.isMesh){resources.add(child.geometry);for(const material of [child.material].flat()){resources.add(material);for(const value of Object.values(material))if(value?.isTexture){value.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());value.needsUpdate=true;resources.add(value);}}}});
  async function geometry(g){
    if(g.type==='mesh'){
      const asset=new URL(g.asset,url);
      if(asset.origin!==url.origin||!manifest.assets[g.asset])throw Error('Unregistered world asset');
      if(!cache.has(asset.href))cache.set(asset.href,asset.pathname.endsWith('.obj')?new OBJLoader().loadAsync(asset.href):new GLTFLoader().loadAsync(asset.href).then(result=>result.scene));
      const object=(await cache.get(asset.href)).clone(true),wrapper=new THREE.Group(),orientation=new THREE.Group();
      track(object);wrapper.scale.fromArray(g.scale);if(g.meshUpAxis==='Y')orientation.rotation.x=Math.PI/2;
      orientation.add(object);wrapper.add(orientation);return wrapper;
    }
    let shape;
    if(g.type==='box')shape=new THREE.BoxGeometry(...g.size);
    else if(g.type==='sphere')shape=new THREE.SphereGeometry(g.radius,32,24);
    else if(g.type==='cylinder'){shape=new THREE.CylinderGeometry(g.radius,g.radius,g.length,32);shape.rotateX(Math.PI/2);}
    else throw Error('Unsupported world geometry');
    const object=new THREE.Mesh(shape,new THREE.MeshStandardMaterial());track(object);return object;
  }
  function vertices(object){
    object.updateMatrixWorld(true);const values=[],indices=[],point=new THREE.Vector3();
    object.traverse(child=>{if(!child.isMesh)return;const attribute=child.geometry.getAttribute('position'),offset=values.length/3;
      for(let i=0;i<attribute.count;i++){point.fromBufferAttribute(attribute,i).applyMatrix4(child.matrixWorld);values.push(point.x,point.y,point.z);}
      const index=child.geometry.index;for(let i=0;i<(index?.count??attribute.count);i++)indices.push(offset+(index?index.getX(i):i));});
    return {vertices:new Float32Array(values),indices:new Uint32Array(indices)};
  }
  let physics,animation,disposed=false;
  try{
    onStatus('Loading world geometry');
    for(const body of manifest.physics.bodies){
      const group=new THREE.Group();pose(group,body.pose);root.add(group);bodies.set(body.id,group);
      for(const part of body.visuals){
        const object=await geometry(part.geometry),local=new THREE.Group();pose(local,part.pose);local.add(object);group.add(local);
        object.traverse(mesh=>{if(!mesh.isMesh)return;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.bodyId=body.id;meshes.push(mesh);
          if(part.geometry.type!=='mesh'||part.geometry.asset.endsWith('.obj')){
            mesh.material=new THREE.MeshStandardMaterial({color:new THREE.Color(...part.color.slice(0,3)),roughness:.65,transparent:part.color[3]<1,opacity:part.color[3]});resources.add(mesh.material);
          }
          if(manifest.living?.bindings.some(binding=>binding.mechanism==='waves'&&binding.targets.includes(body.id))){
            const materials=[mesh.material].flat().map(material=>outdoor?new THREE.MeshPhysicalMaterial({color:0x347c88,roughness:.18,metalness:.25,clearcoat:1,clearcoatRoughness:.12,transparent:true,opacity:.92,side:THREE.DoubleSide}):material.clone());
            mesh.material=Array.isArray(mesh.material)?materials:materials[0];for(const material of materials)resources.add(material);
            const uniforms={waveTime:{value:0},waveAmplitude:{value:0},waveLength:{value:1},waveSpeed:{value:1}};
            const list=waveUniforms.get(body.id)||[];list.push(uniforms);waveUniforms.set(body.id,list);
            for(const material of materials)material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);
              shader.vertexShader='uniform float waveTime; uniform float waveAmplitude; uniform float waveLength; uniform float waveSpeed;\n'+shader.vertexShader;
              shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
                float wk=6.2831853/waveLength;
                float wa=(position.x+position.y*.4)*wk-waveTime*waveSpeed;
                float wb=(-position.x*.6+position.y)*wk*1.7-waveTime*waveSpeed*1.3;
                float sx=waveAmplitude*wk*(cos(wa)-.204*cos(wb));
                float sy=waveAmplitude*wk*(.4*cos(wa)+.34*cos(wb));
                objectNormal=normalize(vec3(-sx,-sy,1.0));`);
              shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
                transformed.z += waveAmplitude*(sin(wa)+.2*sin(wb));`);};
            // This is an explicitly illustrative local-Z surface effect, not fluid simulation.
          }
        });
      }
      for(let i=0;i<body.collisions.length;i++){
        const g=body.collisions[i].geometry;
        if(g.type==='mesh')collisions.set(`${body.id}/${i}`,vertices(await geometry(g)));
      }
    }
    // A bounded visual operator: the agent chooses the region and motion, not JS.
    for(const emitter of manifest.living?.emitters??[]){
      const effect=behaviour.effects()[emitter.assetId]?.particles;if(!effect)throw Error('Particle region has no binding');
      const p=effect.parameters,g=new THREE.BufferGeometry(),positions=new Float32Array(p.count*3);
      g.setAttribute('position',new THREE.BufferAttribute(positions,3));const ages=new Float32Array(p.count);g.setAttribute('age',new THREE.BufferAttribute(ages,1));
      const appearance=emitter.appearance??'generic',soft=appearance==='cloud'||appearance==='mist';
      const spacing=Math.sqrt(Math.max(1,p.spread_x*p.spread_y)/p.count);
      const visualSize=appearance==='rain'?Math.min(p.size,.06):appearance==='cloud'?Math.max(p.size,spacing*4):appearance==='mist'?Math.max(p.size,spacing*2):p.size;
      const visualOpacity=appearance==='rain'?Math.min(p.opacity,.32):appearance==='cloud'?Math.min(p.opacity,.16):appearance==='mist'?Math.min(p.opacity,.14):p.opacity;
      const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
        uniforms:{color:{value:new THREE.Color(p.red,p.green,p.blue)},opacity:{value:visualOpacity},size:{value:visualSize},rain:{value:appearance==='rain'?1:0},soft:{value:soft?1:0},velocity:{value:new THREE.Vector3(p.velocity_x,p.velocity_y,p.velocity_z)}},
        vertexShader:`uniform float size;uniform float rain;uniform float soft;uniform vec3 velocity;varying float pixelFade;attribute float age;varying float life;varying float stretch;varying vec2 direction;
        void main(){life=age;vec4 view=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*view;
        float trail=rain>.5?max(.2,length(velocity)*.1):(soft>.5?0.0:(length(velocity)>2.0?length(velocity)*.04:0.0));stretch=1.0+trail/size;
        vec3 v=(modelViewMatrix*vec4(velocity,0.0)).xyz;direction=length(v.xy)>.001?normalize(vec2(v.x,-v.y)):vec2(0,1);
        float pixels=(size+trail)*600.0/max(0.1,-view.z);pixelFade=min(1.0,pixels*pixels);gl_PointSize=clamp(pixels,1.0,128.0);}`,
        fragmentShader:`uniform vec3 color;uniform float opacity;uniform float soft;varying float pixelFade;varying float life;varying float stretch;varying vec2 direction;
        void main(){vec2 q=(gl_PointCoord-.5)*2.0;float r=length(vec2(dot(q,vec2(-direction.y,direction.x))*stretch,dot(q,direction)));if(r>1.0)discard;
        float fade=smoothstep(0.0,.1,life)*(1.0-smoothstep(.85,1.0,life));
        vec3 tint=soft>.5?mix(color,vec3(1.0),.2)*(0.85+0.15*sqrt(max(0.0,1.0-r*r))):color;gl_FragColor=vec4(tint,opacity*pixelFade*fade*(1.0-smoothstep(0.0,1.0,r)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`});
      const points=new THREE.Points(g,material);points.position.fromArray(emitter.position);points.frustumCulled=false;root.add(points);
      const ground=emitter.ground?manifest.living.groundSurfaces?.find(s=>s.assetId===emitter.ground.assetId):null;
      if(emitter.ground&&!ground)throw Error('Ground-bound particles are missing their support surface');
      resources.add(g);resources.add(material);particleViews.set(emitter.assetId,{emitter,ground,appearance,visualSize,positions,ages,ageAttribute:g.getAttribute('age'),attribute:g.getAttribute('position')});
    }
    physics=await createPhysics(manifest.physics,collisions,{anchorRoots:false,gravity:manifest.gravity,version:'rapier-0.20.0-world-1'});
    const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3());
    sun.target.position.copy(outdoor?new THREE.Vector3().fromArray(manifest.arrival.position):center);if(outdoor)sun.position.copy(sun.target.position).add(new THREE.Vector3(-60,-45,100));const radius=outdoor?80:Math.max(5,bounds.getSize(new THREE.Vector3()).length()/2);
    Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:.1,far:radius*5});
    let yaw=0,pitch=0,elapsed=0,paused=false,controlWorld,walker,walkerCollider,controller;
    const keys=new Set(),raycaster=new THREE.Raycaster(),motion=createCharacterMotion(manifest.gravity?.[2]??-9.81);let jumpQueued=false;
    function bindWalker(position){
      const world=physics.getWorld();
      if(controlWorld!==world){controlWorld=world;controller=world.createCharacterController(.02);controller.setUp({x:0,y:0,z:1});controller.enableAutostep(.22,.25,false);controller.enableSnapToGround(.25);controller.setCharacterMass(75);controller.setApplyImpulsesToDynamicBodies(true);}
      walker=walker&&world.getRigidBody(walker.handle);
      if(!walker){walker=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...position));walkerCollider=world.createCollider(RAPIER.ColliderDesc.capsule(.55,.25).setRotation({x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2}),walker);}
      else walkerCollider=walker.collider(0);
    }
    // Generated packages may supply an independently validated arrival point.
    // Otherwise choose a structural floor hit and verify capsule clearance.
    const fixedGeometry=new Set(manifest.physics.bodies.filter(b=>b.fixed&&b.id.startsWith('room_geometry_')).map(b=>physics.bodies.get(b.id).handle));
    physics.step();
    let spawn=manifest.arrival?.position;
    if(!spawn){
      const world=physics.getWorld();
      outer:for(let radius=0;radius<6;radius+=.5)for(let angle=0;angle<Math.PI*2;angle+=Math.PI/4){
        const x=center.x+Math.cos(angle)*radius,y=center.y+Math.sin(angle)*radius;
        const rayHeight=bounds.min.z+1.5;
        const hit=world.castRayAndGetNormal(new RAPIER.Ray({x,y,z:rayHeight},{x:0,y:0,z:-1}),2,true,undefined,undefined,undefined,undefined,c=>fixedGeometry.has(c.parent()?.handle));
        if(!hit||hit.normal.z<.8)continue;
        const z=rayHeight-hit.timeOfImpact+.82;
        let blocked=false;
        world.intersectionsWithShape({x,y,z},{x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2},new RAPIER.Capsule(.55,.25),()=>{blocked=true;return false;});
        if(!blocked){spawn=[x,y,z];break outer;}
      }
    }
    if(!spawn||spawn.length!==3||!spawn.every(Number.isFinite))throw Error('No clear arrival point found in this world');
    if(manifest.living){let blocked=false;
      physics.getWorld().intersectionsWithShape({x:spawn[0],y:spawn[1],z:spawn[2]},{x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2},new RAPIER.Capsule(.55,.25),()=>{blocked=true;return false;});
      if(blocked)throw Error('Planned arrival overlaps world geometry');
    }
    bindWalker(spawn);camera.position.set(spawn[0],spawn[1],spawn[2]+.65);
    if(manifest.arrival.lookAt){const direction=new THREE.Vector3().fromArray(manifest.arrival.lookAt).sub(camera.position);yaw=Math.atan2(direction.y,direction.x);pitch=Math.max(-Math.PI/18,Math.min(Math.PI/18,Math.atan2(direction.z,Math.hypot(direction.x,direction.y))));}
    const homeYaw=yaw,homePitch=pitch;
    const home=[...spawn],savedKey=`eduworld:world:${manifest.id}:v1`;
    function orient(){camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(pitch)*Math.cos(yaw),Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch))));}
    const resize=()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();orient();
    const moveMouse=e=>{if(document.pointerLockElement!==canvas)return;yaw-=e.movementX*.002;pitch=THREE.MathUtils.clamp(pitch-e.movementY*.002,-1.45,1.45);orient();};
    const down=e=>{if(document.pointerLockElement===canvas){if(e.code==='Escape'){document.exitPointerLock();keys.clear();return;}if(e.code==='KeyE'&&!e.repeat){onStatus(interact());return;}keys.add(e.code);if(e.code==='Space'){e.preventDefault();if(!e.repeat&&!paused)jumpQueued=true;}}};
    const up=e=>keys.delete(e.code),clear=()=>{keys.clear();jumpQueued=false;},lockChanged=()=>{if(document.pointerLockElement!==canvas)clear();};
    document.addEventListener('mousemove',moveMouse);document.addEventListener('keydown',down);document.addEventListener('keyup',up);document.addEventListener('pointerlockchange',lockChanged);window.addEventListener('blur',clear);
    let previous=performance.now(),accumulator=0;
    function frame(now){
      if(disposed)return;animation=requestAnimationFrame(frame);const dt=Math.min((now-previous)/1000,.05);previous=now;
      if(!paused){accumulator+=dt;for(let i=0;accumulator>=1/120&&i<6;i++){
        const direction=new THREE.Vector3();if(document.pointerLockElement===canvas){if(keys.has('KeyW'))direction.x++;if(keys.has('KeyS'))direction.x--;if(keys.has('KeyA'))direction.y++;if(keys.has('KeyD'))direction.y--;}
        direction.normalize().applyAxisAngle(new THREE.Vector3(0,0,1),yaw).multiplyScalar(2.2/120);
        const dz=motion.step(1/120,jumpQueued);jumpQueued=false;
        controller.computeColliderMovement(walkerCollider,{x:direction.x,y:direction.y,z:dz});const delta=controller.computedMovement(),p=walker.translation();
        motion.contact(controller.computedGrounded(),dz,delta.z);
        walker.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});
        if(behaviour){behaviour.step(1/120);const effects=behaviour.effects();
          for(const spec of manifest.physics.bodies){const effect=effects[spec.id],body=physics.bodies.get(spec.id);if(!effect)continue;
            if(body.isKinematic()){
              body.setNextKinematicTranslation({x:spec.pose.position[0]+effect.position[0],y:spec.pose.position[1]+effect.position[1],z:spec.pose.position[2]+effect.position[2]});
              const q=new THREE.Quaternion().fromArray(spec.pose.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...effect.rotation)));
              body.setNextKinematicRotation(q);
            }
          }
        }
        physics.step();elapsed+=1/120;accumulator-=1/120;
      }}else accumulator=0;
      for(const [id,view]of bodies){const body=physics.bodies.get(id);view.position.copy(body.translation());view.quaternion.copy(body.rotation());}
      if(behaviour)for(const [id,effect]of Object.entries(behaviour.effects()))if(effect.waves)for(const u of waveUniforms.get(id)||[]){u.waveTime.value=effect.waves.time;u.waveAmplitude.value=effect.waves.amplitude;u.waveLength.value=effect.waves.wavelength;u.waveSpeed.value=effect.waves.speed;}
      if(behaviour)for(const [id,view]of particleViews){
        const effect=behaviour.effects()[id].particles,p=effect.parameters;
        for(let i=0;i<p.count;i++){
          const fraction=n=>{const x=Math.sin((i+1)*n)*43758.5453;return x-Math.floor(x);};
          const age=(effect.time+fraction(12.9898)*p.lifetime)%p.lifetime;view.ages[i]=age/p.lifetime;
          const tapered=['cloud','mist','rain'].includes(view.appearance);
          const spread=n=>tapered?((fraction(n)+fraction(n+17.31)+fraction(n+41.73))/3-.5)*1.2:fraction(n)-.5;
          view.positions[i*3]=spread(78.233)*p.spread_x+p.velocity_x*age;
          view.positions[i*3+1]=spread(39.425)*p.spread_y+p.velocity_y*age;
          view.positions[i*3+2]=spread(93.989)*(view.appearance==='cloud'?Math.max(p.spread_z,view.visualSize*1.5):p.spread_z)+p.velocity_z*age;
          if(view.ground){
            const support=particleGroundHeight(view.ground,view.emitter.position[0]+view.positions[i*3],view.emitter.position[1]+view.positions[i*3+1]);
            if(support===null)view.ages[i]=1; // Hide samples outside recorded/generated coverage.
            else view.positions[i*3+2]=support-view.emitter.position[2]+Math.max(p.size/2,view.emitter.ground.clearance+view.positions[i*3+2]);
          }
        }view.attribute.needsUpdate=true;view.ageAttribute.needsUpdate=true;
      }
      camera.position.copy(walker.translation());camera.position.z+=.65;orient();renderer.render(scene,camera);
    }
    animation=requestAnimationFrame(frame);onStatus('World ready');
    const save=async()=>{const state={physics:physics.save({binary:true}),walkerHandle:walker.handle,motion:motion.save(),yaw,pitch,elapsed,...(behaviour?{behaviour:behaviour.save()}: {})};await saveWorldState(savedKey,state);return state;};
    const restore=async()=>{const state=await loadWorldState(savedKey);if(disposed)throw Error('World was closed');if(![state.yaw,state.pitch,state.elapsed,state.walkerHandle].every(Number.isFinite))throw Error('Invalid saved camera');if(behaviour)behaviour.validate(state.behaviour);motion.load(state.motion??{velocity:0,grounded:false});jumpQueued=false;physics.load(state.physics);if(behaviour)behaviour.load(state.behaviour);walker=physics.getWorld().getRigidBody(state.walkerHandle);if(!walker?.isKinematic())throw Error('Saved character is missing');controlWorld=null;bindWalker(home);yaw=state.yaw;pitch=state.pitch;elapsed=state.elapsed;};
    function pick(){raycaster.setFromCamera(new THREE.Vector2(),camera);return raycaster.intersectObjects(meshes,false).find(hit=>hit.distance<3);}
    function observe(id){
      const body=physics.bodies.get(id);if(!body)return null;
      const entity=manifest.entities.find(entity=>entity.bodyIds.includes(id));
      const velocity=body.linvel();
      return {id,name:(entity?.id||id).replace(/[_:]+/g,' '),movable:body.isDynamic(),
        mass:body.mass(),speed:Math.hypot(velocity.x,velocity.y,velocity.z)};
    }
    function inspect(){const hit=pick();return hit?observe(hit.object.userData.bodyId):null;}
    function interact(){const hit=pick();if(!hit)return 'Move closer to an object';const body=physics.bodies.get(hit.object.userData.bodyId);if(!body?.isDynamic())return 'This object is fixed';const d=camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.min(body.mass(),20)*2.2);body.applyImpulseAtPoint({x:d.x,y:d.y,z:d.z},hit.point,true);return 'Applied a push';}
    return {manifest,save,restore,enter:()=>canvas.requestPointerLock(),pause:()=>paused=!paused,
      reset:()=>{motion.reset();jumpQueued=false;walker=null;controlWorld=null;physics.reset();behaviour?.reset();physics.step();bindWalker(home);elapsed=0;yaw=homeYaw;pitch=homePitch;},
      behaviourState:()=>behaviour?.observe()??null,
      setBehaviourControl:(id,value)=>{if(!behaviour)throw Error('World has no behaviour graph');behaviour.setControl(id,value);},
      focusEntity:id=>{const body=bodies.get(id),emitter=manifest.living?.emitters.find(e=>e.assetId===id);let point;
        if(body)point=new THREE.Box3().setFromObject(body).getCenter(new THREE.Vector3());
        else if(emitter){point=new THREE.Vector3().fromArray(emitter.position);const effect=behaviour.effects()[id]?.particles;if(effect){const p=effect.parameters;point.addScaledVector(new THREE.Vector3(p.velocity_x,p.velocity_y,p.velocity_z),p.lifetime/2);const surface=particleViews.get(id)?.ground;if(surface){const z=particleGroundHeight(surface,point.x,point.y);if(z!==null)point.z=z+Math.max(p.size/2,emitter.ground.clearance+p.velocity_z*p.lifetime/2);}}}
        if(!point)throw Error('Scene subject not found');const d=point.sub(camera.position);yaw=Math.atan2(d.y,d.x);pitch=THREE.MathUtils.clamp(Math.atan2(d.z,Math.hypot(d.x,d.y)),-1.45,1.45);orient();},
      interact,inspect,observe,
      dispose:()=>{disposed=true;cancelAnimationFrame(animation);observer.disconnect();document.removeEventListener('mousemove',moveMouse);document.removeEventListener('keydown',down);document.removeEventListener('keyup',up);document.removeEventListener('pointerlockchange',lockChanged);window.removeEventListener('blur',clear);if(document.pointerLockElement===canvas)document.exitPointerLock();physics.free();for(const item of resources)item.dispose();sky?.geometry.dispose();sky?.material.dispose();envTexture.dispose();renderer.dispose();},
      snapshot:()=>({elapsed,paused,motion:motion.save(),gravity:manifest.gravity,bodies:physics.state(),camera:camera.position.toArray(),direction:camera.getWorldDirection(new THREE.Vector3()).toArray(),particles:Object.fromEntries([...particleViews].map(([id,v])=>[id,Array.from(v.positions.slice(0,9))])),waves:Object.fromEntries([...waveUniforms].map(([id,u])=>[id,u.map(v=>v.waveTime.value)]))})};
  }catch(error){disposed=true;if(animation)cancelAnimationFrame(animation);physics?.free();for(const item of resources)item.dispose();sky?.geometry.dispose();sky?.material.dispose();envTexture.dispose();renderer.dispose();throw error;}
}
