# ToneForge — Architectural Decision Log

## 2026-09-19 — Repository baseline and scaffold

### ADR-0001 — Use unified JSON manifest (preview) over XML manifest

- **Status**: Accepted
- **Context**: Roadmap targets a Word Web Add-in. The unified manifest for Microsoft 365 is the forward-looking format and supports richer capabilities.
- **Decision**: Use `manifest.json` (manifestVersion 1.10) as the canonical manifest.
- **Consequences**: Preview host support is narrower than XML on desktop. Mitigation: validate on Office on the web first; keep an XML manifest fallback branch documented for Stage 27.

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

- **Status**: Accepted
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
