# Stage 17 — Change planning

**Gate**: Yes

## Objective

Turn Stage 16 unified `Finding[]` input into validated `ChangePlan` objects while preserving traceability and semantic review data, detecting overlapping or contradictory changes, and applying caller-supplied document-hash staleness checks.

## Scope

- `src/changes/planner.ts` — validate raw findings through `FindingSchema`, map supported typography, house-style, formatting, and locally resolved AI findings to typed changes, preserve finding/rule lineage, and produce a schema-valid `ChangePlan`.
  - Typography findings become text insertions, replacements, or reversible deletions.
  - Preferred terminology and spelling variants use structured case-conversion metadata and pure converters.
  - Banned terms become non-reversible `deleteRange` changes.
  - Formatting findings become style, character-format, or list-level changes with unit-aware targets and node/text preconditions.
  - Actionable AI findings require an exact source slice; unresolved full-document semantic deviations remain advisory.
  - Every actionable schema-v2 change carries source, risk, approval state, finding linkage, and a precondition.
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

PASS for the original deterministic planning scope and the current repository-side
hardening. Unit-aware ranges, provenance, approval enforcement, target
preconditions, capitalization, formatting node identity, and protection paths are
repository-tested. Live moved/deleted-node behavior and host approval UX remain
external evidence under the canonical status in [`ROADMAP.md`](../../ROADMAP.md).
