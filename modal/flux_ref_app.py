# ═══════════════════════════════════════════════════════════════════════════
# 🎨 PHASE C — FLUX.2-klein-4B ref-image service (kills the 429 bottleneck)
#
#   .venv-foundry/bin/modal deploy modal/flux_ref_app.py   → permanent URL
#
# WHY: the foundry's ref-image chain (FAL → Gemini → Pollinations) rate-limits
# (429) under parallel forging. FLUX.2-klein-4B is Apache 2.0, ~13GB VRAM,
# 4-step distilled → ~1-3s per 1024² image on L4, ~$0.0004/image. OUR endpoint
# = no 429 ever, parallel-safe, photoreal (FLUX.2 generation quality).
#
# Same patterns as trellis2_app.py (read its header for the full rationale):
#   • @app.cls + @modal.enter  — warm model per container (load once)
#   • @modal.fastapi_endpoint  — real HTTPS URLs
#   • @modal.concurrent(max_inputs=2) — 2 gens in flight per container
#                         (model ~13GB, activations ~+2-4GB/gen on 24GB L4;
#                         drop to 1 if OOM ever shows)
#   • max_containers=6  — matches the parallel-Director goal (6 forges need
#                         6 images near-simultaneously); still a spend cap
#   • scaledown_window=300 — idle 5 min → $0
#   • Auth — X-Foundry-Key vs FOUNDRY_SHARED_SECRET (same foundry-auth secret)
#
# This file is SELF-CONTAINED (Modal mounts only the entrypoint file).
# ═══════════════════════════════════════════════════════════════════════════
import modal

# fastapi types needed at DEPLOY time (annotations) — installed in .venv-foundry.
from fastapi import Request, Response

app = modal.App("edworld-flux-ref")

# ── Persistent weight cache (first boot downloads ~10GB, then warm forever) ──
weights = modal.Volume.from_name("flux-ref-weights", create_if_missing=True)

GPU = "L4"
MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"  # Apache 2.0, NOT gated

# ── Container recipe: same CUDA base + torch as trellis2_app (image-cache
#    friendliness), then the diffusers stack. Flux2KleinPipeline requires a
#    RECENT diffusers (per the official model card: install from git). ──
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-devel-ubuntu22.04",
        add_python="3.10",  # match trellis2_app (and Microsoft's conda)
    )
    .apt_install("git")  # required for the git+https diffusers install below
    .env(
        {
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
            "HF_HOME": "/weights/hf",  # weights → the Volume
        }
    )
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "accelerate",
        "safetensors",
        "Pillow",
        "sentencepiece",  # Mistral-family text encoder tokenizer
        "protobuf",
        "huggingface_hub",
        "transformers",  # FLUX.2's text encoder needs a recent one
        # Flux2KleinPipeline is brand new — model card says install from git:
        "git+https://github.com/huggingface/diffusers.git",
    )
    .pip_install("fastapi")
)


@app.cls(
    image=image,
    gpu=GPU,
    volumes={"/weights": weights},
    secrets=[
        modal.Secret.from_name("huggingface"),  # HF_TOKEN (harmless; repo is public)
        modal.Secret.from_name("foundry-auth"),  # FOUNDRY_SHARED_SECRET
    ],
    max_containers=4,  # one per parallel forge, still a hard spend cap
    scaledown_window=300,  # idle 5 min → $0
    timeout=600,  # a gen is seconds; generous for cold-weight downloads
    startup_timeout=600,  # @modal.enter loads ~13GB (volume-warm ≈ 30-60s)
)
@modal.concurrent(max_inputs=2)  # 2 gens in flight per container (drop to 1 on OOM)
class FluxRef:
    @modal.enter()
    def warm(self) -> None:
        """Container boot: load FLUX.2-klein-4B ONCE per container lifetime."""
        import torch
        from diffusers import Flux2KleinPipeline

        print(f"[enter] loading {MODEL_ID} → GPU…")
        self.pipeline = Flux2KleinPipeline.from_pretrained(
            MODEL_ID, torch_dtype=torch.bfloat16
        )
        # L4 has 24GB — the ~13GB model fits WITHOUT cpu offload (faster).
        # If a bigger variant ever OOMs: replace with enable_model_cpu_offload().
        self.pipeline.to("cuda")
        self._torch = torch
        print(f"[enter] warm ✓ on {torch.cuda.get_device_name(0)}")

    def _gen_png(self, prompt: str, seed: int | None) -> bytes:
        import io

        torch = self._torch
        generator = (
            torch.Generator(device="cuda").manual_seed(seed) if seed is not None else None
        )
        # Params per the official model card: 4 steps, guidance 1.0, 1024².
        img = self.pipeline(
            prompt=prompt,
            height=1024,
            width=1024,
            guidance_scale=1.0,
            num_inference_steps=4,
            generator=generator,
        ).images[0]
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

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
        return {"ok": True, "warm": hasattr(self, "pipeline"), "gpu": GPU, "model": MODEL_ID}

    @modal.fastapi_endpoint(method="POST")
    async def generate(self, request: Request) -> Response:
        """POST {"prompt": "...", "seed": 123?} → raw PNG bytes.

        Auth: X-Foundry-Key header must equal FOUNDRY_SHARED_SECRET.
        """
        import time

        from fastapi.responses import JSONResponse

        if not self._authorized(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        try:
            body = await request.json()
            prompt = str(body["prompt"])
            if not prompt.strip():
                raise ValueError("empty prompt")
            seed = body.get("seed")
            seed = int(seed) if seed is not None else None
        except (ValueError, KeyError, TypeError) as e:
            return JSONResponse({"error": f"bad request: {e}"}, status_code=400)

        t0 = time.time()
        try:
            png = self._gen_png(prompt, seed)
        except Exception as e:  # noqa: BLE001 — surface the failure to the caller
            print(f"[gen] ✗ {type(e).__name__}: {e}")
            return JSONResponse({"error": f"gen failed: {e}"}, status_code=500)

        ms = int((time.time() - t0) * 1000)
        print(f"[gen] ✓ {len(png) / 1e6:.2f}MB in {ms}ms")
        return Response(
            content=png,
            media_type="image/png",
            headers={"X-Gen-Ms": str(ms)},
        )
