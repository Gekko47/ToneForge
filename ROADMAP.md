# ToneForge — Authoritative Roadmap and Work Status

> **Status source of truth:** this file is the canonical implementation plan,
> sequencing record, status ledger, and release-gate record for ToneForge.
> `docs/project-state.md` is a compatibility/evidence index that cross-references
> this file; it is not a second plan. Supporting guides are design references or
> historical records and must not override this document.
>
> **Audit baseline:** 2026-09-24. Commit `551667d` records the A–G refactor
> candidate. This audit reconciles that commit against the implementation,
> tests, configuration, manifests, CI, and release scripts.

## Mission

Build ToneForge as a production-quality Microsoft Word Web Add-in with:

- editable style learning from writing samples;
- deterministic micro-consistency and formatting checks;
- semantic AI review only where interpretation is required;
- unified findings and auditable `ChangePlan` objects;
- preview-before-apply and a single native Word mutation path;
- provider-agnostic LLM integration;
- explicit privacy, security, accessibility, testing, and host-compatibility
  discipline.

## Canonical rules

### Deterministic first

Use code for measurable or safely enumerable behavior, including typography,
quotes, whitespace, terminology, capitalization, spelling variants, formatting,
structure, coverage, protection, and preservation checks.

### AI only where interpretation is necessary

Use an LLM for tone, voice, rhetorical style, semantic flow, nuanced register,
grammar ambiguity, concision, and meaning-preserving editorial suggestions. AI is
optional and must not be required for deterministic governance.

### One canonical profile

The editable [`StyleProfile`](src/core/domain/StyleProfile.ts) remains the
profile learned from samples. The refactor adds an additive
[`GovernanceProfile`](src/core/domain/GovernanceProfile.ts) envelope for scope,
protection, terminology, editorial policy, rules, and provenance. The envelope
does not replace the existing profile contract.

### One mutation path

All proposed changes flow through `ChangePlan` and the
[`revisionAdapter`](src/word/revisionAdapter.ts). UI, rules, analysis, and
orchestration code do not mutate Word directly. The deprecated smoke helpers
remain only for reproducible historical verification.

### Coverage is measurable

Analysis records a [`CoverageReport`](src/core/domain/DocumentSnapshot.ts) when
structured nodes are available. Incomplete coverage blocks full-document review;
a partial run must not be presented as complete.

### Preserve source identity

Nodes and findings retain node identifiers, source paths, and/or character ranges
where the current Word API exposes them. The current text-offset path remains the
compatibility path until node-based navigation is proven in real Word.

### Privacy gate

Raw document text may leave the add-in only through an explicit raw-text opt-in.
Spot review and full-document review have separate consent settings. AI prompts
require `includeRawText: true`, and model responses are parsed with Zod.

## Verified architecture

The current code has two connected but distinct paths:

```text
Style sample
    -> deterministic metrics + optional semantic profile
    -> editable/versioned StyleProfile
    -> GovernanceProfile envelope
    -> structured DocumentSnapshot
    -> deterministic rules/formatting + optional AI review
    -> unified Findings
    -> ChangePlan
    -> stale/conflict/protection/preservation checks
    -> preview/confirmation
    -> revisionAdapter
    -> Word revisions
```

### Current modules and evidence

| Area                | Implemented evidence                                                                                                                                                                                                         | Boundary/status                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core domain         | [`StyleProfile`](src/core/domain/StyleProfile.ts), [`Finding`](src/core/domain/Finding.ts), [`Change`](src/core/domain/Change.ts), [`ChangePlan`](src/core/domain/ChangePlan.ts)                                             | Zod-validated, strict TypeScript, additive refactor fields                                                                                               |
| Refactor domain     | [`DocumentSnapshot`](src/core/domain/DocumentSnapshot.ts), [`GovernanceProfile`](src/core/domain/GovernanceProfile.ts), [`ReviewRequest`](src/core/domain/ReviewRequest.ts)                                                  | Present in working tree; review/phase gates remain qualified                                                                                             |
| Persistence         | [`persistence.ts`](src/core/state/persistence.ts), [`migration.ts`](src/core/state/migration.ts)                                                                                                                             | Schema v3 with v0→v1→v2→v3 migration, Office roaming settings plus localStorage fallback                                                                 |
| Deterministic rules | [`typography`](src/rules/typography.ts), [`houseStyle`](src/rules/houseStyle.ts), [`protection`](src/rules/protection.ts), [`registry`](src/rules/registry.ts)                                                               | Pure; no Office, LLM, or UI imports                                                                                                                      |
| Formatting          | [`formatting`](src/formatting/index.ts) and [`formattingReader`](src/word/formattingReader.ts)                                                                                                                               | Pure DTO engines; Word reads through `runInWord`                                                                                                         |
| Analysis            | [`unifiedFindings`](src/analysis/unifiedFindings.ts), [`consistencyChecker`](src/analysis/consistencyChecker.ts), [`coverage`](src/analysis/coverage.ts), [`incrementalCoordinator`](src/analysis/incrementalCoordinator.ts) | Pure/semantic boundaries; coverage and incremental behavior are qualified                                                                                |
| AI                  | [`providers`](src/ai/providers/index.ts), [`prompts`](src/ai/prompts/index.ts), [`review`](src/ai/review)                                                                                                                    | Provider abstraction, retry, redaction, consent-gated structured review                                                                                  |
| Planning            | [`planner`](src/changes/planner.ts), [`conflictDetector`](src/changes/conflictDetector.ts), [`staleGuard`](src/changes/staleGuard.ts), [`exportAdapter`](src/changes/exportAdapter.ts)                                       | Pure planning and export; no Word mutation                                                                                                               |
| Word boundary       | [`documentReader`](src/word/documentReader.ts), [`sourceLocator`](src/word/sourceLocator.ts), [`documentObserver`](src/word/documentObserver.ts), [`revisionAdapter`](src/word/revisionAdapter.ts)                           | Host access uses `runInWord`; adapter is the only mutation owner                                                                                         |
| UI                  | [`Dashboard`](src/taskpane/pages/Dashboard.tsx), Phase C/F components, [`ReformatPanel`](src/taskpane/components/ReformatPanel.tsx)                                                                                          | Task pane; no direct adapter import; host UX evidence incomplete                                                                                         |
| Verification        | [`package.json`](package.json), [`vitest.config.ts`](vitest.config.ts), [`eslint.config.mjs`](eslint.config.mjs), [`validate-manifest.mjs`](scripts/validate-manifest.mjs), [`stage-verify.mjs`](scripts/stage-verify.mjs)   | Automated chain and the 80% exercised-core coverage gate pass; UI entry points and generated bundles remain separately verified by build/component tests |

## Git and repository evidence

- The only local branch is `main`; `origin/main` is the sole remote branch.
- Local `main` is 44 commits ahead of `origin/main` at the audit baseline.
- Git history contains the original Stage 00–22 implementation, Stage 18 live
  smoke evidence, Stage 20–22 implementation, and the committed Phase B
  observer commit `d9a7dbf`.
- Commit `551667d` integrates the A–G refactor candidate as current source and
  documentation; its automated verification passed before commit.
- No merge commit is used as implementation evidence; commit messages, source,
  tests, and CI are the audit basis.

## Original stages: verified status

The original 00–28 stage map remains preserved. Status meanings:

- **PASS** — implementation and automated gate evidence are present and green.
- **PASS WITH DOCUMENTED LIMITATION** — implementation and relevant tests exist,
  but a known limitation remains.
- **IMPLEMENTED** — code and focused tests are committed, but live host or other
  named acceptance evidence remains open.
- **PARTIAL** — some implementation exists, but a required behavior or gate is
  unverified.
- **BLOCKED** — a prerequisite or hard gate prevents a PASS claim.
- **NOT STARTED** — no implementation was verified.

| Stage | Scope                      | Status                          | Evidence and qualification                                                                                                                                                                                                                                         |
| ----- | -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 00    | Repository discovery       | PASS                            | Baseline files and repository inventory exist.                                                                                                                                                                                                                     |
| 01    | Office.js capability spike | PASS WITH DOCUMENTED LIMITATION | Desktop Word probe and live tracked text smoke are recorded in [`manual-verification`](docs/manual-verification.md). Web Chrome, web Edge, and Mac remain untested; styles and breaks remain false on the tested host.                                             |
| 02    | Scaffold                   | PASS                            | Build, manifest JSON/XML fallback, assets, tests, CI, and hooks exist.                                                                                                                                                                                             |
| 03    | Cline governance           | PASS                            | `.cline` rules, `.roo` skills, and scoped rules exist.                                                                                                                                                                                                             |
| 04    | Domain model               | PASS                            | Core Zod contracts and tests exist.                                                                                                                                                                                                                                |
| 05    | Storage/state              | PASS                            | Persistence, v3 migration, and corruption fallback exist.                                                                                                                                                                                                          |
| 06    | LLM provider layer         | PASS                            | OpenAI and mock adapters, registry, retry, redaction, and tests exist.                                                                                                                                                                                             |
| 07    | Settings UI                | PASS                            | Provider, consent, and telemetry settings persist.                                                                                                                                                                                                                 |
| 08    | Style sample               | PASS                            | Selection-preferred capture, clipboard fallback, and quality gate exist.                                                                                                                                                                                           |
| 09    | Deterministic metrics      | PASS                            | Pure metrics and tests exist.                                                                                                                                                                                                                                      |
| 10    | Style profiler             | PASS                            | Mock-driven semantic profiling and opt-in tests exist.                                                                                                                                                                                                             |
| 11    | Editable Style Profile UI  | PASS                            | Editor, validation, save/reset, and version controls exist.                                                                                                                                                                                                        |
| 12    | Profile versioning         | PASS                            | v2 history, diff, changelog, and migration exist.                                                                                                                                                                                                                  |
| 13    | Typography rules           | PASS                            | Pure rule engine and tests exist.                                                                                                                                                                                                                                  |
| 14    | House-style rules          | PASS                            | Pure terminology/spelling/capitalization engine and tests exist; full spellcheck remains out of scope.                                                                                                                                                             |
| 15    | Formatting engine          | PASS                            | Pure analyzer/normalizer plus Word DTO reader and tests exist.                                                                                                                                                                                                     |
| 16    | Unified findings           | PASS                            | Deterministic/formatting/semantic merge and tests exist.                                                                                                                                                                                                           |
| 17    | Change planning            | PASS                            | Planner, conflict detector, stale guard, and tests exist.                                                                                                                                                                                                          |
| 18    | Revision adapter           | PASS WITH DOCUMENTED LIMITATION | Desktop text insert/replace smoke and mock coverage exist; break/style/list/format paths remain mock-only; the mutation gate remains explicit.                                                                                                                     |
| 19    | Semantic deviation         | PASS                            | Mock-only deviation engine, Zod response validation, retry, and abort behavior exist.                                                                                                                                                                              |
| 20    | Consistency checker        | PASS                            | Findings-only checker and mock-only tests exist.                                                                                                                                                                                                                   |
| 21    | Reformat orchestrator      | PASS                            | Snapshot→analysis→plan→preview/apply path and integration tests exist.                                                                                                                                                                                             |
| 22    | Safe application           | PASS                            | Live re-hash, conflict refusal, adapter defense, and confirmation UI exist.                                                                                                                                                                                        |
| 23    | Accessibility/UX           | PASS WITH DOCUMENTED LIMITATION | Phase C task-pane components and [`ux-state-matrix`](docs/ux-state-matrix.md) exist in the worktree; real keyboard, screen-reader, ribbon, navigation, and host checks remain.                                                                                     |
| 24    | Performance                | PASS WITH DOCUMENTED LIMITATION | Debounce, bounded batches, cancellation, and finding-list pagination exist; live 50k-word and edit-to-finding measurements remain pending.                                                                                                                         |
| 25    | Security/privacy           | PASS WITH DOCUMENTED LIMITATION | Separate consent, minimization, response validation, protection checks, and privacy documentation exist; key encryption and formal security review remain limitations.                                                                                             |
| 26    | Test/review                | PASS                            | `npm run test` and `npm run test:coverage` pass. The V8 gate is 80% across exercised production modules with `all: false`, avoiding Windows path-case duplicates; the taskpane and entrypoint TSX files are exercised by component tests and the production build. |
| 27    | Manual Word verification   | PARTIAL                         | Desktop evidence exists; web Chrome, web Edge, Mac, and new Phase C/E paths are incomplete.                                                                                                                                                                        |
| 28    | Release candidate          | BLOCKED                         | Version/manifests/build are prepared, but Stage 27 and coverage/release gates are not complete.                                                                                                                                                                    |

## Refactor status and sequencing

The incoming `ToneForge_Refactor_Implementation` proposal used incompatible
stage numbers. Its implementation is intentionally mapped here to additive
phases rather than renumbered as a replacement roadmap.

| Refactor work                                                                    | Canonical phase          | Status                          | Verified implementation                                                                                                                                              | Remaining work / gate                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document snapshot, governance envelope, coverage, protection, registry, state v3 | A — Foundation           | PASS WITH DOCUMENTED LIMITATION | Domain schemas, migration, coverage, protection, registry, adapter validation, and tests are committed.                                                              | Snapshot exposes body/paragraph/heading-derived nodes rather than every Word container; this remains a documented structural limitation.                                          |
| Incremental observer                                                             | B — Observer             | PARTIAL                         | Coordinator, observer, debounce, stale state, status UI, and tests exist; commit `d9a7dbf` records the initial implementation.                                       | Observer currently has no verified Word change-range source and conservatively scans all structured nodes; the original Phase B “small edit avoids full scan” goal is not proven. |
| Ribbon, task pane, navigation, pending changes, UX states                        | C — Word-native UX       | PASS WITH DOCUMENTED LIMITATION | Office action registration, task-pane components, source locator, navigation bridge, and UX matrix are committed and tested.                                         | Real Word ribbon/navigation/accessibility behavior remains part of the external Stage 27 matrix.                                                                                  |
| Spot selection/paragraph AI review                                               | D — AI spot review       | PASS WITH DOCUMENTED LIMITATION | Prompt gate, minimizer, validator, selection/paragraph paths, absolute offset translation, provider configuration, and MockAdapter tests are committed.              | Live provider/host behavior remains external evidence.                                                                                                                            |
| Full-document editorial review                                                   | E — AI full document     | PASS WITH DOCUMENTED LIMITATION | Coverage gate, oversized-node splitting, absolute batch offsets, per-batch freshness re-checks, preflight/progress/results, consolidation, and export are committed. | Live Word provider/host behavior remains external evidence.                                                                                                                       |
| Safe apply, performance, security, regression                                    | F — Hardening            | PASS WITH DOCUMENTED LIMITATION | Dependency ordering, preservation/protection checks, post-apply hash verification, bounded AI paths, privacy checks, and 80% core coverage exist.                    | Live performance, long-document measurements, and formal security review remain qualified.                                                                                        |
| Host matrix, release acceptance, consistency seam                                | G — Verification/release | BLOCKED                         | Release check, secret/docs scans, deterministic staging, CI gates, and reserved consistency boundary exist.                                                          | The external Word host matrix and release acceptance evidence remain incomplete; Phase H consistency expansion is not started.                                                    |
| Content Consistency Review C1–C10                                                | H — Reserved future      | NOT STARTED                     | Only the reserved seam exists; no engine is implemented or imported.                                                                                                 | Must follow core release acceptance and a separately approved privacy/consent design.                                                                                             |

### Phase dependency graph

```mermaid
flowchart TD
  A[Phase A Foundation] --> B[Phase B Observer]
  B --> C[Phase C Word-native UX]
  C --> D[Phase D Spot AI review]
  D --> E[Phase E Full-document review]
  E --> F[Phase F Hardening]
  F --> G[Phase G Host verification and release]
  G --> H[Phase H Reserved consistency expansion]
```

The sequence is retained because later phases consume earlier contracts, but a
phase marked partial or implemented in the worktree must not be treated as a
passed gate merely because its files exist.

## Refactor before/after architecture

### Before

The pre-refactor path had text snapshots, a `StyleProfile`, deterministic rule
and formatting findings, semantic deviation findings, a findings-only checker,
a planner, and the Word revision adapter. It had a small task pane, limited UX
states, and no structured node/coverage/protection/AI-review contracts.

### After as currently implemented

The refactor adds structured node DTOs, a governance profile envelope, additive
finding/change/plan metadata, state schema v3, coverage, protection, rule IDs,
an observer, source navigation, ribbon/commands, consent-gated AI review,
bounded full-document review, export adapters, and a reserved consistency seam.
The original `StyleProfile`, text snapshot, checker, orchestrator, and adapter
paths remain available for compatibility.

### Transitional and compatibility code

- [`DocumentSnapshot`](src/word/documentReader.ts) text interface and
  `getStructuredSnapshot()` coexist.
- `resolveSourceRange()` is additive; current navigation still uses character
  offsets because real Word node-path navigation is not proven.
- `ChangePlan.conflicts` accepts legacy strings and structured conflict entries.
- `Finding`, `Change`, and `ChangePlan` use defaults/additive fields to preserve
  existing fixtures.
- [`smokeApply`](src/word/smokeApply.ts) and the Stage 18 smoke panel are
  deprecated compatibility/reproduction paths, not competing production paths.
- The reserved [`consistency`](src/analysis/consistency/README.md) directory is
  documentation-only and must not be imported by live code.

## Verification and release gates

The required ordered chain is:

```text
typecheck -> lint -> format -> secret scan -> documentation links -> test -> build -> manifest validation
```

Commands:

- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm run secrets:scan`
- `npm run docs:validate`
- `npm run test`
- `npm run build`
- `npm run validate`
- `npm run stage:verify` — repeats the ordered automated checks and creates release staging.
- `npm run test:coverage` — required for the 80% exercised-core coverage gate.
- `npm run release:check` — must not pass while Stage 27 is incomplete.

### Current verification result

| Check               | Result             | Evidence                                                          |
| ------------------- | ------------------ | ----------------------------------------------------------------- |
| Typecheck           | PASS               | `npm run typecheck`                                               |
| Lint                | PASS               | `npm run lint`                                                    |
| Format              | PASS               | `npm run format`                                                  |
| Tests               | PASS               | `npm run test`: 59 files, 603 tests                               |
| Coverage            | PASS               | `npm run test:coverage` passes the 80% exercised-core gate        |
| Build               | PASS with warnings | `npm run build`; Webpack reports asset-size/runtime warnings      |
| Manifest validation | PASS               | `npm run validate`                                                |
| Stage verification  | PASS               | `npm run stage:verify` runs the ordered chain and release staging |
| Manual host matrix  | INCOMPLETE         | Desktop evidence only; web Chrome, web Edge, and Mac open         |
| Release check       | BLOCKED            | Hard human Word-host evidence gate is open                        |

## Prioritized implementation plan

### P0 — correctness and safety (automated) — COMPLETE

1. Command-runtime registration, completion events, and manifest parity pass.
2. Whole-body `Range.set()` navigation passes with fail-closed host handling.
3. Selection-relative paragraph resolution passes.
4. Structured offsets, AI range translation, and oversized batch splitting pass.
5. Full-review freshness checks fail closed on drift.
6. Structured protection validation and post-apply verification pass through the orchestrator.
7. Pending AI plans apply through `applyReviewedPlan()`; the action is unavailable without a callback.
8. Configured OpenAI credentials are passed to the registry; mock tests remain offline.
9. Focused regression tests and the ordered automated gates pass.

### P1 — release engineering and regression — COMPLETE

1. The 80% exercised-core coverage gate passes; thresholds remain unchanged.
2. Manifest/action parity, documentation links, secret scanning, generated-artifact checks, and release staging pass.
3. Release validation reads canonical statuses and required Word-host evidence; staging includes manifests and static assets.
4. Status/evidence documentation is updated after verification.

### P2 — external evidence and release

1. Run the Windows desktop, Word web Chrome, Word web Edge, and conditionally Mac
   matrix in [`docs/manual-verification.md`](docs/manual-verification.md).
2. Exercise Phase C/D/E navigation, consent, observer, protection, accessibility,
   and safe-apply behavior in each supported host.
3. Run performance baselines, formal security review, release staging, tag, and
   publication only after P0/P1 and the host matrix pass.
4. Keep Phase H reserved until core release acceptance.

Affected verification: `npm run test:coverage`, `npm run verify`,
`npm run stage:verify`, and `npm run release:check`. P2 items require real Word
hosts and cannot be completed by repository automation alone.

## Human decisions still required

- Which Word hosts are release-support commitments: web Chrome, web Edge, and
  Windows desktop are named; Mac is “if available” in the refactor materials.
- Whether the current global 80% coverage threshold remains mandatory for the
  release or whether a documented module-scoped policy is approved.
- Whether Phase G's proposed consistency `types.ts` stub and CI grep guard are
  required before release, or whether the current documentation-only seam is
  sufficient.
- Whether to retain the deprecated smoke panel in the release candidate UI or
  remove it after the final live verification record is complete.

## Documentation policy

Supporting documents retain historical or design detail, but status and plan
claims must point here. The following are compatibility evidence and guides,
not competing sources of truth:

- [`docs/project-state.md`](docs/project-state.md) — evidence index and stage-gate
  notes; authoritative statuses are the table in this file.
- [`docs/architecture.md`](docs/architecture.md) — current module boundaries and
  data flow.
- [`docs/decision-log.md`](docs/decision-log.md) — dated architectural decisions.
- [`docs/manual-verification.md`](docs/manual-verification.md) — host evidence.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — release history.
- [`plans/`](plans) — historical execution plans and audit records.
- `ToneForge_Refactor_Implementation/` — incoming proposal/design set; superseded
  for status and sequencing by this file.

When a supporting document conflicts with this file, correct the supporting
document or add a clear cross-reference; do not create another roadmap.
