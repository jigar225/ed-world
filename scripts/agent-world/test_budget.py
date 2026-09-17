"""No Modal import/network: validate reservations against an isolated project-local ledger."""
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('agent_rpc', Path(__file__).with_name('modal_reason.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='agent-budget-test-') as folder:
    root = Path(folder)
    out = root / 'receipts'
    out.mkdir()
    (root / 'modal').mkdir()
    (root / 'modal/scenesmith_language_service.py').write_text('# fixture')
    m.ROOT, m.OUT = root, out
    m.product_hold = lambda: sum(json.loads(p.read_text())['reservation_usd'] for p in out.glob('*-reservation-product-*.json'))
    budget = {'approved_usd': 1.0, 'reconciliation': {'model_check_retained_hold_usd': .1}}
    (out / 'integration-round-budget.json').write_text(json.dumps(budget))
    request = {'job': 'one', 'role': 'intent', 'system': 'Fixture', 'prompt': 'Test'}
    try:
        m.reserve_or_recover(request, False)
        raise AssertionError('Execution must be explicit')
    except RuntimeError:
        pass
    assert not list(out.glob('*-reservation-product-*.json'))
    file, receipt = m.reserve_or_recover(request, True)
    again, same = m.reserve_or_recover(request, True)
    assert same['lease_id'] == receipt['lease_id'] and file == again
    assert len(list(out.glob('*-reservation-product-*.json'))) == 1
    try:
        m.reserve_or_recover({**request, 'job': 'two'}, True)
        raise AssertionError('Budget must reject excess')
    except RuntimeError:
        pass
    assert len(list(out.glob('*-reservation-product-*.json'))) == 1
    assert m.request_identity(request) == m.request_identity(dict(reversed(list(request.items()))))
print('PASS: existing ledger ceiling, retained holds, duplicate reservation recovery, explicit execution, no Modal requests.')
# Roles and independent jobs may share a funded warm allocation. A stale or
# expiring allocation must obtain a fresh reservation, regardless of job identity.
with tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='agent-session-test-') as folder:
    root=Path(folder);out=root/'receipts';out.mkdir();(root/'modal').mkdir()
    (root/'modal/scenesmith_language_service.py').write_text('# fixture')
    m.ROOT,m.OUT=root,out;m.CREDIT_USD=.8
    m.product_hold=lambda:sum(json.loads(p.read_text())['reservation_usd'] for p in out.glob('*-reservation-product-*.json'))
    (out/'integration-round-budget.json').write_text(json.dumps({'approved_usd':1.,'reconciliation':{'model_check_retained_hold_usd':.1}}))
    request={'job':'shared','role':'intent','system':'fixture','prompt':'one'}
    file,record=m.reserve_language(request,True)
    p=out/record['receipt'];receipt=json.loads(p.read_text());receipt['status']='completed_pending_billing';m.atomic_json(p,receipt)
    session={'lease_id':record['lease_id'],'receipt':record['receipt'],'source_sha256':m.service_source_hash(),'allocation_deadline_utc':m.time.time()+600,'last_completed_utc':m.time.time()}
    m.atomic_json(m.session_file('shared'),session)
    child_file,child=m.reserve_language({**request,'role':'plan'},True)
    assert child['allocation_lease_id']==record['lease_id'] and child['lease_id']!=record['lease_id']
    assert json.loads((out/child['receipt']).read_text())['reservation_usd']==0
    assert m.product_hold()==.8
    assert m.reserve_language({**request,'role':'plan'},True)[1]==child
    for stale in ({**session,'last_completed_utc':m.time.time()-301},{**session,'allocation_deadline_utc':m.time.time()+60}):
        m.atomic_json(m.session_file('shared'),stale)
        try:m.reserve_language({**request,'role':'review'},True);raise AssertionError('Expired session reused')
        except RuntimeError:pass
    try:m.reserve_language({**request,'job':'different'},True);raise AssertionError('Expired session reused across jobs')
    except RuntimeError:pass
print('PASS: warm lease reuse, unchanged shared hold, call recovery, stale/expired refusal including across jobs.')
