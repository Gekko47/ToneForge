# Stage 22 — Safe application

**Gate**: Yes

## Objective

Add stale-result protection and safe application logic.

## Scope

- `src/changes/staleGuard.ts` — re-hash document before applying; abort if stale.
- `src/word/revisionAdapter.ts` — integrate stale check before apply.
- UI confirmation before applying changes.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
