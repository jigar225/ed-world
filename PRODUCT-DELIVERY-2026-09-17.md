# Local delivery — September 17, 2026

The prompt-to-world flow works for the tested outdoor lessons. It is a usable
local preview, not the completed universal, photoreal student product.

Open http://127.0.0.1:3011/create. The app and generation worker are running.
To restart from this project, use `npm run local:worlds -- --execute`.
All inference uses existing private Modal deployments; no local models,
new packages, model deployments or hosting changes were made.

## Actual results

These plain prompts were submitted through the browser form, generated with
Modal, assembled locally, opened and tested in Chrome:

- `Show evaporation, clouds, and rain over a lake.`
  World: `bbeff2aee50d89c9509d53736d58995a7fda28fc412e9cf34fa9ba4404ae8459`.
  Canonical job: `agent-7fc655c4898327aae71533d3`.
  New generated terrain and material, clipped water, rising mist, drifting cloud
  billows and falling rain. A replay through the UI reused the saved package.
- `Show snow falling over a mountain valley.`
  World: `597fab2f4af2d587ef2ba5c0b8f960ddaa0297c02a3006c5e061075cb2a8933c`.
  Canonical job: `agent-24650e7e216d403935c1e35a`.
  Separate generated terrain/material and a falling, ground-following snow field.
  Routing and motion repairs reused the actual terrain, material and model outputs.

The existing `gravity on moon` and ordinary desert worlds remain available.
The desert browser regression also passed during this work. Lunar data is the
existing recorded Apollo 15 crop, not newly generated lunar geology.

Final browser reports and screenshots:

- `.cache/agent-tests/generated-browser-bbeff2aee50d/report.json`
- `.cache/agent-tests/generated-browser-597fab2f4af2/report.json`
- `.cache/agent-tests/generated-browser-4fff5874e69e/report.json`

Checks covered real rendering, particle movement, water phase movement where
applicable, walking on geometry, pause, save/restore/reopen and effect focus.
Screenshots were separately inspected. They show simple/coarse scenes and subtle
particle weather; they do not demonstrate photorealism or scientific validation.

## What changed

Production worker and CLI now use `scene-planner.ts`, not the legacy free-form
renderer-plan generator. The model proposes a semantic recipe. The compiler
provides mandatory solid ground, separate liquid surfaces, isolated solid objects,
and distinct particle emitters with their own behaviour bindings.

A focused material classifier checks proposed liquids/objects independently of
their proposed category. This caught the snow test's incorrect classification of
ice and snowfall as liquid surfaces. One checkpointed revision repairs mismatches;
remaining mismatches block generation. Coverage review matches phrases from the
original question to actual components. Unsupported requirements need a real
request quote, rather than an invented demand for a physical solver.

Terrain comes from the existing Modal model or supported recorded lunar source.
A same-job terrain realization is retained across compatible plan repairs at the
same domain/extent; its original plan and provenance remain saved. Measured
geometry must still pass grounding before assembly. No replacement terrain preset
is generated in the browser.

Grounding uses relative site information, without exposing absolute map coordinates
to the placement model. It constrains local offsets and preserves the planned
motion direction. A deterministic compiler derives falling height/duration and
missing emitter footprint, aligns rain with the nearest cloud layer, and validates
parameters. Raw model decisions and calibrated decisions are stored separately.

The appearance agent chooses reusable cloud, mist, rain, dust, spark or generic
rendering styles. The renderer uses softer cloud/mist billboards, tapered fields
and thin transparent rain. Entry camera pitch preserves a useful terrain view;
Look controls can still point overhead. Ground textures use anisotropic sampling.
The controls panel scrolls instead of covering navigation on small windows.

Completed packages retain exact-prompt, checksum-verified reuse. Older typed
packages whose calibrated motion would change resume from saved stages. Current
assembly revision is 4; already-correct revision-3 packages can still be reused.

## Validation and spending

Full `test:agent`, schema tests and strict TypeScript passed. Added targeted tests
cover material routing, bounded revision, mandatory support, real request coverage,
relative coordinates, direction preservation, source height, falling trajectories,
footprint derivation and stale-package invalidation. No test fixture was substituted
for the live lake or snow generation.

The ceiling remains **$59 total**. Product reservations: **$52.82618424**, plus
**$0.50** retained model-check hold. **$5.67381576 remains unreserved**.
This work added **$5 in reservations**: three language allocations ($0.80 each),
two terrain calls ($1 each), and two ground materials ($0.30 each). Warm language
roles reused funded allocations. Reservations are not audited billing.
All 28 RPC records updated during this work contain completed results. The local
queue has no queued/running generation jobs. Warm containers follow the existing
idle and funded-allocation limits; this is not a fresh all-app zero-runner audit.

## Remaining limitations

Earth terrain is still sampled at 30m, with simple geometry and tiled materials.
Close-up graphics, landform fidelity and composition need further improvement.
Weather, condensation proxies and surface waves are illustrations. Invisible water
vapor is represented by visible mist; accumulation, cloud microphysics and fluid
flow are not simulated. Navigation gravity is a separate tested physics feature.

Arbitrary interiors, caves, microscopic worlds, mechanical assemblies, rigs and
process-specific scientific solvers are not qualified. The 8B planner still makes
semantic mistakes; the new checks correct or block several observed failures,
but two live prompts do not establish universal prompt reliability. The isolated
object pipeline remains available with its existing reference/geometry review
requirements, but these two new scenes did not require new TRELLIS objects.

The full arbitrary-prompt product remains unfinished. Do not present this local
preview as universally ready merely because its browser and unit tests pass.
