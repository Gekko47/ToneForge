# Indexed Content Consistency Review (Phase 5, v3)

Replacement engine per `plans/indexed-consistency-authoritative-plan.md`.
The windowed pairwise engine is gone; retrieval is indexed by subject.

## What is here

- [`contracts/`](contracts/) — every shape the engine produces or consumes.
  Full claim, entity, event, programme, quantum, delay, evidence, candidate,
  subject, evaluation, plan, report schemas plus the store interface.
  Replaces the old `contracts.ts`.
- [`indexedEngine.ts`](indexedEngine.ts:1) — orchestration. Replaces the old
  `engine.ts`. Consent gate first, cancellation and staleness guards
  throughout, report tied to its revision.
- [`bridge.ts`](bridge.ts:1) — the only boundary into the rest of ToneForge.
  Maps a report to ordinary `Finding` objects with `kind: "consistency"`.
- [`grouping.ts`](grouping.ts:1) — collapses repeats of one disagreement for
  the results surface. Replaces the old grouping.
- [`checks/`](checks/) — the ten check identities with their
  deterministic-first flags and the shared pure primitives.

## What R1–R7 delivered

- `extraction/` — prompt, schema, batch extractor, global resolver, evidence
  validator (R2).
- `normalisation/` — dates, quantities, currencies, durations, units,
  terminology, aliases (R3).
- `index/` — nine blocking indices with add, remove, replace (R3).
- `candidates/` — `c1` through `c10` plus registry (R3).
- `comparison/` — diff, deterministic resolver, profiles, 16-outcome
  derivation, hard gates, confidence engine with intervals (R4, R6).
- `decision/` — provider interface, plan compiler, context expansion,
  question registry, `systemOne/` adapter triple (R5).
- `persistence/` — `ConsistencyStore` interface, `IndexedDbStore`,
  `MemoryStore`, schema versioning, WebCrypto field encryption, TTL wipe (R7).
- `benchmark/` — expert-labelled corpus and the decision-model benchmark (R7).

## Properties this engine holds to

1. **Consent first.** `consistencyConsent: z.literal(true)` or the run
   refuses. A stored `"yes"` is not permission.
2. **Certain stays local.** Only `ambiguous` candidates reach the model, and
   only up to the adjudication budget.
3. **Unclear never becomes a finding.** Malformed model output is counted in
   coverage, not silently dropped.
4. **Below threshold is advisory.** Under
   `CONSISTENCY_ACTIONABLE_CONFIDENCE` a finding is shown, explained, and
   never applied.
5. **Coverage is honest.** `complete` is true only when nothing was skipped.
   A capped run says what it skipped.

## Module boundary

Per ADR-0052 this engine is the single sanctioned exception to
deterministic-first. It may import from `ai/providers`; it may not import
from `word`, `taskpane`, `commands`, `reformat`, or `changes`. It is never
reached from the typing path, and its output is an ordinary `Finding`.
