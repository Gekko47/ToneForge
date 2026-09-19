# ToneForge — Architectural Decision Log

## 2026-09-19 — Repository baseline and scaffold

### ADR-0001 — Use unified JSON manifest (v1.30) over XML manifest

- **Status**: Accepted (superseded v1.10 decision on 2026-09-19)
- **Context**: Roadmap targets a Word Web Add-in. The unified manifest for Microsoft 365 is the forward-looking format and supports richer capabilities. The originally-chosen v1.10 schema did not support the Office `extensions`/`runtimes` structure required for task-pane activation.
- **Decision**: Use `manifest.json` (manifestVersion 1.30, schema `https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json`) as the canonical manifest. Keep `manifest.xml` as a validated add-in-only fallback for platforms that do not yet support the unified manifest.
- **Consequences**: The unified manifest must use `extensions[].requirements` + nested `extensions[].runtimes[]` with an `openPage` action and `code.page` only (no `script`, since the build emits content-hashed bundles). The XML fallback must declare `xmlns:bt`, use `Host Name="Document"` / `xsi:type="Document"`, include `<Permissions>ReadWriteDocument</Permissions>`, and use `bt:Urls`/`bt:ShortStrings`/`bt:LongStrings`. Both manifests are kept in sync by `scripts/validate-manifest.mjs`.
- **Supersession note**: the earlier v1.10 decision is retained for historical traceability; new code must follow v1.30.

### ADR-0002 — TypeScript + React + Fluent UI v9 + Webpack + npm

- **Status**: Accepted
- **Context**: Office add-in tooling defaults to Yeoman + React + Webpack. Fluent UI v9 is the current supported UI framework.
- **Decision**: TypeScript strict mode, React 18, Fluent UI v9, Webpack 5, npm.
- **Consequences**: Larger bundle than vanilla JS; mitigated by code-splitting and lazy-loaded pages.

### ADR-0003 — Provider-agnostic LLM interface with OpenAI + mock adapters

- **Status**: Accepted
- **Context**: Roadmap requires provider-agnostic integration and strong privacy. Azure OpenAI is deferred to a post-MVP ADR.
- **Decision**: Define `LlmProvider` interface; implement `OpenAiAdapter` (fetch-based, no SDK) and `MockAdapter` for tests. `LlmRegistry` provides fallback and switching.
- **Consequences**: Fetch-based adapter avoids SDK bloat but lacks SDK features (streaming, retries). Acceptable for MVP.

### ADR-0004 — Vitest + jsdom + Testing Library for tests

- **Status**: Accepted
- **Context**: Fast, modern test runner preferred over Jest for ESM + TypeScript ergonomics.
- **Decision**: Vitest with jsdom environment, Testing Library for component tests, coverage thresholds at 80%.
- **Consequences**: Mock `Office` global in `tests/setup.ts` so `word` modules can be imported in unit tests.

### ADR-0005 — One mutation path through `ChangePlan` → `revisionAdapter`

- **Context**: Roadmap critical ordering rule.
- **Decision**: `probeWordCapabilities()` must return `supportsRevisions: true` (or document the limitation) before any Stage 15-21 work is committed.
- **Consequences**: Reformatter development may be blocked if Word lacks revision support; fallback is tracked-change insertion with explicit documentation.
- **Context**: Roadmap "One mutation path" rule. Rules and UI must never mutate Word directly.
- **Decision**: All changes are produced as `ChangePlan` objects; only `src/word/revisionAdapter.ts` calls `Office.run`.
- **Consequences**: Adds an indirection layer; accepted for safety and auditability.

### ADR-0006 — Deterministic first, AI only where interpretation is required

- **Status**: Accepted
- **Context**: Roadmap rules of the system.
- **Decision**: `rules`, `formatting`, `style/metrics` are pure deterministic functions with no Office or LLM imports. `analysis/semantic` is the only consumer of `LlmProvider`.
- **Consequences**: Semantic engines are harder to test; mitigated by `MockAdapter`.

### ADR-0007 — Storage in `Office.roamingSettings` with localStorage fallback

- **Status**: Accepted
- **Context**: Add-ins must persist settings across sessions but also run in tests/outside Word.
- **Decision**: `src/core/state/persistence.ts` writes to `Office.roamingSettings` when available, falls back to `localStorage`.
- **Consequences**: Data may diverge between Word and localStorage if both are used; mitigated by always writing both.

### ADR-0008 — Hard gate on Stage 01 Office.js spike before reformatter

- **Status**: Accepted
- **Context**: Roadmap critical ordering rule.
- **Decision**: `probeWordCapabilities()` must return `supportsRevisions: true` (or document the limitation) before any Stage 15-21 work is committed.
- **Consequences**: Reformatter development may be blocked if Word lacks revision support; fallback is tracked-change insertion with explicit documentation.

### ADR-0009 — Discriminated-union payloads for Change schemas

- **Status**: Accepted
- **Context**: Stage 1 audit (R4) found `ChangeSchema` accepted any payload shape, allowing invalid change objects to pass validation.
- **Decision**: `ChangeSchema` uses a discriminated union (`ChangePayloadSchema`) keyed on `kind`, with a `superRefine` that enforces per-kind payload requirements. `ChangeRangeSchema` uses a `refine` to reject inverted ranges. Factories use `uuid.v4()` for IDs.
- **Consequences**: Invalid changes fail fast at the boundary; downstream engines can rely on the payload shape. New change kinds must extend the union.

### ADR-0010 — Persistence falls back to defaults on corrupt state

- **Status**: Accepted
- **Context**: Stage 1 audit (R7) found `loadState()` threw on corrupted or version-incompatible persisted state, which could brick the taskpane on startup.
- **Decision**: `loadState()` catches parse/validation failures and returns defaults (logging a warning); `saveState()` persists via `Office.roamingSettings.saveAsync` when available. Migrations are versioned (`version` field, v0→v1 implemented).
- **Consequences**: Users never see a startup crash from bad state, but silently lose corrupted settings. Mitigation: the warning is logged and surfaced in diagnostics.

### ADR-0011 — OpenAI adapter delegates retry to `withRetry()` and distinguishes abort causes

- **Status**: Accepted
- **Context**: Stage 1 audit (R5) found the OpenAI adapter implemented its own retry loop, ignored `request.signal`, and treated caller-abort the same as timeout.
- **Decision**: The adapter uses `AbortSignal.any([request.signal, timeoutSignal])` to honor caller cancellation, distinguishes caller-abort (non-retryable) from timeout (retryable), delegates retry/backoff to the shared `withRetry()` helper, and implements real `redact()` (emails, card numbers, API keys, bearer tokens).
- **Consequences**: Retry policy is consistent across providers; caller cancellation is immediate and never retried. New providers must follow the same contract.

### ADR-0012 — Capability probe is non-destructive by default

- **Status**: Accepted
- **Context**: Stage 1 audit (R1) found the capability probe inserted and deleted text in the user's document as a side effect of probing.
- **Decision**: `probeWordCapabilities()` defaults to `dryRun: true` and never mutates the document unless the caller explicitly opts in. `supportsStyles`/`supportsRevisions` return truthful values derived from the probe, not hardcoded `true`.
- **Consequences**: Probing is safe to run on any document. Callers that need a live write test must pass `dryRun: false` explicitly and accept the mutation risk.

### ADR-0013 — Enforce module boundaries with ESLint `no-restricted-imports`

- **Status**: Accepted
- **Context**: Stage 1 audit (R9) found `docs/architecture.md` forbids `core/domain` from importing `Office`, but no lint rule enforced it — the boundary was documentation-only.
- **Decision**: `eslint.config.mjs` adds scoped `no-restricted-imports` rules: `core/domain` may only import `zod`/`shared/utils`; `word/` may not import `ai`/`ui`; `ai/` may not import `word`/`ui`; `ui` (`taskpane/`, `commands/`) may not import `word/revisionAdapter` directly.
- **Consequences**: Boundary violations fail `npm run lint`. New modules must declare their allowed imports in `architecture.md` and add a matching ESLint scope.
