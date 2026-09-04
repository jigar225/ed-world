# EduWorld — Project Context (for all AI chats & contributors)

> Read this FIRST before making changes. Update it whenever architecture,
> decisions, env vars, or roadmap change. Last updated: 2026-09-04.

## 🚦 HANDOFF — START HERE (new chat? read this)

**Where you are:** `/Users/macair/Development/ed/ed-world` — Next.js 15 app,
git repo (GitHub user: jigar225). `npm run dev` → localhost:3000.
API keys live in `.env` (gitignored) — Reactor, Kimi (Modal), FAL/GEMINI.

**What works TODAY (all verified):**
- 3 world engines wired end-to-end: ⚗️ CodeWorld (default, $0, deterministic
  physics), ⚡ LingBot (layered-prompt harness in `lib/lingbot.ts`), ✨ Happy
  Oyster (prompt-only, persistent worlds in localStorage library).
- Kimi agent pipeline: `/api/plan` (oyster+lingbot, engine-aware), `/api/world`
  (codeworld architect+critic), `/api/token`, `/api/image`.
- Award-style UI: R3F hero, Framer Motion, playable LoadingUniverse, HUD,
  world library. GitHub pushed; demo video recorded by the owner.

**WHAT'S NEXT — P1: Moon Runtime 2.0 (photoreal-by-code, the current mission):**
1. `components/RealWorldExperience.tsx` (new): THREE.WebGPURenderer+TSL
   (fallback WebGL2), NASA LOLA lunar heightmap terrain (displacement +
   triplanar + macro-variation + RNM normals), HDRI space env (Poly Haven CC0),
   hard shadows 2048-4096, NO fog (vacuum), sheen 0.05, post chain in exact
   order SSAO→SSR→bloom(0.85-0.9)→DOF→ACESFilmic→LUT→vignette/grain→SMAA,
   pointer-lock FPS cam + head-bob. Keep CodeWorld's deterministic physics +
   missions/events pattern (reuse `lib/codeworld.ts` spec types, extended).
2. Success test: screenshot side-by-side vs the owner's Happy Oyster moon
   screenshot — target ~85% of the photoreal look at $0.
3. After P1 → P2 prop foundry (TRELLIS.2 GLBs on Modal), P3 lake water stack,
   P4 splat environments (Spark 2.0 + collision proxies).

**Parent folder `/Users/macair/Development/ed/` — project discussion files:**
- `discussion.md` — original strategy (Marble/Oyster/LingBot, cost arch)
- `new_discussion.md` — VRAM/GPU math for self-hosting (MoE, quantization)
- `promptanswers.md` — 3 EXPERT ANSWERS (Three.js photoreal stack, asset
  pipeline gltf-transform/KTX2/meshopt, splat+mesh integration) — the
  technical bible for P1, READ IT before coding Runtime 2.0
- `idea.md` — the "code vs world models" debate notes

## 🎯 What this is

**EduWorld — "Step inside anything you want to learn."**
A student types a topic ("gravity on the moon") → an AI agent (Kimi) designs a
world + missions → the student explores an interactive 3D world in the browser
and completes missions. Hackathon project with a real product ambition.

**Core constraint discovered:** judges/users may open the product at ANY time
over days. Paid world-model credits (Reactor) WILL run out. The product MUST
work forever at $0 — that's why the CodeWorld (Lab) engine exists and is the
DEFAULT engine.

## 🏗️ Architecture — 3 engines + 1 brain

```
Student topic
   ↓
Kimi agent (lesson planner / scene architect)
   ↓
┌──────────────────┬──────────────────┬──────────────────────┐
│ ⚗️ CodeWorld     │ ⚡ LingBot W2     │ ✨ Happy Oyster       │
│ (DEFAULT, $0)    │ ($0.20/min)      │ ($0.83/min)          │
│ spec-driven      │ live world model │ live world model     │
│ Three.js runtime │ via Reactor      │ via Reactor          │
│ real physics     │ event keys 1-4   │ persistent world_id  │
└──────────────────┴──────────────────┴──────────────────────┘
```

1. **⚗️ CodeWorld (`/api/world` + `components/CodeWorldExperience.tsx`)**
   - Multi-agent: ARCHITECT (Kimi writes world spec JSON) + CRITIC
     (`validateSpec` in `lib/codeworld.ts` validates/repairs; one repair pass).
   - Spec = data (objects/physics/events/missions), NEVER executed code →
     judges can never break it. Deterministic physics (spec.gravity is real).
   - Runs 100% client-side. No token, no credits, instant load.
2. **⚡ LingBot World 2 (`/api/plan` engine=lingbot + `components/LingbotExperience.tsx`)**
   - Needs: reference image (REQUIRED) + LAYERED prompt — NOT a single prompt.
   - `lib/lingbot.ts` = composePrompt harness: `base + camera[static|dynamic]
     + movement[static|dynamic] + heldEvents + vertical`, recomposed live on
     input changes. Follow docs.reactor.inc/model-api-reference/lingbot-world-2/prompt-guide
     EXACTLY (no negations, pin landmarks "EXACTLY ONE", camera contract verbatim).
3. **✨ Happy Oyster (`/api/plan` engine=happy-oyster + `components/WorldExperience.tsx`)**
   - Prompt-only (image anchoring REMOVED — quality was worse). Second-person
     prompt per its prompt guide. Worlds persist: save `encrypted_world_id`,
     re-enter via `attachWorld` (no regeneration cost). 2-min travel limit.

## 🧠 The brain — Kimi (OpenAI-compatible)

- Self-hosted on Modal (endpoint `https://<workspace>--ep-kimi-k3-server.us-west.modal.direct/v1`)
  with **Modal proxy auth** → headers `Modal-Key` (ak_...) + `Modal-Secret` (as_...).
  Plain `Bearer wk-...` FAILS ("different workspace").
- Fallback: Moonshot public API (`KIMI_API_KEY` Bearer).
- `/api/plan` and `/api/world` both pick auth style from env automatically.

## 🔑 Env vars (.env — gitignored; .env.example documents all)

- `REACTOR_API_KEY` (rk_...) — server-only, mints JWTs in `/api/token` for the
  3 Reactor models (oyster adventure/director + lingbot-world-2).
- `KIMI_BASE_URL`, `KIMI_MODEL`, `KIMI_MODAL_KEY`, `KIMI_MODAL_SECRET`, `KIMI_API_KEY`
- Images (for LingBot seed frames): `FAL_KEY` (best) → `GEMINI_API_KEY` → free
  Pollinations fallback. Chain lives in `/api/image`.
- Token route scopes JWTs to all 3 model slugs.

## 📁 Key files

- `app/page.tsx` — stage machine: home → planning → planned → world; engine
  toggle (codeworld default); world library (localStorage via `lib/worlds.ts`).
- `app/api/plan/route.ts` — Kimi lesson planner, engine-aware (oyster/lingbot).
- `app/api/world/route.ts` — CodeWorld architect+critic agent loop.
- `app/api/token/route.ts` — Reactor JWT minting (3 model slugs).
- `app/api/image/route.ts` — image provider chain (fal → gemini → pollinations).
- `lib/codeworld.ts` — CodeWorld spec types + validateSpec (repair).
- `lib/lingbot.ts` — LingBot layered prompt harness (composePrompt).
- `lib/worlds.ts` — plan types (3 engines) + localStorage world library.
- `components/WorldExperience.tsx` — Oyster engine.
- `components/LingbotExperience.tsx` — LingBot engine (event keys 1-4).
- `components/CodeWorldExperience.tsx` — CodeWorld engine (deterministic physics).
- `components/LoadingUniverse.tsx` — playable loading (particles, steps, tips, log).
- `components/Scene.tsx` — R3F hero planet (client-only, dynamic import).
- Design system: true black `#050505`, mint `#6cffc2`, Space Grotesk display
  font, film grain, glass HUD. See `app/globals.css`.

## 💰 Cost model (verified 2026-09 via api.reactor.inc/pricing)

- 10,000 credits = $1. happy-oyster 139 cr/s ≈ $50/hr · lingbot-world-2 33 cr/s
  ≈ $12/hr · codeworld $0 forever. Reactor billing = session lifetime.
- Modal GPUs: L4 $0.80/hr, L40S $1.95, A100-80GB $2.50, H100 $3.95.

## 🗺️ Roadmap / decisions log

- ✅ 3-engine architecture + engine-agnostic plan API
- ✅ LingBot layered prompt harness (fixed bad results: oyster-style prompts
  were the bug — Reactor also hosts a LITE version of LingBot)
- ✅ CodeWorld Lab engine (architect+critic agents, deterministic physics)
- ✅ GitHub repo live (jigar225), demo video recorded
- 🔲 **REALITY GAP → "RealWorld Harness" (DECIDED 2026-09-04, expert-validated):**
  Photoreal by CODE (no AI world models at runtime). Formula: captured/generated
  CONTENT + lighting engine + post FX. Full pipeline in repo discussion files.
  - Pipeline: Director agent (Kimi: blueprint + asset shopping list) → Asset
    Foundry (texture/HDRI/prop/terrain agents) → COMPILE world package once
    (manifest + GLB/KTX2, cached forever) → Runtime 2.0 renders in browser $0.
  - Runtime 2.0 stack: THREE.WebGPURenderer + TSL (fallback WebGL2), GLTFLoader
    +KTX2Loader+MeshoptDecoder; terrain = heightmap displacement + triplanar +
    macro-variation + RNM normals + CDLOD; water = Reflector + Gerstner +
    fresnel + depth foam; post chain ORDER = SSAO→SSR→fog→bloom(0.85-0.9)→DOF
    →ACESFilmic→LUT→vignette/grain→SMAA. ACES = #1 realism lever.
  - Asset rules: KTX2 (UASTC normals / ETC1S albedo) + meshopt + GLB + ORM
    packing; budgets ≤1.5GB texture VRAM, ≤2-3M tris, ≤25MB geometry.
  - Sources: Poly Haven/ambientCG (CC0), Fab/Megascans (Fab Standard = any
    engine OK), TRELLIS.2/Hunyuan3D props SELF-HOST on our Modal, NASA LRO LOLA
    lunar DEM (real moon heightmap!), Scaniverse phone scans → FREE .SPZ.
  - Moon rules: NO fog (vacuum), hard shadows 2048-4096, sheen 0.05.
  - Splats (P4): quaternion.set(1,0,0,0) OpenCV→OpenGL flip, scale once,
    opaque→splat(depth-test ON/write OFF)→transparent-last, separate invisible
    COLLISION PROXY meshes (splats have no colliders), Spark 2.0 renderer.
  - Phases: P1 Moon Runtime 2.0 (easiest photoreal, no water/clouds/trees) →
    P2 prop foundry (TRELLIS Modal) → P3 lake water stack + vegetation →
    P4 splat environments (Scaniverse free / Marble paid-once).
  - Oyster/LingBot stay as demo-day "live wow" mode only.
- 🔲 Future: self-host LingBot-World-Infinity 14B (CC BY-NC-SA — non-commercial!)
  or Matrix-Game 3.0 (MIT) on Modal when usage justifies (~100+ student-hrs/mo).
  See /Users/macair/Development/ed/new_discussion.md for the VRAM math.

## ⚠️ Gotchas (learned the hard way)

- Happy Oyster travel = 2 min max; world persists, just `startTravel()` again.
- LingBot: image and prompt MUST agree or you get artifacts; first seconds of a
  stream materialize — judge after settling. Movement is PERSISTENT state
  (send "idle" to stop), unlike Oyster's held axes.
- Kimi plan call takes 30-90s — normal, not a bug. LoadingUniverse covers it.
- Oyster `createWorld` takes 1-3 min on their GPUs — normal.
- Never execute LLM-generated code in the browser; specs-as-data only.
