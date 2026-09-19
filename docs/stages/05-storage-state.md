# Stage 05 — Storage/state

**Gate**: Yes

## Objective

Add persistence and application state management.

## Scope

- `src/core/state/persistence.ts` — `Office.roamingSettings` + localStorage fallback.
- `src/core/state/migration.ts` — versioned state migrations.
- `src/core/state/index.ts` — barrel export.
- Tests under `tests/unit/core/state/`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
