"""Budgeted RPC to the EXISTING private Modal language service; never loads a local model.

Input is JSON over stdin. Cached/remote call receipts are recovered, never retried.
Only --execute may reserve/invoke. All receipts contribute to the existing round ledger.
"""
import argparse
import asyncio
import datetime
import fcntl
import hashlib
import json
import sys
import uuid
import re
import base64
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/physical-world'))
from run_product_job import OUT, product_hold, authorized_limit

APP = 'eduworld-scene-language'
MODEL = 'eduworld-qwen3-vl-8b'
CREDIT_USD = .80
STAGE = 'agent-language'
SOURCE_FILES = ['modal/scenesmith_language_service.py']

def service_source_hash():
    return hashlib.sha256(b''.join((ROOT / name).read_bytes() for name in SOURCE_FILES)).hexdigest()


def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(value) + '\n')
    temp.replace(file)


def request_identity(request):
    required = {'job', 'role', 'system', 'prompt'}
    if not isinstance(request, dict) or not required.issubset(request) or set(request) - required - {'images','schema'}:
        raise ValueError('Invalid request fields')
    if 'schema' in request:
        schema = request['schema']
        if not isinstance(schema,dict) or schema.get('type') != 'object' or len(json.dumps(schema)) > 25000:
            raise ValueError('Invalid response schema')
    for key, maximum in [('job', 100), ('role', 100), ('system', 20000), ('prompt', 60000)]:
        if not isinstance(request[key], str) or not request[key].strip() or len(request[key]) > maximum:
            raise ValueError('Invalid request value')
    request_images(request)
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()


def request_images(request):
    images = request.get('images', [])
    if not isinstance(images, list) or len(images) > 6: raise ValueError('Invalid review images')
    content = []; total = 0
    for relative in images:
        if not isinstance(relative, str) or not re.fullmatch(r'\.cache/agent-world/artifacts/[a-f0-9]{64}\.png', relative): raise ValueError('Invalid review image path')
        file = (ROOT / relative).resolve()
        if not file.is_relative_to(ROOT.resolve()) or file.stat().st_size > 2 * 1024 * 1024: raise ValueError('Review image containment or size')
        data = file.read_bytes(); total += len(data)
        if total > 8 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != file.stem: raise ValueError('Review image checksum or total size')
        content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,' + base64.b64encode(data).decode()}})
    return content


def reserve_or_recover(request, execute):
    key = request_identity(request)
    record_file = ROOT / '.cache/agent-world/rpc' / (key + '.json')
    # This is the SAME lock used by the existing product launcher.
    with (OUT / 'product-budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        retired = None
        if record_file.exists():
            record = json.loads(record_file.read_text())
            if record['input_hash'] != key:
                raise ValueError('Receipt input mismatch')
            if record['status'] == 'retired_before_retry':
                # Only the explicit remote reconciliation tool sets this state.
                # The prior hold and immutable audit remain; this costs a NEW hold.
                retired = record
            else:
                return record_file, record
        if not execute:
            raise RuntimeError('Execution disabled; no reservation or model call made')
        budget_file = OUT / 'integration-round-budget.json'
        budget = json.loads(budget_file.read_text())
        held = product_hold()
        retained = budget['reconciliation']['model_check_retained_hold_usd']
        if not isinstance(retained, (int, float)) or retained < 0:
            raise ValueError('Invalid retained budget hold')
        if held + retained + CREDIT_USD > authorized_limit(budget):
            raise RuntimeError('Existing round budget cannot fund this call')
        lease = str(uuid.uuid4())
        receipt_file = OUT / f'{STAGE}-reservation-product-{lease}.json'
        receipt = {'id': lease, 'stage': STAGE, 'status': 'reserved',
                   'reservation_usd': CREDIT_USD, 'input_hash': key, 'app_name': APP,
                   'created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'source_sha256': service_source_hash()}
        atomic_json(receipt_file, receipt)
        record = {'lease_id': lease, 'input_hash': key, 'status': 'reserved',
                  'receipt': receipt_file.name}
        if retired:
            record['retired_attempts'] = [*retired.get('retired_attempts', []),
                {k:retired[k] for k in ('lease_id','receipt','reconciliation')}]
        atomic_json(record_file, record)
        budget.update(product_reserved_usd=held + CREDIT_USD,
                      unreserved_usd=budget['approved_usd'] - retained - held - CREDIT_USD)
        atomic_json(budget_file, budget)
        return record_file, record


def session_file(job):
    # Each completion sends a fresh messages array; sharing the funded model
    # allocation does not share conversation context or cached job results.
    return ROOT / '.cache/agent-world/language-sessions/shared.json'


def reserve_language(request, execute):
    """Reuse a still-funded warm allocation across this project's sequential jobs.

    Every call still has its own durable receipt. A reused call holds no extra
    dollars: the parent allocation's unchanged timer bounds their combined cost.
    """
    global CREDIT_USD
    path = session_file(request['job']); path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time(); reusable = False
        sessions=[]
        # Also adopt the active allocation from older per-job session records.
        for candidate in path.parent.glob('*.json'):
            try:
                value=json.loads(candidate.read_text())
                if isinstance(value,dict) and isinstance(value.get('last_completed_utc'),(int,float)):
                    sessions.append(value)
            except (OSError,ValueError):continue
        session=None
        for candidate in sorted(sessions,key=lambda s:s['last_completed_utc'],reverse=True):
            filename=candidate.get('receipt','')
            if candidate.get('source_sha256') != service_source_hash() or not re.fullmatch(r'agent-language-reservation-product-[a-f0-9-]+\.json',filename):continue
            parent = OUT / filename
            if parent.is_file():
                receipt = json.loads(parent.read_text())
                reusable = (receipt.get('id') == candidate.get('lease_id') and receipt.get('app_name') == APP
                    and receipt.get('status') == 'completed_pending_billing'
                    and receipt.get('reservation_usd', 0) == .8
                    and now < candidate.get('allocation_deadline_utc', 0) - 120
                    and 0 <= now - candidate.get('last_completed_utc', 0) < 180)
                if reusable:
                    session=candidate
                    break
        previous_credit = CREDIT_USD
        try:
            if reusable: CREDIT_USD = 0
            file, record = reserve_or_recover(request, execute)
        finally: CREDIT_USD = previous_credit
        if reusable and record['status'] == 'reserved' and not record.get('allocation_lease_id'):
            with (OUT / 'product-budget.lock').open('a') as budget_lock:
                fcntl.flock(budget_lock, fcntl.LOCK_EX)
                record = json.loads(file.read_text())
                receipt_path = OUT / record['receipt']; receipt = json.loads(receipt_path.read_text())
                # Only attach zero-dollar child receipts; never repurpose a funded lease.
                if receipt['reservation_usd'] == 0:
                    record['allocation_lease_id'] = session['lease_id']
                    receipt['allocation_lease_id'] = session['lease_id']
                    receipt['funded_by'] = session['receipt']
                    atomic_json(file, record); atomic_json(receipt_path, receipt)
        return file, record


async def run(request, execute=False):
    file, record = reserve_language(request, execute)
    if record['status'] == 'completed':
        return record['result']
    if not execute:
        raise RuntimeError('Execution disabled; remote recovery requires explicit execution')
    import modal
    receipt_file = OUT / record['receipt']
    with (OUT / 'product-budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = json.loads(file.read_text())
        receipt = json.loads(receipt_file.read_text())
        if record['status'] == 'completed':
            return record['result']
        if not record.get('call_id'):
            if record['status'] != 'reserved':
                raise RuntimeError('Uncertain submission without call ID; reconcile instead of resubmitting')
            if receipt['source_sha256'] != service_source_hash():
                raise RuntimeError('Service source changed since reservation')
            allocation = record.get('allocation_lease_id', record['lease_id'])
            if receipt['reservation_usd'] == 0 and 'allocation_lease_id' not in record:
                raise RuntimeError('Unfunded language allocation refused')
            obj = modal.Cls.from_name(APP, 'Language')(lease_id=allocation, credit_cents=80)
            # Resolve metadata before crossing the submission boundary. A network
            # failure here has not sent model input and can reuse this reservation.
            try:
                await obj.complete.hydrate.aio()
            except Exception:
                record['last_error_code'] = 'metadata_connection_failed'
                atomic_json(file, record)
                raise RuntimeError('Modal connection failed before model submission. The saved reservation can be resumed.') from None
            payload = {'model': MODEL, 'stream': False, 'max_tokens': 4096, 'temperature': .2,
                       'response_format': {'type': 'json_object'},
                       'messages': [{'role': 'system', 'content': request['system']},
                                    {'role': 'user', 'content': ([{'type':'text','text':request['prompt']}] + request_images(request)) if request.get('images') else request['prompt']}]}
            if 'schema' in request:
                payload['response_format'] = {'type':'json_schema','json_schema':{'name':'agent_response','strict':True,'schema':request['schema']}}
            record['status'] = receipt['status'] = 'submitting'
            record.pop('last_error_code', None)
            atomic_json(file, record)
            atomic_json(receipt_file, receipt)
            try:
                call = await obj.complete.spawn.aio(payload)
            except Exception:
                record['last_error_code'] = 'submission_outcome_unknown'
                atomic_json(file, record)
                raise RuntimeError('Modal submission could not be confirmed. Check the recorded allocation before retrying; no duplicate call was sent.') from None
            record.update(call_id=call.object_id, status='submitted')
            receipt['status'] = 'submitted'
            atomic_json(file, record)
            atomic_json(receipt_file, receipt)
        else:
            call = modal.FunctionCall.from_id(record['call_id'])
    # Individual polls do not impose an overall cold-start deadline or resubmit.
    while True:
        try:
            response = await call.get.aio(timeout=30)
            break
        except TimeoutError:
            print(json.dumps({'stage': 'waiting-for-recorded-call', 'call_id': record['call_id']}), file=sys.stderr, flush=True)
    choice = response['choices'][0]
    if choice.get('finish_reason') == 'length':
        raise RuntimeError('Model output truncated; no automatic paid retry')
    result = json.loads(choice['message']['content'])
    with (OUT / 'product-budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record.update(status='completed', result=result)
        receipt['status'] = 'completed_pending_billing'
        atomic_json(file, record)
        atomic_json(receipt_file, receipt)
    # Query only the allocation that just served this call. If it already ended,
    # the service refuses to reload that consumed lease; never create a new one.
    try:
        allocation = record.get('allocation_lease_id', record['lease_id'])
        obj = modal.Cls.from_name(APP, 'Language')(lease_id=allocation, credit_cents=80)
        state = await obj.ready.remote.aio()
        if state.get('lease_id') == allocation and state.get('allocation_deadline_utc', 0) > time.time() + 120:
            session_path = session_file(request['job'])
            with session_path.with_suffix('.lock').open('a') as session_lock:
                fcntl.flock(session_lock, fcntl.LOCK_EX)
                atomic_json(session_path, {'lease_id':allocation,
                    'receipt':receipt.get('funded_by', record['receipt']), 'source_sha256':service_source_hash(),
                    'allocation_deadline_utc':state['allocation_deadline_utc'], 'last_completed_utc':time.time()})
    except Exception:
        pass  # Result remains durable; a future call must reserve its own allocation.
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(100001)
        if len(raw) > 100000:
            raise ValueError('Input exceeds request limit')
        result = asyncio.run(run(json.loads(raw), args.execute))
        print(json.dumps({'result': result}), flush=True)
    except Exception as error:
        # SDK/provider exceptions can contain URLs or credentials. Keep them out of stdout.
        known = {
            'Existing round budget cannot fund this call',
            'Execution disabled; no reservation or model call made',
            'Execution disabled; remote recovery requires explicit execution',
            'Uncertain submission without call ID; reconcile instead of resubmitting',
            'Service source changed since reservation',
            'Model output truncated; no automatic paid retry',
            'Modal connection failed before model submission. The saved reservation can be resumed.',
            'Modal submission could not be confirmed. Check the recorded allocation before retrying; no duplicate call was sent.',
        }
        message = str(error) if str(error) in known else 'Modal reasoning did not complete. Check budget and recorded call status; no automatic retry.'
        print(json.dumps({'error': message}), flush=True)
        sys.exit(1)
