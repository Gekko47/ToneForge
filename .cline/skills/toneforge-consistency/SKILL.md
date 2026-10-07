---
name: toneforge-consistency
description: Work with ToneForge's cross-report consistency engine (C1-C10). Use when editing src/analysis/consistency, changing a consistency check, or touching the review that produces consistency findings.
---

# Consistency Review Engine

The cross-report engine in
[`src/analysis/consistency/`](../../../src/analysis/consistency/) is the **single
sanctioned exception** to ToneForge's deterministic-first rule (ADR-0052). Read
this skill before changing anything in it, because the boundaries below are what
keep one exception from becoming a precedent.

## When to use

- Editing a check, the pipeline, the contracts, or the bridge.
- Changing how consistency findings are produced or presented.
- Deciding whether something belongs in this engine at all.

Trigger phrases: "consistency check", "C1", "contradiction", "consistency
review", "cross-report", "model adjudication".

## Why it is an exception

Deciding whether two statements in different sections _contradict_ is
interpretation. No rule answers it, and a rule that approximated one would be
confidently wrong on precisely the cases that matter. The deterministic engine
still runs while a user types; this engine runs on a whole-document snapshot the
user chose to review, never continuously.

## The three boundaries

1. **It is never reached from the typing path.** No module in `word/`, no
   observer, and no incremental scan may import it. ESLint forbids `word`,
   `taskpane`, `commands`, `reformat`, and `changes` from importing into the
   engine, and the engine imports only `core/domain`, `ai/providers`, and
   `shared/utils`.
2. **`ai/providers` is allowed deliberately and narrowly.** This is the one place
   that may ask a model to judge something. The eslint scope carries a comment
   saying so, because an undocumented exception is indistinguishable from a
   mistake.
3. **Its output is an ordinary `Finding`.**
   [`bridge.ts`](../../../src/analysis/consistency/bridge.ts) is the only crossing
   point. `consistency` was added to `FindingKind`, so a consistency finding is
   planned, gated, and applied through exactly the same path as every other
   finding. It has no privileged route to the document.

ADR-0052 is an exception, **not** a precedent. No other non-deterministic engine
is authorized by it. A proposal for a second one is a proposal to rewrite
ADR-0052, and should be recorded as such.

## The pipeline

Segment, extract, normalise, index, retrieve — with its own progress,
cancellation, and stale-run handling. Extraction is two-pass with canonical
resolution; normalisation gives every claim canonical date, quantity, and
alias keys; nine indices map those keys to claims; and each of the ten
checks retrieves only the subjects its rule names — no window scanning, no
pairwise comparison of everything. Comparison, adjudication, and D-derivation
land in R4–R6, so a candidate is never a user-facing issue by itself: it
names a subject and the claims that bear on it, and the comparison stages
decide what, if anything, is wrong.

## Consent and the surface

The engine has **its own opt-in toggle and its own consent flag**,
`consistencyReviewConsent`, distinct from `semanticOptIn` and the two retired
review consents. It defaults to `false`, and migration sets it to `false` rather
than deriving it. A user who agreed to send text for one feature has not agreed
to send it for this one.

It reuses the already-configured provider and model. There is no second
credential, no second settings surface, and no second model selection.

## What this engine does not prove

Be honest about these limits; they are recorded in
[`docs/project-state.md`](../../../docs/project-state.md).

- **It has never run against a real document or a real model.** Everything is
  covered by unit tests with `MockAdapter` and injected `fetch` doubles. That is
  a typed contract, not a verified integration.
- **The ten checks are heuristic.** They will miss real conflicts below their
  subject-overlap thresholds and will produce false positives on real prose.
  They are not calibrated against a corpus.
- **Retrieval is capped, and a capped run says so.** A subject contributes at
  most 400 claims; the rest are counted as `blockOverflowSkipped`, and a
  capped run reports partial coverage rather than silently truncating. Partial
  coverage is not full coverage, and a clean partial result is not a clean
  document.
- **A finding can propose rewriting prose.** Below 0.7 confidence it is marked
  `actionable: false` and produces no change. Above it, the plan still passes
  through the ordinary review and apply gates. The confidence scale itself is
  unvalidated — no model has judged real candidate pairs yet.

## Changes here

1. Add or change the check in `candidates/` — one retriever per check,
   dispatched by
   [`src/analysis/consistency/candidates/registry.ts`](../../../src/analysis/consistency/candidates/registry.ts) —
   and its contract in `src/analysis/consistency/contracts/`. The shared
   retrieval helpers live in
   [`src/analysis/consistency/candidates/kit.ts`](../../../src/analysis/consistency/candidates/kit.ts),
   apart from the dispatch: the retrievers depend on the kit, and the
   registry depends on the retrievers, so neither side imports the other
   mid-evaluation.
2. If it is structural and deterministic, keep it that way. Escalation must be
   the exception inside the check, not its default.
3. Add tests under `tests/unit/analysis/consistency/`.
4. Report partial coverage as partial, in the panel and the summary line.
5. Update [`docs/decision-log.md`](../../../docs/decision-log.md) if you change a
   boundary.

## Referenced resources

- [`src/analysis/consistency/`](../../../src/analysis/consistency/) — the engine
- [`docs/decision-log.md`](../../../docs/decision-log.md) — ADR-0052, and the
  record of the five real defects its tests found
- [`docs/architecture.md`](../../../docs/architecture.md) — the engine boundary
- [`docs/project-state.md`](../../../docs/project-state.md) — what it does not close
