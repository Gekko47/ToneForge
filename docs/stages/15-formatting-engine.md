# Stage 15 — Formatting engine

**Gate**: Yes

## Objective

Add Word formatting analyzer and normalizer.

## Scope

- `src/formatting/analyzer.ts` — read Word styles and formatting from document snapshot.
- `src/formatting/normalizer.ts` — normalize formatting to match the profile.
- `src/formatting/wordStyles.ts` — map Word style names to profile expectations.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [x] Coverage threshold met for `formatting/`
- [x] `docs/project-state.md` updated
- [x] `npm run verify` passes (typecheck → lint → format → test → build → validate)

## Status

PASS
