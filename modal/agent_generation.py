"""On-demand generation services. Deploy last; importing this source starts no GPU.

Reuses the FLUX/TRELLIS image recipes and weight volumes. Each funded lease has a
persistent result, private Modal RPC and one active input. Legacy endpoints remain
untouched. A dollar-derived guard bounds allocation, not queue/cold-start waiting.
"""
import importlib.util
import sys
import json
from pathlib import Path
import modal

HERE = Path(__file__).resolve().parent
if not (HERE / 'flux_ref_app.py').exists(): HERE = Path('/opt/agent')
app = modal.App('eduworld-agent-generation')
outputs = modal.Volume.from_name('eduworld-agent-artifacts', create_if_missing=True)

def recipe(filename):
    spec = importlib.util.spec_from_file_location('_agent_' + Path(filename).stem, HERE / filename)
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module)
    return module.image

def runtime(image):
    for name in ['agent_generation.py','agent_generation_runtime.py','flux_ref_app.py','trellis2_app.py','terrain-requirements.txt','prepare_terrain_data.py']:
        image = image.add_local_file(HERE / name, '/opt/agent/' + name, copy=True)
    return image

flux_image = runtime(recipe('flux_ref_app.py'))
object_image = runtime(recipe('trellis2_app.py'))
TERRAIN_COMMIT = 'e8dcb4b1a834ab2f6b1a6f5256ed7c9f2f3e8230'
terrain_image = runtime(modal.Image.from_registry('nvidia/cuda:12.4.1-devel-ubuntu22.04', add_python='3.11')
    .apt_install('git', 'libgl1', 'libglib2.0-0')
    .pip_install('torch==2.6.0', 'torchvision==0.21.0', index_url='https://download.pytorch.org/whl/cu124')
    .run_commands('git init /opt/terrain-diffusion', 'git -C /opt/terrain-diffusion remote add origin https://github.com/xandergos/terrain-diffusion.git',
        f'git -C /opt/terrain-diffusion fetch --depth 1 origin {TERRAIN_COMMIT}', f'git -C /opt/terrain-diffusion checkout {TERRAIN_COMMIT}')
    .pip_install_from_requirements(HERE / 'terrain-requirements.txt')
    .env({'PYTHONPATH':'/opt/terrain-diffusion', 'HF_HOME':'/weights/hf'})
    .add_local_file(HERE / 'prepare_terrain_data.py', '/opt/agent/prepare_terrain_data.py', copy=True)
    .run_commands('cd /opt/terrain-diffusion && python /opt/agent/prepare_terrain_data.py'))

# CPU/RAM bounds plus the highest selected GPU rate; standard prices checked Sept 14.
RATE = .000542 + 8 * .0000131 + 32 * .00000222

class Generator:
    lease_id: str = modal.parameter()
    credit_cents: int = modal.parameter()

    @modal.enter()
    def start(self):
        import os, sys, threading, uuid
        uuid.UUID(self.lease_id)
        if not 20 <= self.credit_cents <= 500: raise ValueError('Invalid funded lease')
        import time, subprocess
        self.started = time.monotonic()
        self.failed = True
        # Start a conservative guard before volume/model I/O, then use the allocated GPU rate.
        seconds = (self.credit_cents / 100 - .10) / RATE
        self.timer = threading.Timer(seconds, lambda: os._exit(70)); self.timer.daemon = True; self.timer.start()
        device = subprocess.check_output(['nvidia-smi','--query-gpu=name','--format=csv,noheader'],text=True).strip()
        gpu_rate = .000542 if 'L40S' in device else .000222 if device in ('NVIDIA L4','L4') else None
        if gpu_rate is None: return
        self.timer.cancel()
        rate = gpu_rate + 8 * .0000131 + 32 * .00000222
        seconds = (self.credit_cents / 100 - .10) / rate - (time.monotonic() - self.started)
        self.timer = threading.Timer(max(0,seconds), lambda: os._exit(70)); self.timer.daemon = True; self.timer.start()
        self.folder = Path('/data/leases') / self.lease_id
        outputs.reload()
        if self.folder.exists(): return
        self.folder.mkdir(parents=True)
        (self.folder / 'allocation.json').write_text(json.dumps({'gpu':device,'rate':rate,'credit_cents':self.credit_cents,'started_utc':time.time()}))
        outputs.commit()
        try:
            sys.path.insert(0, '/opt/agent')
            from agent_generation_runtime import Backend
            self.backend = Backend(self.kind)
            modal.Volume.from_name(self.weight_volume).commit()
            self.failed = False
        except Exception as error:
            print("Terrain/backend startup failed:", type(error).__name__, str(error)[:600], flush=True)
            (self.folder / 'failed.json').write_text(json.dumps({'status':'startup-failed'})); outputs.commit()
            # Complete startup without automatic repeated model loads.

    @modal.method()
    def generate(self, payload):
        import hashlib
        from modal.experimental import stop_fetching_inputs
        try:
            if self.failed: raise RuntimeError('Generation lease failed or was already consumed')
            self.failed = True
            data, extension = self.backend.generate(payload)
            if len(data) > 128 * 1024 * 1024: raise ValueError('Artifact too large')
            digest = hashlib.sha256(data).hexdigest()
            (self.folder / ('result.' + extension)).write_bytes(data)
            (self.folder / 'result.json.meta').write_text(json.dumps({'sha256':digest,'extension':extension,'bytes':len(data)}))
            outputs.commit()
            return {'data':data,'extension':extension,'sha256':digest}
        finally:
            stop_fetching_inputs()

def service(image, weight_volume):
    return app.cls(image=image, secrets=[modal.Secret.from_name('huggingface')], gpu=['L4','L40S'], cpu=(2,8), memory=(4096,32768),
        volumes={'/weights':modal.Volume.from_name(weight_volume, create_if_missing=True), '/data':outputs},
        min_containers=0, max_containers=1, buffer_containers=0, scaledown_window=2,
        timeout=86400, startup_timeout=86400, retries=0)

@service(flux_image, 'flux-ref-weights')
@modal.concurrent(max_inputs=1)
class Reference(Generator):
    lease_id: str = modal.parameter()
    credit_cents: int = modal.parameter()
    kind = 'reference'
    weight_volume = 'flux-ref-weights'

@service(object_image, 'trellis2-weights')
@modal.concurrent(max_inputs=1)
class Object(Generator):
    lease_id: str = modal.parameter()
    credit_cents: int = modal.parameter()
    kind = 'object'
    weight_volume = 'trellis2-weights'

@service(terrain_image, 'eduworld-terrain-weights')
@modal.concurrent(max_inputs=1)
class Terrain(Generator):
    lease_id: str = modal.parameter()
    credit_cents: int = modal.parameter()
    kind = 'terrain'
    weight_volume = 'eduworld-terrain-weights'
