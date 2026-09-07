# ═══════════════════════════════════════════════════════════════════════════
# 🌋 P2 FOUNDRY — PHASE A: TRELLIS.2-4B smoke test on Modal
#
# GOAL: prove the 4B model runs on a CHEAP GPU before we build the service.
#   - does the container build? (CUDA deps compile without a GPU attached)
#   - does the pipeline load + generate on L4 (Ada, sm_89)?
#   - peak VRAM? generation time? GLB out?
#
# RUN IT (your Task #2):
#   .venv-foundry/bin/modal run modal/trellis2_smoke.py
#
# WHAT YOU'RE WATCHING (infra concepts in the wild):
#   1. IMAGE BUILD — Modal builds the container on CPU builders (no GPU $).
#      Every step below = an immutable cached layer, like Docker. Edit one
#      line → only that layer + below rebuild.
#   2. GPU ATTACHES ONLY AT FUNCTION TIME — the expensive silicon exists
#      only while `smoke()` runs. Per-second billing.
#   3. VOLUME — persistent disk that survives container death. The 8GB of
#      weights download ONCE into it; every future cold start mounts it.
# ═══════════════════════════════════════════════════════════════════════════
import modal

app = modal.App("edworld-trellis2-smoke")

# ── The persistent weight cache ─────────────────────────────────────────────
# Like a named EBS volume we mount into any container. create_if_missing =
# idempotent infra (safe to run the script twice — lesson: always design
# your ops to be re-runnable).
weights = modal.Volume.from_name("trellis2-weights", create_if_missing=True)

# ── The GPU knob ────────────────────────────────────────────────────────────
# L4 = 24GB, Ada sm_89, $0.80/hr — BF16-capable (all sm_80+ are).
# If custom kernels (FlexGEMM/nvdiffrast) reject sm_89 or we OOM:
# flip to "A100-40GB" and re-run. One line. That's the whole failover plan.
GPU = "L4"

# ── The container recipe ────────────────────────────────────────────────────
# Base: NVIDIA's own CUDA 12.4 DEVEL image (nvcc included — Microsoft's
# custom CUDA ops must COMPILE, so a runtime-only image won't do).
# Modal injects the GPU driver libs at run time; we bring the toolkit.
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
            # CRITICAL BUILD TRICK: image builds run WITHOUT a GPU attached,
            # so nvcc can't auto-detect the arch. We declare it explicitly:
            #   8.0 = A100 · 8.9 = L4 (Ada) · 9.0 = H100 · +PTX = forward-JIT
            "TORCH_CUDA_ARCH_LIST": "8.0;8.9;9.0+PTX",
            "CUDA_HOME": "/usr/local/cuda",
            # Phase A attention backend: xformers (prebuilt wheels).
            # flash-attn==2.7.3 compiles from source (~40min build) — we earn
            # that only AFTER the model proves it runs. ATTN_BACKEND is read
            # by TRELLIS.2 at import time.
            "ATTN_BACKEND": "xformers",
            # Microsoft's own OOM mitigation, straight from their example:
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
            "OPENCV_IO_ENABLE_OPENEXR": "1",
            # Hugging Face cache → the Volume (persists across containers):
            "HF_HOME": "/weights/hf",
        }
    )
    # Layer 1: torch FIRST — every extension below links against it.
    # Order matters: pip layers are sequential, and xformers later must find
    # torch==2.6.0 already present or pip will "helpfully" replace it.
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # Layer 2: pure-python deps (setup.sh --basic, minus gradio/tensorboard —
    # those serve their demo UI and training, not our pipeline).
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
    # Layer 4: the custom CUDA ops — cloned, then pip-installed with
    # --no-build-isolation (they must see the torch we installed above;
    # build isolation would hide it and fetch a SECOND torch).
    # CC/CXX pinned to g++ IN THE SHELL: Modal's standalone python reports
    # clang++ as its compiler (it's built with clang) but clang isn't in this
    # image — compiling works (nvcc), then the LINK step dies. Shell-level
    # env = only this layer rebuilds when tweaked; layers above stay cached.
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
    # LATE PIN (appended AFTER the CUDA extensions so all layers above stay
    # cached): transformers 5.x moved DINOv3's encoder under `.model`, which
    # breaks TRELLIS.2's feature extractor (`self.model.layer` → 4.x layout).
    # Known upstream bug (issues #147/#156). Pin newest 4.x; pip auto-resolves
    # a compatible huggingface_hub (<1.0). Pure-python layer, rebuilds in sec.
    .pip_install("transformers==4.57.6")
    # The trellis2 package itself is NOT pip-installed — Microsoft's scripts
    # run from the repo root. We replicate that with PYTHONPATH.
    .env({"PYTHONPATH": "/opt/trellis2"})
)

# ── The smoke function ──────────────────────────────────────────────────────
# `modal run` = one-shot job (think `kubectl run --rm -it`): container starts,
# function runs, container dies, billing stops. No service, no endpoint —
# the cheapest possible way to answer "does it work?".
@app.function(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights},
    secrets=[modal.Secret.from_name("huggingface")],  # HF_TOKEN → DINOv3 gate
    timeout=3600,  # first run downloads ~8GB of weights — give it room
)
def smoke() -> dict:
    import os
    import time

    import torch

    print(f"═══ SMOKE START ═══ gpu={torch.cuda.get_device_name(0)}")
    print(f"bf16 supported: {torch.cuda.is_bf16_supported()}")
    t0 = time.time()

    from trellis2.pipelines import Trellis2ImageTo3DPipeline

    pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    pipeline.cuda()
    t_load = time.time() - t0
    print(f"[1/3] weights loaded in {t_load:.1f}s | VRAM {torch.cuda.memory_allocated()/1e9:.2f}GB")

    # Microsoft's own sample asset — shipped with the repo, zero fetch risk:
    from PIL import Image

    image = Image.open("/opt/trellis2/assets/example_image/T.png")

    t1 = time.time()
    mesh = pipeline.run(image)[0]
    mesh.simplify(16777216)  # nvdiffrast triangle limit (from their example)
    t_gen = time.time() - t1
    peak = torch.cuda.max_memory_allocated() / 1e9
    print(f"[2/3] 512³ generation in {t_gen:.1f}s | PEAK VRAM {peak:.2f}GB")

    import o_voxel

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
        texture_size=1024,  # mid-prop texture budget
        remesh=True,
        remesh_band=1,
        remesh_project=0,
        verbose=True,
    )
    os.makedirs("/weights/out", exist_ok=True)
    glb.export("/weights/out/smoke_T.glb", extension_webp=True)
    weights.commit()  # flush volume writes before the container dies

    size_mb = os.path.getsize("/weights/out/smoke_T.glb") / 1e6
    print(f"[3/3] GLB exported: {size_mb:.1f}MB → volume trellis2-weights/out/smoke_T.glb")
    print("═══ SMOKE PASS ═══")
    return {
        "gpu": torch.cuda.get_device_name(0),
        "load_s": round(t_load, 1),
        "gen_s": round(t_gen, 1),
        "peak_vram_gb": round(peak, 2),
        "glb_mb": round(size_mb, 1),
    }
