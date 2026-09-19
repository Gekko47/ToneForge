# Stage 16 — Unified findings

**Gate**: Yes

## Objective

Add the unified finding model that merges deterministic and semantic findings.

## Scope

- `src/analysis/unifiedFindings.ts` — merge `Findings[]` from rules, formatting, and semantic engines.
- Deduplicate by range and category.
- Tests under `tests/unit/analysis/`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
