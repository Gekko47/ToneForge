# ToneForge — Privacy & Security

The canonical implementation status and release gates are in
[`ROADMAP.md`](../ROADMAP.md). This document describes the current privacy and
security posture and known limitations.

## Data handling

- **Credentials**: API keys are not ordinary settings, are not accepted by the
  Settings form, and are not compiled into Webpack browser assets. State v5
  removes legacy `openAiApiKey` values and purges v1-v4 storage records while
  preserving user consent. Settings includes a clear-legacy-credential action
  that selects the offline mock provider.
- **Development broker**: the local Webpack HTTPS server exposes
  `/__toneforge/llm/v1/chat/completions` only during `npm run dev`. The Node
  process reads `.env`; the browser bundle receives no key or full environment
  object. The broker requires a loopback same-origin request or a session
  nonce, accepts only `application/json`, validates the bounded chat-completion
  schema, and does not log prompts, document text, request/response bodies, or
  authorization headers.
- **Production custody**: this repository does not claim an approved production
  browser-credential model. A deployed service broker, identity model, and
  formal threat model remain release decisions; unsupported production live-AI
  use must stay disabled rather than falling back to a browser-held key.
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

- `src/shared/utils/logger.ts` recursively removes credential fields, prompt
  and document-content fields, and secret-shaped strings from diagnostic context.
- The OpenAI adapter uses the same redaction contract and logs provider failure
  type rather than untrusted error text.
- Runtime troubleshooting displays allow-listed host capability and runtime
  booleans; it does not display credentials, prompts, or document text.
- Logs should contain operation metadata, hashes, statuses, and error types, not
  raw document text. Review the logger call sites when adding an operation.

## Storage and manifest

- `Office.roamingSettings` is used when available; localStorage is the fallback.
  Neither store is a credential vault.
- Both stores are written when available, legacy v1-v4 keys are read through
  the v5 migration path, and those legacy records are removed after migration.
- `manifest.json` v1.30 is the canonical execute-function manifest;
  `manifest.xml` is an intentional `ShowTaskpane` navigation fallback. The
  validator checks shared command IDs, labels, and task-pane destinations while
  preserving the action-mechanism difference. Live sideload of both remains an
  external host gate.
- The production build emits content-hashed bundles through
  [`webpack.prod.js`](../webpack.prod.js). Development and production sentinel
  builds scan every generated artifact and fail on secret-shaped values.

## Safety boundaries

- [`revisionAdapter.ts`](../src/word/revisionAdapter.ts) is the only mutation
  path.
- The orchestrator re-hashes before apply and refuses unresolved conflicts.
- Protected nodes and preservation literals are rejected before application.
- Coverage gaps block full-document review/export paths.

## Open work

- Complete the formal credential-custody threat model and approve the production
  broker/authentication architecture. Repository tests do not close that
  product/security decision.
- Complete live browser and host-specific data-flow verification; no live
  browser credential experiment is claimed by this change.
- Complete the host matrix and release acceptance checklist in
  [`ROADMAP.md`](../ROADMAP.md).
