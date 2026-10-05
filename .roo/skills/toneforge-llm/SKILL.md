---
name: toneforge-llm
description: Work with the provider-agnostic LLM layer in ToneForge src/ai. Use when adding providers, building prompt templates, implementing semantic profiling or deviation detection, or testing LLM behavior with MockAdapter. Apply Ponytail first — YAGNI, reuse existing code, minimal diff.
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
- `GatewayRoutedAdapter` in `src/ai/providers/gatewayAdapter.ts` — the shared base every remote provider extends.
- `openaiAdapter.ts`, `anthropicAdapter.ts`, `openRouterAdapter.ts` — thin wrappers differing only in request and response shape.
- `MockAdapter` in `src/ai/providers/mockAdapter.ts` — scripted responses keyed by prompt substring; `configured` is always `true`.
- `LlmRegistry` in `src/ai/providers/registry.ts` — selects the active provider, with `completeWithFallback` and `createLlmRegistry`.
- `src/ai/gateway/` — `gatewayClient.ts`, `modelCatalog.ts`, `oauthState.ts`. The **only** module that talks to a credential service.

## Credentials

**The add-in never persists a key, in any store.** Not in `Office.roamingSettings`, not in `localStorage`, not in the bundle, not in a URL.

- `src/core/domain/ProviderConnection.ts` has no field capable of holding a secret; a test reflects over the schema to keep it that way.
- The browser-held `apiKey` mode was removed (ADR-0049). Auth modes are `oauth`, `deploymentManaged`, `brokerApiKey`, and `none`.
- OpenRouter takes a user-held key, held in **component state only**, submitted **once** to the gateway, and **dropped when the request settles**. The key sits in the **local development gateway's memory**, not the add-in (ADR-0050).
- `src/core/config/env.ts` has no secret field. The gitignored `.env` is read only by the Node-side development broker.

## Rules

- Deterministic engines must never call the LLM directly.
- Prompts are built in `src/ai/prompts/`. Prompt builders throw unless `includeRawText: true` — they must not include raw document text unless the user has explicitly opted in. Validate LLM outputs with Zod.
- One consent governs one feature. `semanticOptIn` and `consistencyReviewConsent` are independent; the spot and full-document consents are retired and kept only for migration.
- Always respect `AbortSignal` for cancellable requests.
- Use `withRetry(fn, opts)` from `src/ai/providers/retry.ts` for transient failures.

## Testing

Use `MockAdapter` for all unit tests. Pass `{ provider: "mock" }` in
`LlmRegistry` / `createLlmRegistry` constructors. `tests/setup.ts` mocks
`fetch` so adapter tests stay offline. A mocked result is a typed contract,
not an integration — no engine has run against a real model.

## Adding a new provider

1. Extend `GatewayRoutedAdapter` in `src/ai/providers/<name>Adapter.ts` (honor `request.signal`, implement `redact()`).
2. Add the id to `ProviderIdSchema` and, if user-selectable, to `REMOTE_PROVIDER_IDS`.
3. Set its `PROVIDER_OAUTH_SUPPORT` entry deliberately.
4. Add tests under `tests/unit/ai/providers/`.
5. Update `docs/decision-log.md` with the ADR.

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
Live LLM calls require a credential in the gitignored `.env` and network access;
all unit tests must stay offline via `MockAdapter` and the `fetch` mock.

## Referenced resources

- `src/ai/providers/LlmProvider.ts` — interfaces
- `src/ai/providers/gatewayAdapter.ts` — the shared routed base
- `src/ai/providers/mockAdapter.ts` — deterministic test double
- `src/ai/providers/registry.ts` — selection and fallback
- `src/ai/providers/retry.ts` — `withRetry`
- `src/ai/gateway/gatewayClient.ts` — credential service client
- `src/ai/prompts/` — prompt builders with the `includeRawText` gate
- `src/core/domain/ProviderConnection.ts` — non-secret connection contract
- `docs/privacy-security.md` — privacy posture
- `docs/decision-log.md` — ADR-0049, ADR-0050, ADR-0052
- `.cline/skills/toneforge-llm/SKILL.md` — the Cline equivalent of this skill
