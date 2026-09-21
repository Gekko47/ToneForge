# Stage 17 — Change planning

**Gate**: Yes

## Objective

Turn Stage 16 unified `Finding[]` input into validated `ChangePlan` objects while preserving traceability and semantic review data, detecting overlapping or contradictory changes, and applying caller-supplied document-hash staleness checks.

## Scope

- `src/changes/planner.ts` — validate raw findings through `FindingSchema`, map supported typography, house-style, and formatting findings to typed changes, preserve `suggestedChangeId`, retain raw findings for review, and produce a schema-valid `ChangePlan`.
  - Typography findings become text insertions, replacements, or reversible deletions.
  - Preferred terminology and spelling variants use message-derived replacements.
  - Banned terms become non-reversible `deleteRange` changes.
  - Formatting findings become style, character-format, or list-level changes.
  - Semantic findings remain available for Stage 19 review and become changes only when an explicit quoted replacement can be safely extracted.
  - Invalid findings are skipped without rejecting the remaining plan.
- `src/changes/conflictDetector.ts` — report overlapping ranges, same-range different-type changes, and style/direct-format contradictions without dropping either change.
- `src/changes/staleGuard.ts` — compare a plan hash with a caller-supplied current document hash and mark mismatches stale without reading Word.
- `src/core/domain/Change.ts` and `src/core/domain/ChangePlan.ts` — preserve optional `suggestedChangeId` linkage and raw finding passthrough while keeping existing plan fixtures compatible.
- `eslint.config.mjs` — enforce the pure `changes/` boundary: only `core/domain` and `shared/utils` imports are allowed.
- `tests/unit/changes/` — mirror the planner, conflict detector, stale guard, and public barrel with deterministic unit coverage.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run test` passes (373 tests across 38 files; 53 focused tests in `tests/unit/changes/`)
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `npm run stage:verify` passes
- [x] `src/changes/` coverage meets the 80% threshold (planner.ts 99.57% lines, conflictDetector.ts 100% lines, staleGuard.ts 100% lines, index.ts 100% lines)
- [x] `docs/project-state.md` updated

## Status

PASS
