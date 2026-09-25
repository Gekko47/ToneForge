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

PASS — the current persisted schema is v5. `loadState()` calls `migrate(raw)`
before `StateSchema.parse`; v0-v4 style/settings and consent data are preserved,
legacy API-key fields are removed, governance history is initialized or migrated,
and corrupt data falls back to defaults. Migration is covered through both
Office roaming-settings and localStorage fallback tests. The canonical release
status remains in [`ROADMAP.md`](../../ROADMAP.md).
