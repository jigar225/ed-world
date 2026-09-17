# EduWorld contributor instructions

## Scope and working rules

- Work only in this project and on data needed for the task. Respect the user's
  privacy; do not inspect unrelated directories or credentials.
- Run model inference on Modal, never on this Mac. Existing deployments provide
  language, FLUX references, TRELLIS objects and terrain generation.
- Do not install suspicious or unreviewed software. New installations and model
  deployments must follow the user's current authorization; do not infer it from
  historical plans. Do not deploy hosting or change domains as part of local work.
- Do not commit or push unless explicitly requested. Keep existing user changes.
- No subagents unless the user explicitly requests delegation.
- Model output is data, never executable code. Validate roles, geometry, behaviour
  and source provenance. Never replace a requested scene silently with a demo.
- Do not call a plan or unit-test pass a working product. Report browser evidence,
  visual limitations and unsupported scenes separately.

## Current application

Start from the repository root with `npm run local:worlds -- --execute`, then open
http://127.0.0.1:3011/create. Check whether it is already running before launching.
This starts the Next app and a durable generation worker; it does not deploy models.
Do not interrupt active generation or start a duplicate job to resolve a timeout.

Production entry points:
- `lib/agent-world/scene-planner.ts`: semantic recipe, material routing, coverage,
  terrain detail and appearance. `research.ts` supplies shared research/types.
- `lib/agent-world/pipeline.ts`: checkpointed generation and assembly.
- `lib/agent-world/grounding.ts`: measured placement and motion calibration.
- `lib/physical-world-viewer.mjs`: browser rendering and navigation.
- `scripts/agent-world/worker.mjs`, `cli.mjs`: production job runners.
- `.cache/agent-world/jobs.sqlite`, `tools.sqlite`: local queue and durable receipts.

Older homepage engines, scene-review routes and saved-world renderers still have
callers. Trace references before deleting them. Preserve public assets used by
saved worlds, even when their names are not literal imports. The retired
`prepareWorld` planner was removed; regressions now exercise `prepareScene`.

## Budget and recovery

The latest authorized integration ceiling is $59 TOTAL. Read
`scripts/out/physical-world/integration-round-budget.json` for current reservations;
never use historical handoff balances as current billing. The enforced cap is in
`scripts/physical-world/run_product_job.py`.

Keep receipts and old holds. An unknown submission is not permission to retry.
Reconcile existing call IDs before resubmission. Do not reset budgets, erase
uncertain records, redeploy models or apply arbitrary cold-start deadlines to
bypass recovery. Modal secrets stay on Modal; local secrets stay in ignored env
files. Never print or commit tokens.

## Verified scope and latest failure

Lake and snow outdoor previews passed actual browser navigation, moving effects,
pause and persistence checks. Existing Moon/desert previews have also been tested.
See `PRODUCT-DELIVERY-2026-09-17.md` for world IDs and evidence. Graphics are coarse,
weather is illustrative, and these examples do not prove arbitrary scene support.

Subsequent prompt `inside the volcano` FAILED (queue
`5d42f9f0-7bdb-4126-9b29-d52f7b66af47`, canonical
`agent-8cab7d9a19e8f50c38249ddf`). The planner sent an interior through the outdoor
heightfield path; grounding rejected it for nonexistent required water. Terrain
was generated and saved. Cleanup does not fix this semantic/capability failure.
Do not retry paid generation blindly or claim interiors are supported.

## Validation and repository hygiene

- `npm run typecheck`: strict TypeScript check.
- `npm run test:agent`: offline contracts, pipeline, budgets and runtime tests.
- `npm run test:agent:schemas`: structured-output schema checks.
- Browser QA scripts and test reports live under `scripts/agent-world/` and
  `.cache/agent-tests/`. Saved-world browser checks do not need new model calls.
- Keep `.cache`, `scripts/out`, virtualenvs, build output and film exports out of
  Git. Preserve saved scenes and budget ledgers locally. The separate film project,
  historical handoffs and one-off authoring experiments are also ignored by request.
- Avoid broad dependency upgrades or renderer rewrites during cleanup.

Earlier engineering notes are preserved locally (ignored, absent in a new checkout) in
`docs/history/agent-handoff-through-2026-09-17.md`; they are historical context,
not active instructions. In particular their old budgets, defaults and readiness
claims must not override this file or the current user request.
