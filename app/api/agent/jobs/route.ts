import {NextRequest,NextResponse} from 'next/server';
import {sameRequestOrigin} from '@/lib/request-origin';
import {randomUUID} from 'node:crypto';
import {agentJobs,generationWorkerReady} from '@/lib/agent-world/jobs';
import {publicJob} from '@/lib/scene-jobs';
import {limitedJSON} from '@/lib/limited-json';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookie='ed-agent-owner';
export async function GET(request:NextRequest) {
  const owner=request.cookies.get(cookie)?.value,id=request.nextUrl.searchParams.get('id');
  const job=owner&&id?agentJobs().get(id,owner):undefined;
  return NextResponse.json(job?publicJob(job):{error:'World job not found'},
    {status:job?200:404,headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:NextRequest) {
  if(!sameRequestOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
  let topic='';
  try {const input=await limitedJSON(request) as {topic?:unknown};if(typeof input.topic==='string')topic=input.topic.trim();}catch{}
  if(!topic || topic.length>1600)return NextResponse.json({error:'Enter 1–1600 characters.'},{status:400});
  const db=agentJobs();
  if(!generationWorkerReady())return NextResponse.json({error:'World generation worker is not running. No model call was made.'},{status:503});
  const owner=request.cookies.get(cookie)?.value||randomUUID();
  try {
    const job=db.enqueue(owner,topic),response=NextResponse.json(publicJob(job),{status:202});
    response.cookies.set(cookie,owner,{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/',maxAge:2592000});
    return response;
  } catch {return NextResponse.json({error:'World creation queue is full.'},{status:429});}
}
export async function DELETE(request:NextRequest) {
  if(!sameRequestOrigin(request))return NextResponse.json({error:'Invalid origin'},{status:403});
  const owner=request.cookies.get(cookie)?.value,id=request.nextUrl.searchParams.get('id');
  if(!owner||!id||!agentJobs().get(id,owner))return NextResponse.json({error:'World job not found'},{status:404});
  agentJobs().cancel(id,owner);return NextResponse.json({ok:true,note:'Downstream work cancelled; an already submitted Modal call may finish within its funded lease.'});
}
