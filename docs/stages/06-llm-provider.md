# Stage 06 — LLM provider layer

**Gate**: Yes

## Objective

Add resilient provider adapters behind a provider-agnostic interface.

## Scope

- `src/ai/providers/LlmProvider.ts` — interface.
- `src/ai/providers/openaiAdapter.ts` — fetch-based OpenAI adapter.
- `src/ai/providers/mockAdapter.ts` — scripted mock for tests.
- `src/ai/providers/registry.ts` — `LlmRegistry` with fallback.
- `src/ai/providers/retry.ts` — retry helper.
- `src/ai/prompts/` — prompt builders.
- Tests under `tests/unit/ai/providers/` and `tests/integration/`.

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `docs/project-state.md` updated

## Status

PENDING
