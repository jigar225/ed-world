import {spawn} from 'node:child_process';
import path from 'node:path';
import {projectFile} from './assets';
import {responseSchema} from './schemas';

/** Invoke our reviewed project bridge, using the existing SDK environment; no shell/install. */
async function invokeBridge(root:string,scriptName:'modal_reason.py'|'modal_generate.py',payload:unknown,signal?:AbortSignal):Promise<unknown> {
  signal?.throwIfAborted();
  // A venv's python can legitimately symlink to its system interpreter. The
  // executable path is fixed by us; only the reviewed script must be project-contained.
  const python=path.join(root,'.venv-foundry/bin/python');
  const script=await projectFile(root,'scripts/agent-world/'+scriptName);
  return new Promise((resolve,reject)=>{
    const child=spawn(python,[script,'--execute'],{cwd:root,stdio:['pipe','pipe','pipe'],signal});
    let output='', oversized=false;
    child.stdout.setEncoding('utf8');child.stderr.resume();
    child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>1024*1024){oversized=true;child.kill();}});
    child.stdin.on('error',()=>{});
    child.on('error',()=>reject(Error('Modal RPC bridge unavailable; no fallback provider')));
    child.on('close',code=>{
      if(oversized)return reject(Error('Modal RPC response exceeded its limit; inspect the recorded call before retrying'));
      try {const data=JSON.parse(output.trim().split('\n').at(-1)!);
        // These messages are the reviewed bridge's allow-listed public errors,
        // never raw SDK/provider exceptions or stderr containing credentials.
        if(typeof data.error==='string')return reject(Error(data.error.slice(0,400)));
        if(code!==0)throw Error();resolve(data.result);}
      catch {reject(Error('Invalid Modal RPC response'));}
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export const modalReasonRPC=(root:string,job:string,role:string,system:string,prompt:string,signal?:AbortSignal,schema:Record<string,unknown>|undefined=responseSchema(role))=>
  invokeBridge(root,'modal_reason.py',{job,role,system,prompt,schema},signal);
export const modalGenerationRPC=(root:string,job:string,kind:'reference'|'object'|'terrain',payload:unknown,signal?:AbortSignal)=>
  invokeBridge(root,'modal_generate.py',{job,kind,payload},signal);

export const modalVisualRPC=(root:string,job:string,system:string,prompt:string,images:string[],signal?:AbortSignal)=>
  invokeBridge(root,'modal_reason.py',{job,role:'asset-review',system,prompt,images,schema:responseSchema('asset-review')},signal);

export const modalSceneRevisionRPC=(root:string,job:string,system:string,prompt:string,images:string[],schema:Record<string,unknown>,signal?:AbortSignal)=>
  invokeBridge(root,'modal_reason.py',{job,role:'grounding-visual',system,prompt,images,schema},signal);
