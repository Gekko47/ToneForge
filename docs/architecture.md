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
Deterministic rules/formatting   Optional AI review
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
```

## Module boundaries

| Module                                 | Allowed imports                                                                         | Forbidden imports                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `core/domain`                          | `zod`, `shared/utils`                                                                   | `word`, `ai`, UI, `Office`                                 |
| `rules`, `formatting`, `style/metrics` | `core/domain`, `shared/utils`                                                           | `ai`, `Office`, UI                                         |
| `analysis`                             | `core/domain`, `rules`, `formatting`, `ai/providers`, `shared/utils`                    | UI, `word/revisionAdapter`                                 |
| `changes`                              | `core/domain`, `shared/utils`                                                           | analysis, rules, formatting, style, ai, word, UI, `Office` |
| `reformat`                             | core, analysis, changes, formatting DTOs, word boundary, AI providers, shared utilities | taskpane, commands, direct `Office.run`                    |
| `word`                                 | shared Office helpers, core domain, and permitted deterministic readers                 | AI, UI                                                     |
| `ai/providers`                         | core config, shared utilities                                                           | Word, UI                                                   |
| `taskpane` / `commands`                | core, shared, approved service boundaries                                               | direct `word/revisionAdapter` imports and direct mutation  |

## Data flow and compatibility

1. `style/sampleCapture` and `style/sampleQuality` produce sample DTOs.
2. `style/metrics` and the optional semantic profiler build the editable,
   versioned `StyleProfile`.
3. `GovernanceProfile` adds policy and provenance without replacing the style
   contract.
4. `word/documentReader` preserves the text snapshot and adds
   `getStructuredSnapshot()` for node DTOs.
5. `analysis/consistencyChecker` composes deterministic findings, formatting
   findings, optional semantic deviations, and optional coverage.
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

## StyleProfile field enforcement

The editable profile is the single source for analysis and planning. Measured
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

The current structured reader derives a body node and paragraph/heading nodes
from the text snapshot. It is an additive compatibility seam, not proof that all
Word structures (tables, cells, lists, captions, headers, footers, fields, and
shapes) are extracted from the live object model. Coverage must not be described
as complete until those limitations are either implemented or explicitly
scoped.

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
- GitHub Actions CI runs typecheck, lint, format, coverage, build, and manifest
  validation; `npm run build:check` fails on missing, unhashed, oversized, or
  unreferenced production artifacts. Word-host evidence remains tracked in
  [`ROADMAP.md`](../ROADMAP.md).

## Security and privacy posture

- API keys enter through Settings and are stored in `Office.roamingSettings` or
  the documented localStorage fallback.
- Prompt builders require explicit raw-text opt-in.
- Provider errors and logger context redact secret-like fields.
- Protected content and incomplete coverage fail closed.
- The localStorage fallback is a documented MVP limitation; formal security
  review and host evidence remain open.
