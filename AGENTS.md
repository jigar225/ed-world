# EduWorld — Project Context (for all AI chats & contributors)

> Read this FIRST before making changes. Update it whenever architecture,
> decisions, env vars, or roadmap change. Last updated: 2026-09-07.

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

**P1: Moon Runtime 2.0 — ✅ DONE + e2e-verified (2026-09-04).**
`components/RealWorldExperience.tsx` + `lib/moon-terrain.ts`:
THREE.WebGPURenderer+TSL (auto-fallback WebGL2), deterministic lunar
heightfield terrain (seeded procedural, LOLA-style — NOT the real NASA DEM
yet), triplanar regolith + macro-variation + RNM normals, hard 4096 shadows
following the player, NO fog, procedural PMREM star env (offline, no HDRI
download), star dome + Earth + HDR sun disc, pointer-lock FPS cam + head-bob,
full post chain in EXACT expert order:
GTAO→SSR→bloom(0.87)→DOF→ACESFilmic→grade→vignette/grain→SMAA→sRGB.
Reuses CWSpec: real `spec.gravity` physics, event keys 1-5, mission HUD.
Textures in `public/textures/moon/` (albedo/normal/roughness/earth, CC0).
Verified via puppeteer walk test (`e2e-walk.mjs` in the temp dir): plan →
compile → pointer-lock → walk → drop event → screenshots, clean console.

**WHAT'S NEXT — P2 prop foundry, mid-flight (2026-09-05):**

*Built + verified (foundry machinery):* `lib/foundry.ts` (prompt→FLUX ref
image→TRELLIS→GLB→`public/props/` cache-forever), `app/api/foundry` (ad-hoc
forge), Director step in `/api/world` (realworld plans forge ALL labeled
objects biggest-first — cap removed 2026-09-05, `FOUNDRY_MAX_PROPS` only
caps if explicitly set), runtime GLB upgrade in
`RealWorldExperience` (obj.model → GLTFLoader, bbox-normalized to scale.y,
center-origin wrapper → physics identical to primitives, primitive fallback).
VERIFIED via `e2e-foundry.mjs` (temp dir): seeded library world re-enters
with a real GLB on the moon. `tsc` clean.

*Provider pivot:* FAL_KEY is EMPTY (user has no FAL budget) → self-host
**TRELLIS.2-4B on Modal** (user has $107 Modal credit). TRELLIS.2 facts:
image-to-3D, 4B params, BF16 (works on sm_80+, L4=sm_89 fine), 24GB VRAM
minimum, CUDA 12.4 + torch 2.6.0, MIT license, full PBR output (baseColor+
rough+metal), 512³ ≈3s on H100 → est. $0.005/prop on L4. Its image encoder
is Meta's **gated DINOv3** (needs HF account + license accept + HF_TOKEN).

*Modal state:* CLI 1.5.5 in `.venv-foundry/`, authed (workspace `jigar-code`,
`~/.modal.toml`). `modal/trellis2_smoke.py` (Phase A one-shot): **image
BUILT + CACHED** (fixed: wheel for bdist_wheel, CC=gcc/CXX=g++ shell env vs
phantom clang++), GPU knob `GPU="L4"` (flip to "A100-40GB" if OOM/kernel),
weights Volume `trellis2-weights` (HF_HOME=/weights/hf), budgets
decimation 200k tris + texture 1024, exports to volume `out/smoke_T.glb`.

**✅ PHASE A SMOKE PASS (2026-09-05 13:00 IST, run #3):** L4, bf16 OK —
weights load 145.5s (volume-cached), 512³ gen 244.1s, **peak VRAM 7.71GB**
(far under L4's 24GB), GLB 8.7MB (192,566 tris after decimation, xatlas UVs,
webp textures) → pulled to `./smoke_T.glb` (test artifact — DO NOT COMMIT).
Cost ≈$0.08/prop on L4 incl. postprocess (~6 GPU-min). All THREE HF gates
accepted (dinov3, TRELLIS.2-4B, RMBG-2.0); `huggingface` secret works.
Two fixes landed en route: RMBG-2.0 gate + `transformers==4.57.6` pin
(5.x broke DINOv3 `.layer` access — upstream issues #147/#156; pin appended
as late layer, cache preserved).

**✅ PHASE B SERVICE LIVE + first real props forged (2026-09-05 ~14:00 IST):**
`modal/trellis2_app.py` deployed — app `edworld-trellis2-forge`, endpoints
`https://jigar-code--edworld-trellis2-forge-trellis2forge-{health,generate}.modal.run`.
`@app.cls` + `@modal.enter` warm model (cold start ~2 min incl. load) +
`@modal.fastapi_endpoint`; auth = `X-Foundry-Key` header vs Modal secret
`foundry-auth` (FOUNDRY_SHARED_SECRET, same value in .env).
`@modal.concurrent(max_inputs=1)`, max_containers=3, scaledown_window=300.
⚠️ image/GPU/volume block is DUPLICATED from the smoke file ON PURPOSE
(Modal mounts only the entrypoint file remotely; serialized=True impossible
— venv python 3.13 vs image 3.10). KEEP BOTH FILES' IMAGE DEFS IN SYNC.
Verified: health 200 (cold 118s), 401 no/wrong key, then REAL forges via
Next.js: lunar-lander.glb 6.1MB (373s cold) + moon-rock.glb 5.6MB (272s
warm) → `public/props/` (these get COMMITTED). Ref images: Gemini 429'd
(rate limit) → Pollinations carried both — fallback chain works.
FIX landed: Director step in /api/world was gated on FAL_KEY (dead) → now
`foundryConfigured()` from lib/foundry.ts. maxDuration 900 on /api/foundry
+ /api/world (cold-start + serial-forge headroom). `lib/foundry.ts`:
FOUNDRY_PROVIDER=modal default when TRELLIS_MODAL_URL set, FAL fallback;
ref-image chain FAL→Gemini→Pollinations (square, isolated-on-white).

**✅ P2 E2E PASS (2026-09-05 14:27 IST):** `e2e-walk.mjs` (port 3001 —
3000 is a STALE old server!) full walk with REAL forged props in a fresh
Kimi plan: architect+critic 39.6s → Director forged `earth_bar` (6.0MB,
248s) + `fall_sign` (7.1MB, 222s, warm container) → world loaded GLBs via
/props/ → pointer-lock walk → Hammer-Feather-Drop event physics running →
5 screenshots, console clean (only the known favicon 404). Fixes landed
this run: hero forges are now SERIAL (parallel calls 429'd Pollinations);
puppeteer `protocolTimeout: 900000` (CDP dies on 10-min plan calls).
Props inventory in `public/props/` (ALL committed): test_helmet (P2-machinery
test), lunar-lander, moon-rock, mons_hadley, earth_bar, fall_sign.
Session cost ≈ 6 forges × ~$0.06 ≈ **$0.40 of the $107 Modal credit**.

**🔧 CACHE-KEY FIX (2026-09-07):** the foundry cache key is the object `id`,
and Kimi invents FRESH snake_case ids every run (temp 0.7) → repeat topics
("gravity on moon" ×10) cache-MISSED and re-forged existing props on the
Modal GPU (proof: `moon-rock.glb` vs `moon_rock_a/b.glb`, `lunar-lander.glb`
vs `lander_body/top.glb` in public/props/). Two-layer fix in `/api/world`:
(1) architect is now CACHE-AWARE — existing prop slugs are injected into its
system prompt (rule R7) with "reuse this exact id if the object matches";
(2) Director peeks the cache with BOTH `o.id` and `slugify(o.label)` before
forging (`peekCachedProp`/`listCachedProps` in lib/foundry.ts). Old duplicate
GLBs are KEPT (committed; saved worlds in localStorage may reference them).
LIVE-VERIFIED same day: "gravity on moon" run → 14/14 heroes `cached`, 0 GPU
calls, 59.7s total (all Kimi time). Side effect found + fixed: the architect
started planning `test_helmet` (machinery artifact) into worlds because it
was in the advertised cache list → `test*`-prefixed slugs are now filtered
OUT of the prompt list (still usable via cache peek).

**P2 IS DONE.** Commit postponed by owner — world looked CARTOONISH vs the
gltf-viewer GLBs → **P1.5a realism pass (2026-09-05 ~16:30 IST), e2e-verified:**
- ROOT CAUSE of the plastic look: the env map was a black starfield — PBR
  props had nothing to reflect (gltf-viewer uses a studio HDRI). Fix:
  `makeStarEnvTexture(seed, sunDir)` now encodes REAL lunar illumination
  (black sky + stars up top, regolith-bounce gradient below, HDR sun spot
  = key reflection, faint cool earthlight patch), environmentIntensity
  0.3→0.9, + a dim blue earthlight DirectionalLight (0x9db8e8, 0.12) from
  Earth's actual position.
- Primitives were glossy toys (roughness 0.38/metalness 0.35 in a near-black
  env) → now 0.82/0.05 + 30% desaturation toward luminance (non-emissive).
- Labels: smaller, dimmer, distance-fade 22→70m via opacityNode (no more
  floating-billboard look).
- Post re-tuned for a DARK scene: exposure 0.88→1.0, DOF bokeh 1.3→0.7
  @12m (was tilt-shift toy blur), grain 0.06→0.035, vignette 0.42→0.28.
- Terrain: craters deepened to real depth/diameter (~0.17-0.30r, sizes
  3-37m) + slope-based wall darkening in the regolith material (steep =
  darker compacted soil — every crater pops, geometry-agnostic).
- Verified: e2e-walk clean (forged earth_pillar 6.0MB + drop_tower cached).
  Before/after shots in the temp dir (before-walk-*.png vs walk-*.png).

**STILL CARTOONISH (owner-validated gaps, ranked):**
1. ~90% of scene objects are UNTEXTURED PRIMITIVES (white box, yellow box,
   capsules) — content gap, not renderer gap. LEVER PULLED 2026-09-05: prop
   cap REMOVED (Director now forges every labeled object). Remaining levers:
   primitive detail-material, or forge-everything above a size threshold.
2. ~~Terrain smooth near spawn~~ — **CLOSED by P1.5b (2026-09-07), below.**

**✅ P1.5b REALISM PASS 2 — REAL NASA TERRAIN + ROCKS (2026-09-07), e2e-verified:**
- **Placement fix (category semantics):** CWObject gains `category: "ground"
  | "air"`. Ground objects IGNORE the LLM's y and are terrain-snapped
  (`hf.height + halfHeight`, center-origin for both primitives and GLB
  wrappers) — kills the "everything floats" bug class. Air keeps y as
  height-above-ground. Legacy specs resolve: falls/float→air else ground.
  Architect prompt (`app/api/world/route.ts`) has the placement rulebook.
- **REAL NASA DEM:** `public/terrain/moon-dem.{json,bin}` — LROC NAC DTM
  Apollo 15 / Hadley crop, 1024², 2m/px, 2048m across, uint16 LE (source +
  credit in the json). `createLunarHeightfield(seed, dem)`: REAL topography
  inside the tile, procedural macro terrain outside, 80m smoothstep blend
  band; fetch fails → full procedural, never breaks. DEM processing script
  was `process-dem.mjs` in the temp dir — LOST to the Sep-6 temp wipe.
- **Micro-craters octave** (0.75–3.35m, 11m jittered cells, 45% fill) rides
  on top of BOTH DEM and procedural (the DTM's 2m/px can't hold them) +
  sub-meter regolith grain (two fine fbm octaves).
- **Rock scatter field** (`scatterRocks`/`buildRockGeometry` in
  moon-terrain.ts): seeded-deterministic, slope-rejected (>0.42 skip),
  half-buried. 3 instanced tiers: 6500 + 4500 pebbles (no shadow cast) +
  420 boulders 0.3–2.4m (real shadows). Deformed-icosahedron geoms.
- **`hf.heightFar`** — silhouette-only variant (swells + basins + DEM, NO
  cell/micro craters) drives the far ring so its coarse tessellation can't
  alias crater-scale detail.
- **THE PICKET-FENCE HUNT (the hard bug):** vertical fins stood on the
  horizon in every post-processed frame. Systematic bisect (query-param
  kills) eliminated INNOCENT: far ring, rocks, SSR, DOF, bloom, DEM spikes
  (checked the uint16 data — clean). Raw render (`?nopost`) was PRISTINE →
  post-chain artifact. **ROOT CAUSE = GTAO**: it ray-marches the depth
  buffer, and past a few tens of metres the DEM+micro-crater depth detail
  goes sub-pixel → marched "occlusion" is noise, which perspective at
  grazing angles stretches into vertical stripes. **FIX: AO is now
  near-field only** — `aoFactor = mix(ao, 1, smoothstep(18, 45, -viewZ))`
  (contact shadows live in that band anyway; far terrain/sky = clean 1).
- Verified via rebuilt `e2e-realism.mjs` (temp dir — seeded library world,
  GLB props + category semantics, 4 screenshots): fence GONE with full post
  + far ring ON, placement/rocks/drop-event all correct, console clean,
  `tsc` clean.

**IMMEDIATE NEXT (in order):**
1. Owner walks the new look on :3001 — verdict on P1.5b (fence fix + rocks
   + real Hadley terrain).
2. Commit P1+P2+P1.5a+P1.5b (user approves first — never commit unasked).

**Also queued:** owner's eyeball test vs Happy Oyster moon screenshot;
Poly Haven HDRI; P3 lake water stack; P4 splat environments.

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

- **ACTUALLY LIVE today: Moonshot public API** (`KIMI_API_KEY` Bearer).
- The Modal self-host path (headers `Modal-Key`/`Modal-Secret`) is wired in
  `/api/plan` + `/api/world` but INACTIVE: `KIMI_MODAL_KEY`/`KIMI_MODAL_SECRET`
  are EMPTY in .env (they were proxy-only `ak_`/`as_` keys — they authenticate
  endpoint CALLS, but CANNOT `modal deploy`; a real Modal token is needed for
  any self-host deploy, incl. the P2 TRELLIS swap).
- `/api/plan` and `/api/world` pick auth style from env automatically (Modal
  keys win if present, else Bearer).

## 🔑 Env vars (.env — gitignored; .env.example documents all)

- `REACTOR_API_KEY` (rk_...) — server-only, mints JWTs in `/api/token` for the
  3 Reactor models (oyster adventure/director + lingbot-world-2).
- `KIMI_BASE_URL`, `KIMI_MODEL`, `KIMI_MODAL_KEY`, `KIMI_MODAL_SECRET`, `KIMI_API_KEY`
  (⚠️ the two MODAL keys are currently EMPTY — see "The brain" above).
- Images (for LingBot seed frames): `FAL_KEY` (⚠️ currently EMPTY — chain runs
  on Gemini) → `GEMINI_API_KEY` → free Pollinations fallback. `/api/image`.
- `FAL_KEY` is ALSO the P2 foundry's image-to-3D provider (FLUX ref image +
  `fal-ai/trellis`, ~$0.03-0.05/prop, compile-once). Foundry dies without it.
- `FOUNDRY_MAX_PROPS` (UNSET = no cap — every labeled object forged; set a
  number to cap, 0 disables) — hero props auto-compiled per realworld plan.
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
- `components/RealWorldExperience.tsx` — 🌕 RT2.0 Moon engine (WebGPU+TSL, $0).
- `lib/moon-terrain.ts` — lunar heightfield (procedural + real NASA DEM tile),
  micro-craters, terrain geometry, rock scatter, macro noise.
- `public/terrain/moon-dem.{json,bin}` — real LROC NAC DTM Apollo 15 tile
  (1024², 2m/px, uint16 LE; loaded at runtime, procedural fallback).
- `lib/foundry.ts` — 🔨 P2 prop compiler (FLUX image → TRELLIS GLB → cache).
- `app/api/foundry/route.ts` — ad-hoc prop forge endpoint.
- `public/props/` — compiled GLBs (cache-forever, committed to git).
- `modal/trellis2_smoke.py` — Phase A: one-shot TRELLIS.2-4B GPU smoke test.
- `app/tsl-lab/` — TSL/WebGPU experiment route (sandbox, safe to ignore).
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
- ✅ **P1 Moon Runtime 2.0 SHIPPED (2026-09-04):** photoreal-by-code moon
  walks end-to-end at $0 (see HANDOFF above). Terrain/sun graded to lunar
  grey (regolith albedo darkened ~0.6, desaturated 84%, sun 0xfff8ef).
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
- Kimi (Modal) occasionally times out once then succeeds on retry — flaky, retry.
- Every plan call returns a FRESH world spec (same topic ≠ same layout) —
  e2e screenshots differ between runs; that's expected, not a regression.
- e2e walk test logs one harmless 404: `/favicon.ico` (none exists). Ignore.
- **Screen-space AO (GTAO) MUST be distance-faded** on high-detail terrain:
  it ray-marches the depth buffer, and once terrain detail goes sub-pixel
  (here ≳45m), marched occlusion is noise that grazing-angle perspective
  stretches into vertical "picket fence" stripes at the horizon. We fade AO
  to 1 from 18→45m via viewZ (`RealWorldExperience`). Same class of fix
  applies if SSR/bloom ever stripe at silhouettes — bisect post passes with
  query-param kills (`?nopost` raw render splits geometry-vs-post in ONE run).
- **macOS WIPES the temp dir** (`/var/folders/.../T/opencode`) on its own
  schedule — the Sep-6 wipe killed ALL e2e scripts (incl. process-dem.mjs)
  and screenshots mid-project. Scripts that matter should be recreated into
  the repo (or rewritten from AGENTS.md notes); treat temp as scratch only.
- RT2.0: textures MUST live in `public/textures/moon/`; a missing normal map
  must fall back to flat (128,128,255), never grey.

### Modal / TRELLIS.2 build gotchas (P2, learned the hard way)

- `modal run file.py` with ONE function auto-runs it (no confirmation), and
  piping its output (`| head`) SIGPIPE-kills the run. Launch long runs with
  `nohup ... > /tmp/log 2>&1 &`, read logs via `modal image logs <im-...>`.
- Image builds = CPU-only (no GPU cost); layers cache by content → tweak
  late layers only. Shell-prefix env (`CC=gcc pip install ...`) invalidates
  nothing above it; editing the `.env()` block rebuilds everything below.
- `invalid command 'bdist_wheel'` → missing `wheel`/`setuptools` in image.
- `command 'clang++' failed` → Modal's standalone python reports clang++ as
  its compiler but the CUDA image has none → pin `CC=gcc CXX=g++` per-command.
- DINOv3 (TRELLIS.2's image encoder) is a GATED HF repo: human must accept
  Meta's license + use HF_TOKEN (read type) via `modal secret create
  huggingface HF_TOKEN=...`; secret injected as env var, auto-read by HF lib.
- There are THREE gated repos, not two: facebook/dinov3-vitl16-pretrain-lvd1689m,
  microsoft/TRELLIS.2-4B, AND briaai/RMBG-2.0 (background remover TRELLIS.2
  runs on every input image; Bria license, free for non-commercial). Accept
  all three gates on the same HF account BEFORE the smoke run — the error
  surfaces only at pipeline-init, mid-download.
- transformers 5.x moved DINOv3's encoder under `.model` → TRELLIS.2's
  `self.model.layer` raises AttributeError (upstream issues #147/#156, PR
  patches exist). FIX: pin `transformers==4.57.6` as a LATE image layer
  (after CUDA extensions) — pip resolves huggingface_hub<1.0 automatically.
  Lesson: never install fast-moving ML libs unpinned; layer-2 "transformers"
  unpinned was the bug.
- Modal 1.5.5 service gotchas (learned the hard way, Phase B):
  - `serialized=True` cloudpickles LOCALLY → local venv python (3.13) must
    MATCH the image python (3.10) or deploy is rejected. Without it, remote
    imports the entrypoint FILE — and `get_entrypoint_mount` mounts ONLY
    that file, NEVER sibling modules → no cross-file imports; service files
    must be self-contained.
  - cls `max_inputs=` param is DEPRECATED → use `@modal.concurrent(
    max_inputs=1)` instead (NOT `single_use_containers=True` — that kills
    container reuse = warm-model pattern).
  - `@modal.fastapi_endpoint` needs `fastapi` BOTH locally (venv, for
    deploy-time annotations) and in the image (late layer).
  - Web endpoint methods: annotate `request: Request` and `await
    request.json()`; return fastapi `Response`/`JSONResponse` directly.
  - First hit on a scaled-to-zero endpoint blocks through boot+@modal.enter
    (~2 min) — clients need 600s timeouts, routes need maxDuration 900.
- Never put HF/Modal tokens in .env files that get committed or in code —
  Modal secrets or local untracked env only.
- Oyster `createWorld` takes 1-3 min on their GPUs — normal.
- Never execute LLM-generated code in the browser; specs-as-data only.
