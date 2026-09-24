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
10. `taskpane` renders preview, confirmation, findings, coverage, stale, AI, and
    pending-change states. UI code does not import the adapter directly.

## Current implementation boundaries

### Structured snapshot

The current structured reader derives a body node and paragraph/heading nodes
from the text snapshot. It is an additive compatibility seam, not proof that all
Word structures (tables, cells, lists, captions, headers, footers, fields, and
shapes) are extracted from the live object model. Coverage must not be described
as complete until those limitations are either implemented or explicitly
scoped.

### Observer

The observer is debounced and emits findings, coverage, and stale status. It
currently has no verified live Word change-range event, so it can conservatively
scan all current nodes. The helper functions for dirty-node mapping exist, but
the original performance goal is not yet proven in Word.

### AI review

Review requests are validated, context is minimized, protected nodes are
excluded, and responses become `Finding`/`ChangePlan` objects. Spot and
full-document consent are separate. Full-document review is bounded and
coverage-gated, but token-aware limits and live host behavior remain qualified.

### Safety

The adapter retains the Stage 01 mutation gate and reverse-offset application.
The orchestrator performs live re-hash and conflict refusal before apply. The
deprecated smoke helpers are retained only for historical Stage 18 reproduction.

## Technology stack

- TypeScript 5.6 strict mode with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- React 18 and Fluent UI v8.
- Webpack 5 with content-hashed production bundles.
- Zod runtime contracts and Vitest/jsdom tests.
- ESLint, Prettier, Husky, lint-staged, and commitlint.
- GitHub Actions CI runs typecheck, lint, format, coverage, build, and manifest
  validation; the current local coverage command exposes the global threshold
  failure tracked in [`ROADMAP.md`](../ROADMAP.md).

## Security and privacy posture

- API keys enter through Settings and are stored in `Office.roamingSettings` or
  the documented localStorage fallback.
- Prompt builders require explicit raw-text opt-in.
- Provider errors and logger context redact secret-like fields.
- Protected content and incomplete coverage fail closed.
- The localStorage fallback is a documented MVP limitation; formal security
  review and host evidence remain open.
