"""Explicit generation service deployment with a shared-ledger build reservation."""
import argparse
import fcntl
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import modal_reason as ledger
import modal_generate

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--execute',action='store_true')
parser.add_argument('--service',choices=['terrain','generation'],default='terrain')
args=parser.parse_args()
service=args.service
ledger.APP='eduworld-terrain' if service=='terrain' else 'eduworld-agent-generation'
ledger.CREDIT_USD=.50;ledger.STAGE='agent-'+service+'-deployment';ledger.SOURCE_FILES=modal_generate.SOURCE_FILES
request={'job':service+'-deployment-'+ledger.service_source_hash()[:20],'role':'deploy',
 'system':('Register cached terrain service; zero minimum GPU containers' if service=='terrain' else 'Register cached reference and object services; zero minimum GPU containers'),
 'prompt':ledger.service_source_hash()}
file,record=ledger.reserve_or_recover(request,args.execute)
if record['status']=='completed':print('Deployment already recorded; no duplicate submission');sys.exit(0)
if not args.execute:raise RuntimeError('Explicit execution required')
with (ledger.OUT/'product-budget.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 record=json.loads(file.read_text());receipt_file=ledger.OUT/record['receipt'];receipt=json.loads(receipt_file.read_text())
 if record['status']!='reserved':raise RuntimeError('Deployment state is ambiguous; reconcile before retrying')
 record['status']=receipt['status']='submitting';ledger.atomic_json(file,record);ledger.atomic_json(receipt_file,receipt)
log=ledger.ROOT/('.cache/agent-world/'+service+'-deployment.log')
with log.open('w') as output:
 module='modal/terrain_app.py' if service=='terrain' else 'modal/agent_generation.py'
 process=subprocess.run([str(ledger.ROOT/'.venv-foundry/bin/modal'),'deploy',str(ledger.ROOT/module)],cwd=ledger.ROOT,stdout=output,stderr=subprocess.STDOUT)
record['status']='completed' if process.returncode==0 else 'deployment-failed-or-ambiguous'
receipt['status']='completed_pending_billing' if process.returncode==0 else 'failed_or_ambiguous'
ledger.atomic_json(file,record);ledger.atomic_json(receipt_file,receipt)
print(json.dumps({'status':record['status'],'log':str(log.relative_to(ledger.ROOT)),'reservation':.50}))
sys.exit(process.returncode)
