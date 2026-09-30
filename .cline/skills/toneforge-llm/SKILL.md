---
name: toneforge-llm
description: Work with ToneForge's provider-agnostic, gateway-routed LLM layer and its consent gates. Use when adding a provider, writing prompts, handling credentials, or testing LLM behaviour with MockAdapter.
---

# LLM Integration for ToneForge

Use this skill for anything in `src/ai/`, and for any change that sends document
text to a model.

## When to use

- Adding or changing a provider adapter.
- Building a prompt template.
- Handling credentials or connection state.
- Debugging retry, abort, redaction, or consent behaviour.

Trigger phrases: "add an LLM provider", "debug the prompt", "API key", "provider
connection", "LLM retry or abort", "mock the LLM", "send text to the model".

## Architecture

- [`LlmProvider.ts`](../../../src/ai/providers/LlmProvider.ts) — the contract:
  `complete`, optional `stream` and `redact`, `LlmRequest` with `AbortSignal`,
  `LlmResponse`, `LlmError`.
- [`gatewayAdapter.ts`](../../../src/ai/providers/gatewayAdapter.ts) —
  `GatewayRoutedAdapter`, the shared base every remote provider extends.
- `openaiAdapter.ts`, `anthropicAdapter.ts`, `openRouterAdapter.ts` — thin
  wrappers differing only in request and response shape.
- [`mockAdapter.ts`](../../../src/ai/providers/mockAdapter.ts) — scripted
  offline double, always `configured`.
- [`registry.ts`](../../../src/ai/providers/registry.ts) — selects the active
  provider, with `completeWithFallback` and `createLlmRegistry`.
- [`retry.ts`](../../../src/ai/providers/retry.ts) — `withRetry` for transient
  failures.
- [`src/ai/gateway/`](../../../src/ai/gateway/) — the **only** module that talks
  to a credential service: `gatewayClient.ts`, `modelCatalog.ts`, `oauthState.ts`.

## Credentials — the current model

This is the part most likely to be got wrong, so state it precisely.

**No API key is ever persisted by the add-in, in any store.** Not in
`Office.roamingSettings`, not in `localStorage`, not in the bundle, not in a URL.

- [`ProviderConnection.ts`](../../../src/core/domain/ProviderConnection.ts) has
  **no field capable of holding a secret**. It holds an opaque connection id plus
  non-secret account, provider, and model metadata. A test reflects over the
  schema so a future field cannot quietly reintroduce one.
- The browser-held `apiKey` credential mode was **removed entirely** (ADR-0049).
  Auth modes are now `oauth`, `deploymentManaged`, `brokerApiKey`, and `none`.
- **OpenRouter** is the one provider taking a user-held key. The key lives in
  **component state only**, is submitted **once** to the gateway over the
  loopback same-origin and nonce-protected channel, and is **dropped when the
  request settles**, success or failure. Only the opaque connection reference
  comes back and is persisted (ADR-0050). The key is held in the **local
  development gateway's memory**, not by the add-in.
  `OpenRouterConnectionSettings.tsx` is a separate component precisely so the key
  cannot leak into `LlmSettingsDraft`, which has no field that could hold one.
- The add-in **never runs the authorization-code exchange**. It owns no client
  secret, generates no PKCE verifier, and holds no refresh token. The browser
  legitimately cannot keep a secret.
- [`env.ts`](../../../src/core/config/env.ts) contains **no secret field** by
  design. Webpack compiles only an allowlisted, non-secret environment set. The
  gitignored `.env` is read only by the Node-side development broker.
- `LLM_BROKER_URL` must be a same-origin path or an HTTP(S) loopback origin. It
  is refined and rejected at parse time, so a user cannot point the add-in at a
  host they control and receive every request.

If your change needs a credential, it needs a gateway endpoint and an opaque
connection reference. If it needs a field that holds the secret itself, the
design is wrong.

## Rules

- Deterministic engines never call the LLM. A model is asked only where
  interpretation is required.
- **Prompt builders must require an explicit raw-text opt-in.** They throw
  without it. Validate every response with a Zod schema; never trust raw model
  output.
- **Respect `AbortSignal`.** Caller cancellation is non-retryable; an internal
  timeout is retryable.
- **Redact** credentials, prompt content, and document content in logs and error
  context. `redactSensitiveText` in
  [`src/shared/utils/redaction.ts`](../../../src/shared/utils/redaction.ts) is
  the shared implementation.
- Reject a policy-rejected base origin at request time. Policy is re-evaluated on
  read, never trusted from storage.

## Consents

Four flags exist and none implies another. One consent governs one feature.

| Flag                        | Gates                                    |
| --------------------------- | ---------------------------------------- |
| `semanticOptIn`             | Optional semantic profile interpretation |
| `consistencyReviewConsent`  | The cross-report consistency engine      |
| `spotReviewConsent`         | Retired; kept for migration only         |
| `fullDocumentReviewConsent` | Retired; kept for migration only         |

`consistencyReviewConsent` defaults to `false` and is **set** to `false` by
migration rather than derived from another flag. `normalizeSettings` re-derives
every consent flag from a strict boolean, so a stored `"yes"` cannot read as
permission. A change that lets one consent enable another contradicts ADR-0052.

## Testing

Use `MockAdapter` and `{ provider: "mock" }` everywhere. Never hit the network in
a test; `tests/setup.ts` also provides a `fetch` double. Live provider testing
is a separate manual step documented in
[`docs/onboarding.md`](../../../docs/onboarding.md).

## Adding a provider

1. Extend `GatewayRoutedAdapter` in `src/ai/providers/<name>Adapter.ts`, honour
   `request.signal`, and implement `redact()`.
2. Add the id to `ProviderIdSchema` and, if user-selectable, to
   `REMOTE_PROVIDER_IDS`.
3. Set the provider's `PROVIDER_OAUTH_SUPPORT` entry deliberately.
4. Add tests under `tests/unit/ai/providers/`.
5. Record an ADR.

## Referenced resources

- [`src/ai/providers/LlmProvider.ts`](../../../src/ai/providers/LlmProvider.ts) — interfaces
- [`src/ai/gateway/gatewayClient.ts`](../../../src/ai/gateway/gatewayClient.ts) — credential service client
- [`src/ai/prompts/`](../../../src/ai/prompts/) — builders with the raw-text gate
- [`src/core/domain/ProviderConnection.ts`](../../../src/core/domain/ProviderConnection.ts) — non-secret by construction
- [`docs/privacy-security.md`](../../../docs/privacy-security.md) — privacy posture
- [`docs/decision-log.md`](../../../docs/decision-log.md) — ADR-0049, ADR-0050, ADR-0052
