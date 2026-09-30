---
paths:
  - "src/ai/**"
  - "src/core/config/**"
  - "src/core/domain/ProviderConnection.ts"
  - "src/taskpane/components/OpenRouterConnectionSettings.tsx"
  - "src/taskpane/components/ProviderPrivacySettingsSection.tsx"
  - ".env"
  - ".env.example"
  - "scripts/dev-broker.mjs"
  - "scripts/dev-gateway.mjs"
---

# LLM Privacy and Credentials

Raw document text must never leave the add-in without explicit opt-in, and no
API key is ever persisted by the add-in.

## Rules

### 1. Prompt builders throw unless raw text is explicitly opted in

Every builder in [`src/ai/prompts/`](../../src/ai/prompts/) takes an
`includeRawText` option and throws when it is not `true`. Never bypass this. A
new prompt builder gets the same gate. Validate every response with a Zod
schema; never trust raw model output.

### 2. The add-in never persists a credential

Not in `Office.roamingSettings`, not in `localStorage`, not in the bundle, not in
a URL, not in a log line.

- [`ProviderConnection.ts`](../../src/core/domain/ProviderConnection.ts) has **no
  field capable of holding a secret**. A test reflects over the schema so a future
  field cannot quietly reintroduce one. If your change needs a credential, the
  architecture is wrong, not the test.
- The browser-held `apiKey` credential mode was removed (ADR-0049). Do not
  reintroduce it.
- [`env.ts`](../../src/core/config/env.ts) holds no secret field by design. Webpack
  compiles only an allowlisted, non-secret set. The gitignored `.env` is read
  only by the Node-side development broker.

### 3. OpenRouter's key is transient and gateway-held

OpenRouter is the one provider taking a user-held key. It lives in **component
state only**, is submitted **once** over the loopback same-origin and
nonce-protected channel, and is **dropped when the request settles**, success or
failure. Only the opaque connection reference is persisted, and the key is held
in the local development gateway's memory (ADR-0050). Keep it in
`OpenRouterConnectionSettings.tsx`, a separate component, so it cannot leak into
`LlmSettingsDraft` — which has no field that could hold one.

### 4. One consent governs one feature

`semanticOptIn` and `consistencyReviewConsent` are independent; the spot and
full-document consents are retired and kept only for migration. None implies
another, `consistencyReviewConsent` defaults to `false`, and migration sets it to
`false` rather than deriving it. A change letting one consent enable another
contradicts ADR-0052.

### 5. Redact secrets and content everywhere

`redactSensitiveText` in
[`src/shared/utils/redaction.ts`](../../src/shared/utils/redaction.ts) is the
shared implementation. Credential-shaped, prompt-content, and document-content
fields are redacted from logs and recursive error context. Honor `AbortSignal`:
caller cancellation is non-retryable, an internal timeout is retryable.

### 6. Never commit secrets

`.env` is gitignored; `.env.example` is the committable template.
`npm run secrets:scan` and `npm run secrets:verify-build` are part of the
verification graph and will fail the commit.

## Referenced resources

- [docs/privacy-security.md](../../docs/privacy-security.md) — full posture
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0049, ADR-0050, ADR-0052
- [.cline/skills/toneforge-llm/SKILL.md](../skills/toneforge-llm/SKILL.md)
