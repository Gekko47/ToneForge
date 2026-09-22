# Stage 20 — Consistency checker

**Gate**: Yes

## Objective

Add the hybrid consistency checker.

## Scope

- `src/analysis/consistencyChecker.ts` — `checkConsistency(options)` orchestrates deterministic typography + house-style engines, the formatting analyzer, and the semantic deviation engine, merges outputs via `unifyFindings`, and returns a findings-only `ConsistencyReport` with summary counts by severity and kind plus `profileId` and `docHash`. No `ChangePlan` generation — the Stage 21 orchestrator composes this output with the Stage 17 planner.
- `src/analysis/index.ts` — barrel re-exports `checkConsistency`, `CheckConsistencyOptions`, `ConsistencyReport`, `ConsistencySummary`, `ConsistencyReportSchema`, `ConsistencySummarySchema`.
- Tests under `tests/unit/analysis/consistencyChecker.test.ts` (10 tests) reusing `MockAdapter` only.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run test` passes (443 tests across 43 files; 10 new checker tests)
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `npm run stage:verify` passes
- [x] `docs/project-state.md` updated

## Status

PASS — `checkConsistency()` reuses `findTypographyIssues`, `findHouseStyleIssues`, `findFormattingIssues`, `detectSemanticDeviations`, and `unifyFindings` within the `src/analysis/` boundary. Empty text short-circuits; formatting is optional; semantic is gated on `includeRawText: true` with `withRetry` and caller-abort non-retryable; provider failures are logged and skipped rather than fatal. Findings-only contract keeps Stage 21 composition clean.
