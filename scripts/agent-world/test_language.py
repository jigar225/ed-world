"""Structured-output transport and warm-call recovery; mocked Modal, no network."""
import asyncio,json,sys,tempfile,types,time
from pathlib import Path
import modal_reason as m
ROOT=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='language-test-') as d:
 root=Path(d);out=root/'receipts';out.mkdir();(root/'modal').mkdir()
 (root/'modal/scenesmith_language_service.py').write_text('# fixture')
 m.ROOT,m.OUT=root,out
 m.product_hold=lambda:sum(json.loads(p.read_text())['reservation_usd'] for p in out.glob('*-reservation-product-*.json'))
 (out/'integration-round-budget.json').write_text(json.dumps({'approved_usd':1.,'reconciliation':{'model_check_retained_hold_usd':.1}}))
 calls=[];allocations=[];metadata_available=False
 class FakeClass:
  @staticmethod
  def from_name(app,name):
   assert app==m.APP and name=='Language'
   def instance(**params):
    async def hydrate():
     if not metadata_available:raise ConnectionError('private-token-not-for-output')
    async def ready():return {'lease_id':params['lease_id'],'allocation_deadline_utc':time.time()+600}
    async def spawn(payload):
     calls.append(payload);allocations.append(params['lease_id'])
     async def get(timeout):return {'choices':[{'finish_reason':'stop','message':{'content':'{"valid":true}'}}]}
     return types.SimpleNamespace(object_id='call-'+str(len(calls)),get=types.SimpleNamespace(aio=get))
    return types.SimpleNamespace(complete=types.SimpleNamespace(hydrate=types.SimpleNamespace(aio=hydrate),spawn=types.SimpleNamespace(aio=spawn)),ready=types.SimpleNamespace(remote=types.SimpleNamespace(aio=ready)))
   return instance
 sys.modules['modal']=types.SimpleNamespace(Cls=FakeClass)
 schema={'type':'object','properties':{'valid':{'type':'boolean'}},'required':['valid'],'additionalProperties':False}
 req={'job':'shared','role':'intent','system':'fixture','prompt':'first','schema':schema}
 try:asyncio.run(m.run(req,True));raise AssertionError('Disconnected metadata lookup succeeded')
 except RuntimeError as e:assert 'before model submission' in str(e) and 'private-token' not in str(e)
 saved=list((root/'.cache/agent-world/rpc').glob('*.json'));assert len(saved)==1
 reserved=json.loads(saved[0].read_text());assert reserved['status']=='reserved' and len(calls)==0 and m.product_hold()==.8
 metadata_available=True
 assert asyncio.run(m.run(req,True))=={'valid':True}
 assert json.loads(saved[0].read_text())['lease_id']==reserved['lease_id'] and m.product_hold()==.8
 assert calls[0]['response_format']=={'type':'json_schema','json_schema':{'name':'agent_response','strict':True,'schema':schema}}
 assert asyncio.run(m.run({**req,'role':'spatial','prompt':'second'},True))=={'valid':True}
 assert allocations[0]==allocations[1] and m.product_hold()==.8
 asyncio.run(m.run(req,True));assert len(calls)==2
 # A second prompt reuses weights/funding, but gets its own fresh request/result.
 shared=m.session_file(req['job']);legacy=shared.with_name('legacy.json');legacy.write_bytes(shared.read_bytes());shared.unlink()
 asyncio.run(m.run({**req,'job':'another-world','prompt':'independent topic'},True))
 assert len(calls)==3 and allocations[0]==allocations[2] and m.product_hold()==.8
 assert calls[2]['messages'][1]['content']=='independent topic'
 for path in shared.parent.glob('*.json'):
  value=json.loads(path.read_text());value['allocation_deadline_utc']=0;path.write_text(json.dumps(value))
 try:asyncio.run(m.run({**req,'job':'expired-world'},True));raise AssertionError('Expired funding reused')
 except RuntimeError as e:assert 'budget' in str(e)
 assert len(calls)==3 and m.product_hold()==.8
 assert m.request_identity(req)!=m.request_identity({**req,'schema':{**schema,'description':'different contract'}})
print('PASS: pre-submission connection recovery without duplicate reservation, structured requests, shared funded model across independent jobs, separate context, cache replay, expired-budget protection.')
