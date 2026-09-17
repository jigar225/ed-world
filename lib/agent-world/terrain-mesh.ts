import type {TerrainOutput} from './terrain';

/** Package model elevation output as Z-up GLB, without generating replacement terrain. */
export function terrainGLB(output:TerrainOutput,texture?:Buffer):Buffer {
  const {width,height,elevations,extentMeters}=output;
  if(width<2||height<2||width>257||height>257||elevations.length!==width*height)throw Error('Invalid terrain output');
  const positions=new Float32Array(width*height*3),normals=new Float32Array(width*height*3),indices=new Uint32Array((width-1)*(height-1)*6);
  const dx=extentMeters[0]/(width-1),dy=extentMeters[1]/(height-1);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    positions.set([x*dx-extentMeters[0]/2,y*dy-extentMeters[1]/2,elevations[i]],i*3);
    const sx=(elevations[y*width+Math.min(width-1,x+1)]-elevations[y*width+Math.max(0,x-1)])/((x===0||x===width-1?1:2)*dx);
    const sy=(elevations[Math.min(height-1,y+1)*width+x]-elevations[Math.max(0,y-1)*width+x])/((y===0||y===height-1?1:2)*dy);
    const length=Math.hypot(sx,sy,1);normals.set([-sx/length,-sy/length,1/length],i*3);
  }
  let cursor=0;
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const a=y*width+x,b=a+1,c=a+width,d=c+1;indices.set([a,b,c,b,d,c],cursor);cursor+=6;
  }
  const uv=new Float32Array(width*height*2);for(let y=0;y<height;y++)for(let x=0;x<width;x++)uv.set([x*dx/8,y*dy/8],(y*width+x)*2);
  if(texture&&(texture.length>12*1024*1024||texture.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw Error('Ground material must be an embedded PNG');
  const padded=texture?Buffer.alloc(Math.ceil(texture.length/4)*4):undefined;if(padded)texture!.copy(padded);
  const buffers=[Buffer.from(positions.buffer),Buffer.from(normals.buffer),Buffer.from(indices.buffer),...(texture?[Buffer.from(uv.buffer),padded!]:[])],binary=Buffer.concat(buffers);
  const min=[-extentMeters[0]/2,-extentMeters[1]/2,Math.min(...elevations)],max=[extentMeters[0]/2,extentMeters[1]/2,Math.max(...elevations)];
  const document={asset:{version:'2.0',generator:'EduWorld elevation packager (not terrain inference)'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:output.assetId}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,...(texture?{TEXCOORD_0:3}:{})},indices:2,material:0}]}],
    materials:[{name:'generated-ground-material',pbrMetallicRoughness:{baseColorFactor:texture?[1,1,1,1]:[.32,.38,.24,1],...(texture?{baseColorTexture:{index:0}}:{}),metallicFactor:0,roughnessFactor:1}}],
    ...(texture?{images:[{bufferView:4,mimeType:'image/png'}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]}:{}),
    buffers:[{byteLength:binary.length}],bufferViews:buffers.map((b,i)=>({buffer:0,byteOffset:buffers.slice(0,i).reduce((sum,v)=>sum+v.length,0),byteLength:b.length})),
    accessors:[{bufferView:0,componentType:5126,count:width*height,type:'VEC3',min,max},{bufferView:1,componentType:5126,count:width*height,type:'VEC3'},{bufferView:2,componentType:5125,count:indices.length,type:'SCALAR'},...(texture?[{bufferView:3,componentType:5126,count:width*height,type:'VEC2'}]:[])]};
  const raw=JSON.stringify(document),json=Buffer.from(raw.padEnd(Math.ceil(Buffer.byteLength(raw)/4)*4,' '));
  // Asset IDs are validated ASCII; use byte length explicitly for all GLB chunks.
  const b=Buffer.alloc(12+8+json.length+8+binary.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);
  b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);const offset=20+json.length;
  b.writeUInt32LE(binary.length,offset);b.writeUInt32LE(0x004e4942,offset+4);binary.copy(b,offset+8);return b;
}
