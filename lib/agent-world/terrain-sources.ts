import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {projectFile} from './assets';
import type {TerrainPlan,TerrainOutput} from './terrain';

// Source selection is separate from scene composition. Never relabel an Earth
// model output as another planet, or stretch recorded data beyond its coverage.
export const TERRAIN_CAPABILITIES = 'Earth: generated regional heightfields, 30m samples, extent 30–7680m in multiples of 30. Moon/lunar: existing Apollo 15 elevation dataset, centered crops 32–2048m; prefer 512m for a walkable lesson with 2m samples. Lunar terrain is recorded data, not newly generated geology; no other lunar locations or arbitrary landforms are available. Neither source supports caves/overhangs. Other planets need another source.';
export function terrainSource(plan:TerrainPlan):'lunar-dem'|'earth-model' {
  if(plan.representation!=='heightfield')throw Error('Terrain requires a qualified volume source');
  const domain=plan.domain.trim().toLowerCase();
  if(/^(moon|lunar)(\b|$)/.test(domain)){
    if(plan.extentMeters.some(v=>v<32||v>2048))throw Error('The lunar elevation dataset supports 32–2048m crops; do not stretch or repeat its coverage');
    if(plan.waterRegions.length)throw Error('The lunar elevation source does not support surface liquid water');
    return 'lunar-dem';
  }
  if(!/^(earth|terrestrial)(\b|$)/.test(domain))throw Error('No qualified terrain source for domain: '+plan.domain);
  if(plan.extentMeters.some(v=>v<30||v>7680||Math.abs(v/30-Math.round(v/30))>1e-7))throw Error('Earth terrain needs native 30m spacing and 30–7680m extent');
  return 'earth-model';
}
export async function recordedTerrain(root:string,plan:TerrainPlan):Promise<TerrainOutput>{
  if(terrainSource(plan)!=='lunar-dem')throw Error('No recorded terrain selected');
  const [metaBytes,bytes]=await Promise.all(['public/terrain/moon-dem.json','public/terrain/moon-dem.bin'].map(async p=>readFile(await projectFile(root,p))));
  const m=JSON.parse(metaBytes.toString());
  if(m.width!==1024||m.height!==1024||m.meters!==2048||bytes.length!==m.width*m.height*2||![m.minHeight,m.maxHeight].every(Number.isFinite)||m.minHeight>=m.maxHeight)throw Error('Invalid recorded elevation dataset');
  const width=Math.min(257,Math.ceil(plan.extentMeters[0]/2)+1),height=Math.min(257,Math.ceil(plan.extentMeters[1]/2)+1),elevations:number[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    // Rows in the source run north to south; packaged coordinates are east/north/up.
    const gx=((x/(width-1)-.5)*plan.extentMeters[0]/m.meters+.5)*(m.width-1);
    const gy=(.5-(y/(height-1)-.5)*plan.extentMeters[1]/m.meters)*(m.height-1);
    const ix=Math.min(m.width-2,Math.floor(gx)),iy=Math.min(m.height-2,Math.floor(gy)),fx=gx-ix,fy=gy-iy;
    const at=(x:number,y:number)=>bytes.readUInt16LE((y*m.width+x)*2);
    const value=(1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy))+fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1));
    elevations.push(m.minHeight+value/65535*(m.maxHeight-m.minHeight));
  }
  return {version:1,assetId:plan.assetId,width,height,extentMeters:[...plan.extentMeters],elevations,
    provenance:{kind:'recorded-dataset',model:'Bundled LROC Apollo 15 DTM; NASA/GSFC/ASU; centered crop',requestHash:createHash('sha256').update(metaBytes).update(bytes).update(JSON.stringify(plan.extentMeters)).digest('hex')}};
}
