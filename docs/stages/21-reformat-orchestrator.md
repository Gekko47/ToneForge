# Stage 21 — Reformat orchestrator

**Gate**: Yes

## Objective

Add the hybrid document reformatter as the taskpane-safe composition point for snapshot → analyze → plan → tracked apply.

## Scope

- `src/reformat/orchestrator.ts` — read document and formatting snapshots, delegate Stage 20 analysis, compose Stage 17 planning, and expose preview or tracked application.
- `src/reformat/index.ts` — public barrel export.
- `src/word/revisionAdapter.ts` remains the only mutation path; `src/reformat` never calls `Office.run` directly.
- `tests/integration/reformatOrchestrator.test.ts` — preview, no-change, stale, capability-gate, abort, semantic opt-in, formatting-snapshot reuse, tracking fallback, and tracked-apply coverage.
- Legacy `src/word/smokeApply.ts` helpers are deprecated and retained only for reproducible Stage 18 live-smoke evidence. Dashboard UI redirection is explicitly out of scope for Stage 21.
- Stage 22 confirmation/re-hash UX remains out of scope.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run test` passes, including the Stage 21 integration suite
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `npm run stage:verify` passes
- [x] `npm run verify` passes in the required order
- [x] `docs/architecture.md`, `docs/decision-log.md`, and this stage file document the boundary
- [x] `docs/project-state.md` updated after the gate result
- Coverage evidence: the executed Stage 21 module clears the 80% gate (`orchestrator.ts`: 98.46% lines/statements, 100% functions, 81.25% branches; `index.ts`: 100%). `npm run test:coverage` still exits 1 on the repository-wide global threshold because pre-existing UI/style files remain below 80%; that unrelated repository limitation is documented in `docs/project-state.md`.

## Status

PASS
