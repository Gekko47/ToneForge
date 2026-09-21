# Stage 11 — Editable Style Profile UI

**Gate**: Yes

## Objective

Add an editable Style Profile UI in the taskpane that loads the active persisted
profile, renders measured metrics as read-only derived data, and lets the user
edit semantic, typography, and house-style fields.

## Scope

- `src/taskpane/pages/Profile.tsx` — page wrapper with local and Fluent theme providers.
- `src/taskpane/components/ProfileEditor.tsx` — main editor component.
- `src/taskpane/components/VersionDiff.tsx` — read-only draft-versus-saved diff preview.
- `src/taskpane/pages/Dashboard.tsx` — lazy navigation to the Profile page.
- Wiring to `core/state/persistence.ts` via `loadState`, `upsertProfile`, `setActiveProfile`.

## Implementation notes

- Measured metrics are rendered in a `<dl>` and are never editable; they are
  derived from the captured writing sample.
- Draft validation uses `StyleProfileSchema.safeParse`; unresolved errors are
  surfaced as `MessageBar` errors with `role="alert"`.
- Success and status regions use `aria-live="polite"`.
- `VersionDiff` compares the current validated draft against the last saved
  profile. It explicitly does **not** implement persistent version history or
  version bumps — that remains Stage 12 (`src/style/versioning.ts`).

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run lint` passes with zero warnings
- [x] `npm run format` passes
- [x] `npm run test` passes (200 tests, including 9 Stage 11 component tests)
- [x] `npm run build` succeeds
- [x] `npm run validate` (manifest) passes
- [x] `docs/project-state.md` updated

## Status

PASS
