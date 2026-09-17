/** Six actual GLB views using the existing browser. No model, installs or external fetches. */
import {createServer} from 'node:http';
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer-core';
const require=createRequire(import.meta.url),root=process.cwd();
const {inspectProjectAsset,projectFile}=require('../../.cache/agent-test-build/agent-world/assets.js');
const asset=process.argv[2];await inspectProjectAsset(root,asset);const bytes=await readFile(await projectFile(root,asset));
const axisAt=process.argv.indexOf('--up-axis'),upAxis=axisAt<0?'Y':process.argv[axisAt+1];
if(!['Y','Z'].includes(upAxis))throw Error('Up axis must be Y or Z');
const html=`<!doctype html><style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/build/three.module.js","three/addons/":"/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,640);renderer.setPixelRatio(1);renderer.setClearColor(0xe5e7e9);document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.add(new T.HemisphereLight(0xffffff,0x607080,2));for(const p of [[4,6,8],[-4,-3,2]]){const l=new T.DirectionalLight(0xffffff,3);l.position.set(...p);scene.add(l);}
try{const gltf=await new GLTFLoader().loadAsync('/asset.glb');scene.add(gltf.scene);const bounds=new T.Box3().setFromObject(gltf.scene),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
let triangles=0;gltf.scene.traverse(m=>{if(m.isMesh)triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;});
window.metrics={min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray(),triangles,animations:gltf.animations.length};
const camera=new T.PerspectiveCamera(40,1,.001,Math.max(100,size.length()*10));const radius=Math.max(size.length(),.001)*1.8;
const zUp=${upAxis==='Z'};if(zUp)camera.up.set(0,0,1);
window.view=i=>{const directions=zUp?[[1,1,.7],[-1,1,.7],[1,-1,.7],[-1,-1,.7],[.01,0,1],[.01,0,-1]]:[[1,.5,1],[-1,.5,1],[1,.5,-1],[-1,.5,-1],[0,1,.01],[0,-1,.01]];camera.position.copy(center).add(new T.Vector3(...directions[i]).normalize().multiplyScalar(radius));camera.lookAt(center);renderer.render(scene,camera);};window.view(0);window.ready=true;
}catch(e){window.failure=e.message;}
</script>`;
const threeRoot=await realpath(path.join(root,'node_modules/three'));
const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(pathname==='/asset.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(bytes);return;}
  if(pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}
  if(!/^\/(build|examples\/jsm)\/[a-zA-Z0-9_./-]+\.js$/.test(pathname))throw Error();
  const file=await realpath(path.join(threeRoot,pathname.slice(1)));if(!file.startsWith(threeRoot+path.sep))throw Error();
  res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));
}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await puppeteer.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});
  const page=await browser.newPage();await page.setViewport({width:640,height:640});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))void r.continue();else{errors.push('External asset dependency');void r.abort();}});
  await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.ready||window.failure,{timeout:60000});
  const data=await page.evaluate(()=>({metrics:window.metrics,failure:window.failure}));if(data.failure||errors.length)throw Error('Asset rendering failed');
  const images=[];await mkdir('.cache/agent-world/artifacts',{recursive:true});await projectFile(root,'.cache/agent-world/artifacts');
  for(let i=0;i<6;i++){await page.evaluate(i=>window.view(i),i);const png=await page.screenshot({type:'png'});const hash=createHash('sha256').update(png).digest('hex'),relative='.cache/agent-world/artifacts/'+hash+'.png';await writeFile(relative,png);images.push(relative);}
  console.log(JSON.stringify({...data.metrics,images}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
