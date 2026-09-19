# Stage 10 — Style profiler

**Gate**: Yes

## Objective

Add semantic style profiling via the LLM.

## Scope

- `src/style/profiler.ts` — calls `LlmRegistry` to produce a `StyleProfile` from a sample.
- Uses `src/ai/prompts/profilePrompts.ts`.
- Tests use `MockAdapter`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
