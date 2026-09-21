# Stage 13 — Typography rules

**Gate**: Yes

## Objective

Add the deterministic typography and punctuation engine.

## Scope

- `src/rules/typography.ts` — em dash, en dash, quotes, apostrophes, whitespace, ellipsis.
- Pure functions; no Office or LLM imports.
- Tests under `tests/unit/rules/`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [x] Coverage threshold met for `rules/`
- [x] `docs/project-state.md` updated

## Status

PASS
