/** Local app + existing private Modal generation, with no deployment or installs. */
import {spawn} from 'node:child_process';
if(!process.argv.includes('--execute'))throw Error('Use npm run local:worlds -- --execute to enable budgeted generation for prompts submitted in the local app.');
const children=[];let stopping=false;
function start(command,args,env=process.env){const p=spawn(command,args,{cwd:process.cwd(),stdio:'inherit',env});children.push(p);p.on('exit',()=>{if(!stopping)stop();});return p;}
function stop(){if(stopping)return;stopping=true;for(const p of children)if(p.exitCode===null)p.kill('SIGTERM');}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
start(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3011'],{...process.env,ED_BUILD_DIR:'.next-agent-integration'});
start(process.execPath,['--env-file-if-exists=.env','scripts/agent-world/worker.mjs','--execute','--generate']);
console.log('Local EduWorld: http://127.0.0.1:3011/create. GPU calls occur only for submitted work, within the existing ledger ceiling.');
