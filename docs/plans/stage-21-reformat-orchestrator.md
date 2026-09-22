# Stage 21 — Reformat Orchestrator — Finalized Plan

## 1. Authoritative alignment

- [ROADMAP.md](ROADMAP.md:46) defines Stage 21 as `feat(reformat): add hybrid document reformatter` with Gate Yes.
- [21-reformat-orchestrator.md](docs/stages/21-reformat-orchestrator.md:1) scopes work to [orchestrator.ts](src/reformat/orchestrator.ts:1) driving snapshot → analyze → plan → apply, using [documentReader.ts](src/word/documentReader.ts:1) and [revisionAdapter.ts](src/word/revisionAdapter.ts:1), with tests at [integration](tests/integration/llm-registry.test.ts:1). Status PENDING.
- [project-state.md](docs/project-state.md:29) confirms Stages 00–20 PASS, Stage 18 PASS WITH DOCUMENTED LIMITATION with live smoke 2026-09-22, Stage 21 PENDING, Stage 22 PENDING.
- [architecture.md](docs/architecture.md:45) constrains [analysis](src/analysis/index.ts:1), [changes](src/changes/planner.ts:1), [word](src/word/documentReader.ts:1); one canonical profile drives both Reformat and Consistency Check; one mutation path via [ChangePlan](src/core/domain/ChangePlan.ts:1) to adapter.
- [decision-log.md](docs/decision-log.md:1) ADRs ADR-0005, ADR-0006, ADR-0011, ADR-0013, ADR-0024, ADR-0025, ADR-0026, ADR-0027, and ADR-0028 govern this stage.
- Locked user scope: full pipeline snapshot → analyze → plan → apply with tracked apply, superseding smoke scaffolding in [smokeApply.ts](src/word/smokeApply.ts:1).

## 2. Systematic review

### 2.1 Objectives

- Compose Stage 20 findings-only output with Stage 17 planning and Stage 18 tracked application into a single orchestrated entry point.
- Expose a taskpane-safe mutation path so [taskpane](src/taskpane/components/smokePlan.ts:1) never imports [revisionAdapter.ts](src/word/revisionAdapter.ts:1) directly.
- Supersede debug scaffolding in [smokeApply.ts](src/word/smokeApply.ts:1) and [smokePlan.ts](src/taskpane/components/smokePlan.ts:1) with a production orchestrator.
- Keep findings-only contract clean for Stage 22 safe-application hardening.

### 2.2 Prerequisites — all met

- Stage 15 formatting engine PASS: [analyzer.ts](src/formatting/analyzer.ts:1), [formattingSnapshot.ts](src/formatting/formattingSnapshot.ts:1), [formattingReader.ts](src/word/formattingReader.ts:1).
- Stage 16 unified findings PASS: [`unifyFindings()`](src/analysis/unifiedFindings.ts:104).
- Stage 17 change planning PASS: [`planChanges()`](src/changes/planner.ts:286), [`detectConflicts()`](src/changes/conflictDetector.ts:1), [`markStale()`](src/changes/staleGuard.ts:16).
- Stage 18 revision adapter PASS WITH DOCUMENTED LIMITATION: [`applyChangePlan()`](src/word/revisionAdapter.ts:69), [`applyChangePlanWithTracking()`](src/word/revisionAdapter.ts:1), [`setStage01Passed()`](src/word/revisionAdapter.ts:21), [`validatePlanBeforeApply()`](src/word/revisionAdapter.ts:1).
- Stage 19 semantic deviation PASS: [`detectSemanticDeviations()`](src/analysis/deviationEngine.ts:58).
- Stage 20 consistency checker PASS: [`checkConsistency()`](src/analysis/consistencyChecker.ts:117), [`ConsistencyReportSchema`](src/analysis/consistencyChecker.ts:60).
- Stage 01 hard gate partially closed: Desktop Word live smoke recorded in [manual-verification.md](docs/manual-verification.md:1); web plus Mac pending, deferred to Stage 27.

### 2.3 Required inputs

- `profile: StyleProfile` validated via [`StyleProfileSchema`](src/core/domain/StyleProfile.ts:80).
- Live text via [`getDocumentSnapshot()`](src/word/documentReader.ts:39) returning [DocumentSnapshot](src/word/documentReader.ts:10) with `text`, `id`, `hash` via [`hashDocument()`](src/word/documentReader.ts:21).
- Optional formatting via [`getFormattingSnapshot()`](src/word/formattingReader.ts:25) returning [FormattingSnapshot](src/formatting/formattingSnapshot.ts:1).
- `includeRawText: boolean` explicit opt-in, default false, enforced by [`buildDeviationPrompt()`](src/ai/prompts/profilePrompts.ts:1).
- `signal: AbortSignal` passthrough; caller abort non-retryable per ADR-0011.
- `registry: LlmSemanticProvider` injectable; tests use [`MockAdapter`](src/ai/providers/mockAdapter.ts:1) only.
- `currentDocHash: string` for stale refusal in [`applyChangePlan()`](src/word/revisionAdapter.ts:69).

### 2.4 Key activities

- Create [orchestrator.ts](src/reformat/orchestrator.ts:1) with `ReformatOptions`, `ReformatResult`, [`reformatDocument()`](src/reformat/orchestrator.ts:1).
- Create [index.ts](src/reformat/index.ts:1) barrel re-export.
- Add `src/reformat` ESLint scope in [eslint.config.mjs](eslint.config.mjs:1) mirroring [analysis](src/analysis/index.ts:1) plus `word/revisionAdapter` allowance.
- Add integration tests under [tests/integration/reformatOrchestrator.test.ts](tests/integration/reformatOrchestrator.test.ts:1) mirroring source behavior.
- Wire tracked apply via [`applyChangePlanWithTracking()`](src/word/revisionAdapter.ts:1); surface `tracking.managed`, `modeBefore`, `modeAfter`, `recordedCount`.
- Mark [smokeApply.ts](src/word/smokeApply.ts:1) deprecated while retaining the historical Stage 18 live-smoke harness; Dashboard redirection remains out of scope for Stage 21.
- Update [project-state.md](docs/project-state.md:29), [21-reformat-orchestrator.md](docs/stages/21-reformat-orchestrator.md:1), and [decision-log.md](docs/decision-log.md:1).

### 2.5 Essential skills and resources

- Primary: `toneforge-scaffold` — stage ordering, gates, module placement in [architecture.md](docs/architecture.md:45), verification via [stage-verify.mjs](scripts/stage-verify.mjs:1).
- Supporting `toneforge-officejs` — [`runInWord()`](src/shared/office/officeHelpers.ts:50), [`isOfficeReady()`](src/shared/office/officeHelpers.ts:40), DTO boundary, capability-gated mutation.
- Supporting `toneforge-llm` — [`LlmRegistry`](src/ai/providers/registry.ts:1), [`withRetry()`](src/ai/providers/retry.ts:1), [`MockAdapter`](src/ai/providers/mockAdapter.ts:1), `includeRawText` gate.
- Supporting `toneforge-testing` — Vitest plus jsdom per [vitest.config.ts](vitest.config.ts:1), Office mock in [setup.ts](tests/setup.ts:1), fixtures in [sampleDocs.ts](tests/fixtures/sampleDocs.ts:1).
- Resources: [package.json](package.json:30) `verify` chain, [validate-manifest.mjs](scripts/validate-manifest.mjs:1), [commitlint.config.cjs](commitlint.config.cjs:1).

### 2.6 Dependencies

- Upstream: [documentReader.ts](src/word/documentReader.ts:1) → [consistencyChecker.ts](src/analysis/consistencyChecker.ts:1) → [planner.ts](src/changes/planner.ts:1) → [revisionAdapter.ts](src/word/revisionAdapter.ts:1).
- Downstream: Stage 22 [staleGuard.ts](src/changes/staleGuard.ts:1) will harden re-hash before apply; orchestrator must expose `docHash` and `stale` without preempting Stage 22 UI confirmation.
- Boundary: `src/reformat` may import `core/domain`, `analysis`, `changes`, `word/documentReader`, `word/formattingReader`, `word/revisionAdapter`, `ai/providers`, `shared/utils`; must never import `taskpane` or `commands`; `taskpane` must never import `revisionAdapter` directly.

### 2.7 Risks

- Stale apply corrupting edited document if hash not re-checked.
- Privacy leak if raw text sent without opt-in.
- Host gaps: `supportsInsertBreak` false plus `supportsStyles` false on Desktop per [project-state.md](docs/project-state.md:8); per-kind refusal must surface cleanly.
- Vague semantic full-text ranges diluting precise deterministic offsets.
- Scope creep into Stage 22 confirmation UX or Stage 23 taskpane wiring.
- Test-double infidelity masking live `Word.run` versus `Office.run` differences in [officeHelpers.ts](src/shared/office/officeHelpers.ts:50).

### 2.8 Completion criteria

- [`typecheck`](package.json:29) passes.
- [`lint`](package.json:25) passes with zero warnings including new `reformat` scope.
- [`format`](package.json:27) passes.
- [`test`](package.json:22) passes including new orchestrator tests; `src/reformat` meets 80% lines, statements, functions, branches per [vitest.config.ts](vitest.config.ts:13).
- [`build`](package.json:15) succeeds.
- [`validate`](package.json:20) passes.
- [`stage:verify`](package.json:31) passes via [stage-verify.mjs](scripts/stage-verify.mjs:1).
- [project-state.md](docs/project-state.md:29) updated; gate declared PASS or PASS WITH DOCUMENTED LIMITATION.

## 3. Detailed implementation plan — Code-mode execution sequence

### Step 1 — Snapshot layer composition

- Call [`getDocumentSnapshot()`](src/word/documentReader.ts:39) for `text`, `id`, `hash`.
- Call [`getFormattingSnapshot()`](src/word/formattingReader.ts:25) optionally; on `id: unavailable` proceed text-only.
- Short-circuit empty text to empty [ConsistencyReport](src/analysis/consistencyChecker.ts:67) plus empty [ChangePlan](src/core/domain/ChangePlan.ts:25); no LLM call.
- Responsibility: Code mode; capability: `toneforge-officejs`.

### Step 2 — Analyze via checker

- Delegate to [`checkConsistency()`](src/analysis/consistencyChecker.ts:117) with `text`, `profile`, `snapshot`, `docHash`, `includeRawText`, `signal`, `registry`.
- Preserve `profileId` plus `docHash` plus `summary` for report traceability.
- Log and skip transient provider failures; rethrow caller abort.
- Responsibility: Code mode; capability: `toneforge-llm` plus `toneforge-testing` with [`MockAdapter`](src/ai/providers/mockAdapter.ts:1).

### Step 3 — Plan via planner

- Call [`planChanges()`](src/changes/planner.ts:286) with `findings`, `docHash`, `baseDocId`, and the caller-observed `currentDocHash` when available.
- Preserve `conflicts` plus `findings` plus `suggestedChangeId` for review.
- Populate `plan.stale` before adapter validation; do not resolve conflicts automatically; leave Stage 22 confirmation to the next stage.
- Responsibility: Code mode.

### Step 4 — Apply via tracked adapter

- Call [`applyChangePlanWithTracking()`](src/word/revisionAdapter.ts:1) with `plan` plus fresh `currentDocHash`; preview mode returns before this call.
- Honor `STAGE_01_PASSED` gate via [`setStage01Passed()`](src/word/revisionAdapter.ts:21); surface gate refusal as typed result, never throw for UI.
- Return `results` plus `tracking` plus `report` plus `plan`, `snapshot`, `stale`, and `applied` in `ReformatResult`.
- Responsibility: Code mode; capability: `toneforge-officejs`.

### Step 5 — Module scaffolding and boundaries

- Create `src/reformat/orchestrator.ts` plus `src/reformat/index.ts`.
- Extend [eslint.config.mjs](eslint.config.mjs:1) with `src/reformat` scope.
- Update [architecture.md](docs/architecture.md:45) module table if new imports introduced; record ADR in [decision-log.md](docs/decision-log.md:1).
- Remove or deprecate [smokeApply.ts](src/word/smokeApply.ts:1) re-export path; keep file for history but mark superseded.
- Responsibility: Code mode; capability: `toneforge-scaffold`.

### Step 6 — Tests

- Add `tests/integration/reformatOrchestrator.test.ts` covering snapshot→analyze→plan→apply with Office mock plus [`MockAdapter`](src/ai/providers/mockAdapter.ts:1): deterministic tracked apply, preview/no-mutation, no-change, stale planner metadata, semantic skipped versus success, empty text, abort, hash mismatch refusal, gate refusal, provided formatting snapshot reuse, `Word.run` preference, and tracking fallback `managed: false`.
- Reuse [sampleDocs.ts](tests/fixtures/sampleDocs.ts:1); never hit live network.
- Run focused tests then full [`test`](package.json:22); enforce 80% coverage.
- Responsibility: Code mode; capability: `toneforge-testing`.

### Step 7 — Verification and docs

- Run full [`verify`](package.json:30) chain: [`typecheck`](package.json:29), [`lint`](package.json:25), [`format`](package.json:27), [`test`](package.json:22), [`build`](package.json:15), [`validate`](package.json:20), plus [`stage:verify`](package.json:31).
- Update [project-state.md](docs/project-state.md:29) to PASS; expand [21-reformat-orchestrator.md](docs/stages/21-reformat-orchestrator.md:1) verification checkboxes.
- Commit as `feat(reformat): add hybrid document reformatter` per [commitlint.config.cjs](commitlint.config.cjs:1).
- Responsibility: Code mode.

## 4. Data flow

```mermaid
flowchart TD
  A[Live snapshot via documentReader plus formattingReader]
  B[Consistency checker deterministic plus formatting plus semantic]
  C[Unified findings merger]
  D[Change planner with conflict plus stale metadata]
  E[Tracked revision adapter with capability gate]
  F[Reformat result with report plus plan plus apply plus tracking]
  G[Stage22 stale guard plus confirmation]
  A --> B
  B --> C
  C --> D
  D --> E
  E --> F
  F --> G
```

## 5. Risk mitigations

- Stale: require `currentDocHash` at apply entry; refuse on mismatch with per-change `applied: false`; expose `stale` flag from [`markStale()`](src/changes/staleGuard.ts:16).
- Privacy: default `includeRawText` false; delegate gate to [`buildDeviationPrompt()`](src/ai/prompts/profilePrompts.ts:1); redact via [logger.ts](src/shared/utils/logger.ts:1).
- Host gaps: rely on [`validatePlanBeforeApply()`](src/word/revisionAdapter.ts:1) per-kind checks; surface `unavailable in this host` without crashing.
- Semantic vagueness: keep full-text range; rely on [`unifyFindings()`](src/analysis/unifiedFindings.ts:104) unit-aware grouping; never invent offsets.
- Scope: explicitly defer UI confirmation plus re-hash UX to Stage 22 [22-safe-application.md](docs/stages/22-safe-application.md:1).
- Mock fidelity: assert [`runInWord()`](src/shared/office/officeHelpers.ts:50) prefers `Word.run`; cover `Office.run` fallback only for test doubles.

## 6. Measurable milestones and success criteria

- M1 Snapshot wired: [`getDocumentSnapshot()`](src/word/documentReader.ts:39) plus [`getFormattingSnapshot()`](src/word/formattingReader.ts:25) return DTOs; empty text short-circuits.
- M2 Analyze plus plan composed: [`checkConsistency()`](src/analysis/consistencyChecker.ts:117) output feeds [`planChanges()`](src/changes/planner.ts:286); `profileId` plus `docHash` preserved end to end.
- M3 Tracked apply wired: [`applyChangePlanWithTracking()`](src/word/revisionAdapter.ts:1) returns `managed` plus counts; gate refusal tested.
- M4 Smoke superseded: production path is [reformatDocument()](src/reformat/orchestrator.ts:69); legacy [smokeApply.ts](src/word/smokeApply.ts:1) helpers are deprecated and retained only for the Stage 18 live-smoke harness; Dashboard redirection is deferred by explicit scope.
- M5 Verify green: full [`verify`](package.json:30) plus [`stage:verify`](package.json:31) pass; [project-state.md](docs/project-state.md:29) updated; stage gate PASS.

## 7. Governance notes

- No time estimates provided per project governance; sequence above defines optimal order.
- Follow stage protocol in [ROADMAP.md](ROADMAP.md:55): read stage file, load only relevant skills, inspect before modifying, implement only stage scope, run targeted tests, run stage verification, update state, record ADRs, declare status, commit only after gate passes.
- Next stage: Stage 22 safe application per [22-safe-application.md](docs/stages/22-safe-application.md:1) will consume `docHash` for re-hash protection.

## 8. Implementation result

- The full pipeline is implemented in [orchestrator.ts](src/reformat/orchestrator.ts:69), including preview, empty-text short-circuit, optional formatting snapshot reuse, caller-observed hash propagation into `planChanges`, tracked apply, and `applied` reporting.
- [reformatOrchestrator.test.ts](tests/integration/reformatOrchestrator.test.ts:1) contains 11 focused integration tests covering tracked apply, preview/no-mutation, no-change, stale planning, Stage 01 refusal, abort, semantic opt-in/skip, formatting reuse, `Word.run` preference, and unmanaged tracking fallback.
- `npm run verify` and `npm run stage:verify` pass; the full Vitest run passes 44 files / 459 tests. Stage 21 module coverage clears the 80% gate (`orchestrator.ts`: 98.46% lines/statements, 100% functions, 81.25% branches; `index.ts`: 100%).
- [project-state.md](docs/project-state.md:29) records Stage 21 as PASS and documents the separate repository-wide `npm run test:coverage` limitation from pre-existing uncovered UI/style files; [ADR-0028](docs/decision-log.md:179) records the orchestration and legacy-smoke boundary decision.
