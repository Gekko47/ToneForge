# Semantic Review — Repository-Grounded Implementation Plan

> **Decisions recorded 2026-10-01.**
>
> - **D6 approved as written.** Model meaning-preservation flags and
>   qualifier/negation changes are **soft warnings requiring an explicit
>   acknowledgement**; only factual-token changes (numeric, percentage, currency,
>   date, duration, identifier, reference) are hard failures that disable Apply.
>   The document's literal §17 reading is not implemented.
> - **D7 approved with a condition**: eligibility and quality are two independent
>   axes, no quality level ever blocks learning, and the level is a **persistent,
>   visible notice** on the sample card rather than a transient warning.
> - **Semantic Review is a separate pipeline**, not a `Finding` variant. It does
>   not use the deterministic review gate, the review session, Pending Changes, or
>   `FindingDetail`. See the revised **D4**.
> - **D4 revised**: the merge point's protection and preservation checks key on
>   the `Change`, not the `Finding` — because as written they **fail open** when
>   `findingId` is absent.
>
> **The source specification is in flight.** See §0.1 for which decisions survive a
> revision to it and which do not. Three corrections were made to this plan during
> review and are marked **Corrected after review** at each site.

Source specification:
[`<systematic review/ToneForge_SEMANTIC_REVIEW_SYSTEMATIC_IMPLEMENTATION.md>`](<../systematic review/ToneForge_SEMANTIC_REVIEW_SYSTEMATIC_IMPLEMENTATION.md>)
(40 sections, §0–§40).

This plan was written by reading the specification in full **and** auditing the
live repository: `src/`, `tests/`, `eslint.config.mjs`, `vitest.config.ts`,
`tsconfig.json`, `manifest.json`, `package.json`, `ROADMAP.md`,
`docs/architecture.md`, `docs/decision-log.md`, `docs/project-state.md`,
`docs/ux-state-matrix.md`, and the three sibling systematic-review documents.
Every claim below is anchored to a file that exists today or is proposed here.

### 0.1 Provenance — what a spec revision invalidates, and what it does not

The SEMANTIC_REVIEW specification is being revised while this plan is being
executed. Every decision below is therefore tagged, so a revised §n can be
reconciled against a short list rather than by re-reading 1,600 lines.

**Repository-derived — unaffected by any spec revision.** These are facts about
the code and its governance, verified on this branch:

| #   | Decision                                                                                                                                                          | Anchor                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `EditorialPolicySchema` + `resolveSemantic()` must expand with the learned schema, or governance overrides for tone silently stop working                         | [`GovernanceProfile.ts:124`](../src/core/domain/GovernanceProfile.ts:124), [`ResolvedPolicy.ts:144`](../src/core/domain/ResolvedPolicy.ts:144) |
| R2  | State versioning, not a per-record `semanticSchemaVersion`, is the migration instrument — V2 defaults make a version field read too late to prevent a lossy parse | [`migration.ts:63`](../src/core/state/migration.ts:63), [`StyleProfile.ts:20`](../src/core/domain/StyleProfile.ts:20)                          |
| R3  | The merge point's protection and preservation checks read `Finding` and **fail open** when `findingId` is absent                                                  | [`revisionAdapter.ts:882`](../src/word/revisionAdapter.ts:882), [`:897`](../src/word/revisionAdapter.ts:897)                                   |
| R4  | A preservation check already exists and is regex-based, blind to party names, and false-positives on shortened dates                                              | [`revisionAdapter.ts:84`](../src/word/revisionAdapter.ts:84)                                                                                   |
| R5  | A `text` precondition is **required** on every v2 `replaceText`, so the Change-based preservation check is fail-closed by an existing enforced rule               | [`preconditions.ts:36`](../src/changes/preconditions.ts:36)                                                                                    |
| R6  | `Range.set` is WordApiDesktop 1.4, so character-unit targeting needs a documented fallback                                                                        | [`revisionAdapter.ts:680`](../src/word/revisionAdapter.ts:680)                                                                                 |
| R7  | `duplicateNavigationTargets()` fails the build on two commands claiming one target, so Semantic Style cannot be a second ribbon button                            | [`commandRegistry.ts:80`](../src/commands/commandRegistry.ts:80)                                                                               |
| R8  | `createSemanticProfileRecord()` unconditionally activates; learning must stop doing that                                                                          | [`persistence.ts:621`](../src/core/state/persistence.ts:621)                                                                                   |
| R9  | `providerMissing` is computed and never used to disable anything                                                                                                  | [`Semantic.tsx:407`](../src/taskpane/pages/Semantic.tsx:407)                                                                                   |
| R10 | Function coverage headroom is 0.48 points                                                                                                                         | measured 2026-10-01                                                                                                                            |
| R11 | `deviationEngine` has zero production callers; `bridge.toFinding` likewise                                                                                        | grep, 2026-10-01                                                                                                                               |
| R12 | `office.d.ts` is a loose subset, so a missing declaration proves nothing (ADR-0084)                                                                               | [`decision-log.md`](../docs/decision-log.md)                                                                                                   |

**Spec-derived — must be re-read if the section changes.** Everything else: the 16
dimension names and their enum members (§4), the quality bands (§8), the
`ApprovedSemanticRevision` field list (§24), the review-prompt clause list (§15),
and the UI copy in §21.

**User decisions — not the spec's to revisit.** D6 severity tiers, D7's visible
notice, and the pipeline separation. A revised §17 or §8 does not reopen them; if
the revised spec wants the literal §17 hard-block, that is a change of product
decision and needs a new decision, not a re-read.

Where the specification and the repository disagree, this plan **states the
disagreement, the evidence, and an alternative** rather than adopting the
document. Twelve such disagreements are recorded in §2. Three of them (D1, D5,
D6) are load-bearing: implementing the document literally would either breach a
governance invariant or remove a safety check that currently works.

---

## 1. Executive summary

### 1.1 What the repository already has (verified)

| Capability                                                             | File                                                                                                                              | State                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Semantic profile namespace, separate from deterministic                | [`persistence.ts`](../src/core/state/persistence.ts:55) (`semanticProfileRecords`, `activeSemanticProfileId`)                     | Exists, used                                                  |
| Shallow semantic schema, 8 fields                                      | [`StyleProfile.ts`](../src/core/domain/StyleProfile.ts:535) `SemanticProfileSchema`                                               | Exists                                                        |
| Governance editorial override of those 8 fields                        | [`GovernanceProfile.ts`](../src/core/domain/GovernanceProfile.ts:124) `EditorialPolicySchema`                                     | Exists, **the document omits it**                             |
| Semantic resolution (governance beats learned)                         | [`ResolvedPolicy.ts`](../src/core/domain/ResolvedPolicy.ts:144) `resolveSemantic()`                                               | Exists                                                        |
| Revision diffing over semantic fields                                  | [`versioning.ts`](../src/style/versioning.ts:99) `diffFields`                                                                     | Exists                                                        |
| Profile record: draft / published / audit trail                        | [`ProfileRecord.ts`](../src/core/domain/ProfileRecord.ts)                                                                         | Exists; **only rendered on the deterministic `Profile` page** |
| Sample capture (selection / document / pasted)                         | [`sampleCapture.ts`](../src/style/sampleCapture.ts)                                                                               | Exists, all three sources                                     |
| Sample quality gate (40 words / 2 sentences)                           | [`sampleQuality.ts`](../src/style/sampleQuality.ts:30)                                                                            | Exists, weak                                                  |
| Learn-style orchestration                                              | [`learnStyle.ts`](../src/style/learnStyle.ts)                                                                                     | Exists; **auto-activates the new profile**                    |
| Semantic profile prompt (8-key JSON)                                   | [`profilePrompts.ts`](../src/ai/prompts/profilePrompts.ts:19)                                                                     | Exists                                                        |
| Deviation engine                                                       | [`deviationEngine.ts`](../src/analysis/deviationEngine.ts)                                                                        | Exists; **zero production callers**                           |
| Rewrite engine                                                         | [`rewriteEngine.ts`](../src/analysis/rewriteEngine.ts)                                                                            | Exists, one caller                                            |
| Model-quoted-anchor resolution                                         | [`anchorResolution.ts`](../src/analysis/anchorResolution.ts) `resolveAnchor()`                                                    | Exists, used by both engines                                  |
| Semantic apply path, shared writer                                     | [`semanticApply.ts`](../src/reformat/semanticApply.ts)                                                                            | Exists, on the **current** path                               |
| Semantic tab (learning + picker + measured + editor + rewrite + apply) | [`Semantic.tsx`](../src/taskpane/pages/Semantic.tsx)                                                                              | Exists, 864 lines, monolithic                                 |
| Provider consent + retry + abort                                       | [`LlmProvider.ts`](../src/ai/providers/LlmProvider.ts), [`retry.ts`](../src/ai/providers/retry.ts)                                | Exists                                                        |
| `semanticOptIn` consent, strictly re-derived                           | [`migration.ts`](../src/core/state/migration.ts:697)                                                                              | Exists                                                        |
| Ribbon command + context menu + navigation bridge                      | [`commandRegistry.ts`](../src/commands/commandRegistry.ts), [`taskpaneNavigation.ts`](../src/shared/office/taskpaneNavigation.ts) | Exists                                                        |
| Sole mutation writer, Track Changes gate, post-apply readback          | [`revisionAdapter.ts`](../src/word/revisionAdapter.ts), [`orchestrator.ts`](../src/reformat/orchestrator.ts)                      | Exists                                                        |

### 1.2 What is genuinely missing

1. **A local factual-preservation validator** (§16, §17), as a _pre-write_ layer.
   **Corrected after review.** An earlier draft of this plan claimed "nothing in
   the repository compares protected tokens" — that is false.
   [`preservationLiterals()`](../src/word/revisionAdapter.ts:84) plus
   [`:895-905`](../src/word/revisionAdapter.ts:895) already refuses a change whose
   replacement drops a URL, ISO date, bare number, or `[A-Z]{2,}` run, and it runs
   on the semantic path. Against the P0 corpus it catches the date, duration,
   percentage, currency, activity-ID, event-ID and clause changes — incidentally,
   because the regex fragments them — and misses **party names entirely**, plus
   every qualifier and negation case. It also false-positives: `30 June 2025` →
   `June 2025` is refused for dropping the literal `30`. See
   [`plans/current-findings-pipeline-schematic.md`](current-findings-pipeline-schematic.md)
   for the full table. So P3 adds a **token-based, pre-write** layer the user sees
   _before_ Apply is offered; the adapter's stays as an independent **at-write**
   backstop and is not replaced.
2. **A structured review contract** returning assessment _and_ revision in one
   model response (§14.3, §15, §28). Today the provider has
   `profile/deviations/rewrite`, each a thin alias for `complete()`.
3. **An expanded semantic style schema** (§4) and its migration (§5).
4. **Learned-profile approval before activation** (§11). Today
   [`createSemanticProfileRecord()`](../src/core/state/persistence.ts:621) calls
   `setActiveSemanticProfile()` unconditionally.
5. **`.txt` import and a meaningful sample-quality ladder** (§6.2, §8).
6. **Explicit `Keep original`** (§23) and **blocked-before-click gating for every
   semantic action** (§26). The page currently derives `consentMissing` and
   `providerMissing` but only uses the first to disable buttons, and
   `providerMissing` never disables anything.
7. **A split of the semantic page** (§33) and **terminology/navigation rename**
   (§32).

### 1.3 Sequencing constraint discovered

The three sibling documents are not independent:

- [`ToneForge_LLM_SETTINGS_SYSTEMATIC_IMPLEMENTATION.md`](<../systematic review/ToneForge_LLM_SETTINGS_SYSTEMATIC_IMPLEMENTATION.md>)
  rewrites the provider/settings contract this plan calls
  [`createRegistryFromSettings()`](../src/taskpane/settings/providerComposition.ts:118).
- [`ToneForge_INDEXED_CONSISTENCY_SYSTEMATIC_IMPLEMENTATION.md`](<../systematic review/ToneForge_INDEXED_CONSISTENCY_SYSTEMATIC_IMPLEMENTATION.md>)
  §19 retires the consistency-to-`Finding` bridge, and its §28 hands work to
  "Semantic Review".
- [`ToneForge_HOME_AND_UNIFIED_FLUENT_UX_IMPLEMENTATION.md`](<../systematic review/ToneForge_HOME_AND_UNIFIED_FLUENT_UX_IMPLEMENTATION.md>)
  renames navigation and the Home page.

Required order across all four: **LLM settings → Semantic Review → Indexed
Consistency → Home/UX navigation.** Doing navigation in this plan and again in
the UX document is how two destinations drift and one silently stops being
handled (the exact defect ADR-0079 records). Navigation changes in P9 are
therefore limited to _relabelling and adding a destination_, with no IA redesign.

---

## 2. Disagreements with the specification

Each entry: what the document says, what the repository shows, what to do
instead.

### D1 — `src/analysis/semantic/` is not a new exception; the rule is already imprecise

**Document** (§3): "Create `src/analysis/semantic/`" and treat it as the isolated
semantic product domain.

**Repository**: ADR-0052 declares `src/analysis/consistency/` "the **single
sanctioned exception** to deterministic-first" and the governance rule states that
"a second one contradicts it and needs its own ADR saying so." But
[`deviationEngine.ts`](../src/analysis/deviationEngine.ts:91) and
[`rewriteEngine.ts`](../src/analysis/rewriteEngine.ts:91) are already
LLM-calling, non-deterministic modules living in `src/analysis/`, outside
`consistency/`, outside the exception. ADR-0052's wording describes the code less
accurately than the code exists.

**Decision**: create the directory, because the shape is right — but do **not**
write it up as a second exception. Write ADR-0092 to _amend_ ADR-0052: the
sanctioned set is `analysis/consistency/` plus `analysis/semantic/`, and
`analysis/`'s general ESLint scope (which already permits `ai/providers` and
forbids `taskpane`/`commands`/`word/revisionAdapter`) is what authorises both.
Add a **narrower** ESLint block for `src/analysis/semantic/**` mirroring the
consistency block — forbidding `word`, `taskpane`, `commands`, `reformat`,
`changes` — and add cases to
[`moduleBoundaries.test.ts`](../tests/unit/architecture/moduleBoundaries.test.ts)
including the bare-directory forms.

### D2 — Replacing `SemanticProfileSchema` without touching governance is a correctness regression

**Document** (§4, §5, §36) lists files to modify and does **not** include
[`GovernanceProfile.ts`](../src/core/domain/GovernanceProfile.ts),
[`ResolvedPolicy.ts`](../src/core/domain/ResolvedPolicy.ts),
[`versioning.ts`](../src/style/versioning.ts), or
[`GovernancePolicy.tsx`](../src/taskpane/pages/GovernancePolicy.tsx).

**Repository**: `EditorialPolicySchema` mirrors the same eight semantic fields and
[`resolveSemantic()`](../src/core/domain/ResolvedPolicy.ts:144) merges them into
`ResolvedPolicy.semantic` using the `explicitFields` override list. If V2 replaces
the learned shape without expanding editorial policy, a governance author who set
`editorial.tone` would silently stop governing tone — with no error, no test, and
no coverage change. [`versioning.ts`](../src/style/versioning.ts:99) would also
emit no diff line for any new dimension.

**Decision**: treat `GovernanceProfile.editorial` V2, `resolveSemantic()`,
`EDITORIAL_OVERRIDE_FIELDS`, and the `diffFields` list as **in scope**. Where a
V2 dimension has no sensible normative override (e.g. `paragraphArchitecture`),
model it as an explicit _merge rule_ rather than leaving it undefined: editorial
values win when set and differ from the schema default, exactly as today, and
dimensions with no editorial counterpart pass through from learned unchanged,
recorded in the ADR.

### D3 — `semanticSchemaVersion` is the wrong migration instrument

**Document** (§5): add `semanticSchemaVersion: number` to semantic profile records
and migrate.

**Repository**: the established mechanism is **state versioning** —
`CURRENT_STATE_VERSION = 13`, `STORAGE_KEY = "ToneForge.State.v13"`, a `switch` in
[`migrate()`](../src/core/state/migration.ts:63), and
`LEGACY_STORAGE_KEYS` purged on write. A per-record integer does not exist
anywhere in the model; `StyleProfile.revision` is explicitly documented as "not a
semantic version" ([`StyleProfile.ts`](../src/core/domain/StyleProfile.ts:20)).

Worse, every field of `SemanticProfileSchema` has a `.default()`. A V1 record
parsed by a V2 schema **silently becomes a V2 profile full of defaults** — the
learned tone is gone and nothing says so. A version _field_ read after the fact
cannot prevent that, because the lossy parse already happened.

**Decision**: ship **state v14**. `migrateV13ToV14()` rewrites
`state.semanticProfileRecords` structurally: map V1 → V2 groups, carry anything
with no exact mapping into `semantic.legacyV1` (retained, never discarded,
surfaced in the editor), and stamp a `schemaVersion: z.literal(2)` on the V2
schema so a _forward-incompatible_ blob is detectable even if it reaches the
parser by another route. Bump `CURRENT_STATE_VERSION` to 14, `STORAGE_KEY` to
`ToneForge.State.v14`, add `v13` to `LEGACY_STORAGE_KEYS`.

### D4 — The merge point must key on the `Change`, not the `Finding`, because keying on `Finding` fails open

**Revised 2026-10-01 after review. The previous version of this entry proposed a
minimal `Finding` bridge; that was wrong in method, and the reason is a defect
rather than a preference.**

**Document** (§1.2 H line 169, §3 line 286, §21 line 1194, §24 lines 1241–1268):
the _contract_ must not be a `Finding`, the _UI_ must not be a `FindingDetail`, and
`semanticApply` should take `ApprovedSemanticRevision` — but "a rewrite _may_ use a
`Finding` internally during migration". The word _bridge_ appears nowhere in the
specification, and §36's file list (lines 1698–1726) contains no `src/word/` file
at all. So the spec neither requires nor forbids this refactor; it simply never
engaged with the fact that the adapter implements two safety checks by reading
`Finding` fields.

**Repository — the merge point is correct, but it currently controls _findings_:**

- [`revisionAdapter.ts:882`](../src/word/revisionAdapter.ts:882) — protection resolves
  `finding.nodeIds` through `change.findingId`, then looks for a protected node whose
  id is in that set.
- [`revisionAdapter.ts:897`](../src/word/revisionAdapter.ts:897) — preservation is
  guarded by `if (finding?.actual && finding.expected)`.

Both are **fail-open**. A change with no `findingId`, or a finding with no
`nodeIds` or no `actual`, yields an empty target set and a skipped check — the
write proceeds and nothing is reported. That is the ADR-0051 class of defect: a
check that cannot fire. The merge point is the right place; it is keyed on the
wrong thing, and the wrong key can be absent by omission rather than by decision.

**Decision — the two checks read the `Change`:**

- **Preservation** from `change.precondition.expectedText` against
  `change.payload.text`. The data is guaranteed present, not merely hoped for:
  [`revisionAdapter.ts:845-846`](../src/word/revisionAdapter.ts:845) already runs
  `validateChangePreconditions` for every v2 plan, and that function _requires_ a
  `text` precondition on `replaceText` and `deleteRange`
  ([`preconditions.ts:36-40`](../src/changes/preconditions.ts:36)). The check becomes
  unfalsifiable-by-omission.
- **Protection** from `change.range.target.nodeId` when present, with a
  range-based fallback resolving the span against the supplied `nodes` when it is
  not. `target` is optional on `ChangeRangeSchema`, so a fallback is required rather
  than optional; a span that resolves to no node is reported as an unresolvable
  target, not passed silently.

**This discharges §24 rather than contradicting it.** "Retain `semanticApply.ts` and
the shared mutation path" is satisfied — the writer, the gates, and the single
mutation boundary are untouched; only the key the two checks read changes. It also
aligns with the Indexed Consistency document, whose §19 retires the sibling
`Finding` bridge, so building a new one would create the thing being removed.

**Behavioural proof required before this lands**: the existing
`tests/unit/word/revisionAdapter.test.ts` and `revisionAdapter.apply.test.ts` suites
must pass unchanged for the deterministic path, plus two new cases — a protected
node still refuses with no `Finding` present anywhere in the plan, and a change
whose `precondition.expectedText` drops a preserved literal still refuses with no
`Finding` present. Recorded in ADR-0092.

### D5 — `resolveAnchor()` does not become "secondary validation"; it leaves this path entirely

**Document** (§18): "During migration, keep `resolveAnchor()` as a secondary
validation/fallback."

**Repository**: [`rewriteEngine.ts`](../src/analysis/rewriteEngine.ts:133) already
refuses any rewrite whose quoted anchor is not the whole selection, and then
resolves it against acquired nodes. Under the new anchor contract the model
returns no anchor at all — the target is the locally captured selection. There is
nothing left for `resolveAnchor()` to validate, and keeping a second resolution
path means two places that can disagree about which span is the target.

**Decision**: the semantic review path uses the locally captured anchor only.
`resolveAnchor()` remains for `deviationEngine()` until that module is retired
(P4), then loses its last caller. No "secondary fallback" is added.

### D6 — The §17 qualifier list as written will disable Apply constantly

**Document** (§17): detect addition/removal of `may might could appears
approximately in my opinion on balance subject to assuming if to the extent not no
only all`, and "if the model reports any `false`, Apply is disabled."

**Repository**: semantic apply is already gated on model-derived state
(`actionable`), and the pane already refuses non-actionable proposals. A
deterministic blocker on a list containing `if`, `not`, `no`, `only`, `all` fires
on nearly every expert sentence — "if" alone appears in most conditional
findings. A hard block on a heuristic list trains the user to press Regenerate
until the check passes, which is precisely the behaviour §30 forbids elsewhere.

**Decision**: two tiers, both deterministic and both testable.

- **Hard failure** (disables Apply): numeric value, percentage, currency, date,
  duration, identifier, and reference tokens — §16.1, unchanged.
- **Soft warning** (requires an explicit extra confirmation, one checkbox in the
  comparison panel, persisted per session): high-risk qualifiers from a curated
  list (`may might could would appears approximately in my opinion on balance
subject to assuming to the extent provisionally likely unlikely arguably
apparently`) and negation/quantifier tokens (`not no only all never`).
- The model's `MeaningPreservationAssessment` stays **evidence, not a gate**: a
  `false` is a soft warning with the model's own sentence quoted, not a silent
  disable. This matches §17's own wording ("Treat this as model evidence, not
  final proof") and contradicts its next paragraph, which is the disagreement.

### D7 — Eligibility and quality are two axes; the level is a visible notice, not a gate

**APPROVED 2026-10-01, with a mandatory visible notice.** The user's condition is
part of the decision: a level is not permitted to appear as a transient warning, and
no level may block learning.

**Document** (§8): "<100 words → insufficient", and `insufficient` samples cannot
be learned from.

**Repository**: [`evaluateSampleQuality()`](../src/style/sampleQuality.ts:39)
returns `pass: boolean` and [`learnStyleDraft()`](../src/style/learnStyle.ts:69)
**throws** when `pass` is false. A 100-word floor would make
`Learn from current document` inert for short documents and short selections,
which ADR-0081 and ADR-0068 were both written to prevent. It would also invert
the `Create empty profile` fallback: the picker exists precisely so a user with
no usable sample can still get a profile.

**Decision — two independent axes, and the band the document leaves ambiguous is
now defined:**

| Axis              | Question it answers                | Value                                                                  | Blocks learning?                  |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| **Eligibility**   | Is this input mechanically usable? | `minWords: 40`, `minSentences: 2` — unchanged                          | yes, and only this axis ever does |
| **Quality level** | How much can be learned from it?   | `insufficient` <100, `limited` 100–299, `good` 300–999, `strong` 1000+ | **never**                         |

A 40–99 word sample is therefore **eligible and `insufficient`**. The label
describes confidence in the learned profile; it is not a permission. This band was
previously undefined in the plan and is now stated explicitly, because "eligible
but labelled insufficient" reads as a contradiction unless the two axes are named.

`SampleQuality` becomes additive —
`{ eligible, level, reasons, warnings, wordCount, sentenceCount, paragraphCount,
repetitionRatio }`. `pass` is retained as a deprecated alias of `eligible` for one
cycle so [`learnStyleDraft()`](../src/style/learnStyle.ts:69)'s throw path and its
callers do not change shape mid-migration.

**The visible notice, as approved.** The level is rendered as a persistent badge on
the sample card — not a toast, not a log line — carrying the word count, the level,
and the consequence in one sentence, e.g. "120 words — limited. ToneForge can learn
a rough voice from this, but not reliably. Learn anyway?" `insufficient` and
`limited` require an explicit acknowledgement before the model is called; `good`
and `strong` proceed without one. The badge stays on screen after the acknowledgement
so the user can see what they agreed to.

**Bands are exported constants** (`SAMPLE_QUALITY_BANDS`) so the badge, the gate, and
the tests cannot quote different numbers — the same discipline
`CONSISTENCY_DEFAULT_MAX_STATEMENTS` follows. The doc's caution still holds: these
are configurable product thresholds, not scientific claims.

### D8 — `.txt` import belongs in a pure module with DOM access in the component

**Document** (§6.2): "Implement client-side `.txt` import."

**Repository**: `src/style/` is documented as a deterministic module in
[`architecture.md`](../docs/architecture.md:53) (`style/metrics`), and
`sampleCapture.ts` states its own boundary rule: "must NOT import from `word/`,
`ai/`, `ui/`, or `Office`". `File`/`FileReader` are not currently in the ESLint
globals list in [`eslint.config.mjs`](../eslint.config.mjs:18).

**Decision**: add a pure validator
`src/style/textFileImport.ts` exporting
`validateTextFile({ name, size, type })` and `MAX_TEXT_FILE_BYTES`, plus
`captureFromFileText(text, filename)` delegating to `captureFromText` with
`source: "text_file"`. The component owns the `FileReader`/`file.text()` call.
Add `File` to the ESLint globals. No new directory, no Office dependency, unit
testable with plain objects.

### D9 — Deleting the measured block contradicts ADR-0076 and a live test

**Document** (§13): remove punctuation-derived metrics from the Semantic page;
show sample diagnostics instead.

**Repository**: ADR-0076 ("The semantic tab owns the semantic profile and its
measured context") was Accepted on this exact question, and
[`Semantic.test.tsx`](../tests/unit/taskpane/pages/Semantic.test.tsx:198) pins
all eight metrics including the four that exist only there. Deleting them
reopens a decided ADR and deletes a regression test.

**Decision**: keep all eight metrics, relabel the section **"Sample diagnostics"**,
add the disclaimer the document itself asks for ("these do not control Semantic
Review"), and move it into a collapsed disclosure defaulting to closed. Amend
ADR-0076 with an amendment entry rather than superseding it. Update the test's
expectation from heading `"Measured style"` to `"Sample diagnostics"` and keep the
eight-label assertion.

### D10 — One ribbon command, two pane destinations

**Document** (§32): rename the route/button to "Semantic Review"; Semantic Style
management becomes a secondary route.

**Repository**: [`duplicateNavigationTargets()`](../src/commands/commandRegistry.ts:80)
**fails the build** if two commands claim one navigation target. Adding a
"Semantic Style" ribbon button alongside "Semantic Review" without a distinct
target breaks it. ADR-0082 additionally requires ribbon-wide id uniqueness, and
ADR-0070/0073 require both manifests to be edited together or Word shows nothing.

**Decision**: one command, `ToneForgeSemantic`, relabelled **"Semantic Review"**,
with `navigationTarget: "semantic-review"`. A second pane destination
`"semantic-style"` is added to [`TaskPaneDestination`](../src/taskpane/components/TaskPaneHeader.tsx:4)
and reachable from the Semantic Review page as a secondary control and from the
navigation drawer — **not** as a second ribbon button. No new ribbon control id, so
ADR-0082 is untouched.

### D11 — Selection awareness is an open question, not a declared limitation

**Revised 2026-10-01 after review. The previous version asserted live selection
awareness was unavailable. That claim rested on our own type declarations, which
is not evidence.**

**Document** (§19): "Add local selection-state tracking **where Word APIs support
it**", reacting to selection changes. The spec itself conditions on host support,
so it does not require an event.

**Repository — what we actually know**: the typed Office surface in
[`office.d.ts`](../src/types/office.d.ts) declares no selection-changed event, and
[`wordParagraphEvents.ts`](../src/word/wordParagraphEvents.ts) registers only
`onParagraphAdded/Changed/Deleted`. But that file is **explicitly a loose subset** —
ADR-0084 records that it is not an authority, and ADR-0084's own lesson is that a
property name missing from our declarations costs us nothing and proves nothing.
**Absence of a declaration is not absence of an API.**

**Decision — treat it as a question with a named procedure, not a fixed limit:**

1. Check the published `WordApi` and `WordApiDesktop` requirement sets for a
   selection-changed event on `Document` or `Context`.
2. Probe for it at runtime the way `capabilityProbe` probes the rest of the host,
   and add a `supportsSelectionEvents` capability so the answer is measured rather
   than assumed — the same discipline `supportsContextMenuApi` follows, including
   its insistence that the probe reports only what it can actually establish.
3. Verify in a real Word host per [`manual-verification.md`](../docs/manual-verification.md).

Until that is done, ADR-0092 records the question as **open** and the shipped
behaviour as the explicit-read design below. It does not record a host limitation,
because we have not established one. No poller either way: a `setInterval` would be
a second thing to keep running and to stop, which is the reasoning ADR-0079 already
applied to navigation.

**Fallback shipped now**: the explicit `Use current selection` read, plus a local
`selectionHash` (`hashText` of the captured text) so a re-read can say "the selection
has changed since the last review" before overwriting. If the probe later finds the
event, the subscription is additive and the explicit read remains.

**The apply-time fallback the review asked for, now specified** — this is a separate
host concern and is answerable from the code today.
[`getRangeByChange()`](../src/word/revisionAdapter.ts:644) resolves
`unit: "paragraph"` through `Paragraph.getRange("Whole")`, but `unit: "character"`
through `body.getRange("Whole").set({ start, end })`, and `Range.set` is
**WordApiDesktop 1.4 — absent on Word on the web** (the same reason `PageSetup` is
optional in `office.d.ts`). So semantic apply resolves its target in this order:

1. **Preferred** — the selection is exactly one whole paragraph: build a
   `paragraph`-unit change with `range.target = { kind: "paragraph", index, nodeId }`.
   No `Range.set` required.
2. **Fallback** — the selection is a partial range and the host exposes `Range.set`:
   `character`-unit change, as today.
3. **Refusal** — a partial range on a host without `Range.set`: refuse with a
   stated reason naming the cause and the remedy ("this Word does not support
   ranged text replacement; select a whole paragraph"). Never a discovered
   host exception at apply time.

### D12 — A second `Finding`-shaped path is not needed for the assessment view

**Document** (§21): "Do not show the result as a generic `FindingDetail`."

**Repository**: agreed, and the fix is narrow: the semantic page currently renders
[`FindingDetail`](../src/taskpane/components/FindingDetail.tsx) for the proposal
card. The D4 bridge is an _apply-path_ concern and lives in `reformat/`, entirely
below the UI.

**Decision**: no new finding-shaped UI contract. `SemanticAssessmentView` renders
`SemanticAssessment` directly. The bridge in D4 is internal to
`semanticApply.ts` and is never rendered.

---

## 3. Requirement-by-requirement disposition

Every section of the specification, with its verified state and where the work
lands. `EXISTS` = already correct; `PARTIAL` = present but wrong or incomplete;
`NEW` = does not exist; `DISAGREE` = see §2.

| §     | Requirement                                                                                                                                                                     | State                                        | Where                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Mandate: review-first, not rewrite-first; separate from Deterministic Review and C1–C10                                                                                         | NEW                                          | P7                                                                                                                                                                       |
| 0     | Do not merge with Consistency Review                                                                                                                                            | EXISTS                                       | `analysis/consistency/` untouched; §1 boundary test extended                                                                                                             |
| 1.1   | Retain existing foundations                                                                                                                                                     | —                                            | No deletions except `deviationEngine` (P4, with its own tests retired)                                                                                                   |
| 1.2 A | Rewrite-first UX is the defect                                                                                                                                                  | EXISTS (defect confirmed)                    | [`Semantic.tsx`](../src/taskpane/pages/Semantic.tsx:438) `proposeRewrite()`                                                                                              |
| 1.2 B | Learning input forms: paste / `.txt` / selection                                                                                                                                | PARTIAL                                      | paste EXISTS ([`Semantic.tsx:369`](../src/taskpane/pages/Semantic.tsx:369)); `.txt` NEW; selection EXISTS ([`Semantic.tsx:417`](../src/taskpane/pages/Semantic.tsx:417)) |
| 1.2 C | Semantic schema too shallow                                                                                                                                                     | EXISTS (confirmed)                           | [`StyleProfile.ts:535`](../src/core/domain/StyleProfile.ts:535)                                                                                                          |
| 1.2 D | Deterministic metrics blurred into semantic                                                                                                                                     | EXISTS (defect confirmed)                    | [`Semantic.tsx:643`](../src/taskpane/pages/Semantic.tsx:643); resolved per **D9**                                                                                        |
| 1.2 E | Rewrite safety relies on model confidence                                                                                                                                       | EXISTS (confirmed)                           | [`REWRITE_ACTIONABLE_CONFIDENCE`](../src/analysis/rewriteEngine.ts:55)                                                                                                   |
| 1.2 F | Provider gating incomplete in UI                                                                                                                                                | EXISTS (confirmed)                           | `providerMissing` computed at [`Semantic.tsx:407`](../src/taskpane/pages/Semantic.tsx:407), never used to disable                                                        |
| 1.2 G | Selection is manually refreshed                                                                                                                                                 | PARTIAL / **D11**                            | new `word/selectionScope.ts` (P5)                                                                                                                                        |
| 1.2 H | Results should not be ordinary `Finding`s                                                                                                                                       | PARTIAL / **D4, D12**                        | `reformat/semanticApply.ts` bridge; new UI contract                                                                                                                      |
| 2     | Target architecture                                                                                                                                                             | —                                            | Diagram reproduced in §4 below, corrected                                                                                                                                |
| 3     | Isolate `src/analysis/semantic/`                                                                                                                                                | NEW / **D1**                                 | P1–P4                                                                                                                                                                    |
| 3     | `SemanticReviewRequest` / `SemanticReviewResult`                                                                                                                                | NEW                                          | `src/analysis/semantic/contracts.ts` (P4)                                                                                                                                |
| 4.1   | Semantic profile excludes fonts/punctuation/formatting                                                                                                                          | EXISTS by construction                       | `DeterministicStyleProfileSchema` omits `semantic` already ([`StyleProfile.ts:586`](../src/core/domain/StyleProfile.ts:586))                                             |
| 4.2   | Replace shallow schema with 16 grouped dimensions                                                                                                                               | NEW                                          | P1; plus **D2** governance expansion                                                                                                                                     |
| 4.3   | Required dimensions, tone/voice/formality/register/assertion/qualification/evidence/uncertainty/sentence/paragraph/transition/agency/technicality/rhetorical/conclusion/lexical | NEW                                          | P1                                                                                                                                                                       |
| 5     | Schema versioning + non-lossy migration                                                                                                                                         | NEW, mechanism changed / **D3**              | P1                                                                                                                                                                       |
| 6.1   | Pasted-text learning UI                                                                                                                                                         | EXISTS                                       | keep; moves to `SemanticStyle.tsx` (P7)                                                                                                                                  |
| 6.2   | `.txt` import, size limit, local read, reject binary                                                                                                                            | NEW / **D8**                                 | P8                                                                                                                                                                       |
| 6.3   | Word selection input                                                                                                                                                            | EXISTS                                       | keep                                                                                                                                                                     |
| 6.4   | Optional whole-document input, not primary                                                                                                                                      | EXISTS                                       | re-label and de-emphasise (P8)                                                                                                                                           |
| 7     | `SemanticSampleSource` = pasted_text / text_file / word_selection / word_document                                                                                               | PARTIAL                                      | enum currently `selection \| document \| pasted`; in-memory type, **no state migration needed**; `SemanticSampleEvidence` persistence is NEW (P1)                        |
| 7     | Persist metadata only, never raw sample text                                                                                                                                    | EXISTS (by omission) — must be made explicit | P1 adds `semanticSampleEvidence` with no text field                                                                                                                      |
| 8     | Quality levels insufficient/limited/good/strong                                                                                                                                 | NEW, hard floor rejected / **D7**            | P8                                                                                                                                                                       |
| 9     | Learning prompt contract, strict JSON, no factual claims as style                                                                                                               | NEW                                          | [`src/ai/prompts/profilePrompts.ts`](../src/ai/prompts/profilePrompts.ts) V2 builder (P2)                                                                                |
| 10    | Learning privacy disclosure before send                                                                                                                                         | NEW                                          | `LearnSemanticStyle` component (P8)                                                                                                                                      |
| 11    | Do not auto-activate a learned profile                                                                                                                                          | NEW                                          | `createSemanticProfileRecord` gains `{ activate }` (P8)                                                                                                                  |
| 12    | Grouped semantic editor sections                                                                                                                                                | NEW                                          | `SemanticStyleEditor` (P8)                                                                                                                                               |
| 13    | Remove deterministic metrics from semantic ownership                                                                                                                            | **DISAGREE (D9)**                            | relabel + collapse, do not delete                                                                                                                                        |
| 14.1  | Primary button "Review selection"                                                                                                                                               | NEW                                          | P7                                                                                                                                                                       |
| 14.2  | Send profile + selection only                                                                                                                                                   | EXISTS in spirit                             | P4 engine sends nothing else; asserted by test                                                                                                                           |
| 14.3  | Structured response contract                                                                                                                                                    | NEW                                          | `reviewSchema.ts` (P4)                                                                                                                                                   |
| 15    | Review prompt, 9 requirements + construction-expert clause                                                                                                                      | NEW                                          | `reviewPrompt.ts` (P4)                                                                                                                                                   |
| 16    | Local preservation validator, token classes                                                                                                                                     | **NEW — highest value**                      | P3                                                                                                                                                                       |
| 16.1  | Hard failures disable Apply                                                                                                                                                     | NEW                                          | P3 → P6                                                                                                                                                                  |
| 16.2  | Soft warnings, extra confirmation                                                                                                                                               | NEW                                          | P3 → P7                                                                                                                                                                  |
| 17    | Qualification-preservation check                                                                                                                                                | NEW, gating changed / **D6**                 | P3 (deterministic tiers) + P4 (model evidence)                                                                                                                           |
| 18    | Selection anchor captured locally, model returns no anchor                                                                                                                      | NEW                                          | `word/selectionScope.ts` (P5); **D5**                                                                                                                                    |
| 19    | Selection awareness                                                                                                                                                             | PARTIAL / **D11**                            | P5 + P7                                                                                                                                                                  |
| 20    | Review-session contract with states                                                                                                                                             | NEW                                          | `src/analysis/semantic/session.ts` in-memory; outcome log persisted in v14 (P1)                                                                                          |
| 21    | Semantic Review UI (assessment + comparison + preservation)                                                                                                                     | NEW                                          | P7                                                                                                                                                                       |
| 22    | Regeneration semantics                                                                                                                                                          | EXISTS                                       | [`regenerateReview()`](../src/taskpane/pages/Semantic.tsx:467); moves to P7 unchanged                                                                                    |
| 23    | Keep original                                                                                                                                                                   | NEW                                          | P7 + persisted outcome (P1)                                                                                                                                              |
| 24    | Apply via `ApprovedSemanticRevision`                                                                                                                                            | PARTIAL / **D4**                             | P6                                                                                                                                                                       |
| 25    | Post-apply verification                                                                                                                                                         | EXISTS via shared path                       | [`verifyPlanReadback()`](../src/reformat/orchestrator.ts:755); P7 adds durable messaging                                                                                 |
| 26    | Provider/consent/profile/selection gates disable before click                                                                                                                   | PARTIAL                                      | P7; new pure `taskpane/semantic/gates.ts`                                                                                                                                |
| 27.1  | Learning sends only the sample; no raw persistence                                                                                                                              | EXISTS + NEW                                 | P1, P8                                                                                                                                                                   |
| 27.2  | Review sends profile + selection only                                                                                                                                           | EXISTS in spirit                             | P4 test                                                                                                                                                                  |
| 27.3  | No continuous review; local dirty tracking only                                                                                                                                 | EXISTS                                       | `wordParagraphEvents` is local; P13 seam is interface-only, and **is not recommended** (see §14)                                                                         |
| 28    | Provider contract `profile()` + `review()`                                                                                                                                      | NEW                                          | `LlmSemanticProvider` + `withSemanticHelpers` (P4)                                                                                                                       |
| 29    | One request, not deviations-then-rewrite                                                                                                                                        | NEW                                          | P4; the current page makes **one** call, so this is a simplification, not a fix                                                                                          |
| 30    | No pseudo-probability confidence                                                                                                                                                | NEW                                          | P4/P7; `Finding.confidence` stays internal, never rendered for semantic                                                                                                  |
| 31    | Profile history, revision invalidation                                                                                                                                          | PARTIAL                                      | `ProfileRecordSection` is not rendered for semantic records today; wire it in `SemanticStyle.tsx` (P8)                                                                   |
| 32    | Rename to "Semantic Review"                                                                                                                                                     | NEW / **D10**                                | P9                                                                                                                                                                       |
| 33    | Split `Semantic.tsx`                                                                                                                                                            | NEW                                          | P7                                                                                                                                                                       |
| 34    | Error handling with remedies                                                                                                                                                    | PARTIAL                                      | new `troubleshooting` checks (P10)                                                                                                                                       |
| 35    | Sequence S0–S13                                                                                                                                                                 | RESTRUCTURED                                 | §7 below (P0–P12)                                                                                                                                                        |
| 36    | Files to modify                                                                                                                                                                 | INCOMPLETE                                   | corrected list in §5                                                                                                                                                     |
| 37    | Construction-domain test corpus                                                                                                                                                 | NEW                                          | [`tests/fixtures/expertProse.ts`](../tests/fixtures/expertProse.ts) (P0)                                                                                                 |
| 38    | Required tests                                                                                                                                                                  | —                                            | §9 below                                                                                                                                                                 |
| 39    | 30 verification gates                                                                                                                                                           | —                                            | §10, with corrections to gates 13, 18, 26, 30                                                                                                                            |
| 40    | Definition of done                                                                                                                                                              | —                                            | §10                                                                                                                                                                      |

---

## 4. Target architecture (corrected)

```text
STYLE LEARNING                              SEMANTIC REVIEW
──────────────                              ───────────────
paste / .txt / Word selection               Word selection
  -> textFileImport / captureFromText         -> word/selectionScope.readSelectionScope()
  -> sampleQuality (level + warnings)            (text, absolute start/end, paragraph ids,
  -> LearnSemanticStyle disclosure                  documentId, contentHash)
     [semanticOptIn + provider gates]         -> taskpane/semantic/gates.ts
  -> ai/prompts/profilePrompts.buildProfilePromptV2   -> review()  [ONE call]
  -> SemanticStyleProfileSchema.parse          -> ai/prompts -> reviewSchema.parse
  -> DRAFT profile (not activated)             -> semanticReviewEngine
  -> SemanticStyleSummary review/edit             assessment + proposedRevision
  -> Save / Save and set active                -> preservationValidator (local, always)
     [updateDraft -> revision audit]           -> SemanticReviewSession (in-memory)
  -> sampleHash + counts -> state v14          -> Keep original | Regenerate | Apply
     (no raw text)                             -> semanticApply.toApplyFinding()  [D4]
                                                  -> buildSemanticRewriteChange
                                                  -> applyReviewedPlan
                                                  -> revisionAdapter (sole writer)
                                                  -> verifyPlanReadback
```

Invariant: **no LLM call occurs anywhere in the left column or the right column
outside an explicit user click.** No background processing, no polling, no
observer-triggered call. `wordParagraphEvents` stays local.

---

## 5. File-by-file change set

### 5.1 New production files

| File                                                             | Purpose                                                                                                                                                                | Phase |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/core/domain/SemanticStyleProfile.ts`                        | V2 persisted schema: **16** grouped dimensions, `schemaVersion: 2`, `legacyV1` carrier                                                                                 | P1    |
| `src/core/domain/SemanticReviewSession.ts`                       | Session + minimised outcome-log Zod schemas (internal, no UI)                                                                                                          | P1    |
| `src/analysis/semantic/semanticStyleExtraction.ts`               | `SemanticStyleExtractionSchema` — strict, no defaults; what the model must satisfy                                                                                     | P2    |
| `src/analysis/semantic/contracts.ts`                             | `SemanticReviewRequest`, `SemanticReviewResult`, `SemanticAssessment`, `SemanticObservation`, `SemanticDimension`, `SemanticReviewSession`, `SemanticProviderMetadata` | P4    |
| `src/analysis/semantic/reviewPrompt.ts`                          | `buildSemanticReviewPrompt()` with the `includeRawText: true` gate                                                                                                     | P4    |
| `src/analysis/semantic/reviewSchema.ts`                          | `SemanticReviewModelResponseSchema`, `MeaningPreservationAssessmentSchema`                                                                                             | P4    |
| `src/analysis/semantic/semanticReviewEngine.ts`                  | `reviewSemanticSelection()` — one call, Zod parse, no `Finding`                                                                                                        | P4    |
| `src/analysis/semantic/protectedFacts.ts`                        | Pure token extraction: numbers, percentages, currency, dates, durations, clause refs, identifiers, quoted refs, capitalised multi-token names                          | P3    |
| `src/analysis/semantic/preservationValidator.ts`                 | `validatePreservation(original, proposed)` → `PreservationReport`                                                                                                      | P3    |
| `src/analysis/semantic/qualifiers.ts`                            | Curated qualifier + negation/quantifier token lists, tiered                                                                                                            | P3    |
| `src/analysis/semantic/session.ts`                               | Pure session transitions and invalidation rules                                                                                                                        | P4    |
| `src/analysis/semantic/index.ts`                                 | Barrel, mirroring `analysis/consistency/index.ts`                                                                                                                      | P4    |
| `src/word/selectionScope.ts`                                     | `readSelectionScope()`: text, absolute offsets, paragraph uniqueLocalIds, documentId, contentHash — via `runInWord` only                                               | P5    |
| `src/style/textFileImport.ts`                                    | `validateTextFile()`, `MAX_TEXT_FILE_BYTES`, `captureFromFileText()`                                                                                                   | P8    |
| `src/taskpane/semantic/gates.ts`                                 | Pure gate computation: consent, provider, model, profile, selection → `{ allowed, blocker, remedy }`                                                                   | P7    |
| `src/taskpane/pages/SemanticReview.tsx`                          | Review surface                                                                                                                                                         | P7    |
| `src/taskpane/pages/SemanticStyle.tsx`                           | Style management surface                                                                                                                                               | P7    |
| `src/taskpane/components/semantic/SemanticReviewScope.tsx`       | Selection scope, word count, Review button                                                                                                                             | P7    |
| `src/taskpane/components/semantic/SemanticAssessmentView.tsx`    | Dimension-by-dimension alignment                                                                                                                                       | P7    |
| `src/taskpane/components/semantic/SemanticRewriteComparison.tsx` | Original / proposed side by side                                                                                                                                       | P7    |
| `src/taskpane/components/semantic/PreservationSummary.tsx`       | Pass/fail plus the soft-warning confirmation                                                                                                                           | P7    |
| `src/taskpane/components/semantic/LearnSemanticStyle.tsx`        | Paste / file / selection inputs, quality level, disclosure                                                                                                             | P8    |
| `src/taskpane/components/semantic/SemanticStyleSummary.tsx`      | Draft-profile review before save/activate                                                                                                                              | P8    |
| `src/taskpane/components/semantic/SemanticStyleEditor.tsx`       | Grouped editor sections                                                                                                                                                | P8    |

### 5.2 Modified production files

| File                                                                                                                          | Change                                                                                                                                                                                                            | Phase       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| [`src/core/domain/StyleProfile.ts`](../src/core/domain/StyleProfile.ts)                                                       | `StyleProfileSchema.semantic` re-typed to V2; `createEmptyProfile` unchanged; re-export V2 types                                                                                                                  | P1          |
| [`src/core/domain/GovernanceProfile.ts`](../src/core/domain/GovernanceProfile.ts)                                             | `EditorialPolicySchema` V2 + `EDITORIAL_OVERRIDE_FIELDS` + `markEditorialField`                                                                                                                                   | P1 (**D2**) |
| [`src/core/domain/ResolvedPolicy.ts`](../src/core/domain/ResolvedPolicy.ts)                                                   | `resolveSemantic()` V2 merge                                                                                                                                                                                      | P1 (**D2**) |
| [`src/core/domain/index.ts`](../src/core/domain/index.ts)                                                                     | Export the two new domain modules                                                                                                                                                                                 | P1          |
| [`src/core/state/persistence.ts`](../src/core/state/persistence.ts)                                                           | `version` default 14; `STORAGE_KEY` v14; `LEGACY_STORAGE_KEYS` += v13; `semanticSampleEvidence`, `semanticReviewOutcomes`; `createSemanticProfileRecord(..., { activate })`; `setActiveSemanticProfile` unchanged | P1          |
| [`src/core/state/migration.ts`](../src/core/state/migration.ts)                                                               | `CURRENT_STATE_VERSION = 14`; `migrateV13ToV14()`; `case 13:`; `normalizeSemanticRecords`, `normalizeSampleEvidence`, `normalizeReviewOutcomes`                                                                   | P1          |
| [`src/style/versioning.ts`](../src/style/versioning.ts)                                                                       | `diffFields` gains V2 groups                                                                                                                                                                                      | P1 (**D2**) |
| [`src/style/sampleCapture.ts`](../src/style/sampleCapture.ts)                                                                 | `source` union → `pasted_text \| text_file \| word_selection \| word_document`; `sampleHash` via `hashText`                                                                                                       | P1, P8      |
| [`src/style/sampleQuality.ts`](../src/style/sampleQuality.ts)                                                                 | Levels and warnings, additive                                                                                                                                                                                     | P8 (**D7**) |
| [`src/style/learnStyle.ts`](../src/style/learnStyle.ts)                                                                       | Returns draft without activating; evidence carries hash and level                                                                                                                                                 | P8          |
| [`src/ai/prompts/profilePrompts.ts`](../src/ai/prompts/profilePrompts.ts)                                                     | `buildProfilePromptV2()` + `SemanticStyleProfileResponseSchema`; V1 kept until P4                                                                                                                                 | P2          |
| [`src/ai/prompts/index.ts`](../src/ai/prompts/index.ts)                                                                       | Export V2                                                                                                                                                                                                         | P2          |
| [`src/ai/providers/LlmProvider.ts`](../src/ai/providers/LlmProvider.ts)                                                       | `LlmSemanticProvider.review()`; `withSemanticHelpers` wires it                                                                                                                                                    | P4          |
| [`src/analysis/index.ts`](../src/analysis/index.ts)                                                                           | Remove `detectSemanticDeviations` export; export the semantic barrel                                                                                                                                              | P4          |
| [`src/reformat/semanticApply.ts`](../src/reformat/semanticApply.ts)                                                           | `ApprovedSemanticRevision` input; `toApplyFinding()` bridge; preservation re-verified at apply time                                                                                                               | P6          |
| [`src/reformat/index.ts`](../src/reformat/index.ts)                                                                           | Export the new apply entry point                                                                                                                                                                                  | P6          |
| [`src/shared/office/taskpaneNavigation.ts`](../src/shared/office/taskpaneNavigation.ts)                                       | Targets `semantic-review`, `semantic-style`; action `read-selection` retained                                                                                                                                     | P9          |
| [`src/commands/commandRegistry.ts`](../src/commands/commandRegistry.ts)                                                       | `navigationTarget` enum extended; handler `openSemanticReview`                                                                                                                                                    | P9          |
| [`src/commands/commandHandlers.ts`](../src/commands/commandHandlers.ts)                                                       | `openSemanticStyle` → `openSemanticReview`; global `ToneForgeSemantic` alias retained for the XML manifest                                                                                                        | P9          |
| [`src/commands/commandDefinitions.json`](../src/commands/commandDefinitions.json)                                             | Label `Semantic Review`                                                                                                                                                                                           | P9          |
| [`src/commands/ribbonState.ts`](../src/commands/ribbonState.ts)                                                               | `semanticButtonEnabled` now requires a _usable_ semantic profile **and** re-reads on activation changes                                                                                                           | P9          |
| [`src/taskpane/components/TaskPaneHeader.tsx`](../src/taskpane/components/TaskPaneHeader.tsx)                                 | Destinations `semantic-review`, `semantic-style`                                                                                                                                                                  | P9          |
| [`src/taskpane/pages/Dashboard.tsx`](../src/taskpane/pages/Dashboard.tsx)                                                     | Route both destinations in both branches; own the semantic session above the page so a navigation does not discard a paid-for review                                                                              | P9          |
| [`src/taskpane/setupStatus.ts`](../src/taskpane/setupStatus.ts)                                                               | `semanticReview` capability split from `semanticRewrite`; `SetupDestination` gains `semantic-style`                                                                                                               | P10         |
| [`src/taskpane/troubleshooting/checks.ts`](../src/taskpane/troubleshooting/checks.ts)                                         | New checks: `semantic-review-no-selection`, `semantic-preservation-failed`, `semantic-profile-changed-since-proposal`; remedy labels updated; **pinned by test**                                                  | P10         |
| [`src/taskpane/pages/Home.tsx`](../src/taskpane/pages/Home.tsx)                                                               | Terminology and destination copy                                                                                                                                                                                  | P10         |
| [`src/taskpane/components/ProviderPrivacySettingsSection.tsx`](../src/taskpane/components/ProviderPrivacySettingsSection.tsx) | Consent copy names Semantic Review and Semantic Style learning separately                                                                                                                                         | P10         |
| [`src/taskpane/taskpane.css`](../src/taskpane/taskpane.css)                                                                   | Tokens for the assessment list and preservation chips — **no colour literals** (ADR-0077)                                                                                                                         | P7          |
| [`src/types/office.d.ts`](../src/types/office.d.ts)                                                                           | `Selection.paragraphs`, `Paragraph.uniqueLocalId` if absent                                                                                                                                                       | P5          |
| [`eslint.config.mjs`](../eslint.config.mjs)                                                                                   | Narrower `src/analysis/semantic/**` block; add `File` global                                                                                                                                                      | P1, P4      |

### 5.3 Deleted

| File                                                                                                                      | When   | Note                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/taskpane/pages/Semantic.tsx`                                                                                         | P7     | Replaced by `SemanticReview.tsx` + `SemanticStyle.tsx`. Its exported `deriveSemanticAnnouncement` moves to `src/taskpane/state/semanticAnnouncement.ts` with its tests |
| `src/analysis/deviationEngine.ts`                                                                                         | P4     | Zero production callers once the Semantic Review page is migrated. Its tests and the `semantic` parameter of `unifyFindings()` go with it — see §14, item 3            |
| `src/analysis/rewriteEngine.ts`                                                                                           | P6     | Superseded by `semanticReviewEngine`                                                                                                                                   |
| `src/ai/prompts/rewritePrompts.ts`                                                                                        | P6     | Replaced by `reviewPrompt.ts` + `reviewSchema.ts`                                                                                                                      |
| `buildDeviationPrompt`, `DeviationResponseSchema`, `REWRITE_CONSENT_ERROR`, `buildRewritePrompt`, `RewriteResponseSchema` | P4, P6 | With the above                                                                                                                                                         |

`src/analysis/anchorResolution.ts` and `resolveAnchor()` survive P4–P5 and are
deleted with the deviation engine's tests in a **separate** commit, so each
deletion is independently revertible.

---

## 6. Contracts (proposed TypeScript)

```ts
// src/core/domain/SemanticStyleProfile.ts
export const SEMANTIC_STYLE_SCHEMA_VERSION = 2;

export const ToneTraitSchema = z.enum([
  "restrained",
  "neutral",
  "assertive",
  "cautious",
  "analytical",
  "forensic",
  "explanatory",
  "persuasive",
]);

export const ToneProfileSchema = z.object({
  primary: ToneTraitSchema.default("neutral"),
  secondary: z.array(ToneTraitSchema).max(2).default([]),
  description: z.string().trim().max(240).default(""),
});

export const VoiceProfileSchema = z.object({
  person: z.enum(["first", "third", "mixed", "impersonal"]).default("impersonal"),
  construction: z.enum(["active", "passive", "balanced"]).default("balanced"),
  authorialPresence: z.enum(["absent", "restrained", "explicit"]).default("restrained"),
  description: z.string().trim().max(240).default(""),
});

export const FormalityProfileSchema = z.object({
  score: z.number().int().min(0).max(100).default(50),
  label: z.string().trim().max(40).default(""),
});

export const RegisterProfileSchema = z.object({
  primary: z
    .enum(["plain", "professional", "technical", "expert", "academic", "legal-technical"])
    .default("professional"),
  description: z.string().trim().max(240).default(""),
});

export const AssertionStyleProfileSchema = z.object({
  strength: z.enum(["categorical", "qualified", "conditional", "provisional"]).default("qualified"),
  ordering: z.enum(["evidence-first", "conclusion-first", "interleaved"]).default("evidence-first"),
  directness: z.enum(["direct", "measured", "indirect"]).default("measured"),
});

export const QualificationProfileSchema = z.object({
  frequency: z.enum(["rare", "occasional", "frequent"]).default("occasional"),
  strength: z.enum(["light", "moderate", "heavy"]).default("moderate"),
  exceptions: z.enum(["none", "inline", "dedicated"]).default("inline"),
  conditionals: z.boolean().default(true),
});

export const EvidenceFramingProfileSchema = z.object({
  recordFirst: z.boolean().default(true),
  attribution: z.enum(["none", "occasional", "systematic"]).default("occasional"),
  quotation: z.enum(["rare", "selective", "frequent"]).default("selective"),
  explicitReferences: z.boolean().default(false),
  progression: z
    .enum(["source-analysis-conclusion", "claim-evidence", "narrative"])
    .default("source-analysis-conclusion"),
});

export const UncertaintyProfileSchema = z.object({
  incompleteEvidence: z.enum(["stated", "implied", "suppressed"]).default("stated"),
  confidenceLanguage: z.enum(["explicit", "implicit", "absent"]).default("explicit"),
  modality: z.enum(["frequent", "occasional", "rare"]).default("occasional"),
  avoidsUnsupportedCertainty: z.boolean().default(true),
});

export const SentenceArchitectureProfileSchema = z.object({
  complexity: z.enum(["simple", "moderate", "complex"]).default("moderate"),
  clauseDensity: z.enum(["low", "medium", "high"]).default("medium"),
  targetWords: z.number().int().min(5).max(60).default(22),
  coordination: z.enum(["coordination", "subordination", "mixed"]).default("mixed"),
  shortClosingSentence: z.boolean().default(false),
});

export const ParagraphArchitectureProfileSchema = z.object({
  function: z.enum(["topic", "evidence", "analysis", "conclusion", "mixed"]).default("mixed"),
  ordering: z
    .enum(["topic-evidence-conclusion", "conclusion-evidence", "chronological", "comparative"])
    .default("topic-evidence-conclusion"),
  targetWords: z.number().int().min(20).max(400).default(90),
  propositions: z.enum(["single", "multiple"]).default("single"),
});

export const TransitionProfileSchema = z
  .enum(["restrained", "explicit", "rhetorical"])
  .default("restrained");
export const AgencyProfileSchema = z.object({
  actorNaming: z.enum(["named", "role", "impersonal", "mixed"]).default("named"),
  passiveTendency: z.enum(["low", "medium", "high"]).default("low"),
  attributionPrecision: z.enum(["exact", "general", "unspecified"]).default("exact"),
});
export const TechnicalityProfileSchema = z.object({
  density: z.enum(["low", "medium", "high"]).default("medium"),
  explainsTerms: z.boolean().default(true),
  abbreviationTendency: z.enum(["none", "first-use", "permissive"]).default("first-use"),
});
export const RhetoricalStyleProfileSchema = z
  .enum([
    "direct-analytical",
    "narrative",
    "forensic",
    "comparative",
    "argumentative",
    "explanatory",
  ])
  .default("direct-analytical");
export const ConclusionStyleProfileSchema = z.object({
  form: z.enum(["concise", "qualified", "recap", "opinion", "none"]).default("qualified"),
  avoidsRepetition: z.boolean().default(true),
});
export const LexicalSemanticProfileSchema = z.object({
  toneAvoid: z.array(z.string().trim().min(1)).max(100).default([]),
  prefersNeutralVerbs: z.boolean().default(true),
  evaluativeLanguage: z.enum(["none", "restrained", "explicit"]).default("restrained"),
});

export const SemanticStyleProfileSchema = z.object({
  schemaVersion: z.literal(SEMANTIC_STYLE_SCHEMA_VERSION).default(SEMANTIC_STYLE_SCHEMA_VERSION),
  tone: ToneProfileSchema.default({}),
  voice: VoiceProfileSchema.default({}),
  formality: FormalityProfileSchema.default({}),
  register: RegisterProfileSchema.default({}),
  assertionStyle: AssertionStyleProfileSchema.default({}),
  qualificationStyle: QualificationProfileSchema.default({}),
  evidenceFraming: EvidenceFramingProfileSchema.default({}),
  uncertaintyStyle: UncertaintyProfileSchema.default({}),
  sentenceArchitecture: SentenceArchitectureProfileSchema.default({}),
  paragraphArchitecture: ParagraphArchitectureProfileSchema.default({}),
  transitions: TransitionProfileSchema.default("restrained"),
  agency: AgencyProfileSchema.default({}),
  technicality: TechnicalityProfileSchema.default({}),
  rhetoricalStyle: RhetoricalStyleProfileSchema.default("direct-analytical"),
  conclusionStyle: ConclusionStyleProfileSchema.default({}),
  lexicalPreferences: LexicalSemanticProfileSchema.default({}),
  notes: z.array(z.string().trim().min(1)).max(20).default([]),
  /**
   * V1 values with no exact V2 home, carried verbatim.
   *
   * Present so the v14 migration is lossless and so the editor can say what the
   * profile used to say. Never read by the engine; removed in state v15 with an
   * ADR. The document's requirement "never silently discard learned profile
   * information" is satisfied here rather than by a mapping that guesses.
   */
  legacyV1: z
    .object({
      readingGradeTarget: z.number().min(0).max(20).nullable().default(null),
      vocabularyRegister: z
        .enum(["simple", "standard", "technical", "academic"])
        .default("standard"),
      tone: z.string().default(""),
      voice: z.string().default(""),
      rhetoricalStyle: z.string().default(""),
    })
    .optional(),
});
export type SemanticStyleProfile = z.infer<typeof SemanticStyleProfileSchema>;
```

```ts
// src/core/domain/SemanticReviewSession.ts
export const SEMANTIC_REVIEW_OUTCOME_CAP = 20;

/**
 * Internal state. There is no user-facing history surface and none is planned.
 *
 * **Minimised deliberately.** An earlier draft carried `documentId` and
 * `documentHash` and the observability section described the log as something "a
 * user can see" — with no UI specified anywhere in the plan. Two unsupported
 * claims, and the identifiers were the more expensive half: a document id plus a
 * content hash in `Office.roamingSettings` is a durable fingerprint of which
 * document a user ran a model against, retained for 20 entries, for a surface that
 * does not exist. What the log is actually for is answering "did my last semantic
 * review get written, and under which profile" — so it carries exactly that, plus
 * a reflection test asserting no field can hold document text.
 */
export const SemanticReviewOutcomeSchema = z.object({
  sessionId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  outcome: z.enum(["applied", "kept_original", "regenerated", "refused"]),
  at: z.string().datetime(),
  preservationPassed: z.boolean(),
  selectionWordCount: z.number().int().nonnegative(),
  // No text, and now no document identity either. Reflection-tested.
});
export type SemanticReviewOutcome = z.infer<typeof SemanticReviewOutcomeSchema>;
```

```ts
// src/analysis/semantic/contracts.ts
export const SEMANTIC_DIMENSIONS = [
  "tone",
  "voice",
  "formality",
  "register",
  "assertionStyle",
  "qualificationStyle",
  "evidenceFraming",
  "uncertaintyStyle",
  "sentenceArchitecture",
  "paragraphArchitecture",
  "transitions",
  "agency",
  "technicality",
  "rhetoricalStyle",
  "conclusionStyle",
  "lexicalPreferences",
] as const;
export const SemanticDimensionSchema = z.enum(SEMANTIC_DIMENSIONS);

export const SemanticObservationSchema = z.object({
  dimension: SemanticDimensionSchema,
  alignment: z.enum(["aligned", "minor_deviation", "material_deviation"]),
  explanation: z.string().trim().min(1).max(600),
  evidenceQuote: z.string().trim().min(1).max(400).optional(),
});

export const SemanticAssessmentSchema = z.object({
  overallAlignment: z.enum(["high", "moderate", "low"]),
  summary: z.string().trim().min(1).max(800),
  observations: z.array(SemanticObservationSchema).min(1).max(24),
});

/**
 * The anchor records where the user pointed, not what the document contains.
 *
 * **No whole-document hash.** An earlier draft carried `documentHash`, and that
 * would have defeated this phase's own performance claim: producing a
 * whole-document hash requires reading the whole document, which is exactly the
 * read the selection-scope reader exists to avoid. Identity of the _document_ is
 * `documentId` (the host's own id, or a content-hash fallback the Word reader
 * already computes only when the host omits it). Identity of the _target_ is
 * `selectionHash` over the selected text.
 *
 * Staleness is not this anchor's job. It is enforced where it already works: the
 * adapter's exact `text` precondition compared against the live document, plus
 * the `structuralHash` the reformat acquisition path already holds. Neither
 * requires a new read on the propose path.
 */
export const SemanticSelectionAnchorSchema = z.object({
  /** Host document identity. Cheap; never a fresh read on this path. */
  documentId: z.string().trim().min(1),
  /**
   * Containing paragraphs, when the host exposes their ids.
   *
   * Optional, and honestly so: `uniqueLocalId` is not universal across hosts, and
   * a required field here would force a fabricated id rather than an absent one.
   * An empty array degrades to offset-plus-precondition targeting and is reported
   * as such in Troubleshooting, not treated as a verified node anchor.
   */
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  selectedText: z.string().min(1),
  /** `hashText(selectedText)` — the cheap, sufficient identity of the target. */
  selectionHash: z.string().trim().min(1),
  capturedAt: z.string().datetime(),
});

export const SemanticReviewRequestSchema = z.object({
  selectedText: z.string().min(1),
  selectionAnchor: SemanticSelectionAnchorSchema,
  profile: z.object({ id: z.string().uuid(), revision: z.number().int().positive() }),
  semantic: SemanticStyleProfileSchema,
  includeRawText: z.literal(true),
  domain: z.enum(["general", "constructionExpert"]).default("constructionExpert"),
});

export const SemanticReviewResultSchema = z.object({
  reviewSessionId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  assessment: SemanticAssessmentSchema,
  proposedRevision: z.string().trim().min(1),
  preservation: PreservationReportSchema,
  meaningPreservation: MeaningPreservationAssessmentSchema,
  actionable: z.boolean(),
  refusalReason: z.string().trim().min(1).optional(),
  providerMetadata: z.object({
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    latencyMs: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
  }),
  selectionAnchor: SemanticSelectionAnchorSchema,
});
```

```ts
// src/analysis/semantic/protectedFacts.ts + preservationValidator.ts
export const PROTECTED_FACT_KINDS = [
  "number",
  "percentage",
  "currency",
  "date",
  "duration",
  "clauseReference",
  "identifier",
  "quotedReference",
  "properName",
] as const;
export const ProtectedFactKindSchema = z.enum(PROTECTED_FACT_KINDS);

export const ProtectedFactSchema = z.object({
  kind: ProtectedFactKindSchema,
  /** Normalised so "1,200", "1200" and "1200.00" compare equal. */
  value: z.string().trim().min(1),
  /** Verbatim, for the user-facing diff. */
  surface: z.string().trim().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** False when ToneForge could not classify a token it saw; drives soft warnings. */
  certain: z.boolean().default(true),
});

export const PreservationReportSchema = z.object({
  pass: z.boolean(),
  tier: z.enum(["hard", "soft", "clean"]),
  originalFacts: z.array(ProtectedFactSchema),
  proposedFacts: z.array(ProtectedFactSchema),
  missing: z.array(ProtectedFactSchema),
  added: z.array(ProtectedFactSchema),
  changed: z.array(
    z.object({
      kind: ProtectedFactKindSchema,
      from: z.string(),
      to: z.string(),
      // "This cannot be applied as a style-only revision." is the whole message.
      userSentence: z.string().trim().min(1),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.string().trim().min(1),
      sentence: z.string().trim().min(1),
      acknowledgementRequired: z.boolean().default(true),
    }),
  ),
});

export const MeaningPreservationAssessmentSchema = z.object({
  qualificationPreserved: z.boolean(),
  attributionPreserved: z.boolean(),
  causationPreserved: z.boolean(),
  responsibilityPreserved: z.boolean(),
  certaintyPreserved: z.boolean(),
});
```

`actionable` in the result is computed **only** from
`preservation.tier !== "hard" && meaningPreservation.* !== false` — never from a
model confidence number. The model may return `confidence` for diagnostics; it is
recorded in `providerMetadata` diagnostics and never rendered (§30).

---

## 7. Migration design

### 7.1 State v13 → v14

`CURRENT_STATE_VERSION = 14`, `STORAGE_KEY = "ToneForge.State.v14"`,
`LEGACY_STORAGE_KEYS` gains `ToneForge.State.v13`.

`migrateV13ToV14(obj)`:

1. `readCurrentState(obj)` to get a validated v14-shaped base.
2. For each record in `semanticProfileRecords`, transform every stored snapshot —
   `draft`, each `published[]`, each `revisions[].profile` — with
   `migrateSemanticStyle(v1)`:
   - `tone` (string) → `tone.description`, and a best-effort `primary` only when
     the V1 string matches a `ToneTrait`; otherwise `primary` stays `"neutral"`
     and the string is preserved in `tone.description`.
   - `voice` (string) → `voice.description`, same treatment.
   - `formality` → `formality.score`.
   - `rhetoricalStyle` → `rhetoricalStyle` when it maps to an enum value, else
     `legacyV1.rhetoricalStyle`.
   - `preferredSentenceLength` → `sentenceArchitecture.targetWords`.
   - `avoidWords` → `lexicalPreferences.toneAvoid`.
   - `vocabularyRegister` → `legacyV1.vocabularyRegister` **and** a best-effort
     `register.primary` mapping (`academic`→`academic`, `technical`→`technical`,
     `simple`→`plain`, `standard`→`professional`), with the original preserved.
   - `readingGradeTarget` → `legacyV1.readingGradeTarget` (no V2 home; it is a
     readability measure, not a style trait).
   - Nothing is dropped. Every V1 field is either mapped or carried in
     `legacyV1`, and a test asserts the round trip.
3. Deterministic `profileRecords` are **not** touched. Their `semantic` block is
   still on the schema, defaults to V2, and is never read by the deterministic
   engine — the existing test
   [`deterministicReviewEngine.test.ts:153`](../tests/unit/analysis/deterministic/deterministicReviewEngine.test.ts:153)
   already refuses a semantic profile, and the kind check is unchanged.
4. `semanticSampleEvidence`: new record keyed by uuid, each
   `{ id, source, filename?, wordCount, sentenceCount, paragraphCount, capturedAt, sampleHash }`.
   **No `text` field exists on the schema**, and a reflection test asserts it,
   mirroring the `ProviderConnection` credential test.
5. `semanticReviewOutcomes`: new array, capped at `SEMANTIC_REVIEW_OUTCOME_CAP`,
   collapsed on `sessionId`, newest last. Populated only by explicit user actions.

A record that fails V2 parsing is dropped individually, exactly as
`normalizeRecords` does today — one malformed profile must not cost the rest.

### 7.2 Backward compatibility and transitional requirements

- **V1 prompt path retained until P4.** `buildProfilePrompt` and
  `ProfileResponseSchema` stay until `profiler.ts` is switched; then they are
  removed with their tests in the same commit that switches the caller, so no
  commit in the chain is broken.
- **`deviations()`/`rewrite()` retained until the page migrates (P7)**, then
  removed in P4→P6 order with `rewriteEngine.ts`.
- **In-memory types need no migration.** `CapturedSample.source` and
  `SemanticSampleSource` are not persisted; renaming them is a compile-time
  change only.
- **Governance history is preserved.** `governanceProfiles` / `governanceHistory`
  are untouched by v14; the deterministic engine's policy path is unaffected.
  Existing tests
  ([`ResolvedPolicy.test.ts`](../tests/unit/core/domain/ResolvedPolicy.test.ts),
  [`GovernanceProfile.test.ts`](../tests/unit/core/domain/GovernanceProfile.test.ts))
  are updated, not deleted, and each keeps asserting the override-precedence
  rule.

### 7.3 Rollback

| Situation                                                    | Rollback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A phase fails verification                                   | Revert that phase's commits. No user data is at risk because each phase is internally consistent.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| v14 ships and must be abandoned                              | **Lossy and not reversible.** `setLocalStorage` and `setRoamingSettingsAsync` purge `LEGACY_STORAGE_KEYS` on write, so the first save after upgrade destroys the v13 record. This is existing designed behaviour, identical to the v11→v12 precedent (`migrateV11ToV12` discards old review keys). Accept it, and record it in ADR-0092 with the same reasoning: ToneForge has no users, so there is nothing to lose, and preserving a second copy of the whole state would double the roaming-settings footprint against a documented ceiling. |
| A V2 profile is wrong for a user                             | No migration rollback needed. `ProfileRecord` already carries the full audit trail and `recallRevisionAsDraft()` restores any prior snapshot — including the `legacyV1` carrier. This is the real safety net, and it is why P1 must keep the audit trail intact.                                                                                                                                                                                                                                                                                |
| Preservation validator produces false positives in the field | Disable Apply for semantic proposals behind a constant (`SEMANTIC_PRESERVATION_ENABLED`, default `true`) rather than reverting the migration. A one-line rollback that does not touch stored data.                                                                                                                                                                                                                                                                                                                                              |

### 7.4 Validation

Per phase: `npm run verify` in full — `typecheck → lint → format → secret-scan →
docs → skills → test → coverage → build-artifacts → built-secret-scan → manifest →
package → package-check`. Additionally per phase:

- **P1**: a migration test that starts from a real v13 fixture with populated
  `semanticProfileRecords` (draft + 2 published + 20 revisions) and asserts (a)
  every V1 field is either mapped or in `legacyV1`, (b) `schemaVersion === 2`,
  (c) `selectActiveProfile(state, "semantic")` still returns the same profile id
  and a `revision` equal to the pre-migration value, (d) a deliberately corrupt
  record is dropped without losing its siblings, (e) the deterministic namespace
  is byte-identical.
- **P1**: extend
  [`profileStateBudget.test.ts`](../tests/unit/core/state/profileStateBudget.test.ts)
  with a **semantic** case — three semantic records at the retention cap must stay
  under the same 512 KB / 3 budget. V2 snapshots are substantially larger than V1
  and this test currently only covers deterministic records.
- **P4**: a prompt test asserting the request body contains the profile JSON and
  the selection, and **nothing else** — no document, no sample text, no
  neighbouring paragraph.
- **P6**: an integration test through
  [`applyReviewedPlan()`](../src/reformat/orchestrator.ts:839) with a mocked
  adapter, asserting exactly one `replaceText` change, `approvalState:
"approved"`, an exact `text` precondition, and a refusal when the live
  document has moved.
- **P7**: a component test asserting **one** `role="status"`/`role="alert"` node
  on both new pages (ADR-0062), carried over from the existing
  [`Semantic.test.tsx`](../tests/unit/taskpane/pages/Semantic.test.tsx:328) case.

---

## 8. Phased implementation order

Each phase is independently shippable and revertible. "Blocker" names what must
land first.

### P0 — Baseline lock _(no behaviour change)_

1. Freeze the current suite: record the test count and coverage figures.
   **Measured 2026-10-01 on this branch: 157 test files, 2121 tests passing;**
   global coverage 94.41 % statements / 84.94 % branches / **80.48 % functions** /
   94.41 % lines against an 80 % floor on all four. Function coverage has
   **0.48 points of headroom**, so any new untested exported function is a
   build-breaking risk from this point on. Per-directory figures to hold or
   improve: `analysis` 98.35/87.20/100/98.35, `core/domain` 100/97.91/44.56/100
   (`StyleProfile.ts` functions 43.13), `core/state` 93.88/94.34/66.31/93.88,
   `reformat` 78.90/67.03/93.75/78.90, `style` 98.25/90.80/100/98.25,
   `word` 92.56/79.28/98.27/92.56.
2. Add [`tests/fixtures/expertProse.ts`](../tests/fixtures/expertProse.ts): synthetic
   construction/quantum expert prose covering the §37 corpus — assertion
   strength ×4, attribution ×4, delay ×4, quantum ×4, evidence framing ×4, plus a
   paired (original, protected-violating proposal) set for every protected token
   class. Fixtures are synthetic and carry no real engagement data.
3. Add a characterisation test that pins today's `proposeSemanticRewrite`
   behaviour so the P6 deletion is provably a replacement, not a silent change.

**Blocker for everything.** No production file changes.

### P1 — Semantic Style V2 domain + state v14 _(LANDED 2026-10-01)_

1. `src/core/domain/SemanticStyleProfile.ts`.
2. `src/core/domain/SemanticReviewSession.ts`.
3. `StyleProfile.ts` re-type; `GovernanceProfile.ts` V2 + override fields
   (**D2**); `ResolvedPolicy.ts` `resolveSemantic()` V2; `versioning.ts`
   `diffFields`.
4. `persistence.ts` + `migration.ts` v14, `createSemanticProfileRecord({ activate })`,
   `semanticSampleEvidence`, `semanticReviewOutcomes`.
5. `sampleCapture.ts` source union + `sampleHash`.
6. ESLint: `src/analysis/semantic/**` placeholder scope; `File` global — **DEFERRED
   to P4**, which is where the directory the scope governs is created. A boundary
   scope for a path that does not exist is a rule about nothing.
7. **The consumer migration was pulled into this phase.** It is item 3's
   unavoidable other half, not a separate phase — see below.

**Why first**: every later phase reads the V2 profile, and the migration is the
only irreversible step. Doing it before any UI exists means a user never sees a
half-migrated profile.

**Exit, as originally written**: `npm run verify` green; migration and budget tests
pass; **zero** rendered pixels change.

**Exit, as met**: `npm run verify` green across all thirteen stages; 162 test
files, 2185 tests; coverage 94.63 / 85.35 / 80.20 / 94.63. Rendered pixels **did**
change — `SemanticProfileEditor.tsx` was rewritten as a grouped V2 editor, because
every one of its fields is now a group rather than a scalar — and that is correct
rather than a miss: the exit criterion was unachievable as written, because the V2
schema is a breaking change to every reader of `profile.semantic`. The user's
confirmation that ToneForge has no users is what made pulling the consumer
migration forward safe rather than merely defensible.

**Three departures from the plan as written, each recorded rather than absorbed:**

- **The V1 → V2 upgrade is in the stored schemas, not in `migrateV13ToV14`.**
  Every migration step ends at `readCurrentState`, and a v7 store's profile
  carries a V1 semantic block exactly as a v13 store's does — a migration keyed on
  the _state_ version cannot see that, and a missed case drops the user's profiles
  silently. ADR-0092.
- **`readCurrentState` was discarding the semantic namespace at every version.** A
  learned semantic profile was written and then dropped on the next load. This was
  found by writing the v14 migration test, and it is a pre-existing defect rather
  than one P1 introduced. ADR-0093.
- **The persisted-state budget test moved from a third of the roaming budget to
  half.** V2 costs 1472 bytes serialised against V1's 186, paid once per retained
  revision, which moved three profiles at the retention cap from ~124 KB to
  ~244 KB against a 512 KB proxy. The bound is still a real guard; if a future
  change pushes past half, the answer is to stop storing whole snapshots per
  revision, not to widen the number again.

### P2 — Learning prompt V2 (runs after P3, which it depends on)

1. `buildProfilePromptV2()` in
   [`profilePrompts.ts`](../src/ai/prompts/profilePrompts.ts), with the
   `includeRawText: true` gate exactly as the existing builders have it, and the
   §9 system instruction.
2. **`SemanticStyleExtractionSchema` — strict, and the model's answer is validated
   against _this_, not against the persisted profile shape.** Every group is
   required, every enum member is closed, and there are **no defaults**. A sparse
   or evasive response throws rather than parsing into a profile full of defaults.
   This is the whole point: `SemanticStyleProfileSchema` (P1) carries
   `.default({})` on every group precisely so a _stored_ record tolerates absence,
   and reusing it here would let "the model told us nothing" render as a confident
   "tone: neutral, register: professional". That is a fabricated claim.
   `SemanticStyleExtractionSchema` is then transformed into
   `SemanticStyleProfileSchema.parse()` for persistence.
3. **Factual leakage is a separate validation, not a Zod guarantee.** Zod cannot
   know that "the contractor resourced to two gangs" is a project fact, and the free
   `description` / `notes` fields are where a leak lands. So after extraction:
   extract protected tokens from the sample with P3's `protectedFacts.ts`, scan the
   extracted profile's free-text fields for them, and **refuse** on a hit with a
   stated reason naming the leaked token class — the same refusal shape
   `preservationValidator` produces, so there is one vocabulary for "this carries
   something it should not".
4. `profiler.ts` switches to V2 **behind a parameter** so both paths are reachable
   in tests; V1 removed in P4.
5. Golden-fixture tests, one per claim, against the P0 corpus:
   - the corpus yields a schema-valid strict extraction;
   - a response omitting any group **fails** (not "defaults to neutral");
   - a response whose `description` names `Halvorsen Quay`, a date, or a figure is
     **refused** by the leakage check;
   - a response that is valid but all-default is **rejected as uninformative** with
     the user-facing "the provider returned an empty analysis — try again".

### P3 — Local preservation _(pure; no LLM, no Word)_

1. `protectedFacts.ts` — extractors per token class, each returning
   `{ kind, value, surface, start, end, certain }`, with normalisation so
   `1,200` ≡ `1200` and `30 June 2025` is compared as an ordered
   (day, month, year) tuple rather than a string.
2. `qualifiers.ts` — two curated lists, tiered (**D6**).
3. `preservationValidator.ts` — diff by normalised value; `missing`/`added`/
   `changed`; tier assignment; user-facing sentences generated from the
   template in §16.1.
4. **A new narrow ESLint scope** over `protectedFacts.ts`,
   `preservationValidator.ts`, `qualifiers.ts` forbidding `ai/*`, `word/*`,
   `taskpane/*` — the same technique the `coverage.ts` scope already uses, so the
   preservation logic is provably local and offline.
5. Boundary cases in
   [`moduleBoundaries.test.ts`](../tests/unit/architecture/moduleBoundaries.test.ts).

**Why before P2 as well as P4.** P2's learning-response validation needs a
protected-token extractor to detect factual leakage out of the model's profile, so
P3 is a hard prerequisite of P2 as well. **P3 therefore runs before P2**; the phase
labels are unchanged, only their order, and the sequence is P1 → P3 → P2 → P4.

**Why before P4**: Apply must not be reachable before the validator exists, and
the validator is independent of everything else.

### P4 — Unified Semantic Review contract

1. `analysis/semantic/contracts.ts`, `reviewPrompt.ts`, `reviewSchema.ts`,
   `semanticReviewEngine.ts`, `session.ts`, `index.ts`.
2. `LlmSemanticProvider.review()` + `withSemanticHelpers`.
3. `semanticReviewEngine` reuses `withRetry` and the caller-abort rule from
   [`rewriteEngine.ts`](../src/analysis/rewriteEngine.ts:100) — abort is
   non-retryable.
4. The engine runs the preservation validator on its own output and sets
   `actionable`. It does **not** read a confidence threshold.
5. Delete `deviationEngine.ts`, `buildDeviationPrompt`, `DeviationResponseSchema`
   and the `semantic` parameter of `unifyFindings()` — see §14 item 3 for why the
   `detections` export is deferred by one commit.
6. **The adapter's preservation check is retained, not replaced.** P3's validator is
   the pre-write layer that tells the user _before_ they are offered Apply; the
   adapter's is an independent at-write backstop with different failure modes.
   Removing it would leave one check where there are two today, on the sole
   mutation path.
7. ADR-0092.

**Exit**: one model call returns assessment + revision; a malformed response
changes nothing; `deviations()`/`rewrite()` still exist so the old page still
works.

### P5 — Selection scope capture

1. `src/word/selectionScope.ts`: `readSelectionScope()` via `runInWord`,
   returning text, absolute `start`/`end`, the containing paragraphs'
   `uniqueLocalId`s (where the host has them), `documentId`, and a `selectionHash`
   over the captured text. **No whole-document `contentHash`** — see the anchor
   schema for why producing one would defeat this phase.
2. Extend [`office.d.ts`](../src/types/office.d.ts) for the properties actually
   loaded, each optional and each guarded — ADR-0084's rule: a property name the
   host does not have is a compile error and a refused load.
3. **The reason for this phase, corrected.** An earlier draft said the current page
   reads the structured snapshot _after_ the model call. That is wrong:
   [`Semantic.tsx:447`](../src/taskpane/pages/Semantic.tsx:447) reads
   `getStructuredSnapshot()` **before** calling `proposeSemanticRewrite` — the
   comment on line 444 claiming otherwise is itself inaccurate. The opportunity is
   therefore not ordering but **cost**: today every proposal pays a whole-document
   read (body text, the paragraph collection, and per-paragraph property loads)
   purely to give `resolveAnchor` some nodes to search. Selection-scope capture
   replaces that with a read proportional to the selection.
4. Freshness before Apply is unchanged and already correct: the adapter's exact
   `text` precondition against the live document, plus the `structuralHash` the
   acquisition context already holds. No new read is added to the propose path.
5. ADR note recording selection-event support as an **open question with a
   verification procedure**, not a host limitation (**D11**).
6. Apply-time target resolution implements D11's three-step fallback: whole-paragraph
   `paragraph`-unit first, `Range.set` character-unit second, stated refusal third.

### P6 — Apply path (no deletions; the page still calls the old engine)

1. `semanticApply.ts` takes `ApprovedSemanticRevision` and builds the change from it
   directly — **no `Finding` bridge** (**D4**).
2. **D4's adapter change lands here**: protection and preservation read the
   `Change`, not the `Finding`. `findingId` becomes optional provenance.
3. Preservation is **re-run at apply time**, not trusted from the proposal: the
   text the user approved is the text that is checked. This is the pre-write
   layer; the adapter's own check remains the independent at-write backstop and is
   **not** replaced by it.
4. `rewriteEngine.ts`, `rewritePrompts.ts`, `buildRewritePrompt` and
   `RewriteResponseSchema` **stay in place this phase** — `Semantic.tsx` still
   calls `proposeSemanticRewrite()` at line 449 and would not compile without them.
5. Integration test: a protected node refuses **with no `Finding` anywhere in the
   plan**; a dropped `expectedText` literal refuses likewise; stale document
   refuses; exactly one change written; readback verified.

### P7 — Semantic Review UI (owns the deletions P6 deferred)

1. `taskpane/semantic/gates.ts` — pure, single source for every enabled/disabled
   decision and its blocker sentence (**§26**).
2. `SemanticReview.tsx` + the five components.
3. Dashboard owns the session above the page, mirroring how
   `consistencyResult` is owned, so navigating away does not discard a paid-for
   review. The existing effect that resets `semanticSelectionCaptured` on leaving
   the page is updated accordingly.
4. Delete `Semantic.tsx`; move `deriveSemanticAnnouncement` to
   `taskpane/state/semanticAnnouncement.ts` with its three tests.
5. **Now that the last caller is gone**, delete in this order, each step leaving
   the tree compiling: `Semantic.test.tsx` (reassigned, not dropped, in step 2);
   then `rewriteEngine.ts`, `rewritePrompts.ts`, `buildRewritePrompt`,
   `RewriteResponseSchema`, `REWRITE_ACTIONABLE_CONFIDENCE`. The characterisation
   file `semanticBaseline.test.ts` is deleted **in the same commit** as
   `rewriteEngine.ts` — its whole purpose was to record behaviour that is being
   replaced, and leaving it behind would pin a contract that no longer exists.
6. `taskpane.css` tokens.

**Ordering invariant, stated so it is not broken again:** a module may only be
deleted in the phase that removes its last caller. `Semantic.tsx:449` is the last
caller of `proposeSemanticRewrite`, so the page dies before the engine does.

### P8 — Semantic Style UI + learning inputs

1. `SemanticStyle.tsx`, `SemanticStyleEditor.tsx` (grouped sections), `LearnSemanticStyle.tsx`,
   `SemanticStyleSummary.tsx`, and `ProfileRecordSection` wired in (**§31** —
   the semantic record currently has no publish/activate/recall UI at all).
2. `.txt` import via `textFileImport.ts` (**D8**).
3. Sample quality levels and warnings (**D7**).
4. `createSemanticProfileRecord(..., { activate: false })` for the learn path;
   "Save" and "Save and set active" as two distinct buttons (**§11**).
5. Measured block relabelled "Sample diagnostics" and collapsed (**D9**).
6. `Learn Style` renamed "Use current document" and demoted to a disclosure
   (**§6.4**).

### P9 — Terminology and navigation

1. `semantic-review` / `semantic-style` targets; header; Dashboard routing in
   both branches; command registry; `commandDefinitions.json` label.
2. **Both manifests** edited together: `manifest.json` and `manifest.xml`
   labels and supertips (**ADR-0070, ADR-0073, ADR-0080**). Note the current
   JSON supertip already says "Nothing is changed until you approve it on
   Deterministic Review", which has been **false since ADR-0078** — this is a
   documentation defect fixed here, and it is worth calling out in the commit.
3. `duplicateNavigationTargets()` still passes — one command, one target.
4. `ToneForgeSemantic` global alias kept (the XML manifest resolves `onAction`
   against the global, per
   [`commandHandlers.ts:99`](../src/commands/commandHandlers.ts:99)).
5. ADR-0070's sideload procedure (`npm run stop` → close Word → `npm run
sideload`) is a **manual** step and is recorded, not automated.

### P10 — Diagnostics, setup status, terminology

1. `troubleshooting/checks.ts`: new checks, updated remedy labels, and the
   pinned-label test updated in the same commit (**ADR-0069**).
2. `setupStatus.ts`: `semanticReview` capability (needs semantic profile +
   provider + consent) split from the style-learning capability (needs provider +
   consent only). Today `semanticRewrite` requires only a semantic profile, which
   is how a rewrite button can be enabled with no provider.
3. `Home.tsx`, `ProviderPrivacySettingsSection.tsx`, `docs/ux-state-matrix.md`
   semantic-tab table rewritten.

### P11 — Documentation and governance

`docs/decision-log.md` (ADR-0092 and any amendment to ADR-0052, ADR-0064, ADR-0076,
ADR-0078), `ROADMAP.md` (stage 19 status and a new semantic-review ledger entry),
`docs/project-state.md`, `docs/architecture.md` (new module-boundary rows),
`docs/privacy-security.md`, `docs/accessibility.md`, `docs/CHANGELOG.md`,
`docs/manual-verification.md` (new host procedures). `npm run docs:validate` and
`npm run skills:validate` are graph stages and must pass.

### P12 — Host verification _(human, remains open)_

New entries in [`manual-verification.md`](../docs/manual-verification.md): selection
readback, tracked-revision apply and reject, preservation false-positive sampling
over real expert prose, and the two-page navigation. Recorded as **procedures**,
not results. Per ADR-0051, a green automated run is never reported as a release,
and `npm run release:check` stays blocked.

---

## 9. Test strategy

### Structure (mirrors source, per the coverage rule)

```
tests/unit/core/domain/SemanticStyleProfile.test.ts
tests/unit/core/domain/SemanticReviewSession.test.ts
tests/unit/core/state/migration-v14.test.ts
tests/unit/core/state/profileStateBudget.test.ts      (extended)
tests/unit/style/textFileImport.test.ts
tests/unit/style/sampleQuality.test.ts               (extended)
tests/unit/analysis/semantic/contracts.test.ts
tests/unit/analysis/semantic/semanticReviewEngine.test.ts
tests/unit/analysis/semantic/protectedFacts.test.ts
tests/unit/analysis/semantic/preservationValidator.test.ts
tests/unit/analysis/semantic/qualifiers.test.ts
tests/unit/analysis/semantic/session.test.ts
tests/unit/word/selectionScope.test.ts
tests/unit/reformat/semanticApply.test.ts            (rewritten for the new contract)
tests/unit/taskpane/semantic/gates.test.ts
tests/unit/taskpane/pages/SemanticReview.test.tsx
tests/unit/taskpane/pages/SemanticStyle.test.tsx
tests/unit/taskpane/components/semantic/*.test.tsx
tests/integration/semanticReviewApply.test.ts        (new)
tests/fixtures/expertProse.ts                        (new)
```

### Mocking discipline

- `protectedFacts`, `preservationValidator`, `qualifiers`, `session`, `gates`,
  `textFileImport` are **pure**: no Office mock, no LLM mock. If one of them needs
  a mock to test, it is not pure and that is the finding.
- `semanticReviewEngine` uses `MockAdapter` via `createLlmRegistry({ mock: { responses } })`
  — scripted by prompt substring, as
  [`profiler.test.ts`](../tests/unit/style/profiler.test.ts:30) already does.
- `word/selectionScope` uses the `Office` mock from
  [`tests/setup.ts`](../tests/setup.ts).
- Component tests mock at the module boundary exactly as
  [`Semantic.test.tsx`](../tests/unit/taskpane/pages/Semantic.test.tsx:25) does.

### Coverage

`src/analysis/**`, `src/core/**`, `src/reformat/**`, `src/word/**`, and
`src/style/**` are all inside the [`vitest.config.ts`](../vitest.config.ts:16)
include list with an 80 % floor on all four metrics. `src/taskpane/**` is **not**
in the include list and is covered by component tests. The new `analysis/semantic`
modules therefore count directly against the gate, and the function-coverage
headroom is **0.48 points** (measured 2026-10-01; one figure, used throughout).
**Every new exported function needs a direct test.** No
per-directory override, per the coverage rule.

### Requirement → test map

| Spec § | Test                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5      | `migration-v14.test.ts` — full round trip, `legacyV1` carrier, corrupt-row isolation, deterministic namespace untouched                                                                      |
| 6.2    | `textFileImport.test.ts` — extension/MIME accept, size cap, rejection of `.docx`/binary, `captureFromFileText` delegation                                                                    |
| 7      | `sampleCapture.test.ts` — all four sources, `sampleHash` stability, evidence schema has no `text` field (reflection)                                                                         |
| 8      | `sampleQuality.test.ts` — four levels at the band boundaries; `pass` unchanged at 40 words; `limited` warns                                                                                  |
| 9      | `profilePrompts.test.ts` — gate throws without `includeRawText`; factual-claim response is rejected                                                                                          |
| 11     | `SemanticStyle.test.tsx` — learned profile is not active until "Save and set active"                                                                                                         |
| 12     | `SemanticStyleEditor.test.tsx` — every V2 group has a control; validation error shown, nothing saved                                                                                         |
| 14     | `semanticReviewEngine.test.ts` — one call returns assessment + revision; prompt contains profile + selection only; malformed response changes nothing                                        |
| 16     | `preservationValidator.test.ts` — one case per token class, both directions, normalisation equivalence, tier assignment, user sentences                                                      |
| 16.2   | soft warnings require acknowledgement; acknowledgement is per session, not persisted across sessions                                                                                         |
| 17     | `qualifiers.test.ts` + validator — curated list only; negation tokens are soft, not hard                                                                                                     |
| 18     | `selectionScope.test.ts` — anchor captured before the call; absolute offsets; `nodeIds` may be empty and the anchor says so; `selectionHash` stable; **no whole-document read on this path** |
| 19     | `SemanticReview.test.tsx` — re-read detects a changed selection and says so; no automatic review                                                                                             |
| 20     | `session.test.ts` — profile/document/selection change moves state to `stale`; `Keep original` records the outcome                                                                            |
| 22     | `SemanticReview.test.tsx` — Regenerate re-sends the identical prompt and selection                                                                                                           |
| 23     | `SemanticReview.test.tsx` — Keep original writes nothing and records the outcome                                                                                                             |
| 24     | `semanticReviewApply.test.ts` — one `replaceText`; `toApplyFinding` restores `nodeIds`; protected node refuses; stale refuses                                                                |
| 25     | `semanticReviewApply.test.ts` — readback verified; unverified reported, not hidden                                                                                                           |
| 26     | `gates.test.ts` + component — each of consent/provider/model/profile/selection disables and names the blocker                                                                                |
| 27     | engine test — request body contains no sample text, no document text, no neighbouring text                                                                                                   |
| 28     | `registry.test.ts` — `review()` present and delegating; `MockAdapter` unchanged                                                                                                              |
| 29     | engine test — exactly one `complete` call per review                                                                                                                                         |
| 30     | component test — no confidence percentage is rendered                                                                                                                                        |
| 31     | `SemanticStyle.test.tsx` — `ProfileRecordSection` renders; switching drops the proposal                                                                                                      |
| 32     | `commandContracts.test.ts` + manifest parity test — labels agree across both manifests                                                                                                       |
| 34     | `checks.test.ts` — new remedies, labels pinned                                                                                                                                               |
| 39.13  | `SemanticReview.test.tsx` — no `FindingDetail` in the tree                                                                                                                                   |

---

## 10. Acceptance criteria

The specification's 30 gates, with four corrected. A gate passes only on
repository evidence; host gates stay open per ADR-0051.

| #     | Gate                                                       | Evidence                                                                                                                                                                                            | Note |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1     | Explicitly user-triggered                                  | No call site outside a click handler; test asserts no call on mount or navigation                                                                                                                   |      |
| 2     | No background LLM calls                                    | Same test, plus absence of any timer/observer reaching `analysis/semantic`                                                                                                                          |      |
| 3     | Semantic and Deterministic Style stay separate             | Existing namespace test plus a new assertion that no `rules/` or `formatting/` module reads `profile.semantic`                                                                                      |      |
| 4     | V2 is structured enough                                    | Schema test asserting all 15 groups present with bounded values                                                                                                                                     |      |
| 5–7   | Paste, `.txt`, selection learning                          | `textFileImport` + component tests                                                                                                                                                                  |      |
| 8     | Quality ladder                                             | `sampleQuality.test.ts`                                                                                                                                                                             |      |
| 9     | User reviews before activation                             | `SemanticStyle.test.tsx`                                                                                                                                                                            |      |
| 10    | Raw samples not required for review                        | Engine test: request body has no sample                                                                                                                                                             |      |
| 11    | Review sends profile + selection only                      | Prompt capture assertion                                                                                                                                                                            |      |
| 12    | One call returns both                                      | Spy on `registry.complete`                                                                                                                                                                          |      |
| 13    | **User sees why the selection differs**                    | **Corrected**: this is the assessment view, _not_ a "difference from the profile text". Verified by `SemanticAssessmentView` rendering each observation's `dimension` + `alignment` + `explanation` |      |
| 14    | Model does not choose the target                           | `reviewSchema` has no anchor field; a response containing one is stripped                                                                                                                           |      |
| 15    | Exact selection is the target                              | `selectionScope` test                                                                                                                                                                               |      |
| 16    | Local preservation protects factual tokens                 | Validator tests, one per class                                                                                                                                                                      |      |
| 17    | **Meaning-preservation flags**                             | **Corrected per D6**: model flags are _soft warnings with the model's sentence quoted_, not a silent disable. The **hard** gate is local                                                            |      |
| 18    | **Confidence alone cannot make a rewrite actionable**      | **Corrected**: confidence is not read at all. `actionable` derives from `preservation.tier` and freshness. The test asserts a high-confidence response with a changed date is still refused         |      |
| 18a   | **(new) The merge point cannot be bypassed by omission**   | **From D4**: a protected node refuses and a dropped `expectedText` literal refuses **with no `Finding` anywhere in the plan**. Without this the two checks are fail-open                            |      |
| 18b   | **(new) The quality level is visible, not transient**      | **From D7**: the badge renders word count, level and consequence, and survives the acknowledgement                                                                                                  |      |
| 18c   | **(new) A sparse model profile is refused, not defaulted** | **From P2**: an extraction omitting any group throws; one leaking a project fact is refused by the leakage check                                                                                    |      |
| 19–20 | Keep original / Regenerate write nothing                   | Spy on `applyReviewedPlan`                                                                                                                                                                          |      |
| 21–23 | Explicit apply, shared writer, verified                    | Integration test                                                                                                                                                                                    |      |
| 24    | Track Changes where supported                              | `prepareTrackedEditing` path unchanged; **host gate open**                                                                                                                                          |      |
| 25    | Stale invalidation                                         | Session tests                                                                                                                                                                                       |      |
| 26    | Blockers disable before click                              | `gates.test.ts`; every action's disabled state is derived from `gates`, never from a local boolean                                                                                                  |      |
| 27    | No semantic results in Pending Changes                     | Assert `SemanticReview` never calls `planChanges` and never renders `PendingChanges`; the deterministic review's semantic-finding count is unchanged                                                |      |
| 28    | C1–C10 separate                                            | No import between the two `analysis/` subdirectories, enforced by boundary test                                                                                                                     |      |
| 29    | Distinct surfaces                                          | Two `TaskPaneDestination`s, two lazy pages                                                                                                                                                          |      |
| 30    | Terminology                                                | Label assertions across header, command registry, both manifests, `Home`, and troubleshooting remedies                                                                                              |      |

**Release claim**: none. `npm run release:check` remains blocked by the human
Word-host matrix (4 hosts, 0 fully passing) and by production credential custody,
per [`project-state.md`](../docs/project-state.md:195).

---

## 11. Risks and mitigations

| Risk                                                                               | Likelihood                                    | Impact                                            | Mitigation                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function coverage falls below 80 %                                                 | **High** — headroom is 0.48 points            | Build fails                                       | Every new function gets a direct test; check `npm run test:coverage` at the end of each phase, not at the end of the plan                                                                            |
| V2 semantic snapshots blow the `roamingSettings` budget                            | Medium                                        | Silent loss of audit trail                        | P1 adds a semantic-namespace budget case to `profileStateBudget.test.ts` **before** the UI exists; the retention cap is the only lever, and it is already 20                                         |
| Preservation false positives make Apply feel broken                                | **High** — this is the single biggest UX risk | Users press Regenerate reflexively, defeating §30 | D6's two-tier split; `certain: false` on unclassifiable tokens routes them to soft warnings; `SEMANTIC_PRESERVATION_ENABLED` gives a one-line rollback with no data migration                        |
| Governance override silently stops working for new dimensions                      | Certain if D2 is ignored                      | Silent correctness regression                     | D2 is in scope; `EDITORIAL_OVERRIDE_FIELDS` and `resolveSemantic()` tests are updated, not deleted                                                                                                   |
| Model returns a profile-shaped response that parses to defaults                    | Medium                                        | A learned profile that says nothing               | Zod requires each group's `primary`/`strength`/etc.; the engine rejects a response where every group is at its default, with a user-facing "the provider returned an empty analysis — try again"     |
| Word host cannot load the selection's paragraph ids                                | Medium                                        | No anchor                                         | `selectionScope` degrades to offsets-only and says the target could not be node-anchored; Apply then requires the exact text precondition, which is already mandatory. **Host-unverified until P12** |
| Manifest label change applied to only one file                                     | Medium                                        | Ribbon silently missing (ADR-0070)                | Both files edited in the same commit; `npm run validate` parity check; ADR-0082 id-uniqueness check                                                                                                  |
| Two destinations drift so one is unhandled                                         | Low                                           | Button does nothing (ADR-0079)                    | One `applyArrival` switch; a test asserts every `TaskpaneTarget` is handled                                                                                                                          |
| The sibling LLM-settings document lands mid-plan and changes `providerComposition` | Medium                                        | Merge conflict in shared files                    | P4/P7 touch `providerComposition` only through its existing interface; if the sibling lands first, rebase P4 and re-run its parity test                                                              |
| Deleting `deviationEngine` removes coverage the gate was relying on                | Medium                                        | Function coverage drops                           | P4 pairs the deletion with the tests it retires, and re-checks coverage in the same commit                                                                                                           |

---

## 12. Observability

The repository has **no telemetry** — ADR-0060 removed the Settings toggle
because it gated a build-time flag with no analytics endpoint, and
`TELEMETRY_DISABLED=1` is the default. No new metrics endpoint is proposed; doing
so would reopen a removed decision.

Observability here means three things that already exist:

1. **`logger.warn` / `logger.error`** for every refusal with a structured, already
   redacted context: `redactSensitiveText` in
   [`src/shared/utils/redaction.ts`](../src/shared/utils/redaction.ts) strips
   credential-shaped and document-content fields, so a preservation report's
   `surface` values **must not** be logged. Log the `kind` and the counts, not the
   tokens. This is a concrete rule the implementer must follow; a log line
   containing `30 June 2025` is a privacy defect.
2. **The Troubleshooting registry** — every new refusal gets a check with a remedy
   label pinned by a test.
3. **The session outcome log** in state v14 — 20 entries, carrying only
   `{ sessionId, profileId, profileRevision, outcome, at, preservationPassed,
selectionWordCount }`. **It is internal state and there is no user-facing
   history surface**; an earlier draft of this plan claimed the user could see it,
   which was an unsupported claim about a UI that was never specified. Its job is
   narrower: after a session ends, answer "was that written, and under which
   profile revision" from the store rather than from component state that a
   navigation has already discarded. It holds no document text — reflection-tested,
   mirroring the `ProviderConnection` credential test — and, since P1's review,
   **no document identity either**, so it is not a durable fingerprint of which
   document a user ran a model against.

`docs/manual-verification.md` gains the P12 procedures. A user-visible counter
("3 paragraphs changed since last review") is **not** built: the seam exists
(`createWordParagraphEventAdapter`) but the value is marginal against the cost of
a second thing to keep running, and it would be the first step toward the
continuous review §27.3 forbids. Recorded as a deliberate non-goal, not deferred
work.

---

## 13. Security and privacy

| Concern                             | Position                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learning sample leaving the machine | Only through the explicit disclosure in `LearnSemanticStyle`, after the quality level is shown. The `includeRawText: true` gate in the prompt builder is the load-bearing control, unchanged in shape from the existing three builders                        |
| Raw sample persistence              | **Prohibited by schema.** `SemanticSampleEvidenceSchema` has no text field; a reflection test asserts it, mirroring the `ProviderConnection` credential test                                                                                                  |
| Review request contents             | Asserted by test: active semantic profile + selected text + nothing else                                                                                                                                                                                      |
| Consent                             | `semanticOptIn` remains a single global permission and is re-derived from a strict boolean on every load. §10 adds a per-action confirmation on top; it does not create a second stored consent, so ADR-0052's "no consent implies another" rule is untouched |
| Session persistence                 | Outcome log carries no text; the in-memory session holds text and never leaves component state above the page                                                                                                                                                 |
| Credentials                         | Untouched. No `ProviderConnection` field changes, no new auth mode, no key in the task pane                                                                                                                                                                   |
| Logs                                | See §12 — counts and kinds, never surfaces                                                                                                                                                                                                                    |
| New third-party surface             | `.txt` is read with the browser `File` API and never uploaded anywhere except through the disclosed semantic request                                                                                                                                          |

---

## 14. Performance

- **Model calls**: one per review instead of the two the document describes
  (`deviations()` then `rewrite()`). Note the current page already makes **one**
  call, so this is a simplification of the contract, not a cost reduction today.
- **Word reads**: P5 captures the selection scope _before_ the call and reuses
  the captured `contentHash`; the current code calls
  `getStructuredSnapshot()` — a whole-document read with a paragraph collection
  and per-paragraph property loads — on every proposal. Removing that from the
  propose path is the single largest local win available and is not mentioned in
  the document.
- **Preservation validation**: linear in the length of the selection. Bounded by
  a `MAX_REVIEW_SELECTION_CHARS` constant (default 20 000) enforced in
  `gates.ts`, with a stated refusal above it rather than a silent truncation.
- **UI**: the measured block collapses by default; the assessment list is capped
  at 24 observations by schema.
- **No new observers, timers, or listeners.**

---

## 15. Developer-experience impact

- Two new leaf directories (`src/analysis/semantic/`, `src/taskpane/components/semantic/`)
  following the `analysis/consistency/` precedent. The placement guide in the
  scaffold skill and the module table in `docs/architecture.md` are updated in
  P11 — and `npm run skills:validate` is a graph stage, so a stale skill fails
  the build.
- `Semantic.tsx` (864 lines) becomes two focused pages and six components. Every
  test in [`Semantic.test.tsx`](../tests/unit/taskpane/pages/Semantic.test.tsx) is
  **reassigned** to one of the new files, not deleted; the announcement tests move
  with `deriveSemanticAnnouncement`.
- One new pure gate module means a developer no longer computes readiness in a
  component. This is the same correction `applyReadiness.ts` made for Apply.
- One new narrow ESLint scope means the preservation logic cannot accidentally
  acquire a Word or LLM dependency, and the boundary test proves the scope is live
  rather than decorative.

---

## 16. Rollout

Semantic-only, in the P0–P11 order, with one commit per numbered item where the
commit message can name it. Conventional-commit scopes aligned to the ROADMAP:
`feat(semantic):` for the new engine and UI, `feat(state):` for v14,
`refactor(semantic):` for deletions, `test(semantic):` for fixtures and tests,
`docs:` for P11. Each commit body states the _why_ and cites the ADR and the
spec section.

**Feature flag**: none. The product has no users, and the two surfaces replace the
existing one in place. A flag would add a state field, a settings control, and a
second code path to retire later, for no benefit. The v14 migration is the only
user-visible transition and it is transparent.

**Release**: blocked. P12 is a procedure, not a result. `npm run release:check`
stays red until a person runs the add-in in Word.

---

## 17. Deliberate non-goals

Recorded so they are not mistaken for omissions:

1. **The changed-paragraph dirty tracker** (§27.3, S13). The seam exists; a
   counter is not worth a second long-running thing, and it points at continuous
   review, which is forbidden.
2. **"Regenerate with instruction"** (§22) — the document already excludes it from
   the first milestone. If required, it is a `SemanticReviewRequest` field with a
   prompt clause and a session record of the instruction; no schema change.
3. **A sample library** (§7's "unless the user explicitly opts into a future
   sample-library feature"). Explicitly future.
4. **`.docx` ingestion** (§6.2) — the document forbids it; nothing here adds it.
5. **Whole-document semantic review.** The document excludes it; nothing here
   enables it, and the gates module has no code path that would.
6. **A second ribbon button** for Semantic Style (**D10**).
7. **Semantic coverage reporting.** The consistency engine has a coverage report
   because its bound is real and stated. Semantic review is bounded by the
   selection, which the user chose and can see, so a coverage report would be a
   fact the user already has. If the selection cap is ever exceeded, `gates.ts`
   refuses with a stated sentence rather than truncating — which is the same
   honesty, at one third of the machinery.

---

## 18. Open decisions requiring your answer before implementation

1. **D6 severity split — DECIDED 2026-10-01.** Approved as written in §2/D6:
   hard failures for factual tokens; soft warnings with an explicit
   acknowledgement for qualifier/negation changes and for the model's
   meaning-preservation flags. The document's literal §17 reading is not
   implemented. Recorded at the head of this document.
2. **D7 sample floor.** I am keeping the 40-word hard floor and making 100 words a
   warning rather than a refusal. Confirm, or tell me to raise the floor and accept
   that short documents can no longer be learned from directly.
3. **P0–P12 as one branch or several.** The plan assumes one linear sequence. If
   you want P1–P3 landed and reviewed as a self-contained "semantic data layer"
   before any UI work begins, say so; I would then add a checkpoint after P3.
4. **Sibling-document ordering.** This plan assumes LLM settings lands first. If
   the Indexed Consistency or Home/UX documents are in flight, tell me which, and
   I will re-sequence P9 and P10 around them.
