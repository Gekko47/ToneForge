# Deterministic Review — End-to-End Review Findings

**Date:** 2026-10-08
**Method:** Fleet of independent reviewers per `plans/deterministic-review-end-to-end-review-plan.md` (X0 baseline, XA engine, XB wiring, XC profile, XD dashboard, XE cross-layer), aggregated and deduplicated, with a final evidence-verification pass on every conflicting claim.
**Baseline (X0):** `npm run typecheck` clean · `npm run lint` 0 warnings · 582 tests / 33 files passing across `tests/unit/analysis/deterministic`, `tests/unit/rules`, `tests/unit/changes`, `tests/unit/formatting`.

## Verdict by layer

| Layer                                    | Verdict                                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine determinism (A1–A7)               | **PASS** — pure, boundary-clean, registry-guarded; two latent two-owner pairs and declaration drift found (F1, F2, F4)                                                                       |
| Wiring and integration (B1–B7)           | **PASS** — groups join the same run's findings, batch approval reachable, one projection feeds gate and Apply, one mutation path, module boundaries hold                                     |
| Profile accuracy and consistency (C1–C6) | **PASS WITH FINDINGS** — Phase 3 enforcement claims all hold; rule-read fields with no control (F3), two two-owner pairs (F1, F2)                                                            |
| Dashboard fidelity (D1–D8)               | **PASS** — all eight checks confirmed, no findings                                                                                                                                           |
| Cross-layer catalogue                    | 25 catalogue items Closed; ND-4 and D-2 Partially closed (F1/F2); S11's "every typography field has a control" is false for `typography.percentageSpacing` (deliberate, unrecorded deferral) |

No P0 or P1 findings. The single-occurrence path, the grouped path, the coverage verdict, and the apply gate are wired and honest.

## Remediation status (2026-10-08)

All ten findings are remediated per `plans/deterministic-review-f1-f10-remediation-plan.md`; the decisions are recorded in ADR-0126.

| ID  | Status     | Resolution                                                                                                                             |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Remediated | `typography.currencySpacing` field, check, declaration and control deleted; `language.currency.symbolSpacing` is the single owner      |
| F2  | Remediated | `typography.percentageSpacing` field, check, declaration and control deleted; `language.numbers.percentageSpacing` is the single owner |
| F3  | Remediated | Controls added for `structure.maxHeadingLevel` and the named-style/heading fields; editor-coverage guard added                         |
| F4  | Remediated | Four drifted declarations corrected; `emits`-equals-filter assertion added to `ruleRegistry.test.ts`                                   |
| F5  | Remediated | `src/rules/registry.ts` and `src/shared/utils/result.ts` deleted with their barrel re-exports and tests                                |
| F6  | Remediated | Partition assertion added: `correctable: false ⇒ emits ⊆ reported-only`                                                                |
| F7  | Remediated | `undoGroup` and its tests deleted (production-dead)                                                                                    |
| F8  | Remediated | `WORD_STYLE_MAPPING` re-export dropped from `src/formatting/index.ts`                                                                  |
| F9  | Remediated | Vestigial `preferredTerminology`/`bannedTerms` form fields and writes removed from `ProfileEditor`; the row editor is the single owner |
| F10 | Remediated | Bulk-add hint now states the colon restriction                                                                                         |

**Verification:** `npm run typecheck` clean · `npm run lint` 0 warnings · 2946 tests / 220 files passing. The full `npm run verify` chain is run as the closing step of the remediation plan.

## Findings — P2

### F1 (P2) — Two owners for one behaviour: currency symbol spacing

- **Defect class:** two owners for one behaviour (ND-2 family).
- **Actual:** `typography.currencySpacing` and `language.currency.symbolSpacing` are both user-settable, both measure the same gap between a currency symbol and its amount, and both are correctable. No code reconciles them.
- **Expected:** one owner per behaviour. The schema comment claims "`none` defers to the currency profile, which is the normative source for money" — no such deference is implemented.
- **Failure scenario:** a profile with `typography.currencySpacing: "spaced"` and `language.currency.symbolSpacing: "tight"` produces two findings over one character with opposite expectations; the planner is entitled to refuse the whole plan — ND-2 reproduced over the currency symbol.
- **Evidence:** `src/rules/typography.ts:690` (`checkCurrencySpacing`), `src/rules/language.ts:1384` (`findCurrencyIssues`), `src/core/domain/StyleProfile.ts:111-118` (the false comment), controls at `src/taskpane/components/DeterministicStyleSections.tsx:1523` and `:1282`.
- **Root layer:** profile schema / rules.
- **Remediation:** apply the same resolution used for the separators — remove the `typography.currencySpacing` control and field so `language.currency.symbolSpacing` is the single owner, or implement the claimed deference in `checkCurrencySpacing`. Either way, delete or correct the false comment.

### F2 (P2) — Two owners for one behaviour: percentage spacing, with a false reconciliation claim

- **Defect class:** two owners for one behaviour + a comment that over-claims.
- **Actual:** `typography.percentageSpacing` and `language.numbers.percentageSpacing` both target the same `50%` gap and both are correctable. Comments in `StyleProfile.ts:105-108` and `typography.ts:646-649` state the two "are reconciled by the rule, which prefers the number profile's value when the two differ" — no such code exists; each rule reads only its own field.
- **Expected:** one owner, or a real reconciliation.
- **Failure scenario:** less reachable than F1 (the typography field has no UI control), but it is settable through a persisted profile, and the moment it is non-`"none"` while the number profile disagrees, the two rules produce overlapping conflicting changes. The comment asserts a safety property the code does not provide.
- **Evidence:** `src/rules/typography.ts:651` (`checkPercentageSpacing`), `src/rules/language.ts:989` (`findNumberIssues`), `src/core/domain/StyleProfile.ts:105`.
- **Root layer:** profile schema / rules.
- **Remediation:** implement the deference in `checkPercentageSpacing`, or delete `typography.percentageSpacing` and its `profilePaths` claim as was done for the separators; correct both comments.

### F3 (P2) — Rule-read profile fields with no editor control (the ADR-0112 class, surviving)

- **Defect class:** a field with no control; `unwiredProfilePaths()` cannot see it because it counts a rule's claim, not a control's reachability.
- **Actual — confirmed instances:**
  - `structure.maxHeadingLevel` — read by the formatting analyzer, declared by two rules, no control anywhere; the Structure section summary explicitly promises "how deep the document may nest".
  - `formatting.titleStyle`, `formatting.subtitleStyle`, `formatting.captions`, `formatting.headings.1–9` — read by `checkNamedStyles`/`checkHeadingStyle`, no control anywhere; the Formatting section summary says "The Word style each paragraph kind must carry".
  - `typography.percentageSpacing` — deliberate deferral to Language → Numbers, but recorded only in a JSX comment, not in `METADATA_ONLY_PROFILE_PATHS`.
- **Expected:** every rule-read field is either settable from a control or excused where the audit can see it.
- **Evidence:** `src/analysis/deterministic/ruleRegistry.ts:243-333` (`PROFILE_FIELD_PATHS`), `src/formatting/analyzer.ts:619-666`, `src/taskpane/components/DeterministicStyleSections.tsx:1552-1737` (Formatting and Structure sections), `:1705` (the promising summary), `src/taskpane/components/ProfileEditor.tsx:46-60`.
- **Root layer:** editor; the missing guard is the root cause.
- **Remediation:** add controls for the named-style fields and `maxHeadingLevel` (or record each deferral in `METADATA_ONLY_PROFILE_PATHS` with a comment), and add a guard test that walks `PROFILE_FIELD_PATHS` against the editor's writable field set — the same shape as `profileBehaviour.test.ts`, extended past the registry to the editor.

### F4 (P2) — Registry declaration fidelity: `emits` does not equal the analyze filter, and no guard asserts it

- **Defect class:** a declaration that over-claims what the running engine emits; the audit's blind spot.
- **Actual — confirmed instances:**
  - `language/currency`'s `analyze` filter lists `language.currency.separator`, a category no rule emits (removed with the currency separator fields under D2).
  - `emits` includes bare base categories (`language.currency`, `language.abbreviation`, `language.date`, `language.unit`) that no `analyze` filter selects and no rule produces.
  - `typography.percentageSpacing` is claimed by `typography/numbers`' `profilePaths` but its finding is emitted by `typography/punctuation` and discarded by `typography/numbers`' filter.
- **Expected:** the registry's own comment — "the rule's `emits` and its category filter must agree exactly; the registry's own audit asserts that they do" — is currently a false statement: `ruleRegistry.test.ts` asserts `emits` uniqueness and headline inclusion, never `emits`-equals-filter.
- **Evidence:** `src/analysis/deterministic/ruleRegistry.ts:46`, `:405-440`, `:583`, `:608`, `:637-655`, `:662`; `tests/unit/analysis/deterministic/ruleRegistry.test.ts:159-176`.
- **Root layer:** registry + tests.
- **Remediation:** correct the four declarations, then add the missing assertion that each rule's `emits` equals the categories its `analyze` filter can return.

### F5 (P2) — Dead production modules

- **Defect class:** dead pure module never imported by production code.
- **Actual (verified against barrels, not just direct imports):**
  - `src/rules/registry.ts` — a legacy registry superseded by `src/analysis/deterministic/ruleRegistry.ts`; re-exported by `src/rules/index.ts:11-18`; zero production importers; sole consumer is its own test.
  - `src/shared/utils/result.ts` — speculative `Result` abstraction; re-exported by the utils barrel; zero importers in `src/` and `tests/`.
- **Refuted during verification:** `src/changes/exportAdapter.ts` is **not** dead — `src/taskpane/components/ExportChangesButton.tsx:3` imports `toRevisionsCsv` directly and calls it at line 46.
- **Expected:** deletion over addition; no exported surface with no consumer.
- **Root layer:** rules / shared utils; no dead-code detection exists in the verification graph.
- **Remediation:** delete both modules and their barrel re-exports and tests; consider a dead-export check in the verification graph.

## Findings — P3

| ID  | Finding                                                                                                                                                                         | Evidence                                                                                                    | Remediation                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F6  | No test asserts non-correctable rules' categories are in `DETERMINISTIC_REPORTED_ONLY_CATEGORIES`; the union holds today (manually verified) but is unpinned                    | `tests/unit/changes/deterministicChanges.test.ts:77`                                                        | Add the assertion `correctable: false ⇒ emits ⊆ reported-only`                      |
| F7  | `undoGroup` is exported and tested but production-dead; `undoOne` in the Dashboard bypasses it via `clearReviewDecision`                                                        | `src/taskpane/batchApproval.ts:184`, `src/taskpane/pages/Dashboard.tsx:1267`                                | Wire the group card's undo through `undoGroup`, or delete it                        |
| F8  | `WORD_STYLE_MAPPING` is re-exported from `src/formatting/index.ts:10` with no external importer (it is used internally by `lookupWordStyle`)                                    | `src/formatting/wordStyles.ts:27,51`                                                                        | Drop the re-export                                                                  |
| F9  | `ProfileEditor.buildCandidate` still writes `language.terminology`/`language.bannedTerms` alongside the row editor — a latent two-owner path kept in sync only by re-projection | `src/taskpane/components/ProfileEditor.tsx:166,204,365`                                                     | Remove the residual form fields and writes; the row editor becomes the single owner |
| F10 | Bulk-add splits on the first colon, so a term containing a colon is expressible as a row but silently reinterpreted by a paste                                                  | `src/taskpane/settings/terminologyText.ts:63`, `src/taskpane/components/DeterministicStyleSections.tsx:462` | State the colon restriction in the bulk-add hint                                    |

## Catalogue re-verification (XE)

- **Closed:** ND-1, ND-2, ND-3, ND-5, ND-6 (not a defect), ND-7, ND-8, ND-9, ND-10, ND-11 (verified correct), ND-12, ND-13; owner decisions D1–D6; UX-1, UX-2, UX-3, UX-3a, UX-4, UX-4a; profile-page D-1, D-3, D-4, D-5, D-6.
- **Partially closed:** ND-4 and D-2 — the separator ownership was resolved, but the percentage and currency spacing pairs survive as F1/F2.
- **False claim found:** S11's "every typography field has a control" — `typography.percentageSpacing` has none (the deliberate deferral, unrecorded).
- **Unverified here:** S13's "`npm run verify` green" — the full verification graph was not run in this review; the X0 baseline (typecheck, lint, deterministic suites) is what was established.

## Open items — not claimed as done

- **The Word-host gate is open.** Every finding above is repository-side evidence (static analysis plus the jsdom/mocked suite). Nothing here ran in a real Word host; `word-host-evidence` stays `pending`, and the visual/theme checks in `docs/manual-verification.md` remain human steps.
- The full `npm run verify` chain (coverage, build, manifest, package) was not run and is not claimed.

## Remediation backlog (ordered)

1. **F1** — single-owner the currency symbol spacing (P2; can block unrelated corrections).
2. **F2** — single-owner the percentage spacing and correct the false reconciliation comments (P2; same class as F1).
3. **F3** — close the control gap for `maxHeadingLevel` and the named-style fields, and add the editor-coverage guard (P2; the guard is the root-cause fix for the whole class).
4. **F4** — correct the four registry declarations and add the `emits`-equals-filter assertion (P2; the guard is the root-cause fix).
5. **F5** — delete the two dead modules (P2).
6. **F6–F10** — P3 items, in table order.

---
