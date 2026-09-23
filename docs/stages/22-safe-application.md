<arg_value># Stage 22 — Safe application

**Gate**: Yes

## Objective

Add stale-result protection and safe application logic.

## Scope

- `src/reformat/orchestrator.ts` — live re-hash before apply; refuse conflicting plans without explicit override.
- `src/word/revisionAdapter.ts` — `allowConflicts` parameter on `applyChangePlan`/`applyChangePlanWithTracking`/`validatePlanBeforeApply` as defense-in-depth.
- `src/taskpane/components/ReformatPanel.tsx` — preview/confirm/apply workflow with conflict acknowledgment.
- `src/taskpane/pages/Dashboard.tsx` — panel wiring via `resolveActiveProfile`.
- `tests/integration/reformatOrchestrator.test.ts` — integration tests for live re-hash, conflict refusal, and explicit acknowledgment.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes (zero warnings)
- [x] `npm run format` passes
- [x] `npm run test` passes (462 tests, all green)
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `docs/project-state.md` updated

## Status

PASS
