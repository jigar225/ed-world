"""Terrain service deployed independently, using the same cached class lifecycle as FLUX/TRELLIS."""
from pathlib import Path
import sys
import modal
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE if (HERE / 'agent_generation.py').exists() else Path('/opt/agent')))
from agent_generation import terrain_image, Generator, outputs
app = modal.App('eduworld-terrain')

@app.cls(image=terrain_image, secrets=[modal.Secret.from_name('huggingface')],
    gpu=['L4','L40S'], cpu=(2,8), memory=(4096,32768),
    volumes={'/weights':modal.Volume.from_name('eduworld-terrain-weights',create_if_missing=True),'/data':outputs},
    min_containers=0, max_containers=1, buffer_containers=0, scaledown_window=2,
    timeout=86400, startup_timeout=86400, retries=0)
@modal.concurrent(max_inputs=1)
class Terrain(Generator):
    lease_id: str = modal.parameter()
    credit_cents: int = modal.parameter()
    kind = 'terrain'
    weight_volume = 'eduworld-terrain-weights'
