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

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [x] `docs/project-state.md` updated

## Status

PASS — `loadState()` now calls `migrate(raw)` before `StateSchema.parse`, so
v0 persisted state is upgraded to v1 instead of being discarded. Migration
behavior is covered by Office-path tests.
