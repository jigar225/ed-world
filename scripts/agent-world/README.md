# Latest local delivery — September 17

Cleanup: the retired `prepareWorld` implementation was removed. Worker and CLI
use `prepareScene`; shared reference retrieval now lives in
`lib/agent-world/research.ts`. Planner regression tests target the production path.
The later `inside the volcano` request failed; the successful outdoor examples
below do not establish interior or arbitrary-scene support.

See `../../PRODUCT-DELIVERY-2026-09-17.md` for the current tested worlds, architecture,
budget and remaining limitations. New ordinary lake and snow prompts generate and
open; actual browser movement/persistence tests pass. This remains a local outdoor
preview with simple graphics and illustrative weather, not universal scene support.

Production planning uses semantic recipes, independent material routing, request
coverage and appearance classification. Measured relative grounding is followed by
deterministic trajectory calibration. Compatible plan repairs retain their original
terrain realization and material. Completed package reuse checks calibration and
asset integrity. The current total ceiling is $59; consult the shared ledger for
remaining funds rather than historical amounts below.

# Production planning — September 17

The worker and CLI now use `scene-planner.ts`. The language model returns a
semantic recipe: a ground source, liquid surfaces, particle effects and isolated
solid objects. `scene-recipe.ts` compiles this into checked asset roles and
behaviour bindings. Walking support is mandatory, effects own their emitters,
and liquid surfaces cannot enter TRELLIS object reconstruction. The model still
selects the scene contents, terrain conditioning and illustrative parameters.

Measured grounding runs after actual terrain generation. It selects a real basin
or dry site, attaches solids to support, places weather, and determines arrival.
It cannot change the compiler's liquid/object roles or behaviour mechanisms.
Semantic review errors block generation rather than being treated as fixable
placement issues. Unsupported requirements stay explicit and block compute.

Start with `npm run local:worlds -- --execute`; open localhost:3011/create.
Current authorization is $59 TOTAL with earlier holds preserved; read the ledger
for remaining funds. Existing Modal deployments provide all inference. New recipe
unit tests are part of `npm run test:agent`. Actual live/browser qualification is
recorded in the latest AGENTS.md handoff; passing unit tests is not that acceptance.

# Connection recovery — September 17

The local app and worker must both be running. Starting the browser alone does
not restart them: use `npm run local:worlds -- --execute` from this project.
Check actual Modal SDK metadata access when diagnosing connectivity. An HTTP
HEAD request to the API root can return 503 even when SDK access later succeeds;
that response alone does not prove the model service is unavailable.

`modal_reason.py` resolves metadata before recording submission. A failure during
that preflight retains the existing reservation and is safely resumable. Once
input may have been sent, missing acknowledgement remains an uncertain outcome.

For an uncertain standalone language allocation without a call ID, the explicit
`reconcile_language.py <request-digest> --execute` tool checks zero queued inputs
and runners and absence of remote execution artifacts. It permanently retires
the old permit through the deployed service's existing single-use directory guard,
verifies the marker and idle state again, and preserves an immutable local audit
and the old financial hold. The next attempt obtains a separate reservation;
budget exhaustion still blocks it. It refuses active allocations, shared child
leases and allocations with execution artifacts. Recover their actual calls
instead. Do not edit receipt states manually or release uncertain holds.

The September 16 lake allocation was retired using this procedure. Its replacement
was accepted by Modal as `fc-01M2PPHSQ3DBENFZHAKN3WB0TZ`; inspect current queue/
RPC records for the outcome rather than treating this acknowledgement as success.

# Earlier local product — September 15

Start the app and generation worker with `npm run local:worlds -- --execute` from
the project root, then open http://127.0.0.1:3011/create. Port 3011 must be free.
This uses existing private Modal deployments and the same **$49 TOTAL** budget;
no model or package is installed on the Mac. Only submitted work invokes models.

Actual generated lake navigation/motion/persistence passed. The app remains a
local preview: visual quality, arbitrary-scene robustness and scientific fidelity
are not universally qualified. See `../../AGENT-WORLD-LIVE-RESULT.md` for current
results, supported boundaries and the fresh browser-submitted scenario test.

Grounding uses measured terrain, constrained model decisions and reusable runtime
operators. `revise_scene.mjs` supports a budgeted revision from actual screenshots
and explicit review feedback; it preserves model receipts and original packages.
Latest world versions are selected from assembly checkpoints. Exact-prompt replay
shares CLI/worker checkpoints instead of generating the same assets again.

The historical notes below are superseded wherever they differ from this update.

# Latest verified result — September 14

See AGENT-WORLD-LIVE-RESULT.md (project root) for current evidence. Terrain and
private reference/object services are deployed and live-tested. Same-job warm
language reuse, schema-constrained replies, spatial/representation checks and
retained incompatible terrain candidates are implemented. The live lake candidate
is `needs-terrain-review`: actual terrain 427.714–780.273m versus planned 0–100m.
Full scene/student acceptance remains incomplete. No active GPU tasks at last check.
Budget TOTAL $39 after the user added $15; $8.47381576 unreserved with holds retained.
Earlier "not deployed" and "$24 budget blocked" notes below are historical.

# Current update — asset generation connections and terrain deployment

The terrain service is deployed, but GPU qualification failed on missing upstream
climate-data initialization. The corrected noninteractive data-build source is
ready and locally tested; it is not deployed yet. Two build and two GPU reservations
retain $3 inside the previous remaining $3.17381576. No paid tasks are active.
See ../../AGENTS.md and `.cache/agent-world/terrain-status.json` before any paid run.

`asset-agent.ts` now renders six actual views with the existing local Chrome,
requires a Modal vision review, measures/recenters the GLB and caches accepted
briefs. `generation-services.ts` connects the asset and terrain services to the
pipeline. Worker/CLI `--generate` enables this stage; default remains preparation.
New private reference/object wrappers require deployment before that mode is used.
They reserve through `modal_generate.py` in the existing global ledger; the old
HTTP FundingAuthority is not bypassed or enabled.

New tests: test_generation.py, test_asset_agent.mjs, test_terrain_data.py and
source-only SDK parameter hydration in test_deployment.py. Mock tests do not prove
live generated-world quality. No local models or packages were installed.

The historical implementation notes below are superseded where this update differs.

# Agent-world tools

Implemented 2026-09-14. Local terrain planning, assembly and runtime integration are implemented.
The complete student product still requires production generation connections and
scientific/visual qualification. Only MODEL DEPLOYMENT remains deferred by the owner.
No packages/models were installed and no paid calls were made during implementation.

## Local commands

From the project root:

```sh
npm run agent -- status
npm run agent -- deployment-plan
npm run agent -- find-assets "rock"
npm run agent -- inspect-asset public/props/<existing-file>.glb
npm run agent -- research "water cycle"
npm run test:agent
```

Status does not ping model endpoints. Research sends only the supplied query to
the existing bounded Wikipedia reference adapter; it is not broad web search or
scientific validation. Model credentials are never returned by status.

## Agent execution (paid, not performed for this milestone)

Write the requested scenario into a project `scripts/*.txt` file, then:

```sh
npm run agent -- run --prompt-file scripts/my-scenario.txt --execute
```

This uses the existing `.venv-foundry/bin/python` and private deployed
`eduworld-scene-language / Language` class, not a new HTTP language deployment.
The bridge reserves $0.80 for each new reasoning call against the EXISTING round
ledger, retaining prior holds and obeying its ceiling. The four base roles reserve $3.20, plus $0.80 per terrain asset
(e.g. $4.00 for a plan with one terrain). No independent fresh allowance is created. Reconcile existing
billing before a funded live test; reservations stay held pending reconciliation.

Stages: understand → retrieve references → plan world AND behaviour → spatial
layout → terrain plan(s) → critique →
inspect candidate project assets → return plan and capability gaps. Results are
saved in `.cache/agent-world/plans`. A plan does not trigger object generation or
claim a rendered/accepted world. Checkpoint reuse avoids rerunning accepted roles.
The current 4096-token remote limit can constrain large plans; truncation stops
the job without automatic paid retries.

If interrupted, repeating the SAME request recovers its saved Modal call ID.
An ambiguous submission with no recorded call ID requires reconciliation and is
never blindly resubmitted. Cancelling the local runner does not guarantee a remote
call stops immediately; the existing service's dollar lease bounds its compute.

For durable app jobs:

```sh
npm run agent:worker -- --execute
```

`GET /api/agent/tools` reports tools and worker status. `POST /api/agent/jobs`
accepts `{topic:string}` only when the worker is healthy. GET/DELETE with `?id=`
are scoped to an HTTP-only owner cookie. Successful preparation ends in
`needs_review`, never `ready`. Existing scene jobs and saved worlds use their
original databases and entry points. No worker was left running by this change.

## Object tools and deliberate execution boundary

`ModalTools` implements existing FLUX/TRELLIS HTTP contracts, bounds output,
disallows redirects and non-Modal endpoints, persists receipts and artifacts,
checks reference hashes, and structurally inspects GLBs. `buildObjectAsset`
connects a shared-style reference to geometry with same-request recovery/cache.
Only simple mesh requests are accepted; terrain, rigs, volumes and required
separable parts cannot silently fall through to a generic mesh generator.

HTTP paid tools require an injected `FundingAuthority` tied to the global budget.
That production funding/call-recovery integration is NOT yet supplied for legacy
FLUX/TRELLIS HTTP endpoints. They must not be enabled using an always-approve
callback. Tests use simulated reservations and mocked responses. The shipped
language RPC path does have a real existing-ledger reservation bridge.

GLB inspection reports headers/chunks, embedded-resource restrictions, meshes,
node names, skins and clips. It does not prove correct topology, rig quality,
dimensions, scientific structure or visual fidelity. Results remain
`structural-only` and generated physical scale remains unverified.

## Cleanup and remaining work

Removed the old Gemini/Pollinations reference functions and external fallback chain
from the Modal foundry path. Modal failures no longer cascade into FAL. Explicit
legacy FAL mode is retained for existing code; no credentials or assets deleted.
Other legacy renderers/routes still have callers or saved-world compatibility
obligations, so they were not removed speculatively.

Still needed: funded live qualification; broader research provider if required;
qualified asset retrieval/provenance; FLUX/TRELLIS funding and recovery integration;
live visual/scientific acceptance and complex simulation/rig/navigation support.
Behaviour compilation, basic runtime binding and checked assembly are now implemented.
Terrain planning is implemented; actual terrain model deployment comes last.

Tests cover five mocked scenario plans, resume without repeated reasoning, invalid
IDs/units/sources, ambiguous submissions, missing funds, Modal-only routing,
cancellation, secret redaction, generated-reference checksums, asset containment,
the reference-to-object tool chain, legacy foundry privacy and global budget holds.
They are mechanism tests, not generated-world quality evidence.

Read-only inspection of existing `fish_school.glb` and `jellyfish.glb` also passed:
both have mesh geometry but zero skins and zero animation clips. They must not be
advertised as ready for skeletal animation simply because the asset names match.

## Local runtime and whole-package integration

`/create` connects the agent preparation queue and saved package library to the
existing first-person Three.js/Rapier viewer. `pipeline.ts` accepts qualified asset
and terrain services, reuses validated checkpoints, checks capabilities and hashes,
and assembles an engineering preview. The current production worker does not invoke
that generation stage yet. No dummy funding authority is supplied.

`terrain.ts` defines the terrain agent output and measured heightfield contract;
`terrain-mesh.ts` packages real elevation arrays. `behaviour-runtime.ts` compiles
rotation, oscillation, drift, illustrative waves/particles and conservative scalar
transfer. No arbitrary downloaded code executes. Assembly rejects unsupported
navigation/scale, competing transform ownership and unqualified representations.

`test_runtime.mjs` creates clearly labelled geometry solely for regression tests.
It is hidden from normal UI; `/create?qa=1` exposes fixtures for automated QA.
Run `npm run test:agent:browser` with a dev server on 3011 (or AGENT_QA_ORIGIN).
Full plan, acceptance cases and honest remaining gaps: ../../AGENT-WORLD-DELIVERY-PLAN.md.
