import {NextResponse} from 'next/server';
import {TOOL_CATALOG} from '@/lib/agent-world/capabilities';
import {agentJobs} from '@/lib/agent-world/jobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET() {
  return NextResponse.json({tools:TOOL_CATALOG,workerAvailable:agentJobs().healthy(),
    mode:'preparation-only',terrain:'planner-and-heightfield-contract-ready; model-deployment-pending',liveModelsVerified:false},
    {headers:{'Cache-Control':'no-store'}});
}
