# ═══════════════════════════════════════════════════════════════════════════
# 🌋 P2 FOUNDRY — PHASE B: TRELLIS.2-4B as a warm HTTPS service
#
#   .venv-foundry/bin/modal deploy modal/trellis2_app.py   → permanent URL
#
# CONCEPTS (vs Phase A's one-shot `modal run`):
#   • @app.cls          — container = a persistent OBJECT. Methods share state
#                         (self.pipeline) across requests for the container's
#                         whole lifetime.
#   • @modal.enter      — BOOT hook, runs once per container before traffic.
#                         The ~145s 4B-model load is paid HERE, never per-
#                         request. ("warm model" pattern.)
#   • @modal.fastapi_endpoint — fronts the method with a real HTTPS URL.
#   • @modal.concurrent(max_inputs=1) — one forge per container at a time:
#                         the pipeline holds ~8GB VRAM and is not re-entrant.
#                         Extra requests queue / trigger another container.
#   • max_containers=3  — spend guardrail: never more than 3 L4s alive.
#   • scaledown_window=300 — idle 5 min → container dies → billing STOPS
#                         (scale-to-zero). Next request cold-starts
#                         (~2.5 min boot+load) — fine: the foundry compiles
#                         props at PLAN time, never live.
#   • Auth              — our own shared-secret header (X-Foundry-Key), not
#                         Modal proxy auth: keeps Modal tokens out of .env.
#
# ⚠️ SYNC WARNING: the image/GPU/volume definitions below are DUPLICATED from
# modal/trellis2_smoke.py ON PURPOSE. Modal mounts ONLY the entrypoint file
# into remote containers (verified in SDK 1.5.5: get_entrypoint_mount mounts
# the FILE, never sibling modules), and `serialized=True` can't be used
# (local venv is Python 3.13, image is 3.10 — cloudpickle version mismatch).
# So this file must be fully self-contained. Identical definitions hash to
# the SAME cached image server-side — zero rebuild cost. BUT: any future
# image/GPU/volume change MUST be mirrored in trellis2_smoke.py (and vice
# versa) or the two will drift.
# ═══════════════════════════════════════════════════════════════════════════
import modal

# fastapi types are needed at DEPLOY time (signature annotations) — installed
# locally in .venv-foundry. Remote containers get it from the late layer below.
from fastapi import Request, Response

app = modal.App("edworld-trellis2-forge")

# ── The persistent weight cache (SAME volume Phase A filled) ───────────────
weights = modal.Volume.from_name("trellis2-weights", create_if_missing=True)

# ── The GPU knob (same failover plan as Phase A: "L4" → "A100-40GB") ──────
GPU = "L4"

# ── The container recipe — VERBATIM copy of trellis2_smoke.py's image ─────
# (see SYNC WARNING above) + ONE late layer: fastapi for the web endpoints.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-devel-ubuntu22.04",
        add_python="3.10",  # matches Microsoft's conda env exactly
    )
    .apt_install(
        "git",
        "build-essential",  # gcc/g++ for the C++ extensions
        "ninja-build",  # the build system torch extensions expect
        "libgl1",  # nvdiffrast GL plugin
        "libglib2.0-0",  # opencv runtime dep
        "libjpeg-dev",  # image codecs
    )
    .env(
        {
            # Image builds run WITHOUT a GPU: declare the arch explicitly.
            #   8.0 = A100 · 8.9 = L4 (Ada) · 9.0 = H100 · +PTX = forward-JIT
            "TORCH_CUDA_ARCH_LIST": "8.0;8.9;9.0+PTX",
            "CUDA_HOME": "/usr/local/cuda",
            "ATTN_BACKEND": "xformers",
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
            "OPENCV_IO_ENABLE_OPENEXR": "1",
            # Hugging Face cache → the Volume (persists across containers):
            "HF_HOME": "/weights/hf",
        }
    )
    # Layer 1: torch FIRST — every extension below links against it.
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # Layer 2: pure-python deps (setup.sh --basic, minus gradio/tensorboard).
    .pip_install(
        "wheel",  # build tool — without it every --no-build-isolation
        "setuptools",  #   extension dies with "invalid command 'bdist_wheel'"
        "imageio",
        "imageio-ffmpeg",
        "tqdm",
        "easydict",
        "opencv-python-headless",
        "ninja",
        "trimesh",
        "transformers",
        "pandas",
        "lpips",
        "zstandard",
        "kornia",
        "timm",
        "xformers==0.0.29.post3",  # built for torch 2.6 — pinned so pip can't drift
        "huggingface_hub",
    )
    # utils3d — pinned commit, exactly like Microsoft's setup.sh:
    .pip_install(
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"
    )
    # Layer 3: the repo itself (--recursive: o-voxel + submodules).
    .run_commands(
        "git clone --recursive https://github.com/microsoft/TRELLIS.2.git /opt/trellis2"
    )
    # Layer 4: the custom CUDA ops — CC/CXX pinned to g++ IN THE SHELL:
    # Modal's standalone python reports clang++ as its compiler but clang
    # isn't in this image (link step dies). Shell-level env = only this
    # layer rebuilds when tweaked; layers above stay cached.
    .run_commands(
        "git clone -b v0.4.0 --depth 1 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast"
        " && CC=gcc CXX=g++ pip install /tmp/ext/nvdiffrast --no-build-isolation",
        "git clone -b renderutils --depth 1 https://github.com/JeffreyXiang/nvdiffrec.git /tmp/ext/nvdiffrec"
        " && CC=gcc CXX=g++ pip install /tmp/ext/nvdiffrec --no-build-isolation",
        "git clone --recursive --depth 1 https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/cumesh"
        " && CC=gcc CXX=g++ pip install /tmp/ext/cumesh --no-build-isolation",
        "git clone --recursive --depth 1 https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/flexgemm"
        " && CC=gcc CXX=g++ pip install /tmp/ext/flexgemm --no-build-isolation",
        "CC=gcc CXX=g++ pip install /opt/trellis2/o-voxel --no-build-isolation",
    )
    # LATE PIN: transformers 5.x moved DINOv3's encoder under `.model`, which
    # breaks TRELLIS.2's feature extractor (upstream issues #147/#156). Pin
    # newest 4.x; pip auto-resolves a compatible huggingface_hub (<1.0).
    .pip_install("transformers==4.57.6")
    # SERVICE-ONLY late layer: fastapi for the web endpoints.
    .pip_install("fastapi")
    # The trellis2 package itself is NOT pip-installed — Microsoft's scripts
    # run from the repo root. We replicate that with PYTHONPATH.
    .env({"PYTHONPATH": "/opt/trellis2"})
)


@app.cls(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights},
    secrets=[
        modal.Secret.from_name("huggingface"),  # HF_TOKEN (hub calls at load)
        modal.Secret.from_name("foundry-auth"),  # FOUNDRY_SHARED_SECRET
    ],
    max_containers=3,  # spend guardrail: ≤3 L4s alive, ever
    scaledown_window=300,  # idle 5 min → $0
    timeout=1800,  # per-request ceiling (a forge is ~5-7 min cold)
    startup_timeout=600,  # @modal.enter may take ~150s (model load) — headroom
)
@modal.concurrent(max_inputs=1)  # one forge per container (GPU not re-entrant;
                                 # cls `max_inputs` param is deprecated in 1.5.5)
class Trellis2Forge:
    @modal.enter()
    def warm(self) -> None:
        """Container boot: pay the model load ONCE per container lifetime."""
        import torch
        from trellis2.pipelines import Trellis2ImageTo3DPipeline

        print("[enter] loading microsoft/TRELLIS.2-4B → GPU…")
        self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        self.pipeline.cuda()
        print(f"[enter] warm ✓ on {torch.cuda.get_device_name(0)}")

    # ── core forge (identical pipeline + budgets to Phase A's smoke test) ──
    def _image_to_glb(self, image_bytes: bytes) -> bytes:
        import io
        import os
        import tempfile
        import time

        import o_voxel
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        t0 = time.time()
        mesh = self.pipeline.run(img)[0]
        mesh.simplify(16777216)  # nvdiffrast triangle limit (their example)
        print(f"[forge] 512³ gen in {time.time() - t0:.1f}s")

        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            # OUR budgets (expert asset rules), not their 4K demo defaults:
            decimation_target=200_000,  # ≤200k tris/prop
            texture_size=1024,
            remesh=True,
            remesh_band=1,
            remesh_project=0,
            verbose=False,
        )
        # trimesh export via temp file — exactly like Phase A.
        fd, tmp = tempfile.mkstemp(suffix=".glb")
        os.close(fd)
        try:
            glb.export(tmp, extension_webp=True)
            with open(tmp, "rb") as f:
                return f.read()
        finally:
            os.unlink(tmp)

    @staticmethod
    def _authorized(request: Request) -> bool:
        import hmac
        import os

        expected = os.environ.get("FOUNDRY_SHARED_SECRET", "")
        got = request.headers.get("x-foundry-key", "")
        # fail closed if the secret isn't injected; constant-time compare
        return bool(expected) and hmac.compare_digest(expected, got)

    # ── endpoints ──────────────────────────────────────────────────────────
    @modal.fastapi_endpoint(method="GET")
    def health(self) -> dict:
        """Unauthenticated liveness/readiness probe (leaks nothing)."""
        return {"ok": True, "warm": hasattr(self, "pipeline"), "gpu": GPU}

    @modal.fastapi_endpoint(method="POST")
    async def generate(self, request: Request) -> Response:
        """POST {"image_b64": "<png/jpeg b64>"} → raw GLB bytes.

        Auth: X-Foundry-Key header must equal FOUNDRY_SHARED_SECRET.
        """
        import base64
        import binascii
        import time

        from fastapi.responses import JSONResponse

        if not self._authorized(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        try:
            body = await request.json()
            image_bytes = base64.b64decode(body["image_b64"], validate=True)
        except (ValueError, KeyError, binascii.Error) as e:
            return JSONResponse({"error": f"bad request: {e}"}, status_code=400)

        t0 = time.time()
        try:
            glb_bytes = self._image_to_glb(image_bytes)
        except Exception as e:  # noqa: BLE001 — surface the failure to the caller
            print(f"[forge] ✗ {type(e).__name__}: {e}")
            return JSONResponse({"error": f"forge failed: {e}"}, status_code=500)

        ms = int((time.time() - t0) * 1000)
        print(f"[forge] ✓ {len(glb_bytes) / 1e6:.1f}MB in {ms}ms")
        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={"X-Forge-Ms": str(ms)},
        )
