import type {TerrainOutput} from './terrain';
import type {TerrainSite} from './terrain-analysis';
import {sampleHeight} from './terrain-analysis';
/** General hydrostatic surface clipped to an actual, measured closed basin. */
export function basinSurface(t:TerrainOutput,site:TerrainSite):Buffer{
 if(site.kind!=='basin'||!site.cells.length)throw Error('A closed basin is required for a lake surface');
 const dx=t.extentMeters[0]/(t.width-1),dy=t.extentMeters[1]/(t.height-1),cellSet=new Set(site.cells);
 const xs=site.cells.map(i=>(i%t.width)*dx-t.extentMeters[0]/2),ys=site.cells.map(i=>Math.floor(i/t.width)*dy-t.extentMeters[1]/2);
 const minX=Math.max(-t.extentMeters[0]/2,Math.min(...xs)-dx),maxX=Math.min(t.extentMeters[0]/2,Math.max(...xs)+dx),minY=Math.max(-t.extentMeters[1]/2,Math.min(...ys)-dy),maxY=Math.min(t.extentMeters[1]/2,Math.max(...ys)+dy);
 const step=Math.max(2,Math.max(maxX-minX,maxY-minY)/192),positions:number[]=[],normals:number[]=[],indices:number[]=[];
 type P=[number,number,number];
 function clip(triangle:P[]){let poly:P[]=[];for(let i=0;i<3;i++){const a=triangle[i],b=triangle[(i+1)%3],inside=a[2]<site.center[2],next=b[2]<site.center[2];if(inside)poly.push(a);if(inside!==next){const f=(site.center[2]-a[2])/(b[2]-a[2]);poly.push([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1]),site.center[2]]);}}
  const start=positions.length/3;for(const p of poly){positions.push(p[0]-site.center[0],p[1]-site.center[1],0);normals.push(0,0,1);}for(let i=1;i<poly.length-1;i++)indices.push(start,start+i,start+i+1);
 }
 for(let y=minY;y<maxY;y+=step)for(let x=minX;x<maxX;x+=step){const xx=Math.min(maxX,x+step),yy=Math.min(maxY,y+step),gx=Math.round(((x+xx)/2/t.extentMeters[0]+.5)*(t.width-1)),gy=Math.round(((y+yy)/2/t.extentMeters[1]+.5)*(t.height-1));
  if(![gy*t.width+gx,gy*t.width+gx-1,gy*t.width+gx+1,(gy-1)*t.width+gx,(gy+1)*t.width+gx].some(i=>cellSet.has(i)))continue;
  const a:P=[x,y,sampleHeight(t,x,y)],b:P=[xx,y,sampleHeight(t,xx,y)],c:P=[x,yy,sampleHeight(t,x,yy)],d:P=[xx,yy,sampleHeight(t,xx,yy)];clip([a,b,c]);clip([b,d,c]);
 }
 if(!indices.length)throw Error('No visible surface could be clipped from the basin');
 const arrays=[new Float32Array(positions),new Float32Array(normals),new Uint32Array(indices)],buffers=arrays.map(a=>Buffer.from(a.buffer)),bin=Buffer.concat(buffers);
 const doc={asset:{version:'2.0',generator:'EduWorld hydrostatic surface, clipped to generated terrain'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.025,.22,.26,.88],metallicFactor:.15,roughnessFactor:.12},alphaMode:'BLEND',doubleSided:true}],buffers:[{byteLength:bin.length}],bufferViews:buffers.map((b,i)=>({buffer:0,byteOffset:buffers.slice(0,i).reduce((s,b)=>s+b.length,0),byteLength:b.length})),accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[minX-site.center[0],minY-site.center[1],0],max:[maxX-site.center[0],maxY-site.center[1],0]},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'},{bufferView:2,componentType:5125,count:indices.length,type:'SCALAR'}]};
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const out=Buffer.alloc(28+json.length+bin.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);bin.copy(out,28+json.length);return out;
}
