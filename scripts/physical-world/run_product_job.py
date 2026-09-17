"""Product integration jobs inside the recorded total Modal allowance."""
import argparse
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import uuid
import fcntl

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts/out/physical-world"
MAX_AUTHORIZED_USD = 59.0  # User added $10 to the existing $49 total on September 17.

def authorized_limit(budget):
    value=budget.get('approved_usd')
    if not isinstance(value,(int,float)) or not 0<value<=MAX_AUTHORIZED_USD:
        raise ValueError('Invalid recorded spending authorization')
    return value

def validate_build_recovery(run_id,receipt,apps):
    """Only an app that never registered executable functions may be resubmitted."""
    if receipt['id']!=run_id or receipt['stage']!='generate-world' or receipt['status'] not in ('failed_or_ambiguous','interrupted_or_ambiguous'):
        raise ValueError('Build recovery requires a terminated launcher receipt')
    if receipt.get('build_history'):raise ValueError('Repeated build recovery requires a new review')
    for folder in ('world-calls','world-model-calls'):
        if (OUT/folder/f'{run_id}.json').exists():raise ValueError('A model/world call exists; recover its result instead')
    submission=json.loads((OUT/'world-submissions'/f'{run_id}.json').read_text())
    audit=json.loads((OUT/f'interrupted-build-{run_id}.json').read_text())
    app_id=submission.get('app_id')
    app=next((app for app in apps if app['app_id']==app_id),None)
    if submission.get('run_id')!=run_id or audit.get('app_id')!=app_id or audit.get('registered_functions')!={}:
        raise ValueError('Missing proof of interruption before function registration')
    if not app or app['state']!='stopped' or int(app['tasks']):raise ValueError('Previous build is not stopped')
    return app_id

JOBS = {"refine-world":{"module":"modal/hyworld2_refine.py","reservation_usd":3.50},
        "native-hd-pano":{"module":"modal/hyworld2_native_hd.py","reservation_usd":1.50},
        "native-hd-world":{"module":"modal/hyworld2_native_hd.py","reservation_usd":7.50},
        "hd-world":{"module":"modal/hyworld2_polish.py","reservation_usd":2.80},
        "superres-trial":{"module":"modal/hyworld2_superres.py","reservation_usd":.45},
        "polish-world":{"module":"modal/hyworld2_polish.py","reservation_usd":1.80},
        "inspect-quality":{"module":"modal/hyworld2_inspect_quality.py","reservation_usd":.15},
        "segment-world":{"module":"modal/segment_world.py","reservation_usd":.65},
        "native-preflight": {"module": "modal/scenesmith_native.py", "reservation_usd": 1.0},
        "prepare-models": {"module":"modal/scenesmith_prepare.py", "reservation_usd":0.15},
        "geometry-setup": {"module":"modal/scenesmith_geometry_setup.py", "reservation_usd":0.75},
        "prepare-aux": {"module":"modal/scenesmith_prepare_aux.py", "reservation_usd":0.10},
        "generate-world": {"module":"modal/scenesmith_product.py", "reservation_usd":2.25}}

KNOWN_APPS = {("native-preflight",1):"ap-DkBspBAP8cWqHUAFh4uyN6",
    ("native-preflight",2):"ap-HSybjz1ZqHrwW98RyZKp6p",("prepare-models",1):"ap-u036EhqXLIRRdY1GeqT6T7",
    ("prepare-models",2):"ap-hrZDKJxTvIomXFwrYMjtT7",("geometry-setup",1):"ap-8i17YRKjsVsHlU724saRbt",
    ("geometry-setup",2):"ap-i0pmDZyS8kl5JCi46DAfbr",("geometry-setup",3):"ap-tLacX8HhMt7bOY89BsTon0",
    ("prepare-aux",1):"ap-YaCYWSKeWkPD2ne593OYzP",("prepare-aux",2):"ap-9Ak8qw48qYv26VXYQNSrQg",
    ("generate-world",1):"ap-iJ9O7BJ8G4ZOD0mKUdQrn6"}


def uninvoked_model_credit(receipt,app_id):
    """Release only provably uninvoked model roles, retaining native/build money.

    These $2.25 jobs reserve language .80, images .30, geometry .65, native
    .40 and headroom .10. Missing provider billing is still unknown. A stopped
    pre-registration build keeps the entire .50 native/build/headroom reserve.
    """
    if receipt.get('stage')!='generate-world' or receipt.get('reservation_usd') not in (2.20,2.25):
        return 0
    run_id=receipt['id']
    dependency_path=OUT/'world-model-calls'/f'{run_id}.json'
    warm_audit=OUT/f'language-warm-failure-{run_id}.json'
    if dependency_path.exists() and warm_audit.exists() and not (OUT/'world-calls'/f'{run_id}.json').exists():
        dependency=json.loads(dependency_path.read_text());audit=json.loads(warm_audit.read_text())
        errors=[call.get('recovery_error','') for call in audit.get('calls',[])]
        if (dependency.get('stage')=='waiting_for_language' and dependency.get('app_id')==app_id
                and audit.get('app_id')==app_id and any(error.startswith(('RuntimeError:','CancelledError:','FunctionCancelledError:')) for error in errors)):
            # The launcher records language ready BEFORE requesting native, image
            # or geometry work. Keep language and miscellaneous headroom; none
            # of these three downstream allocations was invoked.
            return 1.35
    audit_path=OUT/f'interrupted-build-{run_id}.json'
    if audit_path.exists():
        audit=json.loads(audit_path.read_text())
        if audit.get('app_id')==app_id and audit.get('registered_functions')=={} and not receipt.get('build_history'):
            if all(not (OUT/folder/f'{run_id}.json').exists() for folder in ('world-calls','world-model-calls')):
                return 1.75
    result_path=OUT/'world-calls'/f'{run_id}-report.json'
    if result_path.exists():
        result=json.loads(result_path.read_text())
        if result.get('run_id')==run_id and result.get('stage')=='failed':
            counts=result.get('counts',{})
            return (.30 if counts.get('/image')==0 else 0)+(.65 if counts.get('/geometry')==0 else 0)
    return 0


def reconcile_product_holds():
    """Release estimates only for confirmed stopped jobs; preserve original receipts."""
    command = str(ROOT/".venv-foundry/bin/modal")
    apps = json.loads(subprocess.check_output([command,"app","list","--json"],text=True))
    now = datetime.datetime.now(datetime.timezone.utc)
    end = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    # Modal reports complete query buckets only. Include the current whole hour
    # in the range, while retaining margins for its provisional/lagged charges.
    query_end=(now.replace(minute=0,second=0,microsecond=0)+datetime.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = json.loads(subprocess.check_output([command,"billing","report","--start","2026-09-13T06:00:00Z",
        "--end",query_end,"--resolution","h","--show-resources","--json"],text=True))
    previous_path=OUT/'product-billing-reconciliation.json'
    previous=json.loads(previous_path.read_text()) if previous_path.exists() else {}
    # Modal's app list omits older apps. Retain the observed terminal state for
    # those immutable one-shot runs, while current evidence always takes priority.
    stopped={a['app_id']:a for a in previous.get('apps',[]) if a['state']=='stopped' and not int(a['tasks'])}
    stopped.update({a['app_id']:a for a in apps})
    report = {"read_utc":end,"query_end_utc":query_end,"rows":rows,"apps":list(stopped.values()),"receipts":{}}
    for path in OUT.glob("*-reservation-product-*.json"):
        receipt = json.loads(path.read_text())
        app_id = KNOWN_APPS.get((receipt["stage"],receipt.get("attempt",1)))
        if receipt['stage']=='generate-world':
            # Every queued world has attempt=1. Match its UUID, never another
            # world's attempt number, before releasing a paid-job reservation.
            app_id={'26302374-ec49-42d8-9a5b-5ec0c1799c65':'ap-iJ9O7BJ8G4ZOD0mKUdQrn6'}.get(receipt['id'])
            for candidate in (OUT/'world-calls'/f'{receipt["id"]}.json',OUT/'world-submissions'/f'{receipt["id"]}.json'):
                if candidate.is_file():
                    saved=json.loads(candidate.read_text())
                    if saved.get('run_id')==receipt['id']:app_id=saved.get('app_id')
        allocation=None
        if receipt['stage']=='language-service':
            # This deployment intentionally stays registered after its GPU exits.
            # Release the lease hold only with a matching saved exit report AND
            # a fresh zero-container audit. Bill the entire shared app here;
            # never divide its aggregate charges by guessed lease durations.
            app_id=next((a['app_id'] for a in apps if a['description']==receipt.get('app_name')),None)
            evidence=OUT/f'language-service-allocation-{receipt["id"]}.json'
            if evidence.is_file():allocation=json.loads(evidence.read_text())
        if receipt['stage'] in ('segment-world','refine-world','inspect-quality','polish-world','superres-trial','hd-world','native-hd-pano','native-hd-world'):
            evidence=OUT/(receipt['stage']+'-calls')/f"{receipt['id']}.json"
            if evidence.exists():app_id=json.loads(evidence.read_text()).get('app_id')
        app = stopped.get(app_id)
        lease_closed=allocation and allocation.get('lease_id')==receipt['id'] and allocation.get('stage')=='scaled_down'
        if app and (app["state"]=="stopped" or lease_closed) and not int(app["tasks"]) and receipt["status"] not in ("reserved","submitting","submitted"):
            app_ids={app_id,*[entry['app_id'] for entry in receipt.get('build_history',[])]}
            app_rows=[row for row in rows if row['object_id'] in app_ids]
            # Missing billing rows mean unknown, not free. Keep the full
            # reservation until the provider has reported this stopped job.
            if {row['object_id'] for row in app_rows}!=app_ids:
                unused=uninvoked_model_credit(receipt,app_id)
                if unused:
                    report['receipts'][path.name]={'app_id':app_id,
                        'hold_usd':receipt['reservation_usd']-unused,
                        'uninvoked_model_credit_usd':unused,'billing_incomplete':True,
                        'note':'Only uninvoked model roles released; native/build and other roles retained'}
                continue
            billed = sum(float(row["cost"]) for row in app_rows)
            # Keep $0.10 for each stopped app in addition to reported compute,
            # including reporting lag and retained checkpoints/image storage.
            report["receipts"][path.name]={"app_id":app_id,"reported_usd":billed,
                "hold_usd":billed+0.10}
    # The persistent language app is billed once in its aggregate receipt. Do
    # not also retain the same .80 language role in a partially reconciled world.
    language_app=next((a for a in apps if a['description']=='eduworld-scene-language' and not int(a['tasks'])),None)
    language_accounted=language_app and any(entry.get('app_id')==language_app['app_id'] and 'reported_usd' in entry
                                            for entry in report['receipts'].values())
    if language_accounted:
        for name,entry in report['receipts'].items():
            if not entry.get('billing_incomplete'):continue
            receipt=json.loads((OUT/name).read_text());run_id=receipt['id']
            dependency=OUT/'world-model-calls'/f'{run_id}.json'
            allocation=OUT/f'language-service-allocation-{run_id}.json'
            if not dependency.exists() or not allocation.exists():continue
            call=json.loads(dependency.read_text());lease=json.loads(allocation.read_text())
            if (call.get('run_id')==run_id and call.get('language_lease')=={'lease_id':run_id,'credit_cents':80}
                    and lease.get('lease_id')==run_id and lease.get('credit_usd')==.8
                    and isinstance(lease.get('allocation_utc'),(int,float)) and lease['allocation_utc']<now.timestamp()):
                entry['hold_usd']-=.8
                entry['language_accounted_by']=language_app['app_id']
                entry['note']='Language counted in shared app billing; uninvoked roles released; native/build reserve retained'
    (OUT/"product-billing-reconciliation.json").write_text(json.dumps(report,indent=2)+"\n")
    return report


def product_hold():
    path=OUT/"product-billing-reconciliation.json"
    reconciled=json.loads(path.read_text())["receipts"] if path.exists() else {}
    return sum(reconciled.get(p.name,{}).get("hold_usd",json.loads(p.read_text())["reservation_usd"])
               for p in OUT.glob("*-reservation-product-*.json"))


def digest(stage):
    h = hashlib.sha256()
    extra=["modal/scenesmith_native_probe.py"] if stage=="native-preflight" else []
    if stage in ('native-hd-pano','native-hd-world'):extra=['modal/hyworld2_native_hd_worker.py','scripts/out/hyworld2/native-hd-request.json']
    if stage=='segment-world':extra=['modal/segment_world_worker.py','scripts/out/hyworld2/motion-input/manifest.json']
    if stage=='refine-world':extra=['modal/hyworld2_world.py','modal/hyworld2_refine_worker.py','scripts/out/hyworld2/quality-request.json']
    if stage=='inspect-quality':extra=['modal/hyworld2_world.py','scripts/out/hyworld2/quality-inspection-request.json']
    if stage=='polish-world':extra=['modal/hyworld2_world.py','modal/hyworld2_polish_worker.py','modal/hyworld2_hd_sources.py','scripts/out/hyworld2/polish-request.json']
    if stage=='hd-world':extra=['modal/hyworld2_polish_worker.py','modal/hyworld2_hd_sources.py','scripts/out/hyworld2/hd-request.json']
    if stage=='superres-trial':extra=['modal/hyworld2_world.py']
    if stage=='generate-world':
        extra=['modal/'+n for n in ('scenesmith_bridge.py','scenesmith_runtime.py','scenesmith_product_config.py',
            'scenesmith_images.py','scenesmith_vlm_client.py','scenesmith_native_worker.py','scenesmith_geometry_worker.py','scenesmith_native_compat.py','scenesmith_language_service.py','scenesmith_asset_reuse.py')]
        extra+=['scripts/physical-world/'+n for n in ('export_world.py','export_sdf.py')]
        extra+=['scripts/out/physical-world/'+n for n in ('geometry-setup-report.json','prepare-aux-report.json')]
    for name in [JOBS[stage]["module"], *extra]:
        h.update(name.encode())
        h.update((ROOT / name).read_bytes())
    return h.hexdigest()


def validate_receipt(stage):
    path = Path(os.environ.get("EDUWORLD_PRODUCT_RECEIPT", ""))
    if path.parent != OUT or not path.name.startswith(stage + "-reservation-"):
        raise RuntimeError("Use the product launcher with a recorded reservation")
    receipt = json.loads(path.read_text())
    if receipt["status"] != "reserved" or receipt["source_sha256"] != digest(stage):
        raise RuntimeError("Consumed or mismatched product reservation")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=JOBS)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--resume-build",action="store_true",help="Reuse an unconsumed reservation after verified pre-registration build interruption")
    parser.add_argument('--resume-from',type=uuid.UUID,help='Copy a stopped world floor-plan checkpoint into a new funded job')
    parser.add_argument("--reconcile", action="store_true",help="Read billing and stopped-job evidence before reserving")
    parser.add_argument("--job-id",type=uuid.UUID,help="Durable local product job ID; never resubmit the same ID")
    parser.add_argument("--prompt-file",type=Path,help="UTF-8 world description supplied by the local product worker")
    parser.add_argument("--attempt", type=int, choices=(1, 2, 3), default=1)
    args = parser.parse_args()
    if args.stage=='generate-world' and args.execute and not (args.job_id and args.prompt_file):
        parser.error('World generation requires --job-id and --prompt-file for the actual scenario; there is no default demonstration world')
    if args.resume_build and not (args.execute and args.job_id and args.prompt_file):
        parser.error('--resume-build requires --execute, --job-id and --prompt-file')
    if args.resume_from and (args.resume_build or not args.job_id or not args.prompt_file or args.resume_from==args.job_id):
        parser.error('--resume-from requires a new job ID and its unchanged prompt, without --resume-build')
    prompt=None
    if args.job_id or args.prompt_file:
        if args.stage!='generate-world' or not args.job_id or not args.prompt_file or args.attempt!=1:
            raise SystemExit('A product job requires its ID, prompt file and a fresh world submission')
        if args.prompt_file.stat().st_size>6400:raise SystemExit('World description is too long')
        prompt=args.prompt_file.read_text().strip()
        if not 1<=len(prompt)<=1600:raise SystemExit('Invalid world description')
    lock=(OUT/"product-budget.lock").open("a")
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.reconcile:
        reconcile_product_holds()
        budget_path=OUT/'integration-round-budget.json'
        current=json.loads(budget_path.read_text());current['product_reserved_usd']=product_hold()
        current['unreserved_usd']=current['approved_usd']-current.get('reconciliation',{}).get('model_check_retained_hold_usd',0.5)-current['product_reserved_usd']
        budget_path.write_text(json.dumps(current,indent=2)+'\n')
    plan = dict(JOBS[args.stage])
    if args.resume_from:
        # $.80 language + $.20 images + $.65 geometry + $.40 native, plus
        # $.05 miscellaneous headroom. Each
        # allocation also has its own $.04/$.08 shutdown margin within its cap.
        plan['reservation_usd']=2.10
        plan['image_credit_cents']=20
    if args.attempt >= 2:
        if args.attempt == 3 and args.stage not in ("geometry-setup","generate-world","refine-world"):
            raise SystemExit("No third repair is reviewed for this stage")
        if args.stage not in ("native-preflight","prepare-models","geometry-setup","prepare-aux","generate-world","segment-world","refine-world","superres-trial","native-hd-pano","native-hd-world"):
            raise SystemExit("Only reviewed native/download repairs have a second attempt")
        plan["reservation_usd"] = {"native-preflight":0.5,"prepare-models":0.10,"geometry-setup":0.45,"prepare-aux":0.10,"generate-world":2.25,"segment-world":.65,"refine-world":3.50,"superres-trial":.45,"native-hd-pano":1.50,"native-hd-world":7.50}[args.stage]
    budget = json.loads((OUT / 'integration-round-budget.json').read_text())
    print(json.dumps({"stage": args.stage, **plan, "scenario":prompt,"total_authorized_usd": authorized_limit(budget),
                      "execution": "Modal only; no public deployment"}), flush=True)
    if not args.execute:
        return
    if args.resume_from:
        original=json.loads((OUT/'world-calls'/f'{args.resume_from}-report.json').read_text())
        saved=json.loads((OUT/'world-calls'/f'{args.resume_from}.json').read_text())
        apps=json.loads(subprocess.check_output([str(ROOT/'.venv-foundry/bin/modal'),'app','list','--json'],text=True))
        if original.get('run_id')!=str(args.resume_from) or original.get('stage')!='failed':
            raise SystemExit('Checkpoint source must be a recorded failed world')
        if not any(a['app_id']==saved['app_id'] for a in apps):
            prior_audit=json.loads((OUT/'product-billing-reconciliation.json').read_text())
            apps.extend(a for a in prior_audit['apps'] if a['app_id']==saved['app_id'])
        if not any(a['app_id']==saved['app_id'] and a['state']=='stopped' and not int(a['tasks']) for a in apps):
            raise SystemExit('Checkpoint source is not confirmed stopped')
    # Preserve all old receipts. Reconcile their combined hold once from billing
    # evidence, with headroom for reporting lag; do not erase historical entries.
    budget_path = OUT / "integration-round-budget.json"
    budget = json.loads(budget_path.read_text())
    audit = json.loads((OUT / "model-check-final-stop-audit.json").read_text())
    prior = [a for a in audit if a["description"] == "eduworld-scenesmith-model-check"]
    if len(prior) != 7 or any(a["state"] != "stopped" or int(a["tasks"]) for a in prior):
        raise SystemExit("All previous model checks must be confirmed stopped")
    rows = json.loads((OUT / "model-check-billing-report.json").read_text())
    billed = sum(float(r["cost"]) for r in rows if r["object_id"] in {a["app_id"] for a in prior})
    hold = max(0.5, billed + 0.3)
    used = product_hold()
    previous_receipt=None;previous_app=None;reused_hold=0
    if args.resume_build:
        previous_path=OUT/f'generate-world-reservation-product-{args.job_id}.json'
        previous_receipt=json.loads(previous_path.read_text())
        apps=json.loads(subprocess.check_output([str(ROOT/'.venv-foundry/bin/modal'),'app','list','--json'],text=True))
        previous_app=validate_build_recovery(str(args.job_id),previous_receipt,apps)
        reconciled_path=OUT/'product-billing-reconciliation.json'
        reconciliation=json.loads(reconciled_path.read_text()) if reconciled_path.exists() else {'receipts':{}}
        reused_hold=reconciliation['receipts'].get(previous_path.name,{}).get('hold_usd',previous_receipt['reservation_usd'])
    if hold + used - reused_hold + plan["reservation_usd"] > authorized_limit(budget):
        raise SystemExit("Product job exceeds the remaining authorized allowance")
    previous = list(OUT.glob(f"{args.stage}-reservation-product-*.json"))
    if args.job_id:
        if not args.resume_build and any(json.loads(p.read_text())["id"]==str(args.job_id) for p in previous):
            raise SystemExit('A receipt exists for this job. Recover its original call instead of resubmitting.')
    elif len(previous) != args.attempt-1:
        raise SystemExit("Attempt count does not match existing stage receipts")
    if args.attempt >= 2:
        if any(json.loads(p.read_text())["status"] in ("reserved", "completed_pending_billing") for p in previous):
            raise SystemExit("Previous job is active or complete; do not repeat")
        apps = json.loads(subprocess.check_output([str(ROOT / ".venv-foundry/bin/modal"), "app", "list", "--json"], text=True))
        quality_prior = json.loads((OUT/(args.stage+'-calls')/f"{max((json.loads(p.read_text()) for p in previous),key=lambda r:r['attempt'])['id']}.json").read_text())['app_id'] if args.stage in ('refine-world','superres-trial','native-hd-pano','native-hd-world') else None
        prior_app = {"native-preflight":"ap-DkBspBAP8cWqHUAFh4uyN6", "prepare-models":"ap-u036EhqXLIRRdY1GeqT6T7",
                     "geometry-setup":"ap-8i17YRKjsVsHlU724saRbt","prepare-aux":"ap-YaCYWSKeWkPD2ne593OYzP",
                     "generate-world":"ap-iJ9O7BJ8G4ZOD0mKUdQrn6",
                     "segment-world":json.loads((OUT/'segment-world-call.json').read_text()).get('app_id') if args.stage=='segment-world' else None,
                     "refine-world":quality_prior,"superres-trial":quality_prior,"native-hd-pano":quality_prior,"native-hd-world":quality_prior}[args.stage]
        if args.attempt == 3:
            prior_app = {"geometry-setup":"ap-i0pmDZyS8kl5JCi46DAfbr","generate-world":"ap-DRO9ghwhyTiFgwdGmMAQNg","refine-world":quality_prior}[args.stage]
        original = next(a for a in apps if a["app_id"] == prior_app)
        if original["state"] != "stopped" or int(original["tasks"]) != 0:
            raise SystemExit("First native build is not confirmed stopped")
        (OUT / (args.stage+"-first-stop-audit.json")).write_text(json.dumps(original, indent=2)+"\n")
    source = ROOT / ".cache/upstream/scenesmith"
    if subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() != "67cc408fd38334b4a926efef45e284302ed5055b":
        raise SystemExit("Unexpected SceneSmith revision")
    if subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).strip():
        raise SystemExit("Upstream checkout was modified")
    run_id = str(args.job_id or uuid.uuid4())
    receipt = {"id": run_id, "stage": args.stage, "attempt": args.attempt, **plan, "status": "reserved",
               "source_sha256": digest(args.stage), "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if prompt is not None:
        receipt['scenario_prompt']=prompt
        receipt['scenario_sha256']=hashlib.sha256(prompt.encode()).hexdigest()
    if args.resume_from:receipt['resume_from']=str(args.resume_from)
    path = OUT / f"{args.stage}-reservation-product-{run_id}.json"
    if previous_receipt:
        receipt['build_history']=[{**previous_receipt,'app_id':previous_app}]
        reconciliation['receipts'].pop(path.name,None)
        reconciled_path.write_text(json.dumps(reconciliation,indent=2)+'\n')
    with path.open('w' if previous_receipt else 'x') as handle:
        handle.write(json.dumps(receipt, indent=2) + "\n")
    budget["reconciliation"] = {"model_check_reported_usd": billed, "model_check_retained_hold_usd": hold,
        "evidence": "model-check-billing-report.json", "note": "Reporting may lag; original receipts preserved"}
    budget["product_reserved_usd"] = used - reused_hold + plan["reservation_usd"]
    budget["unreserved_usd"] = budget["approved_usd"] - hold - budget["product_reserved_usd"]
    budget["actual_billing"] = "Read from model-check and product billing evidence; retained holds include reporting lag."
    budget_path.write_text(json.dumps(budget, indent=2) + "\n")
    fcntl.flock(lock,fcntl.LOCK_UN)
    lock.close()
    env = dict(os.environ, EDUWORLD_PRODUCT_RECEIPT=str(path))
    try:
        command=[str(ROOT / ".venv-foundry/bin/modal"), "run", "--detach", plan["module"]]
        if prompt is not None:command+=['--prompt',prompt]
        result = subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT,text=True,bufsize=1)
        for line in result.stdout:
            print(line,end='',flush=True)
            match=re.search(r'modal\.com/apps/[^/]+/main/(ap-[A-Za-z0-9]+)',line)
            if match and args.stage=='generate-world':
                submission_dir=OUT/'world-submissions';submission_dir.mkdir(exist_ok=True)
                (submission_dir/f'{run_id}.json').write_text(json.dumps({'run_id':run_id,'app_id':match[1]})+'\n')
        code=result.wait()
        receipt["exit_code"] = code
        receipt["status"] = "completed_pending_billing" if code == 0 else "failed_or_ambiguous"
    except BaseException:
        receipt["status"] = "interrupted_or_ambiguous"
        raise
    finally:
        path.write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
