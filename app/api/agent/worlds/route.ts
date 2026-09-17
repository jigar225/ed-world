import {NextRequest,NextResponse} from 'next/server';
import {listAgentWorlds} from '@/lib/agent-world/assembly';
import {generationWorkerReady} from '@/lib/agent-world/jobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  const all=await listAgentWorlds(process.cwd());
  const worlds=request.nextUrl.searchParams.get('includeFixtures')==='1'?all:all.filter(w=>w.source!=='engineering-fixture');
  return NextResponse.json({worlds,workerReady:generationWorkerReady()}, {headers:{'Cache-Control':'no-store'}});
}
