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

- **Status**: Accepted (corrected 2026-09-19 to match implementation)
- **Context**: Stage 1 audit (R1) found the capability probe inserted and deleted text in the user's document as a side effect of probing. The original decision text described a `dryRun` parameter that was never implemented.
- **Decision**: `probeWordCapabilities()` takes no arguments and is _always_ non-destructive. It inspects the host object model only (`getSelection().getRange(0,0)` + `hasMethod` checks, `styles.load`, `trackedChanges.load`) and never calls `insertText`, `insertParagraph`, or `insertBreak`. There is no opt-in mutation path — the probe cannot mutate the document by design. `supportsStyles`/`supportsRevisions` return truthful values derived from the probe, not hardcoded `true`.
- **Consequences**: Probing is safe to run on any document. Because there is no `dryRun: false` escape hatch, a live write test must be implemented as a separate, explicitly opt-in utility if ever needed (deferred to Stage 27).

### ADR-0013 — Enforce module boundaries with ESLint `no-restricted-imports`

- **Status**: Accepted
- **Context**: Stage 1 audit (R9) found `docs/architecture.md` forbids `core/domain` from importing `Office`, but no lint rule enforced it — the boundary was documentation-only.
- **Decision**: `eslint.config.mjs` adds scoped `no-restricted-imports` rules: `core/domain` may only import `zod`/`shared/utils`; `word/` may not import `ai`/`ui`; `ai/` may not import `word`/`ui`; `ui` (`taskpane/`, `commands/`) may not import `word/revisionAdapter` directly.
- **Consequences**: Boundary violations fail `npm run lint`. New modules must declare their allowed imports in `architecture.md` and add a matching ESLint scope.

### ADR-0014 — `exactOptionalPropertyTypes` enabled in tsconfig

- **Status**: Accepted (2026-09-19)
- **Context**: Stage 00–06 audit (G2.3) found `tsconfig.json` omitted `exactOptionalPropertyTypes`, which `plans/plan.md` mandates.
- **Decision**: Add `"exactOptionalPropertyTypes": true` to `tsconfig.json` compilerOptions. Verified `tsc --noEmit` passes with the flag enabled.
- **Consequences**: Optional properties now distinguish `undefined` from absence. Code that explicitly passes `undefined` for optional fields must use the property name explicitly; existing code already compiles cleanly.

### ADR-0016 — Agent-facing zoo rules as scoped markdown files

- **Status**: Accepted (2026-09-20)
- **Context**: The four existing `.roo/skills/` packages cover LLM, Office.js, scaffold, and testing, but several recurring concerns had no agent-facing rule: TypeScript strict-mode discipline, deterministic-purity enforcement, prompt-privacy opt-in, graceful state persistence, per-module coverage expectations, manifest/build verification before commit, and commit-scope alignment with ROADMAP stages. These gaps were documented in `plans/zoo-rules.md`.
- **Decision**: Create 8 scoped rule files under `.roo/rules/`, each with YAML frontmatter (`name`, `description`) and evidence-backed content referencing `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, ADRs, and source files. Rules are intentionally non-duplicative of existing skills and ESLint config.
- **Consequences**: Agents now have explicit, scoping rules for each gap area. `npm run skills:validate` passes (rules live in `.roo/rules/`, not `.roo/skills/`, so they are not subject to the skill frontmatter spec). `npm run verify` passes after formatting `src/taskpane/taskpane.html`.

### ADR-0017 — UI root is `src/taskpane/`, not `src/ui/`

- **Status**: Accepted (2026-09-20)
- **Context**: Stage files 07/11/12 reference `src/ui/` for Settings and Profile Editor components, but the scaffold skill placement guide and the existing `src/taskpane/` tree (App, pages, theme) are canonical. ESLint `no-restricted-imports` scopes `taskpane/` and `commands/`; a second `src/ui/` root would split that boundary and need new lint scopes for zero benefit.
- **Decision**: All task-pane UI lives under `src/taskpane/` (pages under `src/taskpane/pages/`, shared components under `src/taskpane/components/`). Stage 07 Settings is implemented as `src/taskpane/pages/Settings.tsx` + `src/taskpane/components/SettingsForm.tsx`, wired into `Dashboard.tsx` via lazy import. Stage files 07/11/12 are corrected to say `src/taskpane/`.
- **Consequences**: Single UI root avoids import divergence and test-mirror confusion; no shim needed. Docs drift closed for the UI-location concern; other `src/ui/` references in stage files remain as-is until their stages execute.

- **Status**: Accepted (2026-09-19)
- **Context**: Stage 00–06 audit (G5.1) found `loadState()` parsed raw persisted state directly, bypassing `migrate()` and making the v0→v1 migration dead code.
- **Decision**: `loadState()` calls `migrate(raw)` before `StateSchema.parse`. Migration preserves existing `settings` values over defaults and fills missing fields with defaults.

- **Status**: Accepted (2026-09-19)
- **Context**: Stage 00–06 audit (G5.1) found `loadState()` parsed raw persisted state directly, bypassing `migrate()` and making the v0→v1 migration dead code.
- **Decision**: `loadState()` calls `migrate(raw)` before `StateSchema.parse`. Migration preserves existing `settings` values over defaults and fills missing fields with defaults.

### ADR-0018 — Persistent profile version history (state schema v2)

- **Status**: Accepted (2026-09-21)
- **Context**: Stage 12 requires persistent profile version history and diffs. The v1 state schema had no history; `upsertProfile` replaced the current profile without recording a prior snapshot, so version bumps were invisible after restart.
- **Decision**: Bump `StateSchema` to v2 and add `profileHistory: Record<ProfileId, StyleProfile[]>`. `CURRENT_STATE_VERSION` becomes 2. `loadState()` reads `ToneForge.State.v2` first, falling back to the legacy `ToneForge.State.v1` key in both `Office.roamingSettings` and `localStorage`. `migrate()` handles v0→v1→v2 and seeds history from existing profiles when no history is present. `upsertProfile()` appends the previous snapshot before replacing the current profile; `removeProfile()` deletes history entries. `src/style/versioning.ts` provides pure `bumpProfileVersion`, `diffProfiles`, and `formatChangelog`; `VersionDiff.tsx` consumes them.
- **Consequences**: Existing v1 persisted state is upgraded transparently on next load; corrupt or future-version state falls back to defaults per ADR-0010. History is append-only per profile and deduplicated so unchanged saves do not create duplicate snapshots. `npm run verify` is green.

### ADR-0019 — Deterministic rules module boundary and finding contract

- **Status**: Accepted (2026-09-21)
- **Context**: Stage 13 introduces the first deterministic rule engine. The stage needs a pure module location, an import boundary that forbids Office/LLM/UI dependencies, and a return contract that Stage 14 can reuse without introducing a second rule-output shape.
- **Decision**: Place deterministic rule engines under `src/rules/` (Stage 13 creates `src/rules/typography.ts`). `rules/` may import only `core/domain` and `shared/utils`. ESLint `no-restricted-imports` forbids `ai/`, `word/`, `taskpane/`, and `commands/` imports from `src/rules/`. Rule engines return the existing `Finding` contract from `src/core/domain/Finding.ts` with `kind: "deterministic"`, `confidence: 1`, and character-offset ranges. `findTypographyIssues()` composes the individual checks and returns an empty array for empty input.
- **Consequences**: Stage 14 reuses the same module location, lint scope, and `Finding` return type, keeping Stage 16 unified-findings work simple. Deterministic rules remain directly unit-testable without Office or LLM mocks. The `rules/` module meets the 80% coverage threshold.

### ADR-0020 — Bounded terminology matching and data-table spelling variants

- **Status**: Accepted (2026-09-21)
- **Context**: Stage 14 adds preferred terminology, banned terms, capitalization, and spelling variants. Terminology must be matched case-insensitively but must not flag substrings inside larger words (e.g. `color` inside `colorful`). Spelling differences must be kept as reviewable data tables rather than hardcoded conditional branches, and the engine must remain deterministic and pure.
- **Decision**: All term matching — preferred terminology, banned terms, title-case words, and spelling variants — uses a single `boundedTermPattern()` helper that emits a Unicode-aware word-boundary regex (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])` with the `giu` flags). Overlapping preferred-terminology candidates are resolved by longest match first, then by start position, then by original order; shorter overlapping candidates are dropped. Spelling variants live in `SPELLING_VARIANT_TABLE`, a `readonly` array of `{ "en-US", "en-GB", au }` entries; the active variant is selected by indexing the table with `rules.spellingVariant`, and all non-preferred variants in the same row are flagged. The engine remains pure and imports only `core/domain` and `shared/utils`.
- **Consequences**: Banned terms and preferred terminology no longer produce false positives inside larger words. Spelling rules are easy to extend by adding rows to the table. The engine is not a full spellchecker — unknown words are never flagged — and that limitation is documented in `docs/stages/14-house-style-rules.md`. `src/rules/houseStyle.ts` meets the 80% coverage threshold (100% lines, 85.45% statements, 100% functions, 100% branches).

### ADR-0021 — Formatting engine reads Word through a DTO boundary

- **Status**: Accepted (2026-09-21)
- **Context**: Stage 15 needs a Word formatting analyzer and normalizer, but the deterministic engine must stay pure (no Office.js or LLM imports) while the live reader must access Word formatting data. Stage 01 remains PARTIAL because in-Word execution is still pending, so the live reader must degrade gracefully when Office.js is unavailable.
- **Decision**: Place deterministic formatting logic under `src/formatting/` (analyzer, normalizer, style-name table, and Zod DTO schemas) with an ESLint `no-restricted-imports` scope that forbids `ai/`, `word/`, `taskpane/`, and `commands/` imports. Put all Office.js access in `src/word/formattingReader.ts`, which uses the shared `runInWord` wrapper, loads paragraph `text`/`style`/`format`/`font` properties, performs a second `context.sync()`, and returns a plain `FormattingSnapshot` DTO. Word style names are matched case-insensitively against a data table (`WORD_STYLE_MAPPING`), with heading levels derived from `Heading N` names. Unknown or missing styles fall back to `Normal`; missing formatting fields are `null`; the reader returns an `id: "unavailable"` snapshot when Office.js is not present or the host object model is unsupported.

*

### ADR-0022 — Unified findings merge policy +

- **Status**: Accepted (2026-09-21)
- **Context**: Stages 13, 14, and 15 each emit `Finding[]` arrays with their own categories and range units. Stage 16 must merge them into one list for the Stage 17 planner and the Stage 20 consistency checker, but the merge must be deterministic and must not silently drop distinct findings. Stage 19 (semantic deviation) is not yet built, so the semantic source must be accepted as a first-class input now and exercised with synthetic fixtures.
- **Decision**: `src/analysis/unifiedFindings.ts` accepts `deterministic`, `formatting`, and `semantic` arrays via `UnifyOptions`. Raw findings are validated through `FindingSchema` (invalid findings, including inverted ranges, are silently skipped). Exact duplicates are collapsed on the composite key `range + category + message`. Overlapping findings with different categories are both preserved. Same-category overlaps are resolved per connected group: longest-match-wins, then severity (`error` > `warning` > `info`), then stable source order. Overlap grouping is unit-aware — findings in different range units never conflict. The final list is sorted by `range.start`, then `range.end`, then `severity`, then source index. `suggestedChangeId` is preserved because complete parsed `Finding` objects are retained.
- **Consequences**: The merger is pure and directly unit-testable without Office or LLM mocks. The `src/analysis/` ESLint scope forbids `ui` and `word/revisionAdapter` imports, keeping the boundary aligned with `docs/architecture.md`. Synthetic semantic fixtures (`kind: "semantic"`, `confidence < 1`) prove the full three-source contract before Stage 19 exists. `src/analysis/` coverage is 100% lines / 100% functions / 91.89% branches, and the full `npm run verify` chain is green. Stage 16 is marked PASS. +

### ADR-0023 — Analysis module boundary +

- **Status**: Accepted (2026-09-21)
- **Context**: `docs/architecture.md` declares that `analysis/` may import `core/domain`, `rules`, `formatting`, `ai/providers`, and `shared/utils`, but no ESLint scope existed to enforce it. Stage 16 created the first `src/analysis/` module, so the boundary needed teeth.
- **Decision**: Add an `eslint.config.mjs` scope for `src/analysis/**/*.ts` with `no-restricted-imports` forbidding `**/taskpane/*`, `**/commands/*`, and `**/word/revisionAdapter*`. This mirrors the existing `core/domain`, `word/`, `rules/`, `formatting/`, and `ai/` scopes and keeps `analysis/` free of UI and mutation dependencies.
- **Consequences**: Boundary violations fail `npm run lint`. The scope is intentionally permissive about `rules/` and `formatting/` because Stage 16 consumes their `Finding` outputs; if a future stage needs `analysis/` to call a deterministic engine directly, that is already permitted. `npm run verify` remains green.

### ADR-0024 — Pure change planning and conflict/staleness boundary

- **Status**: Accepted (2026-09-21)
- **Context**: Stage 17 consumes Stage 16's unified `Finding[]` contract and must produce safe, validated `ChangePlan` objects for the future revision adapter without importing Word, UI, or LLM code. It must preserve planner traceability and semantic review data, report conflicts without silently discarding changes, and support stale-plan protection while keeping document access outside the deterministic module.
- **Decision**: Place planning in pure `src/changes/` modules. `planner.ts` validates each raw finding with `FindingSchema`, maps supported deterministic and formatting categories to schema-valid `Change` payloads, preserves `suggestedChangeId`, retains raw findings on the plan, and leaves semantic findings unchanged unless an explicit quoted replacement can be safely extracted. `conflictDetector.ts` reports every overlapping pair, including same-range type and style/direct-format contradictions, without dropping changes. `staleGuard.ts` accepts the current document hash from the caller and marks a plan stale only on a supplied mismatch. `ChangeSchema` and `ChangePlanSchema` gain optional traceability/passthrough fields so existing fixtures remain compatible. ESLint forbids `analysis`, `rules`, `formatting`, `style`, `ai`, `word`, `ui`, and `Office` imports from `changes/`.
- **Consequences**: Stage 18 can consume validated plans through the single mutation path, Stage 19 can later consume preserved semantic findings, and Stage 22 can enforce safe application without planner-side Word access. Conflicts are review signals rather than automatic resolution, and hash production remains the responsibility of the Word boundary. The pure modules are directly unit-testable; Stage 17 is covered by 53 focused tests and the full verification chain.
