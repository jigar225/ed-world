"""Budgeted generation RPC. Uses deployed services only; never deploys or loads models."""
import argparse
import asyncio
import fcntl
import hashlib
import json
from pathlib import Path
import re
import sys
import modal_reason as ledger

ROOT = Path(__file__).resolve().parents[2]
APP = 'eduworld-agent-generation'
CLASSES = {'reference':'Reference', 'object':'Object', 'terrain':'Terrain'}
CREDITS = {'reference':.30, 'object':1.00, 'terrain':1.00}
SOURCE_FILES = ['modal/prepare_terrain_data.py','modal/terrain_app.py','modal/agent_generation.py', 'modal/agent_generation_runtime.py',
                'modal/terrain-requirements.txt', 'modal/flux_ref_app.py', 'modal/trellis2_app.py']


def checked_request(request):
    if not isinstance(request, dict) or set(request) != {'job', 'kind', 'payload'} or request['kind'] not in CLASSES:
        raise ValueError('Invalid generation request')
    if not isinstance(request['job'], str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}', request['job']):
        raise ValueError('Invalid job identity')
    payload = request['payload']
    if not isinstance(payload, dict) or len(json.dumps(payload)) > 60000:
        raise ValueError('Invalid generation payload')
    if request['kind'] == 'object':
        relative = payload.get('referencePath', '')
        if not re.fullmatch(r'\.cache/agent-world/artifacts/[a-f0-9]{64}\.png', relative):
            raise ValueError('Invalid reference path')
        file = (ROOT / relative).resolve()
        if not file.is_relative_to(ROOT.resolve()) or file.stat().st_size > 12 * 1024 * 1024:
            raise ValueError('Reference containment or size error')
        data = file.read_bytes()
        if hashlib.sha256(data).hexdigest() != file.stem: raise ValueError('Reference checksum mismatch')
    elif request['kind'] == 'reference':
        if not isinstance(payload.get('prompt'), str) or not 1 <= len(payload['prompt']) <= 6000 or not isinstance(payload.get('seed'), int):
            raise ValueError('Invalid reference brief')
    else:
        # Pure contract check; this file imports no torch/terrain models.
        sys.path.insert(0, str(ROOT / 'modal'))
        from agent_generation_runtime import terrain_shape
        terrain_shape(payload['plan'])
    return {'job':request['job'], 'role':request['kind'], 'system':APP,
            'prompt':json.dumps(payload, sort_keys=True)}


async def run(request, execute=False):
    envelope = checked_request(request)
    app_name = 'eduworld-terrain' if request['kind'] == 'terrain' else APP
    envelope['system'] = app_name
    ledger.APP, ledger.CREDIT_USD, ledger.SOURCE_FILES = app_name, CREDITS[request['kind']], SOURCE_FILES
    ledger.STAGE = 'agent-' + request['kind']
    file, record = ledger.reserve_or_recover(envelope, execute)
    if record['status'] == 'completed': return record['result']
    if not execute: raise RuntimeError('Execution disabled')
    import modal
    receipt_file = ledger.OUT / record['receipt']
    with (ledger.OUT / 'product-budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = json.loads(file.read_text()); receipt = json.loads(receipt_file.read_text())
        if record['status'] == 'completed': return record['result']
        if not record.get('call_id'):
            if record['status'] != 'reserved': raise RuntimeError('Uncertain submission without call ID; reconcile instead of resubmitting')
            if receipt['source_sha256'] != ledger.service_source_hash(): raise RuntimeError('Service source changed since reservation')
            payload = dict(request['payload'])
            if request['kind'] == 'object':
                image = (ROOT / payload.pop('referencePath')).read_bytes()
                payload.update(image=image, referenceHash=hashlib.sha256(image).hexdigest())
            payload['requestHash'] = record['input_hash']
            record['status'] = receipt['status'] = 'submitting'
            ledger.atomic_json(file, record); ledger.atomic_json(receipt_file, receipt)
            worker = modal.Cls.from_name(app_name, CLASSES[request['kind']])(
                lease_id=record['lease_id'], credit_cents=round(CREDITS[request['kind']] * 100))
            call = await worker.generate.spawn.aio(payload)
            record.update(call_id=call.object_id, status='submitted'); receipt.update(status='submitted', call_id=call.object_id)
            ledger.atomic_json(file, record); ledger.atomic_json(receipt_file, receipt)
        else: call = modal.FunctionCall.from_id(record['call_id'])
    while True:
        if json.loads(file.read_text()).get('status','').startswith('cancelled'):
            raise RuntimeError('Recorded call was cancelled; no resubmission')
        try:
            answer = await call.get.aio(timeout=30); break
        except TimeoutError: pass  # Recover the same call; queue wait is not a new attempt.
    data, extension = answer['data'], answer['extension']
    expected = {'reference':'png','object':'glb','terrain':'json'}[request['kind']]
    if not isinstance(data, bytes) or len(data) > 128 * 1024 * 1024 or extension != expected or hashlib.sha256(data).hexdigest() != answer['sha256']:
        raise RuntimeError('Generation artifact failed integrity checks')
    folder = ROOT / '.cache/agent-world/artifacts'; folder.mkdir(parents=True, exist_ok=True)
    if not folder.resolve().is_relative_to(ROOT.resolve()): raise RuntimeError('Artifact path escapes project')
    relative = f'.cache/agent-world/artifacts/{answer["sha256"]}.{extension}'
    target = ROOT / relative
    temp = target.with_suffix('.tmp'); temp.write_bytes(data); temp.replace(target)
    result = {'path':relative, 'hash':answer['sha256'], 'bytes':len(data), 'receiptId':record['lease_id']}
    with (ledger.OUT / 'product-budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record.update(status='completed', result=result); receipt['status'] = 'completed_pending_billing'
        ledger.atomic_json(file, record); ledger.atomic_json(receipt_file, receipt)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(100001)
        if len(raw) > 100000: raise ValueError('Request too large')
        print(json.dumps({'result':asyncio.run(run(json.loads(raw), args.execute))}), flush=True)
    except Exception:
        print(json.dumps({'error':'Generation did not complete. Recover the recorded call and inspect the shared budget; no automatic resubmission.'}), flush=True)
        sys.exit(1)
