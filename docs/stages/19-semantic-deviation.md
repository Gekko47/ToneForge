# Stage 19 — Semantic deviation

**Gate**: Yes

## Objective

Add the semantic style deviation engine.

## Scope

- `src/analysis/deviationEngine.ts` — use `LlmRegistry` to detect semantic deviations from the profile.
- Uses `src/ai/prompts/profilePrompts.ts`.
- Tests use `MockAdapter`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
