import type {TerrainOutput} from './terrain';
export interface TerrainSite {id:string;kind:'basin'|'land';center:[number,number,number];shore:[number,number,number];radiusMeters:number;areaMeters2:number;depthMeters:number;cells:number[]}
/** Piecewise-linear interpolation matches the packaged heightfield triangles. */
export function sampleHeight(t:TerrainOutput,x:number,y:number){
 const u=(x/t.extentMeters[0]+.5)*(t.width-1),v=(y/t.extentMeters[1]+.5)*(t.height-1);
 if(u<0||v<0||u>t.width-1||v>t.height-1)throw Error('Position lies outside generated terrain');
 const ix=Math.min(t.width-2,Math.floor(u)),iy=Math.min(t.height-2,Math.floor(v)),fx=u-ix,fy=v-iy;
 const a=t.elevations[iy*t.width+ix],b=t.elevations[iy*t.width+ix+1],c=t.elevations[(iy+1)*t.width+ix],d=t.elevations[(iy+1)*t.width+ix+1];
 return fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
}
export function analyzeTerrain(t:TerrainOutput):TerrainSite[]{
 const {width:w,height:h,elevations:e}=t,dx=t.extentMeters[0]/(w-1),dy=t.extentMeters[1]/(h-1),fill=e.slice(),seen=new Uint8Array(e.length);
 const heap:[number,number][]=[];
 function push(z:number,i:number){let k=heap.length;heap.push([z,i]);while(k){const p=(k-1)>>1;if(heap[p][0]<=z)break;heap[k]=heap[p];k=p;}heap[k]=[z,i];}
 function pop(){const first=heap[0],last=heap.pop()!;if(heap.length){let k=0;while(2*k+1<heap.length){let n=2*k+1;if(n+1<heap.length&&heap[n+1][0]<heap[n][0])n++;if(heap[n][0]>=last[0])break;heap[k]=heap[n];k=n;}heap[k]=last;}return first;}
 const neighbours=(i:number)=>{const x=i%w,y=Math.floor(i/w);return [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1,x<w-1&&y>0?i-w+1:-1,x>0&&y<h-1?i+w-1:-1].filter(n=>n>=0);};
 const position=(i:number):[number,number,number]=>[(i%w)*dx-t.extentMeters[0]/2,Math.floor(i/w)*dy-t.extentMeters[1]/2,e[i]];
 const slope=(i:number)=>Math.max(...neighbours(i).map(n=>Math.abs(e[n]-e[i])/Math.hypot((n%w-i%w)*dx,(Math.floor(n/w)-Math.floor(i/w))*dy)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!x||!y||x===w-1||y===h-1){const i=y*w+x;seen[i]=1;push(e[i],i);}
 // Priority flood measures spill heights; it does not modify the generated terrain.
 while(heap.length){const [z,i]=pop();for(const n of neighbours(i))if(!seen[n]){seen[n]=1;fill[n]=Math.max(z,e[n]);push(fill[n],n);}}
 const wet=new Set(e.flatMap((z,i)=>fill[i]-z>.25?[i]:[])),sites:TerrainSite[]=[];
 while(wet.size){const first=wet.values().next().value!;wet.delete(first);const cells=[first];
  for(let c=0;c<cells.length;c++)for(const n of neighbours(cells[c]))if(wet.delete(n))cells.push(n);
  if(cells.length<4)continue;const deepest=cells.reduce((a,b)=>e[a]<e[b]?a:b),level=fill[deepest]-.2;
  const lakeCells=cells.filter(i=>e[i]<level),set=new Set(cells),shoreCandidates=[...new Set(cells.flatMap(neighbours))].filter(i=>!set.has(i)&&e[i]>level+.1&&slope(i)<.45);
  if(!lakeCells.length||!shoreCandidates.length)continue;
  const centroid=[lakeCells.reduce((s,i)=>s+position(i)[0],0)/lakeCells.length,lakeCells.reduce((s,i)=>s+position(i)[1],0)/lakeCells.length];
  const shoreIndex=shoreCandidates.sort((a,b)=>slope(a)-slope(b))[0];
  sites.push({id:'basin-'+deepest,kind:'basin',center:[centroid[0],centroid[1],level],shore:position(shoreIndex),radiusMeters:Math.sqrt(lakeCells.length*dx*dy/Math.PI),areaMeters2:lakeCells.length*dx*dy,depthMeters:level-e[deepest],cells:lakeCells});
 }
 const mid=Math.floor(h/2)*w+Math.floor(w/2),land=position(mid);
 sites.sort((a,b)=>b.areaMeters2-a.areaMeters2);return [...sites.slice(0,8),{id:'land-center',kind:'land',center:land,shore:land,radiusMeters:100,areaMeters2:0,depthMeters:0,cells:[]}];
}
export function terrainSummary(t:TerrainOutput,sites:TerrainSite[]){return {assetId:t.assetId,extentMeters:t.extentMeters,nativeSampleMeters:t.extentMeters[0]/(t.width-1),elevationRange:[Math.min(...t.elevations),Math.max(...t.elevations)],sites:sites.map(({cells,...s})=>s)};}
