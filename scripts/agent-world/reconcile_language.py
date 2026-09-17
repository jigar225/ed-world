"""Retire one uncertain, idle allocation before a separately funded retry.

No model invocation. Uses the deployed service's existing single-use directory
guard to revoke this permit permanently. Never deletes receipts or frees holds.
"""
import argparse,datetime,fcntl,io,json,re
from pathlib import Path
import modal_reason as bridge

def reconcile(key, modal):
    if not re.fullmatch(r'[a-f0-9]{64}',key): raise ValueError('Invalid request digest')
    path=bridge.ROOT/'.cache/agent-world/rpc'/f'{key}.json'
    with (bridge.OUT/'product-budget.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        record=json.loads(path.read_text())
        if record['status']=='retired_before_retry':return record['reconciliation']
        if record['status']!='submitting' or record.get('call_id') or record.get('allocation_lease_id'):
            raise RuntimeError('Only an uncertain standalone allocation without a call ID can be retired here')
        receipt_path=bridge.OUT/record['receipt'];receipt=json.loads(receipt_path.read_text())
        if receipt['id']!=record['lease_id'] or receipt['source_sha256']!=bridge.service_source_hash() or receipt['app_name']!=bridge.APP:
            raise RuntimeError('Allocation source/receipt mismatch')
        function=modal.Cls.from_name(bridge.APP,'Language')(lease_id=record['lease_id'],credit_cents=80).complete
        stats=function.get_current_stats()
        if stats.backlog or stats.num_total_runners:raise RuntimeError('Allocation is queued or running; recover its call instead')
        volume=modal.Volume.from_name('eduworld-hyworld2-data')
        directory='scenesmith-language-leases/'+record['lease_id']
        marker_path=directory+'/retired.json'
        marker={'lease_id':record['lease_id'],'input_hash':key,'action':'revoke-unused-permit',
                'reason':'Uncertain submission; no queued inputs/runners or saved allocation directory',
                'time':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            entries=volume.listdir(directory)
        except (FileNotFoundError,modal.exception.NotFoundError):entries=None
        if entries is not None:
            # Recover an interrupted reconciliation only if our own marker is the
            # sole artifact. Any execution report/data requires manual call recovery.
            if len(entries)!=1 or Path(entries[0].path).name!='retired.json':raise RuntimeError('Allocation has remote artifacts; do not discard its outcome')
            marker=json.loads(b''.join(volume.read_file(marker_path)))
            if marker.get('input_hash')!=key or marker.get('lease_id')!=record['lease_id'] or marker.get('action')!='revoke-unused-permit':raise RuntimeError('Retirement marker mismatch')
        else:
            raw=json.dumps(marker,sort_keys=True).encode()
            with volume.batch_upload() as batch:batch.put_file(io.BytesIO(raw),marker_path)
        if json.loads(b''.join(volume.read_file(marker_path)))!=marker:raise RuntimeError('Remote permit retirement not verified')
        stats=function.get_current_stats()
        if stats.backlog or stats.num_total_runners:raise RuntimeError('Allocation changed during reconciliation; retain uncertain state')
        audit=bridge.ROOT/'.cache/agent-world/reconciliation'/f'{key}.json'
        bridge.atomic_json(audit,{'record_before':record,'receipt_before':receipt,'remote_marker':marker_path,
            'marker':marker,'after':{'backlog':stats.backlog,'runners':stats.num_total_runners},'original_hold_retained':True})
        receipt['status']='retired_pending_billing';receipt['reconciliation']=str(audit.relative_to(bridge.ROOT))
        bridge.atomic_json(receipt_path,receipt)
        record.update(status='retired_before_retry',reconciliation=receipt['reconciliation'])
        bridge.atomic_json(path,record)
        return receipt['reconciliation']

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('digest');parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:raise SystemExit('Explicit --execute is required to retire the remote permit')
    import modal
    try:print(json.dumps({'audit':reconcile(args.digest,modal),'model_calls':0,'holds_released':0}))
    except Exception as e:print(json.dumps({'error_type':type(e).__name__,'action':'Reconciliation incomplete; retain uncertain state and holds'}));raise SystemExit(1)
