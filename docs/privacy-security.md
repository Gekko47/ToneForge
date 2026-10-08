# ToneForge — Privacy & Security

The canonical implementation status and release gates are in
[`ROADMAP.md`](../ROADMAP.md). This document describes the current privacy and
security posture and known limitations.

## Data handling

- **Credentials**: API keys are not ordinary settings, are not accepted by the
  Settings form, and are not compiled into Webpack browser assets. State v15
  removes legacy `openAiApiKey` values and purges v1-v14 storage records while
  preserving user consent. Settings includes a clear-legacy-credential action
  that selects the offline mock provider.
- **Development gateway**: the local Webpack HTTPS server exposes
  `/__toneforge/gateway/v1/*` routes only during `npm run dev`. The Node
  process reads `.env`; the browser bundle receives no key or full environment
  object. The gateway requires a loopback same-origin request or a session
  nonce, accepts only `application/json`, validates the bounded chat-completion
  schema, and does not log prompts, document text, request/response bodies, or
  authorization headers. The development gateway holds a deployment-managed
  credential in memory; no user API key is required.
- **Production custody**: this repository does not claim an approved production
  browser-credential model. A deployed gateway, identity model, and
  formal threat model remain release decisions; unsupported production live-AI
  use must stay disabled rather than falling back to a browser-held key.
- **Dual-role LLM bindings**: the `llmRoleBindings` persisted in state v15
  contain only opaque connection identifiers (`connectionId`) and model names
  (`selectedModel`). No credential, token, or key material is stored. A
  reflection test (`assertRoleSchemasAreSecretFree` in
  `src/core/domain/LlmRole.ts`) enforces this at the schema level — any new
  string field that is not in the known-safe set causes the test to fail.
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

## Cross-report consistency review (Phase 5)

The consistency engine is the widest data-egress surface in the product and is
governed separately from every other review.

**Three consents, none of which implies another.** Spot review,
full-document review, and semantic opt-in are all scope-specific. A fourth flag,
`settings.consistencyReviewConsent` (state v9), gates the consistency engine
alone. It defaults to `false`, `migrateV8ToV9` sets it to `false` rather than
deriving it, and `normalizeSettings` re-derives every consent flag from a strict
boolean so a persisted `"yes"` or `1` reads as a refusal rather than as
permission. A user who agreed to send a selection has not agreed to send a whole
document to be compared against itself.

**One consent governs the one feature that needs it.** Per ADR-0055 the task pane
now presents a single AI Review, the cross-report consistency check, so
`consistencyReviewConsent` is the only consent it depends on. `spotReviewConsent` and
`fullDocumentReviewConsent` no longer have a Settings toggle: their entry points are
retired, so nothing in the shipped pane can read them. Both fields are **kept** in the
state schema, the defaults, and the migrations, so existing state loads unchanged and
no state version bump is required. Their removal from the UI relaxes nothing — a
consent that no control can read cannot be granted by it, and the flags remain
`false` by default for any consumer that is reintroduced.

**Diagnostics are no longer fully redacted, and this is deliberate.** `errorName`,
`errorCode`, and `errorMessage` are exempt from the content-redaction rule so a Word
host failure is diagnosable; a blanket `/error/i` rule previously turned every
failure into `[REDACTED_CONTENT]`. Those three fields still pass through credential
redaction and are capped at 200 characters, so a message that embeds a paragraph is
truncated rather than logged. Every other key — including the bare `error` key, and
every document, prompt, evidence, and text field — is unchanged. See ADR-0056.

**What leaves the add-in.** The whole document's text, and nothing else. Not the
profile, not the governance policy, not the model catalog, not a credential. The
engine reuses the already-configured provider and model and has no provider
picker of its own.

**What never leaves.** No credential, in any code path. Consistency findings
carry document text in their evidence, so they are subject to the same redaction
rules as any other finding; `logger` and `OpenAiAdapter.redact` continue to apply
and the engine logs only a check id and an error name on failure.

**What the engine will not do without being asked.** It is never invoked from
the typing path, the document observer, or any incremental scan. The entry point
is a button, and the preflight is shown before anything is sent.

**Cost proportionality.** Pairwise comparison is quadratic, so a run is bounded
at 400 statements and the bound is reported as a limitation. Without a configured
provider the engine still runs every deterministic comparison, reports the
candidates it could not adjudicate, and sets `usedModel: false` — it does not
silently substitute a stub that would let a report read as model-reviewed.

## What Semantic Review sends, and what it keeps

The semantic review is the only surface that sends the user's own prose to a
provider, so it is worth stating exactly what crosses the boundary and exactly
what does not.

**Sent, in one request:** the text the user selected, and the semantic profile it
is measured against. Nothing else. **Not sent:** the rest of the document, the
document's name or id, the findings from any earlier scan, the governance policy,
or the review's own outcome history.

Three boundaries are enforced in code rather than in prose:

1. **Explicit selection.** The selection is read only when the user presses
   _Use current selection_, or arrives from the context menu — a local Word call
   that sends nothing. No poller watches the document or the selection.
2. **Explicit opt-in, and only for this feature.** `semanticOptIn` governs the
   semantic review and nothing else; it is re-derived from a strict boolean on every
   load, so a stored `"yes"` cannot read as permission. The consistency review has
   its own separate consent, and neither implies the other.
3. **A size cap, stated above the limit.** A review is refused above
   `MAX_REVIEW_SELECTION_CHARS` rather than truncated, because a review of the
   first 20 000 characters of a passage is not a review of the passage.

**What is kept locally, and what is not.** The sample used to learn a style is
**never stored**. What is stored is metadata: its source, its word and sentence
count, when it was captured, and a hash that lets two samples be compared without
keeping either. The review's outcome log carries a session id, the profile id and
revision, the outcome, the time, whether the local check passed, and the selection's
word count — and, since the P1 review, **no document identity at all**, so it is not
a durable record of which document a user ran a model against. A test reflects over
both schemas, mirroring the `ProviderConnection` credential test, so a future field
cannot quietly reintroduce either.

**Where the check runs.** The preservation check that decides whether a revision may
be written is local and deterministic: it compares protected facts and qualifiers in
the original against the proposed revision, on this machine, before any write. Its
report is shown to the user, and its `surface` values must never be logged — the
reason `redactSensitiveText` strips document-content fields from log context.

**What a refusal looks like.** Every refusal names the control that resolves it
(ADR-0069). A permission you have not granted, a provider that is not configured, a
profile that does not exist, a selection that is too long, and a revision the local
check protects are five different sentences with five different remedies, and
Troubleshooting carries all five. None of them is a discovered host exception.

## Dependency advisory audit — 2026-09-26

`npm audit` reports 25 advisories. The classification below is by **whether the
package reaches the shipped add-in bundle**, because severity alone does not
say whether a user is exposed. [`webpack.common.js`](../webpack.common.js)
bundles only `src/`, so a package that no module under `src/` imports cannot
appear in `dist/`.

### Reaches the shipped bundle

| Package | Version | Severity | Advisory                                                                            | Assessment                                                                                  |
| ------- | ------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `uuid`  | 9.0.1   | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (CVSS 7.5) | Out-of-bounds write in `v3`/`v5`/`v6` **when a `buf` argument is supplied**. Not reachable. |

`uuid` is a direct runtime dependency and is imported at 17 call sites, all of
the form `import { v4 as uuidv4 } from "uuid"`. Every call is `uuidv4()` with no
arguments. The advisory requires both a non-`v4` function _and_ a caller-supplied
`buf`, so the vulnerable path is not reachable from this codebase today. It is
recorded here rather than dismissed: the version is in the bundle, and "we do
not call the vulnerable function" is a weaker guarantee than "the version is
not vulnerable".

### Does not reach the shipped bundle

| Group                         | Packages                                                                                                                                                                                                                                                                                                                                                                                              | Severity            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Test runner                   | `vitest`, `@vitest/coverage-v8`, `@vitest/mocker`                                                                                                                                                                                                                                                                                                                                                     | critical, moderate  |
| Sideload and manifest tooling | `office-addin-debugging`, `office-addin-manifest`, `office-addin-dev-certs` and their transitives (`@azure/msal-node`, `@microsoft/teamsfx-core`, `@microsoft/teamsapp-cli`, `adm-zip`, `tmp`, `inquirer`, `@inquirer/editor`, `@inquirer/prompts`, `external-editor`, `launch-editor`, `office-addin-node-debugger`, `office-addin-project`, `office-addin-usage-data`, `office-addin-dev-settings`) | high, moderate, low |
| Development server            | `webpack-dev-server`, `sockjs`, `vite`, `vite-node`, `esbuild`                                                                                                                                                                                                                                                                                                                                        | high, moderate      |

These execute on a developer's machine during `npm run sideload`, `npm run dev`,
or `npm test`. They are not installed on an end user's machine and are not in
`dist/`. Their residual risk is to the developer and to CI, not to a user of the
add-in. The `esbuild` and `vite` dev-server advisories in particular describe a
local development server accepting requests it should not; that server is bound
to `localhost` and is not part of any shipped artifact.

### Decision

**No version changes were made in this phase.** The reasoning is recorded so it
can be revisited rather than re-derived:

- The one advisory that ships (`uuid`) is not reachable from any current call
  site, and its fix is a five-major jump (`9` to `14`). Applying that mid-phase,
  while Phase 6 is held and the add-in's provider layer is being restructured,
  would change 17 import sites and the module's ESM/CommonJS surface at the same
  time — a poor trade for an unreachable path.
- Every remaining advisory is confined to development tooling, where the
  exposure is a developer's own machine.

**This is a deferral, not a clearance.** Taking the upgrade decision is a stated
prerequisite for Phase 6 and is not optional there. Before release, `uuid` should
be moved to a non-vulnerable major (or replaced with the platform
`crypto.randomUUID`, which would remove the dependency entirely) and the sideload
tooling should be re-audited when `office-addin-debugging` ships a fixed line.

## Open work

- Complete the formal credential-custody threat model and approve the production
  broker/authentication architecture. Repository tests do not close that
  product/security decision.
- Complete live browser and host-specific data-flow verification; no live
  browser credential experiment is claimed by this change.
- Complete the host matrix and release acceptance checklist in
  [`ROADMAP.md`](../ROADMAP.md).
- Take the deferred dependency-upgrade decision recorded above before any
  Phase 6 work begins.
