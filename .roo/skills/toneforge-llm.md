# Skill: LLM Integration for ToneForge

Use this skill when working with the provider-agnostic LLM layer in `src/ai/`.

## When to use

- Adding a new LLM provider (e.g. Azure OpenAI).
- Implementing semantic profiling or deviation detection (Stages 10, 19).
- Building or debugging prompt templates.
- Testing LLM behavior.

## Architecture

- `LlmProvider` interface in `src/ai/providers/LlmProvider.ts` — the contract.
- `OpenAiAdapter` — fetch-based implementation, no SDK.
- `MockAdapter` — scripted responses for deterministic tests.
- `LlmRegistry` — selects active provider and provides fallback.

## Rules

- Deterministic engines must never call the LLM directly.
- Prompts are built in `src/ai/prompts/`. They must not include raw document text unless the user has explicitly opted in.
- API keys enter only through the Settings UI and are stored in `Office.roamingSettings`.
- Always respect `AbortSignal` for cancellable requests.
- Use `withRetry` from `src/ai/providers/retry.ts` for transient failures.

## Testing

Use `MockAdapter` for all unit tests. Set `provider: "mock"` in `LlmRegistry` constructors.

## Adding a new provider

1. Implement `LlmProvider` in `src/ai/providers/<name>Adapter.ts`.
2. Register it in `LlmRegistry` constructor.
3. Add tests under `tests/unit/ai/providers/`.
4. Update `docs/decision-log.md` with the ADR.
