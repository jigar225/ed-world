import {createHash} from 'crypto';
import {promises as fs} from 'fs';
import path from 'path';

export interface SceneReference {title:string;url:string;excerpt:string;image?:string;imageSource?:string}
async function boundedFetch(url:string,signal?:AbortSignal,maximum=1_500_000){
  const response=await fetch(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000),headers:{'User-Agent':'EduWorld/0.1 (educational reference retrieval)'}});
  if(!response.ok||!response.body)throw new Error(`Reference service returned ${response.status}`);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>maximum)throw new Error('Reference exceeds retrieval budget');chunks.push(r.value);}}finally{await reader.cancel();}
  return {data:Buffer.concat(chunks),type:response.headers.get('content-type')?.split(';')[0]};
}

/** Bounded general retrieval; queries come from the subject blueprint, never a
 * hand-maintained topic catalogue. External text/images are evidence, not code
 * or instructions. Images remain private review inputs, not world textures. */
export async function retrieveSceneReferences(queries:string[],signal?:AbortSignal):Promise<{sources:SceneReference[];limitations:string[]}>{
  const bounded=[...new Set(queries.filter(q=>typeof q==='string'&&q.trim()).map(q=>q.trim().slice(0,120)))].slice(0,3);
  const sources:SceneReference[]=[],limitations:string[]=[];
  for(const query of bounded){
    signal?.throwIfAborted();
    const key=createHash('sha256').update('references-v2:'+query).digest('hex').slice(0,24),file=path.join(process.cwd(),'.cache','references',key+'.json');
    try{const stat=await fs.stat(file);if(Date.now()-stat.mtimeMs<7*86400000){const cached=JSON.parse(await fs.readFile(file,'utf8')) as SceneReference[];sources.push(...cached);continue;}}catch{}
    try{
      const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:query,gsrlimit:'1',gsrnamespace:'0',prop:'extracts|pageimages|info',inprop:'url',exintro:'1',explaintext:'1',exchars:'1200',piprop:'thumbnail',pithumbsize:'640'});
      const {data}=await boundedFetch('https://en.wikipedia.org/w/api.php?'+params,signal),result=JSON.parse(data.toString());
      const batch:SceneReference[]=[];
      for(const page of result.query?.pages??[]){
        if(typeof page.title!=='string'||typeof page.extract!=='string'||!page.extract.trim()||typeof page.fullurl!=='string')continue;
        const url=new URL(page.fullurl);if(url.origin!=='https://en.wikipedia.org'||!url.pathname.startsWith('/wiki/'))continue;
        const source:SceneReference={title:page.title.slice(0,160),url:url.href,excerpt:page.extract.slice(0,1200)};
        try{
          const image=new URL(page.thumbnail?.source);if(['https://upload.wikimedia.org','https://thumb.wikimedia.org'].includes(image.origin)){
            const fetched=await boundedFetch(image.href,signal);
            if(['image/jpeg','image/png','image/webp'].includes(fetched.type??'')){source.image=`data:${fetched.type};base64,${fetched.data.toString('base64')}`;source.imageSource=image.href;}
          }
        }catch{signal?.throwIfAborted();}
        batch.push(source);
      }
      if(!batch.length)limitations.push(`No reference was retrieved for ${query}.`);
      else{await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(batch));await fs.rename(temp,file);sources.push(...batch);}
    }catch{signal?.throwIfAborted();limitations.push(`Reference retrieval was unavailable for ${query}.`);}
  }
  for(const source of sources)if(!source.image)limitations.push(`No usable reference image was retrieved for ${source.title}; text only.`);
  return {sources:[...new Map(sources.map(s=>[s.url,s])).values()].slice(0,3),limitations};
}
