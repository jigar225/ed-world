"""GPU-only backends. Imported by the remote class, never by the Mac runner."""
import hashlib
import io
import json
import math

TERRAIN_MODEL = 'xandergos/terrain-diffusion-30m'
TERRAIN_REVISION = '9ef8030cb805b433b98ec25c5dddefbac07a9e26'


def terrain_shape(plan):
    if plan.get('representation') != 'heightfield':
        raise ValueError('This model does not generate caves or volume terrain')
    extent = plan['extentMeters']
    if len(extent) != 2 or any(not isinstance(v, (float, int)) or not math.isfinite(v) or v < 30 or v > 7680 or abs(v / 30 - round(v / 30)) > 1e-7 for v in extent):
        raise ValueError('Terrain 30m adapter requires 30–7680m extents in multiples of 30m; no silent rescaling')
    grid = plan['conditioning']
    if any(not isinstance(grid[k], int) or not 2 <= grid[k] <= 16 for k in ('width', 'height')) or len(grid['elevations']) != grid['width'] * grid['height']:
        raise ValueError('Invalid terrain conditioning')
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or not -20000 <= v <= 100000 for v in grid['elevations']):
        raise ValueError('Invalid terrain elevation')
    return round(extent[0] / 30) + 1, round(extent[1] / 30) + 1


class Backend:
    def __init__(self, kind):
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA is required; local/CPU inference is disabled')
        self.kind, self.torch = kind, torch
        if kind == 'reference':
            from diffusers import Flux2KleinPipeline
            self.pipeline = Flux2KleinPipeline.from_pretrained('black-forest-labs/FLUX.2-klein-4B', torch_dtype=torch.bfloat16).to('cuda')
        elif kind == 'object':
            from trellis2.pipelines import Trellis2ImageTo3DPipeline
            self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained('microsoft/TRELLIS.2-4B')
            self.pipeline.cuda()
        elif kind == 'terrain':
            import os
            from pathlib import Path
            os.chdir('/opt/terrain-diffusion')
            if not Path('data/global/synthetic_map_stats.json').is_file():
                raise RuntimeError('Terrain conditioning data must be prepared in the CPU image build')
            from huggingface_hub import snapshot_download
            from terrain_diffusion.inference.world_pipeline import WorldPipeline
            checkpoint = snapshot_download(TERRAIN_MODEL, revision=TERRAIN_REVISION)
            self.pipeline = WorldPipeline.from_pretrained(checkpoint, torch_compile=False, dtype=None,
                latents_batch_size=1, caching_strategy='direct', cache_limit=512 * 1024 * 1024).to('cuda')
        else:
            raise ValueError('Unknown backend')

    def generate(self, payload):
        if self.kind == 'reference':
            prompt = payload['prompt']
            if not isinstance(prompt, str) or not 1 <= len(prompt) <= 6000:
                raise ValueError('Invalid reference prompt')
            image = self.pipeline(prompt=prompt, width=1024, height=1024, guidance_scale=1., num_inference_steps=4,
                generator=self.torch.Generator(device='cuda').manual_seed(payload['seed'])).images[0]
            out = io.BytesIO(); image.save(out, format='PNG')
            return out.getvalue(), 'png'
        if self.kind == 'object':
            import os
            import tempfile
            import o_voxel
            from PIL import Image
            raw = payload['image']
            if not isinstance(raw, bytes) or len(raw) > 12 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != payload['referenceHash']:
                raise ValueError('Reference checksum or size mismatch')
            image = Image.open(io.BytesIO(raw)).convert('RGB')
            mesh = self.pipeline.run(image)[0]
            mesh.simplify(16777216)
            glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs,
                coords=mesh.coords, attr_layout=mesh.layout, voxel_size=mesh.voxel_size,
                aabb=[[-.5, -.5, -.5], [.5, .5, .5]], decimation_target=200000, texture_size=1024,
                remesh=True, remesh_band=1, remesh_project=0, verbose=False)
            fd, name = tempfile.mkstemp(suffix='.glb'); os.close(fd)
            try:
                glb.export(name, extension_webp=True)
                with open(name, 'rb') as file: return file.read(), 'glb'
            finally: os.unlink(name)
        import numpy as np
        plan = payload['plan']; width, height = terrain_shape(plan)
        world = self.pipeline
        world.change_seed(payload['seed'])
        grid = plan['conditioning']; values = np.array(grid['elevations'], dtype=np.float32).reshape(grid['height'], grid['width'])
        # Model conditioning is one cell per 7680m. Preserve that coordinate scale.
        # Sample the plan at model control points; edge-pad outside the requested tile.
        xs = np.arange(2) * 7680.; ys = np.arange(2) * 7680.
        rows = np.array([np.interp(xs, np.linspace(0, plan['extentMeters'][0], grid['width']), row) for row in values])
        controls = np.array([np.interp(ys, np.linspace(0, plan['extentMeters'][1], grid['height']), rows[:, x]) for x in range(2)]).T
        world.set_custom_conditioning_import(0, np.pad(controls.astype(np.float32), 64, mode='edge'), 0, 0)
        world.bind()
        result = world.get(64 * 256, 64 * 256, 64 * 256 + height, 64 * 256 + width, with_climate=False)
        elevations = result['elev'].detach().cpu().numpy()
        if elevations.shape != (height, width) or not np.isfinite(elevations).all():
            raise RuntimeError('Terrain returned an invalid elevation grid')
        out = {'version':1, 'assetId':plan['assetId'], 'width':width, 'height':height,
            'extentMeters':plan['extentMeters'], 'elevations':elevations.reshape(-1).tolist(),
            'provenance':{'kind':'model-generated', 'model':TERRAIN_MODEL + '@' + TERRAIN_REVISION,
                          'requestHash':payload['requestHash']}}
        return json.dumps(out, allow_nan=False).encode(), 'json'
