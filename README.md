# EduWorld

A local prototype that turns a student prompt into an explorable 3D learning scene.
The current flow combines Modal-hosted planning and generation with browser-side
navigation and illustrative animation.

**Current scope:** tested outdoor lake, snowfall, desert and lunar lessons.
Graphics remain basic. Arbitrary interiors, caves, biological worlds and physical
process simulations are not reliably supported. The latest `inside the volcano`
attempt failed during placement; the outdoor successes do not establish universal
prompt-to-world readiness.

## Run locally

Use Node.js 22.16 or newer. Install JavaScript dependencies with `npm ci` on a new
checkout. Configure only the integrations you use from `.env.example`; keep real
credentials in ignored environment files or Modal secrets.

The generation bridge expects the existing `.venv-foundry/bin/python` environment,
Modal authentication and deployed language, terrain and asset services. No model
runs on the Mac. A new checkout does not include local generated worlds, model
credentials, the funded budget ledger or cached job receipts. Do not manufacture a
new budget ledger to bypass that requirement.

```sh
npm run local:worlds -- --execute
```

Open [the local product](http://127.0.0.1:3011/create). The command starts both the
Next app and generation worker. Prompt submissions can spend the authorized Modal
budget; opening an intact saved world does not require regenerating it. Stop the
launcher with Ctrl+C. Check for an existing launcher before starting another.

## Code map

| Area | Purpose |
| --- | --- |
| `app/create`, `components/AgentWorlds.tsx` | Prompt, job progress and saved-world UI |
| `app/api/agent` | Local job and world APIs |
| `lib/agent-world/scene-planner.ts` | Semantic planning and capability checks |
| `lib/agent-world/research.ts` | Reference retrieval and planner dependencies |
| `lib/agent-world/pipeline.ts` | Generation, checkpoints and scene assembly |
| `lib/agent-world/grounding.ts` | Placement on measured terrain and motion calibration |
| `lib/physical-world-viewer.mjs` | Rendering, motion, navigation and persistence |
| `scripts/agent-world` | Worker, CLI, model bridges and tests |
| `modal` | Cloud service definitions; starting locally does not redeploy them |

The existing homepage engines remain in the base repository. Additional local
experiments, including `/live`, `/worlds` and scene-review work, are outside this
focused commit. Integration settings are documented in `.env.example`.

## Validate changes

```sh
npm run typecheck
npm run test:agent
npm run test:agent:schemas
```

These suites use local fixtures and existing dependencies; they do not submit paid
model generation. Browser QA is documented in
[scripts/agent-world/README.md](scripts/agent-world/README.md).

## Local data and commits

Keep `.cache/`, `scripts/out/`, build folders, local Python environments and `.env*`
files out of Git. `.env.example` is the placeholder-only exception. Preserve the
local budget ledger, receipts and generated scenes when cleaning source code.
The separate film project, historical splat viewer, one-off authoring scripts,
historical working notes and `modal.zip` are also ignored. App source, regression
tests and required public assets remain included. Ignoring a file does not delete
it from disk.

See [contributor instructions](AGENTS.md),
[September 17 delivery evidence](PRODUCT-DELIVERY-2026-09-17.md).
