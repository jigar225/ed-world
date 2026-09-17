"""Persistent private Qwen deployment, cold-started on demand like the foundry.

Deploying registers the cached image; min_containers=0 starts no GPU. A caller
must reserve a dollar-denominated lease before invoking the parameterized class.
There is no application deadline for waiting in Modal's GPU scheduling queue.
"""
import json
from pathlib import Path
import modal

APP_NAME='eduworld-scene-language'
GPU_FALLBACKS=['L40S','A100-40GB','A100-80GB','H100']
# CUDA/BF16-capable GPUs with >=40GB; no untested 24GB or Blackwell assumption.
MODEL='eduworld-qwen3-vl-8b'
MODEL_PATH='/data/hf/hub/models--Qwen--Qwen3-VL-8B-Instruct/snapshots/0c351dd01ed87e9c1b53cbc748cba10e6187ff3b'
# Highest configured GPU price, max CPU/RAM, and a margin for allocation overhead.
MAX_USD_PER_SECOND=.001097+4*.0000131+24*.00000222
ALLOCATION_HEADROOM_USD=.08
PLATFORM_MAX_SECONDS=86400
HERE=Path(__file__).resolve().parent
app=modal.App(APP_NAME)
volume=modal.Volume.from_name('eduworld-hyworld2-data')
image=(modal.Image.from_id('im-reNlG7hMpQyaY4j1OHvZMi')
    .add_local_file(HERE/'scenesmith_bridge.py','/opt/check/scenesmith_bridge.py',copy=True))


def allocated_rate(device):
    """Modal standard rates verified at https://modal.com/pricing, 2026-09-14."""
    if len(device.splitlines())!=1:raise ValueError('Expected one funded GPU')
    name,memory=device.rsplit(',',1)
    if 'L40S' in name:gpu=.000542
    elif 'A100' in name:gpu=.000694 if int(memory.strip().split()[0])>60000 else .000583
    elif 'H100' in name:gpu=.001097
    else:raise ValueError('Unrecognized GPU; refusing an unpriced allocation')
    return gpu+4*.0000131+24*.00000222


def paid_seconds(credit_usd,rate=MAX_USD_PER_SECOND):
    if not isinstance(credit_usd,(int,float)) or not .20<=credit_usd<=5:
        raise ValueError('A reserved GPU credit between $0.20 and $5 is required')
    if not 0<rate<=MAX_USD_PER_SECOND:raise ValueError('Invalid allocation rate')
    return (credit_usd-ALLOCATION_HEADROOM_USD)/rate


def language_request(payload):
    """Keep HTTP failures serializable across Modal RPC and preserve their cause."""
    import urllib.request,urllib.error
    request=urllib.request.Request('http://127.0.0.1:18082/v1/chat/completions',
        data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=None) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail=error.read(6000).decode(errors='replace')
        raise RuntimeError(f'Language HTTP {error.code}: {detail}') from None


def require_active_lease(worker):
    if getattr(worker,'exhausted_lease',False):
        from modal.experimental import stop_fetching_inputs
        stop_fetching_inputs()
        raise RuntimeError(getattr(worker,'startup_error',None) or 'This funded language lease was already consumed; no model was loaded')


def six_view_probe_payload():
    """Protocol images use stdlib only; the Modal wrapper has no Pillow install."""
    import base64,struct,zlib
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    content=[{'type':'text','text':'Return JSON with accepted_views set to 6.'}]
    for rgb in ((255,0,0),(0,128,0),(0,0,255),(255,255,0),(128,0,128),(255,165,0)):
        raw=(b'\0'+bytes(rgb)*64)*64
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,64,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
        content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(png).decode()}})
    return {'model':MODEL,'messages':[{'role':'user','content':content}],
        'response_format':{'type':'json_object'},'max_tokens':64,'temperature':0}


@app.cls(image=image,gpu=GPU_FALLBACKS,cpu=(2,4),memory=(4096,24576),
         min_containers=0,max_containers=1,buffer_containers=0,scaledown_window=300,
         timeout=PLATFORM_MAX_SECONDS,startup_timeout=PLATFORM_MAX_SECONDS,retries=0,
         volumes={'/data':volume})
@modal.concurrent(max_inputs=1)
class Language:
    lease_id:str=modal.parameter()
    credit_cents:int=modal.parameter()

    @modal.enter()
    def start(self):
        try:self.initialize()
        except Exception as error:
            self.exhausted_lease=True
            self.startup_error=f'{type(error).__name__}: {error}'
            if hasattr(self,'budget_timer'):self.budget_timer.cancel()
            if hasattr(self,'process'):self.process.terminate()
            if hasattr(self,'report'):
                self.report['error']=self.startup_error
                self.record('failed')

    def initialize(self):
        import os,signal,subprocess,threading,time,uuid,urllib.request,urllib.error
        uuid.UUID(self.lease_id)
        self.credit_usd=self.credit_cents/100
        paid_seconds(self.credit_usd)  # Validate credit before acquiring the lease.
        # Single-use allocation permit: a container restart requires a fresh
        # reservation. Repeated methods on the live container reuse the model.
        volume.reload()
        self.root=Path('/data/scenesmith-language-leases')/self.lease_id
        try:self.root.mkdir(parents=True,exist_ok=False)
        except FileExistsError:
            # A lifecycle exception makes Modal retry startup. Finish startup
            # without loading weights, then fail the input and drain this worker.
            self.exhausted_lease=True
            if (self.root/'report.json').exists():
                self.startup_error=json.loads((self.root/'report.json').read_text()).get('error')
            return
        self.started=time.monotonic();self.instance_id=uuid.uuid4().hex
        device=subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total','--format=csv,noheader'],text=True).strip()
        rate=allocated_rate(device);seconds=paid_seconds(self.credit_usd,rate)
        self.report={'lease_id':self.lease_id,'instance_id':self.instance_id,'credit_usd':self.credit_usd,
            'stage':'allocated','passed':False,'calls':0,'gpu_fallbacks':GPU_FALLBACKS,
            'allocation_utc':time.time()-(time.monotonic()-self.started),'queue_deadline':None,
            'gpu':device,'max_usd_per_second':rate}
        self.report['allocation_deadline_utc']=self.report['allocation_utc']+seconds
        def budget_exhausted():
            print('Reserved GPU dollars exhausted; ending this allocation. Deployment and weights remain saved.',flush=True)
            os._exit(70)
        self.budget_timer=threading.Timer(max(0,seconds-(time.monotonic()-self.started)),budget_exhausted);self.budget_timer.daemon=True;self.budget_timer.start()
        self.record('loading_model')
        self.log_path=self.root/'vllm.log';self.log=self.log_path.open('w')
        self.process=subprocess.Popen(['/usr/bin/python3.12','-m','vllm.entrypoints.openai.api_server',
            '--model',MODEL_PATH,'--served-model-name',MODEL,'--host','127.0.0.1','--port','18082',
            '--dtype','bfloat16','--max-model-len','32768','--max-num-seqs','1',
            '--gpu-memory-utilization','0.85','--enforce-eager','--enable-auto-tool-choice',
            '--tool-call-parser','hermes','--limit-mm-per-prompt','{"image":8,"video":0}'],
            stdout=self.log,stderr=subprocess.STDOUT,start_new_session=True)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while True:
            if self.process.poll() is not None:
                self.report['error']=self.log_path.read_text(errors='replace')[-8000:];self.record('failed')
                raise RuntimeError('vLLM startup failed: '+self.report['error'])
            try:
                with opener.open('http://127.0.0.1:18082/health',timeout=2) as response:
                    if response.status==200:break
            except (urllib.error.URLError,TimeoutError):pass
            time.sleep(1)
        self.report.update(gpu=device,startup_seconds=round(time.monotonic()-self.started,3))
        # Native asset validation sends six views together. Verify that actual
        # request shape during this funded cold start, before generating assets.
        probe=language_request(six_view_probe_payload())
        accepted=json.loads(probe['choices'][0]['message']['content'])
        if accepted.get('accepted_views')!=6:raise RuntimeError('Six-view request protocol check failed')
        self.report['six_view_request_verified']=True
        self.record('ready')

    def record(self,stage):
        import time
        self.report.update(stage=stage,allocated_seconds=round(time.monotonic()-self.started,3))
        (self.root/'report.json').write_text(json.dumps(self.report,indent=2)+'\n');volume.commit()
        print(json.dumps({k:self.report[k] for k in ('stage','lease_id','allocated_seconds')}),flush=True)

    @modal.method()
    def ready(self):
        require_active_lease(self)
        return dict(self.report)

    @modal.method()
    def complete(self,payload):
        require_active_lease(self)
        if payload.get('model')!=MODEL or payload.get('stream'):raise ValueError('Unsupported model request')
        payload={**payload,'max_tokens':min(payload.get('max_tokens',4096),4096)}
        self.report['calls']+=1
        return language_request(payload)

    @modal.method()
    def verify(self):
        require_active_lease(self)
        import subprocess
        result=subprocess.run(['/opt/scenesmith-sdk/bin/python','/opt/check/scenesmith_contract.py'],capture_output=True,text=True)
        file=Path('/tmp/scenesmith-contract.json')
        contract=json.loads(file.read_text()) if file.exists() else {}
        self.report.update(passed=result.returncode==0 and contract.get('passed') is True,
                           contract=contract,probe_error=result.stderr[-6000:])
        self.record('verified' if self.report['passed'] else 'verification_failed')
        return dict(self.report)

    @modal.exit()
    def close(self):
        import os,signal
        if hasattr(self,'process'):
            try:os.killpg(self.process.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            self.log.close()
        if hasattr(self,'report'):self.record('scaled_down')
