# Stage 21 — Reformat orchestrator

**Gate**: Yes

## Objective

Add the hybrid document reformatter.

## Scope

- `src/reformat/orchestrator.ts` — drive the full reformat pipeline: snapshot → analyze → plan → apply.
- Uses `word/documentReader` and `word/revisionAdapter`.
- Tests at `tests/integration/`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
