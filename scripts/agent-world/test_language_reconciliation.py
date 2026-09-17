"""No network: exercise uncertain-call retirement and separate funded retry."""
import json,tempfile,types
from pathlib import Path
import modal_reason as bridge
from reconcile_language import reconcile
ROOT=bridge.ROOT
with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='language-reconcile-test-') as folder:
 root=Path(folder);out=root/'receipts';out.mkdir();(root/'modal').mkdir()
 (root/'modal/scenesmith_language_service.py').write_text('# fixture')
 bridge.ROOT,bridge.OUT=root,out
 bridge.product_hold=lambda:sum(json.loads(p.read_text())['reservation_usd'] for p in out.glob('*-reservation-product-*.json'))
 (out/'integration-round-budget.json').write_text(json.dumps({'approved_usd':2.,'reconciliation':{'model_check_retained_hold_usd':.1}}))
 request={'job':'lake','role':'plan','system':'fixture','prompt':'fixture'}
 file,record=bridge.reserve_or_recover(request,True);record['status']='submitting';bridge.atomic_json(file,record)
 receipt_path=out/record['receipt'];receipt=json.loads(receipt_path.read_text());receipt['status']='submitting';bridge.atomic_json(receipt_path,receipt)
 stats=types.SimpleNamespace(backlog=1,num_total_runners=0);remote={}
 class Volume:
  def listdir(self,directory):
   values=[types.SimpleNamespace(path=k) for k in remote if k.startswith(directory+'/')]
   if not values:raise FileNotFoundError()
   return values
  def read_file(self,path):return [remote[path]]
  def batch_upload(self):return self
  def __enter__(self):return self
  def __exit__(self,*args):pass
  def put_file(self,file,path):
   assert path not in remote
   remote[path]=file.read()
 modal=types.SimpleNamespace(exception=types.SimpleNamespace(NotFoundError=FileNotFoundError),
  Cls=types.SimpleNamespace(from_name=lambda *_:lambda **__:types.SimpleNamespace(complete=types.SimpleNamespace(get_current_stats=lambda:stats))),
  Volume=types.SimpleNamespace(from_name=lambda _:Volume()))
 key=record['input_hash']
 try:reconcile(key,modal);raise AssertionError('Queued allocation retired')
 except RuntimeError as e:assert 'queued or running' in str(e)
 assert not remote
 stats.backlog=0
 existing='scenesmith-language-leases/'+record['lease_id']+'/report.json';remote[existing]=b'{}'
 try:reconcile(key,modal);raise AssertionError('Execution evidence overwritten')
 except RuntimeError as e:assert 'remote artifacts' in str(e)
 assert remote[existing]==b'{}';remote.clear()
 audit=reconcile(key,modal);assert len(remote)==1 and next(iter(remote)).endswith('/retired.json')
 assert reconcile(key,modal)==audit
 assert json.loads(file.read_text())['status']=='retired_before_retry'
 assert json.loads(receipt_path.read_text())['reservation_usd']==.8 and bridge.product_hold()==.8
 _,replacement=bridge.reserve_or_recover(request,True)
 assert replacement['lease_id']!=record['lease_id'] and bridge.product_hold()==1.6
 assert replacement['retired_attempts'][0]['lease_id']==record['lease_id']
 assert bridge.reserve_or_recover(request,True)[1]==replacement and bridge.product_hold()==1.6
 assert json.loads((root/audit).read_text())['record_before']==record
print('PASS: busy/artifact guards, immutable remote permit retirement, audit/old hold retention, separate reservation and idempotent recovery; no network.')
