---
name: toneforge-llm-privacy
description: Protect document text and secrets in LLM prompts — require explicit opt-in before raw text leaves the add-in.
---

# LLM Privacy

Raw document text must never leave the add-in without explicit user opt-in, and
no API key is ever persisted by the add-in.

## When to use

- Building or modifying prompt templates in `src/ai/prompts/`.
- Adding or extending providers in `src/ai/providers/` or `src/ai/gateway/`.
- Handling credentials or connection state.
- Debugging redaction, retry, or abort behavior.

## Rules

### 1. Prompt builders throw unless `includeRawText: true`

Every builder in `src/ai/prompts/` (`buildProfilePrompt`, `buildDeviationPrompt`,
`buildRewritePrompt`, and the spot prompts) requires an `includeRawText` option
and throws when it is not `true`:

```text
"buildProfilePrompt requires includeRawText: true — raw document text must not
leave the add-in without explicit user opt-in"
```

Never bypass this. A new prompt builder gets the same gate. Validate every
response with a Zod schema; never trust raw model output.

**Evidence:** `src/ai/prompts/profilePrompts.ts`; `src/ai/prompts/rewritePrompts.ts`.

### 2. The add-in never persists a credential

Not in `Office.roamingSettings`, not in `localStorage`, not in the bundle, not in
a URL, not in a log line.

- `src/core/domain/ProviderConnection.ts` has **no field capable of holding a
  secret**. A test reflects over the schema so a future field cannot quietly
  reintroduce one.
- The browser-held `apiKey` credential mode was removed entirely (ADR-0049).
  Auth modes are now `oauth`, `deploymentManaged`, `brokerApiKey`, and `none`.
- `src/core/config/env.ts` holds **no secret field** by design. Webpack compiles
  only an allowlisted, non-secret environment set. The gitignored `.env` is read
  only by the Node-side development broker.
- Legacy `openAiApiKey` values are stripped on migration and legacy storage keys
  purged, while consent is preserved.

**Evidence:** `src/core/domain/ProviderConnection.ts`; `src/core/config/env.ts`;
`docs/privacy-security.md`; ADR-0049.

### 3. OpenRouter's key is transient and gateway-held

OpenRouter is the one provider taking a user-held key. It lives in **component
state only**, is submitted **once** over the loopback same-origin and
nonce-protected channel, and is **dropped when the request settles**, success or
failure. Only the opaque connection reference is persisted, and the key is held
in the **local development gateway's memory** (ADR-0050). It is kept in
`OpenRouterConnectionSettings.tsx`, a separate component, so it cannot leak into
`LlmSettingsDraft` — which has no field that could hold one.

**Evidence:** `src/taskpane/components/OpenRouterConnectionSettings.tsx`;
`scripts/dev-gateway.mjs`; ADR-0050.

### 4. One consent governs one feature

`semanticOptIn` and `consistencyReviewConsent` are independent; the spot and
full-document consents are retired and kept only for migration. None implies
another. `consistencyReviewConsent` defaults to `false`, migration sets it to
`false` rather than deriving it, and `normalizeSettings` re-derives every consent
flag from a strict boolean so a stored `"yes"` cannot read as permission.

**Evidence:** `docs/privacy-security.md`; ADR-0052.

### 5. Redact secrets and content in logs and payloads

- `src/shared/utils/redaction.ts` is the shared implementation;
  `redactSensitiveText` strips credential-shaped, prompt-content, and
  document-content fields from logs and recursive error context.
- `OpenAiAdapter.redact()` and the gateway adapters strip emails, card numbers,
  API keys (`sk-`/`pk-`/`rk-`/`whsec-`), bearer tokens, and long hex or base64
  secrets before logging.
- Telemetry is disabled by default (`TELEMETRY_DISABLED=1`); no analytics
  endpoint is configured.

**Evidence:** `src/shared/utils/redaction.ts`; `src/ai/providers/gatewayAdapter.ts`.

### 6. Honor AbortSignal for cancellable requests

All LLM requests accept an `AbortSignal`. Caller cancellation is non-retryable;
an internal timeout is retryable. Use `withRetry()` from
`src/ai/providers/retry.ts` for transient failures.

**Evidence:** `src/ai/providers/LlmProvider.ts`; `src/ai/providers/retry.ts`;
ADR-0011.

## Referenced resources

- `src/ai/prompts/` — prompt builders with the `includeRawText` gate
- `src/ai/gateway/gatewayClient.ts` — the only module that talks to a credential service
- `src/core/domain/ProviderConnection.ts` — non-secret by construction
- `src/core/config/env.ts` — env validation, no secret fields
- `docs/privacy-security.md` — privacy posture
- `docs/decision-log.md` — ADR-0011, ADR-0049, ADR-0050, ADR-0052
- `.cline/skills/toneforge-llm/SKILL.md` — the Cline equivalent of this rule
