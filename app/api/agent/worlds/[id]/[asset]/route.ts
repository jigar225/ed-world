import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {agentWorldAsset} from '@/lib/agent-world/assembly';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string;asset:string}>}) {
  try {
    const {id,asset}=await params,file=await agentWorldAsset(process.cwd(),id,asset);
    return new NextResponse(new Uint8Array(await readFile(file)),{headers:{'Content-Type':asset.endsWith('.json')?'application/json':'model/gltf-binary',
      'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  } catch {return NextResponse.json({error:'World asset not found'},{status:404});}
}
