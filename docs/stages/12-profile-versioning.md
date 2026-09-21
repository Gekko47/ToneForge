# Stage 12 — Profile versioning

**Gate**: Yes

## Objective

Add profile versioning and diffs.

## Scope

- Extend `StyleProfile` with version bump helpers.
- `src/style/versioning.ts` — diff two profiles, produce a changelog.
- UI integration in `src/taskpane/components/`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (218 tests)
- [x] `npm run lint` passes
- [x] `npm run format` passes
- [x] `npm run build` passes
- [x] `npm run validate` passes
- [x] `docs/project-state.md` updated

## Status

PASS

## Implementation notes

- State schema bumped to v2 with `profileHistory: Record<ProfileId, StyleProfile[]>`.
- `src/core/state/migration.ts` handles v0 → v1 → v2 and seeds history from existing profiles.
- `upsertProfile` appends a prior snapshot before replacing; `removeProfile` deletes history.
- `VersionDiff.tsx` now consumes `diffProfiles`/`formatChangelog` from `src/style/versioning.ts`.
- `ProfileEditor.tsx` exposes Major/Minor/Patch bump buttons and a collapsible history list.
