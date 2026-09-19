# Stage 15 — Formatting engine

**Gate**: Yes

## Objective

Add Word formatting analyzer and normalizer.

## Scope

- `src/formatting/analyzer.ts` — read Word styles and formatting from document snapshot.
- `src/formatting/normalizer.ts` — normalize formatting to match the profile.
- `src/formatting/wordStyles.ts` — map Word style names to profile expectations.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Coverage threshold met for `formatting/`
- [ ] `docs/project-state.md` updated

## Status

PENDING
