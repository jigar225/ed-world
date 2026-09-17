import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AgentStore} from './store';
import {inspectGLB, projectFile, saveArtifact} from './assets';

export type ModelTool = 'reason' | 'generate-reference' | 'generate-object';
export interface FundingRequest {callId: string; jobId: string; tool: ModelTool; inputHash: string}
/** Must reserve against the existing global ledger BEFORE dispatch; no new implicit allowance. */
export type FundingAuthority = (request: FundingRequest) => Promise<{receiptId: string}>;
export interface ModalToolOptions {
  root: string; store: AgentStore; env?: NodeJS.ProcessEnv; fetch?: typeof fetch;
  fund?: FundingAuthority;
}
export function modalURL(value: string | undefined): string {
  if (!value) throw Error('Modal endpoint is not configured');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash ||
    !(u.hostname.endsWith('.modal.run') || u.hostname.endsWith('.modal.direct'))) throw Error('Only explicitly configured HTTPS Modal endpoints are allowed');
  return u.href;
}
async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  const reader = response.body?.getReader(); if (!reader) throw Error('Empty provider response');
  const chunks: Uint8Array[] = []; let size=0;
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
    if(size>maximum)throw Error('Provider output exceeds artifact limit'); chunks.push(value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export class ModalTools {
  private env: NodeJS.ProcessEnv;
  constructor(private options: ModalToolOptions) { this.env=options.env ?? process.env; }
  status() {
    return (['reason','generate-reference','generate-object'] as ModelTool[]).map(tool => {
      try { this.configuration(tool); return {tool, configured:true, funded:!!this.options.fund, verifiedLive:false}; }
      catch { return {tool, configured:false, funded:!!this.options.fund, verifiedLive:false}; }
    });
  }
  private configuration(tool: ModelTool) {
    const e=this.env;
    if(tool==='reason') {
      const url=modalURL(e.AGENT_MODAL_LLM_URL), model=e.AGENT_MODAL_LLM_MODEL;
      if(!model || !e.KIMI_MODAL_KEY || !e.KIMI_MODAL_SECRET)throw Error('Modal language model/auth missing');
      return {url, model, headers:{'Modal-Key':e.KIMI_MODAL_KEY,'Modal-Secret':e.KIMI_MODAL_SECRET} as Record<string,string>};
    }
    const url=modalURL(tool==='generate-reference'?e.FLUX_MODAL_URL:e.TRELLIS_MODAL_URL);
    if(!e.FOUNDRY_SHARED_SECRET)throw Error('Modal foundry auth missing');
    return {url, model:tool, headers:{'X-Foundry-Key':e.FOUNDRY_SHARED_SECRET} as Record<string,string>};
  }
  async call(jobId: string, tool: ModelTool, input: {system?:string; prompt?:string; referencePath?:string; seed?:number}, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const config=this.configuration(tool);
    let body: unknown;
    if(tool==='reason') {
      if(!input.system || !input.prompt || input.system.length+input.prompt.length>60000)throw Error('Invalid language input');
      body={model:config.model,stream:false,response_format:{type:'json_object'},temperature:0.2,max_tokens:4096,
        messages:[{role:'system',content:input.system},{role:'user',content:input.prompt}]};
    } else if(tool==='generate-reference') {
      if(!input.prompt?.trim() || input.prompt.length>6000 || (input.seed!==undefined && !Number.isSafeInteger(input.seed)))throw Error('Invalid reference request');
      body={prompt:input.prompt,seed:input.seed};
    } else {
      if(!input.referencePath || !/^\.cache\/agent-world\/artifacts\/[a-f0-9]{64}\.png$/.test(input.referencePath))throw Error('A generated reference artifact is required');
      const file=await projectFile(this.options.root,input.referencePath);
      if((await stat(file)).size>12*1024*1024)throw Error('Reference image too large');
      const image=await readFile(file);
      if(!input.referencePath.endsWith(createHash('sha256').update(image).digest('hex')+'.png'))throw Error('Reference artifact checksum mismatch');
      body={image_b64:image.toString('base64')};
    }
    // Endpoint and model are part of identity: never reuse a different provider's result.
    if(!this.options.fund)throw Error('Paid tool requires a reconciled global-budget funding adapter; no request sent');
    const {record,cached}=this.options.store.begin(jobId,tool,{url:config.url,model:config.model,body});
    if(cached)return JSON.parse(record.result!);
    try {
      const permit=await this.options.fund({callId:record.id,jobId,tool,inputHash:record.input_hash});
      if(!permit.receiptId)throw Error('Missing funding receipt');
      signal?.throwIfAborted();
      const response=await (this.options.fetch ?? fetch)(config.url,{method:'POST',redirect:'error',signal,
        headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw Error('Provider did not complete successfully');
      const bytes=await boundedBody(response,tool==='generate-object'?128*1024*1024:tool==='reason'?512*1024:12*1024*1024);
      let result: unknown;
      if(tool==='reason') {
        const data=JSON.parse(bytes.toString()), content=data.choices?.[0]?.message?.content;
        if(data.choices?.[0]?.finish_reason==='length' || typeof content!=='string')throw Error('Incomplete model JSON');
        result=JSON.parse(content);
      } else {
        if(tool==='generate-reference' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG');
        const inventory=tool==='generate-object'?inspectGLB(bytes):undefined;
        const artifact=await saveArtifact(this.options.root,bytes,tool==='generate-object'?'glb':'png');
        result={...artifact,inventory,receiptId:permit.receiptId};
        if(inventory)this.options.store.register(artifact.hash,result);
      }
      this.options.store.complete(record.id,result); return result;
    } catch {
      // Synchronous legacy endpoints have no recovery handle. Never blindly retry.
      this.options.store.uncertain(record.id);
      throw Error(`Model call ${record.id} needs reconciliation; no automatic retry was submitted`);
    }
  }
}
