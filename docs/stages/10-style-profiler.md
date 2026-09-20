# Stage 10 — Style profiler

**Gate**: Yes

## Objective

Add semantic style profiling via the LLM.

## Scope

- `src/style/profiler.ts` — calls `LlmRegistry` to produce a `StyleProfile` from a sample.
- Uses `src/ai/prompts/profilePrompts.ts`.
- Tests use `MockAdapter`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [x] `docs/project-state.md` updated

## Status

PASS
