# ToneForge — Architecture

The canonical implementation status and work plan are in
[`ROADMAP.md`](../ROADMAP.md). This document describes the verified current
module boundaries and data flow; it does not duplicate stage status.

## Product architecture

```text
Style sample
    |
    v
Sample quality
    |
    +-----------------------------+
    |                             |
    v                             v
Measured analysis           Optional semantic analysis
    |                             |
    +-------------+---------------+
                  v
          Editable StyleProfile
                  |
          GovernanceProfile envelope
                  |
        Structured DocumentSnapshot
                  |
    +-------------+----------------+
    |                              |
    v                              v
Deterministic rules/formatting   Consistency review
    |                              |
    +-------------+----------------+
                  v
              Findings[]
                  |
              ChangePlan
                  |
    stale/conflict/protection/preservation checks
                  |
             Preview/confirm
                  |
           Word revisionAdapter
                  |
              Word revisions


Semantic Review is a SECOND path, and it is drawn separately because the two
share only the writer:

    Word selection
        |
        v
  selectionScope            a local read: selection text, offsets, anchor
        |                   no whole-document read, no document hash
        v
  semantic review engine    the only LLM call; bounded by MAX_REVIEW_SELECTION_CHARS
        |                   returns a value, never a ChangePlan
        v
  preservationValidator     local, deterministic: protected facts, qualifiers
        |
        v
  SemanticReviewResult      assessment + proposed revision + preservation report
        |
        v
  reformat/semanticApply    approved as a value -> ONE Change -> ChangePlan
        |
        +------------------> the same stale/conflict/protection/preservation
        |                     checks, then the same adapter. No Finding, so
        |                     nothing can be skipped by omission (ADR-0097).
        v
  Word revisionAdapter
```

**Why the second path is drawn rather than merged.** ADR-0055 removed the semantic
output from the findings list, so the two no longer share a data structure \u2014 only
a writer. Keeping them in one diagram would suggest the semantic review produces
findings, which is exactly the claim the split removed. `analysis/semantic/` is
forbidden from importing `reformat` and `changes`, so the engine cannot build a
plan even if a caller asked it to.

## Module boundaries

| Module                                 | Allowed imports                                                                         | Forbidden imports                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `core/domain`                          | `zod`, `shared/utils`                                                                   | `word`, `ai`, UI, `Office`                                      |
| `rules`, `formatting`, `style/metrics` | `core/domain`, `shared/utils`                                                           | `ai`, `Office`, UI                                              |
| `analysis`                             | `core/domain`, `rules`, `formatting`, `ai/providers`, `shared/utils`                    | UI, `word/revisionAdapter`                                      |
| `analysis/consistency`                 | `core/domain`, `ai/providers`, `shared/utils`                                           | `word`, `taskpane`, `commands`, `reformat`, `changes`, `Office` |
| `analysis/semantic`                    | `core/domain`, `ai/providers`, `shared/utils`                                           | `word`, `taskpane`, `commands`, `reformat`, `changes`, `Office` |
| `changes`                              | `core/domain`, `shared/utils`                                                           | analysis, rules, formatting, style, ai, word, UI, `Office`      |
| `reformat`                             | core, analysis, changes, formatting DTOs, word boundary, AI providers, shared utilities | taskpane, commands, direct `Office.run`                         |
| `word`                                 | shared Office helpers, core domain, and permitted deterministic readers                 | AI, UI                                                          |
| `ai/gateway`                           | `core/config`, `core/domain`, `shared/utils`, `ai/providers/retry`                      | Word, UI, `Office`                                              |
| `ai/providers`                         | core config, shared utilities, `ai/gateway` (types only)                                | Word, UI                                                        |
| `taskpane/troubleshooting`             | `core/domain` (types only)                                                              | Store reads, `word`, `ai`, UI, React                            |
| `taskpane` / `commands`                | core, shared, approved service boundaries                                               | direct `word/revisionAdapter` imports and direct mutation       |

### Troubleshooting registry boundary

`taskpane/troubleshooting/checks.ts` is pure: state in, notes out. It reads no
store, calls no Office API, and imports no React. That is the whole point of it
— the diagnostics were previously a private function inside the troubleshooting
panel, so no other surface could reuse them and two surfaces could state
different reasons for the same blocker. Anything that can read state can call
`diagnoseSituation`; the state gathering happens at the call site, so the
Dashboard passes the plan and review counts it already holds rather than the
registry re-deriving them and possibly disagreeing with the section below it.

Every remedy carries a `remedyTarget` naming the control by its on-screen label.
This is a documentation obligation enforced by a test that pins every label, not
a suggestion: a remedy that does not say where to go is the same non-answer the
panel was already giving, one level of indirection further from the user.

A remedy target is a label and not a navigation destination, deliberately. The
pane's `TaskPaneDestination` and the command layer's `TaskpaneTarget` are
different unions with no mapping between them, and a link landing the user one
screen early — where they must still find the control — is not better advice
than naming it.

### Provider connection boundary (Phase 4)

Two rules carry the credential model, and both are enforced rather than
documented:

1. **`core/domain/ProviderConnection.ts` has no field capable of holding a
   secret.** It describes _which_ connection is in use and how it was
   authenticated, not the credential itself. A test reflects over the schema
   shape so a future field cannot quietly reintroduce one.
2. **`ai/gateway` is the only module that talks to a credential service**, and
   it accepts only a same-origin path or a loopback HTTP(S) origin. A
   production gateway origin is build-time configuration, so there is no
   Settings field that can name an arbitrary host.

`ai/providers` extends `GatewayRoutedAdapter` and holds no credential of any
kind. Every remote provider - OpenAI, Anthropic, OpenRouter - is routed through
the same connection contract; the only difference between them is the request
and response shape.

### Consistency engine boundary (Phase 5)

`analysis/consistency` is the **single sanctioned exception** to
deterministic-first (ADR-0052). Three boundaries keep that exception from
becoming a precedent:

1. **It is never reached from the typing path.** No module in `word/`, no
   observer, no incremental scan may import it. `eslint.config.mjs` forbids
   `word`, `taskpane`, `commands`, `reformat`, and `changes` from importing
   _into_ the engine, and the engine itself imports only `core/domain`,
   `ai/providers`, and `shared/utils`.
2. **`ai/providers` is allowed, deliberately and narrowly.** The engine is the
   one place that may ask a model to judge something. The eslint scope says so
   in a comment rather than leaving the exception implicit, because an
   undocumented exception is indistinguishable from a mistake.
3. **Its output is an ordinary `Finding`.** `bridge.ts` is the only crossing
   point. `consistency` was added to `FindingKind`, so a consistency finding is
   planned, gated, and applied through exactly the same path as every other
   finding. It gains no privileged route to the document.

## Data flow and compatibility

1. `style/sampleCapture` and `style/sampleQuality` produce sample DTOs.
2. `style/metrics` and the optional semantic profiler build the editable
   `StyleProfile`. A `ProfileRecord` owns the persisted draft, the immutable
   published versions, and the integer revision audit trail, so a
   `ChangePlan` can cite the exact revision it was built from.
3. `GovernanceProfile` adds policy and provenance without replacing the style
   contract.
4. `word/analysisAcquisition` performs the production single-pass Word read and
   creates complete identity, bounded analysis text, structured paragraph/style
   nodes, formatting provenance, capability data, and explicit unsupported scope.
   `word/documentReader` remains the compatibility text/structured reader.
5. `analysis/analysisContext` carries the immutable acquisition DTOs;
   `analysis/consistencyChecker` composes deterministic findings, formatting
   findings, optional semantic deviations, and coverage from that context.
6. `analysis/unifiedFindings` merges findings deterministically.
7. `changes/planner` produces validated `ChangePlan` objects; it never reads Word
   or mutates the document.
8. `reformat/orchestrator` composes snapshot, analysis, planning, preview, and
   tracked apply. Full-document review is delegated to the bounded AI review
   service and does not mutate Word.
9. `word/revisionAdapter` is the only mutation path. It validates stale state,
   conflicts, capabilities, ranges, payloads, dependencies, protection, and
   preservation before applying changes.
10. `taskpane` renders a production governance workflow and a separate
    troubleshooting surface. UI code does not import the adapter directly.
    Capability, runtime, gate, and historical smoke controls never render in the
    normal main view.
11. The observer exposes a single current scan phase and accepted run identity.
    Debounced document events replace scheduled work, and obsolete async results
    are discarded before they can update findings.
12. Safe reformat preview retains one exact `ChangePlan`; apply consumes that
    reviewed plan through `applyReviewedPlan`, re-checks freshness, and reports
    mutation/verification outcomes separately.
13. Apply is operation-specific: text, style, paragraph, character, character-reset,
    and list-level mutations each require their verified Word capability. Non-text
    plans are verified from a fresh formatting snapshot rather than inferred from
    adapter success.

## Phase 0 implementation and approved evolution

The Phase 0 implementation keeps the current service boundaries while making
workflow state and evidence truthful. The Dashboard has a first-run profile
setup state; the observer retains findings from a conservative full rescan;
coverage reports unexpected processing gaps separately from declared unsupported
or protected scope; Finding cards expose Review rather than a mutation action;
and Pending Changes owns the single plan-level Apply and Reject workflow.
Technical acquisition diagnostics remain in Troubleshooting. The production
`ReformatPanel` is preview-only, and the exact `ChangePlan` is passed to
`applyReviewedPlan()` only after user review and all existing safety checks.
Ignored findings use a versioned content fingerprint that excludes generated
UUIDs, and optional broker settings are omitted when cleared.

The approved Phase 1–6 plan adds a resolved policy contract between learned
style evidence and normative governance, followed by Learn Style, B23 workflow
projection, Word event evidence, provider gateway contracts, dynamic model
catalogs, C1–C10, and production/security/accessibility/performance evidence.
Phase 1 is implemented: [`resolveResolvedPolicy()`](../src/core/domain/ResolvedPolicy.ts)
is consumed by analysis and the orchestrator always records a policy revision,
and [`learnStyleDraft()`](../src/style/learnStyle.ts) plus the Profile entry
point create an editable, quality-gated draft. The B23, provider, C1–C10, and
release contracts remain planned boundaries, not claims of current OAuth, live
Word event, or release capability. They must preserve the same `ChangePlan` and
single mutation path. The implementation sequence is recorded
in
[`plans/toneforge-modern-ux-provider-consistency-implementation-plan.md`](../plans/toneforge-modern-ux-provider-consistency-implementation-plan.md:1).

## StyleProfile field enforcement

A `ProfileRecord` in `core/state` is the single persisted source of truth for a
profile; `core/state/profileSelectors` derives every read view from it as a
pure function, so no second structure can disagree. The effective profile —
the active published version, else the draft — is what analysis and planning
consume. Measured
fields are observational evidence from the captured sample; they are deliberately
not converted into unsupported Word formatting commands.

| Profile field                              | Consumer                                                        | Planned change                                 |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------- |
| `semantic.*`                               | Consent-gated semantic deviation prompt and spot/full AI review | Validated AI replacement or advisory finding   |
| `typography.emDash`                        | `findTypographyIssues`                                          | `replaceText` or `deleteRange`                 |
| `typography.emDashSpacing`                 | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.enDashSpacing`                 | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.doubleQuotes`                  | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.singleQuotes`                  | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.apostrophes`                   | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.decimalSeparator`              | `findTypographyIssues`                                          | `replaceText`                                  |
| `typography.thousandsSeparator`            | `findTypographyIssues`                                          | `replaceText` or `deleteRange`                 |
| `typography.ellipsis`                      | `findTypographyIssues`                                          | `replaceText`                                  |
| `houseStyle.preferredTerminology`          | `findHouseStyleIssues`                                          | `replaceText`                                  |
| `houseStyle.bannedTerms`                   | `findHouseStyleIssues`                                          | `deleteRange`                                  |
| `houseStyle.capitalization.sentenceCase`   | `findHouseStyleIssues`                                          | `replaceText`                                  |
| `houseStyle.capitalization.titleCaseWords` | `findHouseStyleIssues`                                          | `replaceText`                                  |
| `houseStyle.spellingVariant`               | `findHouseStyleIssues`                                          | `replaceText`                                  |
| `measured.*`                               | `computeMeasuredProfile` and read-only Profile UI               | No mutation without an explicit normative rule |

Word-format findings (heading hierarchy, unknown/empty styles, direct formatting,
and list level) are governed by the applied document styles and Word object
model. Direct character formatting is cleared with `Font.reset()` so the
profile does not overload terminology records with undocumented formatting keys.

## Current implementation boundaries

### Structured snapshot

The production acquisition path reads Word paragraph items and style metadata
and builds body, paragraph, and style-derived heading nodes with stable local
identities. It records partial or unsupported coverage explicitly. It does not
claim complete extraction of tables, cells, captions, headers, footers, fields,
controls, sections, or shapes; those structures remain outside the current
release scope and must keep coverage qualified. The older text-derived
`getStructuredSnapshot()` path remains a compatibility fallback, not the
authoritative production acquisition path.

### Observer

The observer is debounced and emits one mutually exclusive phase, findings,
coverage, current run identity, and the last accepted run identity. It has no
verified live Word change-range event, so it can conservatively scan all current
nodes. Repeated document events coalesce; a superseded asynchronous scan cannot
commit findings after a newer run is scheduled. The original incremental
performance goal is not yet proven in Word.

### AI review

Review requests are validated, context is minimized, protected nodes are
excluded, and responses become `Finding`/`ChangePlan` objects. Spot and
full-document consent are separate. Full-document review is bounded and
coverage-gated, but token-aware limits and live host behavior remain qualified.

### Safety

The adapter retains the Stage 01 mutation gate and reverse-offset application.
Every strict Apply calls `prepareTrackedEditing()` first: when enabled, it runs a
fresh non-destructive host probe, maps every planned change to its required Word
capability, and arms the adapter only when the complete plan is supported. The
Troubleshooting-only **Enable tracked editing** control persists an operator
preference; disabling it immediately disarms mutation while leaving preview and
review available. The orchestrator still performs live re-hash, conflict and
protection refusal, managed Track Changes, and post-apply readback. It refuses a
plan when managed tracking cannot be established. The UI presents the exact
previewed plan in Pending Changes and never bypasses these gates. Deprecated smoke
helpers are not rendered in the production taskpane.

## Technology stack

- TypeScript 5.6 strict mode with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- React 18 and Fluent UI v8.
- Webpack 5 with content-hashed production bundles, a separate runtime chunk,
  vendor/common splitting, and explicit 600 KiB JavaScript asset/initial-page
  budgets.
- Zod runtime contracts and Vitest/jsdom tests.
- ESLint, Prettier, Husky, lint-staged, and commitlint.
- GitHub Actions CI and release use the named `toneforge-repository-v1`
  verification graph in [`scripts/verification-graph.mjs`](../scripts/verification-graph.mjs).
  It includes typecheck, lint, format, source secret scan, documentation links,
  skills validation, tests, coverage, build/artifact checks, built-secret scan,
  manifest validation, release staging, and release package contents.
  `npm run clean-install:check` proves a clean temporary install follows the
  same documented graph without touching the checkout's `dist/` or
  dependencies. Word-host evidence remains a separate human release gate in
  [`ROADMAP.md`](../ROADMAP.md).

## Security and privacy posture

- Ordinary application state contains provider/model/broker configuration and
  consent, never API keys. State v5 migrates v0-v4 records, removes legacy
  credential fields, and purges legacy storage keys while preserving consent.
- Webpack compiles only an explicit non-secret environment allowlist. Local
  development reads `.env` only in the Node process and exposes a loopback
  same-origin or session-nonce LLM broker; browser requests do not include an
  authorization header. The broker validates content type, request schema, and
  bounded body size.
- Prompt builders require explicit raw-text opt-in.
- Provider errors and recursive logger context redact credential fields,
  prompt/document-content fields, and secret-shaped strings.
- Protected content and incomplete coverage fail closed.
- Production broker authentication/custody, the formal threat model, and live
  browser/host evidence remain open. Browser-held production API keys are not a
  supported release decision in this repository.
