# Stage 07 — Settings UI

**Gate**: Yes

## Objective

Add provider configuration UI in the taskpane.

## Scope

- `src/taskpane/pages/Settings.tsx` — provider settings page.
- `src/taskpane/components/SettingsForm.tsx` — API key fields with redaction.
- Persist settings via `core/state/persistence.ts`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (8 component tests added)
- [x] `npm run verify` passes (typecheck → lint → format → test → build → manifest validate)
- [x] `docs/project-state.md` updated

## Status

PASS — Settings page at `src/taskpane/pages/Settings.tsx` with `src/taskpane/components/SettingsForm.tsx`; API key redacted via `env.redact` and logged only in redacted form; round-trips through `loadState`/`saveState`; invalid base URL rejected before save; cancel restores mount-time values; 8 component tests covering load, redact, dirty, save, log-redaction, validation error, toggles, and cancel.
