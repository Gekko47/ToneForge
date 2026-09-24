# ToneForge — Privacy & Security

The canonical implementation status and release gates are in
[`ROADMAP.md`](../ROADMAP.md). This document describes the current privacy and
security posture and known limitations.

## Data handling

- **API keys**: entered only through Settings, stored in
  `Office.roamingSettings`, and never committed. The localStorage fallback is
  not encrypted by this repository and is a documented MVP limitation.
- **Document text**: read locally for deterministic analysis. It is sent to an
  LLM only after the user explicitly enables the corresponding review consent.
- **Spot review consent**: selection and paragraph review share the explicit
  spot consent and are limited by the context minimizer.
- **Full-document consent**: whole-document review has a separate consent flag,
  excludes protected nodes, and uses bounded batches. Partial results are never
  presented as complete.
- **Telemetry**: disabled by default. No analytics endpoint is configured.

## Prompt safety

- Prompt builders require `includeRawText: true` and fail closed without it.
- Review requests are Zod-validated before provider use.
- Provider responses are parsed as JSON and validated against structured review
  schemas.
- Out-of-range, invented-text, malformed, and protected-content responses fail
  closed.
- Deterministic governance works without an AI provider.

## Logging and redaction

- `src/shared/utils/logger.ts` redacts fields matching
  `/key|token|secret|password|auth/i`.
- The OpenAI adapter redacts email addresses, card numbers, API keys, bearer
  tokens, and other configured secret patterns before logging.
- Logs should contain operation metadata, hashes, statuses, and errors, not raw
  document text. Review the logger call sites when adding a new operation.

## Storage and manifest

- `Office.roamingSettings` is used when available; localStorage is the fallback.
- Both stores are written when available, and legacy v1/v2 state keys are read
  through the v3 migration path.
- `manifest.json` v1.30 and `manifest.xml` are kept in sync and validated by
  [`scripts/validate-manifest.mjs`](../scripts/validate-manifest.mjs).
- The production build emits content-hashed bundles through
  [`webpack.prod.js`](../webpack.prod.js).

## Safety boundaries

- [`revisionAdapter.ts`](../src/word/revisionAdapter.ts) is the only mutation
  path.
- The orchestrator re-hashes before apply and refuses unresolved conflicts.
- Protected nodes and preservation literals are rejected before application.
- Coverage gaps block full-document review/export paths.

## Open work

- Complete formal security review and host-specific data-flow verification.
- Decide the production treatment of the localStorage key-storage limitation.
- Complete the host matrix and release acceptance checklist in
  [`ROADMAP.md`](../ROADMAP.md).
