# Stage 16 — Unified findings

**Gate**: Yes

## Objective

Add the unified finding model that merges deterministic, formatting, and semantic findings into a single sorted, deduplicated list.

## Scope

- `src/analysis/unifiedFindings.ts` — pure merger accepting `deterministic[]`, `formatting[]`, and `semantic[]`.
  - Validates every raw finding through `FindingSchema` (invalid findings, including inverted ranges, are silently skipped).
  - Collapses exact duplicates by range + category + message.
  - Preserves overlapping findings with different categories.
  - Resolves same-category overlaps by longest-match-wins, then severity (`error` > `warning` > `info`), then stable source order.
  - Overlap grouping is unit-aware: findings in different range units never conflict.
  - Sorts deterministically by `range.start`, then `range.end`, then `severity`, then source index.
  - Preserves `suggestedChangeId` linkage.
- `src/analysis/index.ts` — barrel re-exporting `unifyFindings` and `UnifyOptions`.
- `eslint.config.mjs` — `src/analysis/` scope forbidding `ui` and `word/revisionAdapter` imports.
- `tests/unit/analysis/unifiedFindings.test.ts` — 15 tests covering empty inputs, single-source passthrough, cross-source dedupe, different-category overlaps, same-range collapse, longest-match-wins, transitive overlap resolution, equal-length severity tie-break, stable source-order tie-break, range-unit separation, `suggestedChangeId` preservation, synthetic semantic fixtures, deterministic ordering, large mixed inputs, and invalid-range rejection.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run test` passes — 320 tests across 34 files
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `src/analysis/` coverage: 100% lines / 100% functions / 91.89% branches (threshold 80%)
- [x] `docs/project-state.md` updated

## Status

PASS
