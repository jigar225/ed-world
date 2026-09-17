"""Isolated bridge/recovery checks; no SDK requests, credentials, model import or GPU."""
import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/agent-world'))
import modal_generate as bridge
import modal_reason as ledger
sys.path.insert(0,str(ROOT/'modal'))
from agent_generation_runtime import terrain_shape
assert terrain_shape({'representation':'heightfield','extentMeters':[60,90],'conditioning':{'width':2,'height':2,'elevations':[0,1,2,3]}})==(3,4)
for extent in ([20,30],[31,60],[float('nan'),60],[100000,30]):
    try: terrain_shape({'representation':'heightfield','extentMeters':extent,'conditioning':{'width':2,'height':2,'elevations':[0]*4}});raise AssertionError('Unsupported terrain scale accepted')
    except ValueError: pass
assert 'torch' not in sys.modules
with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='generation-test-') as directory:
    root=Path(directory);out=root/'receipts';out.mkdir();bridge.ROOT=ledger.ROOT=root;ledger.OUT=out
    for name in bridge.SOURCE_FILES:
        file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('# test source')
    ledger.product_hold=lambda:sum(json.loads(p.read_text())['reservation_usd'] for p in out.glob('*-reservation-product-*.json'))
    (out/'integration-round-budget.json').write_text(json.dumps({'approved_usd':2.,'reconciliation':{'model_check_retained_hold_usd':.1}}))
    request={'job':'test','kind':'reference','payload':{'prompt':'Fixture reference','seed':1}}
    try: asyncio.run(bridge.run(request,False));raise AssertionError('Execution disabled bypassed')
    except RuntimeError: pass
    calls=[];data=b'\x89PNG\r\n\x1a\nfixture';answer={'data':data,'extension':'png','sha256':hashlib.sha256(data).hexdigest()}
    async def get(timeout):return answer
    handle=types.SimpleNamespace(object_id='fixture-call',get=types.SimpleNamespace(aio=get))
    async def spawn(payload):calls.append(payload);return handle
    class FakeClass:
        @staticmethod
        def from_name(app,name):
            assert app==bridge.APP and name=='Reference'
            return lambda **params:types.SimpleNamespace(generate=types.SimpleNamespace(spawn=types.SimpleNamespace(aio=spawn)))
    sys.modules['modal']=types.SimpleNamespace(Cls=FakeClass,FunctionCall=types.SimpleNamespace(from_id=lambda id:handle))
    result=asyncio.run(bridge.run(request,True));assert (root/result['path']).read_bytes()==data
    assert asyncio.run(bridge.run(request,True))==result and len(calls)==1
    assert len(list(out.glob('*-reservation-product-*.json')))==1
    # A saved submitting record without an ID cannot dispatch another request.
    ambiguous={**request,'job':'ambiguous'};envelope=bridge.checked_request(ambiguous)
    file,record=ledger.reserve_or_recover(envelope,True);record['status']='submitting';ledger.atomic_json(file,record)
    try:asyncio.run(bridge.run(ambiguous,True));raise AssertionError('Duplicate ambiguous call')
    except RuntimeError as e:assert 'Uncertain' in str(e)
    assert len(calls)==1
    # Six-view inputs only read content-addressed project artifacts.
    image=root/'.cache/agent-world/artifacts'/f'{hashlib.sha256(data).hexdigest()}.png'
    req={'job':'x','role':'review','system':'test','prompt':'test','images':[str(image.relative_to(root))]}
    assert len(ledger.request_images(req))==1
    image.write_bytes(b'changed')
    try:ledger.request_images(req);raise AssertionError('Changed review image accepted')
    except ValueError:pass
print('PASS: native terrain scale, explicit funding, generated artifact integrity, same-call recovery, ambiguous submission rejection, review-image privacy; no models.')
