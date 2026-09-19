---
name: toneforge-llm
description: Work with the provider-agnostic LLM layer in ToneForge src/ai. Use when adding providers, building prompt templates, implementing semantic profiling or deviation detection, or testing LLM behavior with MockAdapter.
---

# LLM Integration for ToneForge

Use this skill when working with the provider-agnostic LLM layer in `src/ai/`.

## When to use

- Adding a new LLM provider (e.g. Azure OpenAI).
- Implementing semantic profiling or deviation detection (Stages 10, 19).
- Building or debugging prompt templates in `src/ai/prompts/`.
- Testing LLM behavior with retries, abort, and redaction.

Trigger phrases: "add an LLM provider", "debug the prompt", "semantic profile", "deviation detection", "LLM retry or abort", "mock the LLM".

## Architecture

- `LlmProvider` interface in `src/ai/providers/LlmProvider.ts` — the contract (`complete`, optional `stream`/`redact`, `LlmRequest` with `AbortSignal`, `LlmResponse`, `LlmError`).
- `LlmSemanticProvider` + `withSemanticHelpers()` in the same file — adds `profile()` / `deviations()` / `rewrite()` by delegating to `complete()`.
- `OpenAiAdapter` in `src/ai/providers/openaiAdapter.ts` — fetch-based implementation, no SDK. Honors `request.signal` via `AbortSignal.any()`; caller-abort is non-retryable, internal timeout is retryable; implements real `redact()` for emails, cards, API keys, and bearer tokens.
- `MockAdapter` in `src/ai/providers/mockAdapter.ts` — scripted responses keyed by prompt substring (`responses`, `defaultResponse`, `latencyMs`, `failOn`); `configured` is always `true`.
- `LlmRegistry` in `src/ai/providers/registry.ts` — selects the active provider. Defaults to mock when no API key is configured. `completeWithFallback(request, fallback = "mock")` retries once on the fallback provider; use `createLlmRegistry()` to get a registry with semantic helpers attached.

## Rules

- Deterministic engines must never call the LLM directly.
- Prompts are built in `src/ai/prompts/`. Prompt builders throw unless `includeRawText: true` — they must not include raw document text unless the user has explicitly opted in. Validate LLM outputs with `ProfileResponseSchema` / `DeviationResponseSchema` (Zod).
- API keys enter only through the Settings UI and are stored in `Office.roamingSettings` (validated at startup via `src/core/config/env.ts`; never commit secrets).
- Always respect `AbortSignal` for cancellable requests.
- Use `withRetry(fn, opts)` from `src/ai/providers/retry.ts` for transient failures (`RetryOptions`: `maxRetries`, `baseDelayMs`, `maxDelayMs`, `isRetryable`).

## Testing

Use `MockAdapter` for all unit tests. Pass `{ provider: "mock" }` in
`LlmRegistry` / `createLlmRegistry` constructors. `tests/setup.ts` mocks
`fetch` for `/chat/completions` so `OpenAiAdapter` tests stay offline.

## Adding a new provider

1. Implement `LlmProvider` in `src/ai/providers/<name>Adapter.ts` (honor `request.signal`, implement `redact()`).
2. Register it in the `LlmRegistry` constructor and extend `ProviderName`.
3. Add tests under `tests/unit/ai/providers/`.
4. Update `docs/decision-log.md` with the ADR.

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
Live LLM calls require an API key via Settings UI / `.env` (gitignored) and
network access; all unit tests must stay offline via `MockAdapter` and the
`fetch` mock.

## Referenced resources

- `src/ai/providers/LlmProvider.ts` — interfaces and `withSemanticHelpers`
- `src/ai/providers/openaiAdapter.ts` — fetch adapter with retry/abort/redact
- `src/ai/providers/mockAdapter.ts` — deterministic test double
- `src/ai/providers/registry.ts` — selection + `completeWithFallback`
- `src/ai/providers/retry.ts` — `withRetry`
- `src/ai/prompts/` — prompt builders with `includeRawText` opt-in gate
- `src/core/config/env.ts` — env validation with secret redaction
- `docs/stages/06-llm-provider.md`, `docs/stages/10-style-profiler.md`, `docs/stages/19-semantic-deviation.md`
