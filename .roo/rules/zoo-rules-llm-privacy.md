---
name: toneforge-llm-privacy
description: Protect document text and secrets in LLM prompts — require explicit opt-in before raw text leaves the add-in.
---

# LLM Privacy

Raw document text must never leave the add-in without explicit user opt-in.
API keys are stored only in `Office.roamingSettings` and redacted in logs.

## When to use

- Building or modifying prompt templates in `src/ai/prompts/`.
- Adding or extending LLM providers in `src/ai/providers/`.
- Configuring settings UI for API keys (Stage 07+).
- Debugging redaction, retry, or abort behavior.

## Rules

### 1. Prompt builders throw unless `includeRawText: true`

All prompt builders in `src/ai/prompts/` (`buildProfilePrompt`,
`buildDeviationPrompt`, `buildRewritePrompt`) require an
`includeRawText: boolean` option. When `false` (the default), they throw:

```
"buildProfilePrompt requires includeRawText: true — raw document text must
not leave the add-in without explicit user opt-in"
```

- Never bypass this check. If a prompt needs text, the caller must pass
  `includeRawText: true` **and** the user must have explicitly opted in via
  the Settings UI.
- Do not add a new prompt builder without this gate.

**Evidence:** `src/ai/prompts/profilePrompts.ts` lines 48-52, 77-80;
`toneforge-llm` skill "Rules" section.

### 2. Validate LLM outputs with Zod

All LLM responses are parsed with a Zod schema (`ProfileResponseSchema`,
`DeviationResponseSchema`, etc.). Unknown fields are stripped; missing
required fields produce a typed error. Never trust raw model output.

**Evidence:** `src/ai/prompts/profilePrompts.ts` lines 19-41.

### 3. API keys never enter source code

API keys are entered only through the Settings UI and stored in
`Office.roamingSettings`. They are validated at startup by
`src/core/config/env.ts` (Zod). `.env` is gitignored; `.env.example` is the
template. Never commit a real key.

**Evidence:** `docs/privacy-security.md`; `src/core/config/env.ts` lines 13-24;
`.env.example`.

### 4. Redact secrets in logs and LLM payloads

- `src/shared/utils/logger.ts` redacts any context field whose name matches
  `/key|token|secret|password|auth/i`.
- `OpenAiAdapter.redact()` strips emails, card numbers, API keys
  (`sk-`/`pk-`/`rk-`/`whsec-`), bearer tokens, and long hex/base64 secrets
  before logging.
- Telemetry is disabled by default (`TELEMETRY_DISABLED=1`). No analytics
  endpoint is configured.

**Evidence:** `src/shared/utils/logger.ts` lines 12-22;
`src/ai/providers/openaiAdapter.ts` lines 29-53;
`docs/privacy-security.md`.

### 5. Honor AbortSignal for cancellable requests

All LLM requests accept an `AbortSignal`. Caller cancellation is
non-retryable; internal timeout is retryable. Use `withRetry()` from
`src/ai/providers/retry.ts` for transient failures.

**Evidence:** `src/ai/providers/openaiAdapter.ts` lines 5-13;
`src/ai/providers/retry.ts`; ADR-0011.

## Referenced resources

- `src/ai/prompts/` — prompt builders with `includeRawText` gate
- `src/ai/providers/openaiAdapter.ts` — redaction patterns
- `src/shared/utils/logger.ts` — log redaction
- `src/core/config/env.ts` — env validation
- `docs/privacy-security.md` — privacy posture
- `docs/decision-log.md` — ADR-0011
