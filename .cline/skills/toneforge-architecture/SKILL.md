---
name: toneforge-architecture
description: Keep ToneForge's module boundaries and deterministic-first rule intact. Use when adding an import, deciding where a function belongs, or when a boundary lint error fires.
---

# Architecture and Boundaries

ToneForge is deterministic-first: code decides what can be measured, and a model
is consulted only where interpretation is genuinely required. This skill covers
where code is allowed to reach, and which exception exists.

## When to use

- Adding or changing any import.
- Deciding whether a function belongs in a pure engine, `src/analysis/`,
  `src/ai/`, or `src/word/`.
- Debugging a `no-restricted-imports` failure.
- Reviewing whether a proposed change makes a module impure.

Trigger phrases: "where should this live", "import boundary", "deterministic",
"can this module call the LLM", "why is eslint blocking this import".

## The seven canonical rules

1. **Deterministic first.** Anything measurable or safely enumerable is code:
   typography, quotes, whitespace, terminology, capitalization, spelling
   variants, formatting, structure, coverage, protection, preservation.
2. **AI only where interpretation is necessary.** A model is for tone, voice,
   rhetorical style, semantic flow, register, grammar ambiguity, and
   meaning-preserving rewrites. AI is optional and must never be required for
   deterministic governance.
3. **One canonical profile.** `StyleProfile` is learned from samples;
   `GovernanceProfile` is an additive envelope for scope, protection,
   terminology, policy, and provenance. It does not replace the style contract.
   `ResolvedPolicy` resolves the two for analysis and planning.
4. **One mutation path.** Everything flows through `ChangePlan` to
   `word/revisionAdapter`. Rules and UI never mutate Word.
5. **Coverage is measurable.** Analysis records a `CoverageReport`. Incomplete
   coverage blocks full-document review, and a partial run is never presented as
   complete.
6. **Preserve source identity.** Nodes and findings keep identifiers, paths, or
   character ranges so a finding can be navigated back to real text.
7. **Privacy gate.** Raw text leaves the add-in only through explicit opt-in.

## Module boundaries

The authoritative table is in
[`docs/architecture.md`](../../../docs/architecture.md). The shape of it:

| Module                                 | May import                                                                    | Must never import                                               |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `core/domain`                          | `zod`, `shared/utils`                                                         | `word`, `ai`, UI, `Office`                                      |
| `rules`, `formatting`, `style/metrics` | `core/domain`, `shared/utils`                                                 | `ai`, `Office`, UI                                              |
| `analysis`                             | `core/domain`, `rules`, `formatting`, `ai/providers`, `shared/utils`          | UI, `word/revisionAdapter`                                      |
| `analysis/consistency`                 | `core/domain`, `ai/providers`, `shared/utils`                                 | `word`, `taskpane`, `commands`, `reformat`, `changes`, `Office` |
| `changes`                              | `core/domain`, `shared/utils`                                                 | analysis, rules, formatting, style, ai, word, UI, `Office`      |
| `reformat`                             | core, analysis, changes, formatting DTOs, word boundary, AI providers, shared | taskpane, commands, direct `Office.run`                         |
| `word`                                 | shared Office helpers, `core/domain`, permitted readers                       | AI, UI                                                          |
| `ai/gateway`                           | `core/config`, `core/domain`, `shared/utils`, retry                           | Word, UI, `Office`                                              |
| `ai/providers`                         | core config, shared utils, `ai/gateway` (types only)                          | Word, UI                                                        |
| `taskpane/troubleshooting`             | `core/domain` (types only)                                                    | store reads, `word`, `ai`, React, UI                            |
| `taskpane`, `commands`                 | core, shared, approved service boundaries                                     | direct `word/revisionAdapter` import, direct mutation           |

These are enforced by `no-restricted-imports` scopes in
[`eslint.config.mjs`](../../../eslint.config.mjs), not merely documented. If a
new module needs a scope, add the scope and the architecture table row together.

## Rules

### 1. Deterministic modules stay pure

`src/rules/`, `src/formatting/`, and `src/style/` import only `core/domain` and
`shared/utils`. No Office, no LLM, no UI.

- Put pure helpers in [`src/shared/utils/text.ts`](../../../src/shared/utils/text.ts)
  rather than duplicating them inside a rule.
- If a deterministic function needs document data, pass the DTO in as a
  parameter. Do not import a Word reader to obtain it.
- If you want to call a model from inside a rule, stop. That is not a rule.

A purity test needs no Office mock. If a "pure" test needs the Office mock, the
function is not pure.

### 2. The consistency engine is the one exception, and it is narrow

[`src/analysis/consistency/`](../../../src/analysis/consistency/) is the single
sanctioned exception to deterministic-first (ADR-0052). Three boundaries keep it
from becoming a precedent:

1. It is never reached from the typing path. No module in `word/`, no observer,
   and no incremental scan may import it. ESLint forbids `word`, `taskpane`,
   `commands`, `reformat`, and `changes` from importing into it.
2. `ai/providers` is allowed there deliberately and narrowly, and the eslint
   scope says so in a comment. An undocumented exception is indistinguishable
   from a mistake.
3. Its output is an ordinary `Finding`. `bridge.ts` is the only crossing point.
   `consistency` was added to `FindingKind`, so a consistency finding is planned,
   gated, and applied through exactly the same path as every other finding. It
   gains no privileged route to the document.

ADR-0052 is recorded as an exception, not a precedent. No other non-deterministic
engine is authorized by it.

### 3. Troubleshooting diagnostics are pure

[`src/taskpane/troubleshooting/checks.ts`](../../../src/taskpane/troubleshooting/checks.ts)
is state in, notes out. It reads no store, calls no Office API, and imports no
React, so any surface that can read state can call `diagnoseSituation` and two
surfaces cannot disagree about why something is blocked. Gather state at the
call site.

Every remedy carries a `remedyTarget` naming the control by its on-screen label.
A remedy that does not say where to go is not advice. A test pins every label.

### 4. `core/domain` is Office-free, AI-free, and UI-free

[`ProviderConnection.ts`](../../../src/core/domain/ProviderConnection.ts) is
the sharpest case: it describes which connection is in use and how it was
authenticated, and has **no field capable of holding a secret**. A test reflects
over the schema so a future field cannot quietly reintroduce one. If your change
adds a credential-shaped field there, the architecture is wrong, not the test.

## Referenced resources

- [`docs/architecture.md`](../../../docs/architecture.md) — authoritative boundary table
- [`eslint.config.mjs`](../../../eslint.config.mjs) — enforced scopes
- [`docs/decision-log.md`](../../../docs/decision-log.md) — ADR-0031, ADR-0052
- [`ROADMAP.md`](../../../ROADMAP.md) — canonical rules and status
