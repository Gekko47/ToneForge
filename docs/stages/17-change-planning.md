# Stage 17 — Change planning

**Gate**: Yes

## Objective

Add change planning and conflict detection.

## Scope

- `src/changes/planner.ts` — turn `Findings[]` into `ChangePlan`.
- `src/changes/conflictDetector.ts` — detect overlapping or conflicting changes.
- `src/changes/staleGuard.ts` — detect stale document hashes.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Coverage threshold met for `changes/`
- [ ] `docs/project-state.md` updated

## Status

PENDING
