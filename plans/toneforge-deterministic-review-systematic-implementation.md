# ToneForge Deterministic Review — Implementation Plan

Authoritative source: `SYSTEMATIC_IMPLEMENTATION/ToneForge_DETERMINISTIC_REVIEW_SYSTEMATIC_IMPLEMENTATION.md` (referred to below as **the spec**).

Scope of this pass: **D0–D13 in full** (including table, header/footer and section acquisition), with Word-host-dependent behaviour implemented against the Office.js API surface, unit-tested against mocks, and recorded as **host-unverified** rather than excluded.

---

## 1. Resolved decisions (from clarification)

| #   | Question                                           | Decision                                                                                                                                                                                                               |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope of this pass                                 | Whole spec, D0–D13. Host-dependent stages implemented and marked host-unverified.                                                                                                                                      |
| D2  | Spec §3.3 (remove the Dashboard consistency merge) | Remove the merge and the `Review in Findings` button. Consistency issues live only on the Consistency Review page. Update affected tests and Troubleshooting/consistency coverage text.                                |
| D3  | Spec §4.3 (remove generic spell-check duplication) | Remove `SPELLING_VARIANT_TABLE`, its findings, planner mapping, tests, and the ProfileEditor "Spelling variant" dropdown. Keep `houseStyle.spellingVariant` in the schema as metadata. No state migration (no users).  |
| D4  | Spec §16 (review-session binding)                  | Add a persisted `deterministicReviewSession` block to `PersistedState`, bump state version 12 → 13, store approvals inside it, invalidate wholesale on document/profile/governance identity change. No back-migration. |
| D5  | Spec §3.1 (engine isolation)                       | Delete `analysis/consistencyChecker.ts`; rewire `documentObserver`, `reformat/orchestrator`, `analysis/index.ts`, tests. `deviationEngine.ts` stays on disk, unreachable from deterministic review.                    |
| D6  | Pre-existing verification failures                 | In scope. Fix the 37 broken documentation links and restore the functions-coverage floor above 80%. `npm run verify` must be fully green.                                                                              |

---

## 2. Current-state findings

Verified by reading every file cited below.

### 2.1 What already satisfies the spec

| Spec item                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seams (Word → AnalysisContext → rules → Finding → ChangePlan → gate → revisionAdapter) | [`src/word/analysisAcquisition.ts`](../src/word/analysisAcquisition.ts), [`src/analysis/analysisContext.ts`](../src/analysis/analysisContext.ts), [`src/changes/planner.ts`](../src/changes/planner.ts), [`src/taskpane/reviewGate.ts`](../src/taskpane/reviewGate.ts), [`src/word/revisionAdapter.ts`](../src/word/revisionAdapter.ts) |
| Mutation layer supports all six change families                                        | [`applySingleChange()`](../src/word/revisionAdapter.ts:446) — text, paragraph format, character format, reset, `applyStyle`, `setListLevel`, `insertBreak`                                                                                                                                                                              |
| Reviewed-only plan projection with three distinct states                               | [`reviewedPlan()`](../src/taskpane/reviewGate.ts:192) returns `no-plan` / `nothing-reviewed` / `reviewed`; the old `?? fullPlan` fallback is already gone                                                                                                                                                                               |
| Capability-gated mutation, fail-closed                                                 | [`prepareTrackedEditing()`](../src/reformat/trackedEditing.ts:101), [`requireVerifiedCapability()`](../src/word/revisionAdapter.ts:33)                                                                                                                                                                                                  |
| Stale / conflict / precondition / approval / protection gates                          | [`validatePlanBeforeApply()`](../src/word/revisionAdapter.ts:800)                                                                                                                                                                                                                                                                       |
| Post-apply readback (partial)                                                          | [`verifyPlanReadback()`](../src/reformat/orchestrator.ts:495) — text hash + per-format readback                                                                                                                                                                                                                                         |
| Coverage report exists                                                                 | [`CoverageReportSchema`](../src/core/domain/DocumentSnapshot.ts:77) — `unsupported`, `excluded`, `unprocessed`, `complete`, `protectedOnly`                                                                                                                                                                                             |
| Auto-scan never approves or applies                                                    | [`documentObserver.ts`](../src/word/documentObserver.ts) produces findings only; approvals are persisted solely by the review gate                                                                                                                                                                                                      |
| UI never writes Word                                                                   | ESLint block [`eslint.config.mjs:328`](../eslint.config.mjs:328) forbids `word/revisionAdapter*` under `taskpane/**`                                                                                                                                                                                                                    |
| Profile revision / audit model                                                         | [`ProfileRecord.ts`](../src/core/domain/ProfileRecord.ts), [`persistence.ts`](../src/core/state/persistence.ts)                                                                                                                                                                                                                         |

### 2.2 Gaps against the spec

| Spec §  | Gap                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1     | No `src/analysis/deterministic/`. `checkConsistency` orchestrates deterministic + formatting + **semantic**, holds `includeRawText`, `signal`, `registry`                                                   | `consistencyChecker.ts`                                                                                                                                                                                                                                                                                                                                       |
| 3.2     | The semantic branch is reachable only via `includeRawText`; **no production caller sets it** (Dashboard preview passes `false`, observer passes `false`), so it is dead code that still widens the contract | [`Dashboard.tsx:587`](../src/taskpane/pages/Dashboard.tsx:587), [`documentObserver.ts:241`](../src/word/documentObserver.ts:241)                                                                                                                                                                                                                              |
| 3.3     | Dashboard merges C1–C10 findings into the deterministic list; `ConsistencyReviewResults` offers `Review in Findings`                                                                                        | [`Dashboard.tsx:981`](../src/taskpane/pages/Dashboard.tsx:981), [`Dashboard.tsx:1126`](../src/taskpane/pages/Dashboard.tsx:1126), [`ConsistencyReviewResults.tsx:308`](../src/taskpane/components/ConsistencyReviewResults.tsx:308)                                                                                                                           |
| 4.1     | Profile has `typography` + `houseStyle` only. No `language` / `formatting` / `structure` sections                                                                                                           | [`StyleProfileSchema`](../src/core/domain/StyleProfile.ts:106)                                                                                                                                                                                                                                                                                                |
| 4.2     | No terminology-rule object (no `caseSensitive`, `wholeWord`, `severity`, aliases, scope); no capitalisation proper-noun/prohibited-variant; no abbreviations; no numbers/dates/currency/units conventions   | [`HouseStyleSchema`](../src/core/domain/StyleProfile.ts:50)                                                                                                                                                                                                                                                                                                   |
| 4.3     | `SPELLING_VARIANT_TABLE` ships 14 generic US/UK pairs as findings                                                                                                                                           | [`houseStyle.ts:35`](../src/rules/houseStyle.ts:35), mapping at [`planner.ts:282`](../src/changes/planner.ts:282), UI at [`ProfileEditor.tsx:659`](../src/taskpane/components/ProfileEditor.tsx:659), diff at [`versioning.ts:110`](../src/style/versioning.ts:110), rule source at [`GovernanceProfile.ts:118`](../src/core/domain/GovernanceProfile.ts:118) |
| 5       | Typography has no whitespace-normalisation toggle, non-breaking-space rule, slash/percentage/currency spacing                                                                                               | [`TypographyRulesSchema`](../src/core/domain/StyleProfile.ts:32); whitespace check is unconditional at [`typography.ts:430`](../src/rules/typography.ts:430)                                                                                                                                                                                                  |
| 6       | No `DocumentFormattingProfile` at all                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                             |
| 8.1     | Acquisition covers the listed properties                                                                                                                                                                    | [`analysisAcquisition.ts:75`](../src/word/analysisAcquisition.ts:75)                                                                                                                                                                                                                                                                                          |
| 8.2     | No `leftIndent` / `rightIndent` / `firstLineIndent` / `keepWithNext` / `keepLinesTogether` / `pageBreakBefore`, and no capability flags for them                                                            | [`CAPABILITY_PROPERTY_GROUPS`](../src/word/analysisAcquisition.ts:75)                                                                                                                                                                                                                                                                                         |
| 8.3–8.6 | `tables`, `headers`, `footers`, `sections`, `fields`, `controls`, `shapes` are hard-coded into `unsupported`                                                                                                | [`analysisAcquisition.ts:296`](../src/word/analysisAcquisition.ts:296)                                                                                                                                                                                                                                                                                        |
| 9       | `includeTables: true` / `includeLists: true` defaults contradict the acquisition report; the Governance UI offers a Tables checkbox the host cannot satisfy                                                 | [`GovernanceProfile.ts:23`](../src/core/domain/GovernanceProfile.ts:23), [`GovernancePolicySection.tsx:128`](../src/taskpane/components/GovernancePolicySection.tsx:128)                                                                                                                                                                                      |
| 10      | `findFormattingIssues({ snapshot })` is heuristic only; no profile, capabilities or scope; direct formatting is flagged wholesale                                                                           | [`analyzer.ts:12`](../src/formatting/analyzer.ts:12), [`analyzer.ts:150`](../src/formatting/analyzer.ts:150)                                                                                                                                                                                                                                                  |
| 10.3    | `formatting.directFormatting` → `resetCharacterFormatting` erases legitimate bold/italic emphasis                                                                                                           | [`analyzer.ts:167`](../src/formatting/analyzer.ts:167), [`planner.ts:367`](../src/changes/planner.ts:367)                                                                                                                                                                                                                                                     |
| 10.4    | `formatting.listLevel` always plans level 0                                                                                                                                                                 | [`analyzer.ts:203`](../src/formatting/analyzer.ts:203), [`planner.ts:371`](../src/changes/planner.ts:371)                                                                                                                                                                                                                                                     |
| 11      | `src/rules/registry.ts` is a static descriptor table with no `analyze`/`plan` and no profile-field mapping                                                                                                  | [`registry.ts`](../src/rules/registry.ts)                                                                                                                                                                                                                                                                                                                     |
| 12      | Findings carry no `profilePath`, `occurrenceGroupKey`, `safeBatchKey`, `correctionAvailable`                                                                                                                | [`FindingSchema`](../src/core/domain/Finding.ts:59)                                                                                                                                                                                                                                                                                                           |
| 13      | No grouping; no batch approval                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                                                             |
| 14.5    | Generic direct-format reset, with no proof it restores style-controlled appearance                                                                                                                          | [`planner.ts:216`](../src/changes/planner.ts:216)                                                                                                                                                                                                                                                                                                             |
| 15      | UI says `Review` / `Ignore`; no Approve / Skip / Approve all / Undo                                                                                                                                         | [`FindingDetail.tsx:179`](../src/taskpane/components/FindingDetail.tsx:179)                                                                                                                                                                                                                                                                                   |
| 16      | Approvals keyed by occurrence identity only; no session identity, no document/profile/governance binding                                                                                                    | [`ReviewedFindingSchema`](../src/core/domain/Finding.ts:143), [`persistence.ts:86`](../src/core/state/persistence.ts:86)                                                                                                                                                                                                                                      |
| 17      | Five-column horizontally-scrolling table                                                                                                                                                                    | [`PendingChanges.tsx:205`](../src/taskpane/components/PendingChanges.tsx:205), [`taskpane.css:397`](../src/taskpane/taskpane.css:397)                                                                                                                                                                                                                         |
| 18      | Validation list is 5 of the spec's 8 checks (no capability-support or mandatory-coverage gate at apply)                                                                                                     | [`Dashboard.tsx:850`](../src/taskpane/pages/Dashboard.tsx:850)                                                                                                                                                                                                                                                                                                |
| 19      | Apply message is a single sentence; no per-change success/failure, no refresh of remaining findings                                                                                                         | [`Dashboard.tsx:885`](../src/taskpane/pages/Dashboard.tsx:885)                                                                                                                                                                                                                                                                                                |
| 20      | No `DeterministicCoverage`; the report cannot distinguish requested from examined from excluded from unsupported as first-class lists                                                                       | [`DocumentSnapshot.ts:77`](../src/core/domain/DocumentSnapshot.ts:77)                                                                                                                                                                                                                                                                                         |
| 21      | Profile editor is Typography + House style, flat                                                                                                                                                            | [`ProfileEditor.tsx:527`](../src/taskpane/components/ProfileEditor.tsx:527)                                                                                                                                                                                                                                                                                   |
| 22      | No category summary, no grouped review, no Approve all                                                                                                                                                      | [`Dashboard.tsx:1254`](../src/taskpane/pages/Dashboard.tsx:1254)                                                                                                                                                                                                                                                                                              |
| 23      | Auto-scan behaviour is compliant                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                             |
| 26      | No tests for dates/currency/units/abbreviations, body/heading compliance, grouping, session binding, or the listed integration fixtures                                                                     | [`tests/`](../tests)                                                                                                                                                                                                                                                                                                                                          |
| —       | `npm run docs:validate` fails: 37 links to deleted `ReformatPanel.tsx` / `GovernanceDashboard.tsx`                                                                                                          | [`ROADMAP.md:107`](../ROADMAP.md:107), [`docs/project-state.md:102`](../docs/project-state.md:102), plus `docs/decision-log.md`, `docs/project-state.md`, `plans/**`                                                                                                                                                                                          |
| —       | `npm run test:coverage` fails: functions 79.97% against the 80% floor                                                                                                                                       | [`vitest.config.ts:33`](../vitest.config.ts:33)                                                                                                                                                                                                                                                                                                               |
| —       | `docs/decision-log.md` contains **two** entries numbered `ADR-0080`, and `ADR-0081` is already taken. New ADRs start at **ADR-0082**                                                                        | [`decision-log.md:1766`](../docs/decision-log.md:1766), [`decision-log.md:1796`](../docs/decision-log.md:1796), [`decision-log.md:2054`](../docs/decision-log.md:2054)                                                                                                                                                                                        |

---

## 3. Requirement-by-requirement coverage matrix

Status key: **New** = not present; **Partial** = present but insufficient; **Kept** = already satisfied; **Change** = must be altered.

| Spec §    | Requirement                                                                       | Status  | Task     |
| --------- | --------------------------------------------------------------------------------- | ------- | -------- |
| 0         | No LLM in the deterministic path                                                  | Partial | T2       |
| 0         | Ordinary spelling delegated to Word                                               | Change  | T8       |
| 1.1       | Retain listed foundations                                                         | Kept    | —        |
| 1.2 A     | Deterministic profile incomplete                                                  | New     | T5       |
| 1.2 B     | Formatting analysis heuristic                                                     | Partial | T9       |
| 1.2 C     | Scope/coverage not whole-document                                                 | Partial | T11–T14  |
| 1.2 D     | Naming blurs product boundaries                                                   | Partial | T2, T3   |
| 1.2 E     | Review UX finding-centric                                                         | New     | T16, T17 |
| 1.2 F     | Pending Changes wide table                                                        | New     | T18      |
| 2         | Target pipeline                                                                   | Kept    | —        |
| 3.1       | `src/analysis/deterministic/` + `DeterministicReviewReport`                       | New     | T2       |
| 3.2       | Semantic leaves this path                                                         | New     | T2       |
| 3.3       | C1–C10 never enter the engine                                                     | New     | T3       |
| 4.1       | `DeterministicStyleProfile` sections                                              | New     | T5       |
| 4.2       | Terminology / capitalisation / abbreviations / numbers / dates / currency / units | New     | T6, T7   |
| 4.3       | Remove generic spell-check duplication                                            | Change  | T8       |
| 5         | Typography profile + wired chain                                                  | Partial | T7       |
| 6         | `DocumentFormattingProfile`                                                       | New     | T5       |
| 7         | Style-first strategy                                                              | New     | T9, T13  |
| 8.1       | Retain current acquisition                                                        | Kept    | —        |
| 8.2       | Indent / keep / page-break capability-gated                                       | New     | T10      |
| 8.3       | `TableSnapshot` + acquisition                                                     | New     | T12      |
| 8.4       | Headers/footers                                                                   | New     | T13      |
| 8.5       | Sections / page setup                                                             | New     | T13      |
| 8.6       | Fields / controls / shapes explicitly excluded                                    | Change  | T14      |
| 9         | Scope = requested ∩ supported; truthful coverage                                  | New     | T11, T14 |
| 10.1      | Body paragraph comparison                                                         | New     | T9       |
| 10.2      | Heading comparison                                                                | New     | T9       |
| 10.3      | Direct formatting not indiscriminately cleared                                    | Change  | T9, T13  |
| 10.4      | Lists compared, not reset to 0                                                    | Change  | T9, T15  |
| 10.5      | Tables compared on supported properties only                                      | New     | T12      |
| 10.6      | Empty headings kept as integrity findings                                         | Kept    | —        |
| 11        | Deterministic rule registry + orphan-setting assertion                            | New     | T4       |
| 12        | `DeterministicFindingMetadata`                                                    | New     | T4       |
| 13        | Grouped findings + safe batch approval                                            | New     | T16      |
| 14.1–14.4 | Text / style / paragraph / character mappings                                     | Partial | T13      |
| 14.5      | Reset only when proven safe                                                       | Change  | T13      |
| 14.6      | List level only when proven                                                       | Change  | T13      |
| 14.7      | Valid finding, non-actionable correction                                          | New     | T13      |
| 15        | Approve / Skip / Approve all / Undo / Go to text                                  | New     | T17      |
| 16        | `DeterministicReviewSession` binding                                              | New     | T19      |
| 17        | Pending Changes cards + sticky footer                                             | New     | T18      |
| 18        | 8-point pre-apply validation                                                      | Partial | T13, T18 |
| 19        | Per-change verification + remaining findings                                      | Partial | T20      |
| 20        | `DeterministicCoverage`                                                           | New     | T11      |
| 21        | Deterministic Style UI IA                                                         | New     | T21      |
| 22        | Deterministic Review UI + grouped review                                          | New     | T16, T17 |
| 23        | Auto-scan invariants                                                              | Kept    | T22      |
| 24 D0–D13 | Stage order                                                                       | —       | T0–T22   |
| 25        | Repository files to modify                                                        | —       | §5 below |
| 26        | Required tests                                                                    | New     | §7 below |
| 27        | 24 verification gates                                                             | New     | §8       |
| 28        | Definition of done                                                                | New     | §8       |

---

## 4. Design decisions taken (and why)

**DD-1 — Rule registry placement.**
The spec places `ruleRegistry.ts` in `src/analysis/deterministic/`. The planner lives in `src/changes/`, which ESLint forbids from importing `**/analysis/*` ([`eslint.config.mjs:268`](../eslint.config.mjs:268)). Therefore:

- `src/analysis/deterministic/ruleRegistry.ts` owns the `DeterministicRule` interface, the rule list, the profile-path audit, and the rule metadata.
- The **finding → Change mapping** lives in a new pure `src/changes/deterministicChanges.ts` keyed by `ruleId`, importing only `core/domain` and `shared/utils`.
- A test asserts the two sets of rule ids agree, so the registry can never claim a rule is plannable when the planner cannot build it.

**DD-2 — Formatting policy argument types.**
`src/formatting/` may import only `core/domain` and `shared/utils`. The new `findFormattingIssues` arguments (`capabilities`, `scope`, `unsupported`) are therefore declared as structural interfaces in `src/formatting/formattingSnapshot.ts` (DD-2 file), not by importing from `analysis/` or `word/`.

**DD-3 — New capability flags default to `false`.**
Every new Office.js-dependent family (indentation, pagination, tables, headers/footers, sections) is added to `WordCapabilities` **and** `AnalysisCapabilities` with a `false` default in `DEFAULT_CAPABILITIES`, `UNPROBED_CAPABILITIES` ([`Dashboard.tsx:81`](../src/taskpane/pages/Dashboard.tsx:81)), and `FALLBACK_CAPABILITIES` ([`orchestrator.ts:92`](../src/reformat/orchestrator.ts:92)). Acquisition therefore skips them until a probe proves them, and they surface in `unsupported`. This is what makes §9 truthful without claiming support (§8.2 "Do not declare support before host verification") while still shipping the implementation (decision D1).

**DD-4 — New ESLint scopes, ordered last-wins.**
Add a `files: ["src/analysis/deterministic/**/*.ts"]` block **after** the general `src/analysis/**` block, mirroring the existing `src/analysis/consistency/**` precedent, forbidding `**/ai/*` and `**/word/*`. Extend the `src/analysis/coverage.ts` scope block to also cover `src/analysis/deterministic/coverage.ts`.

**DD-5 — Session identity invalidation is wholesale.**
A `DeterministicReviewSession` carries a `fingerprint` derived from document id/version, content hash, structural hash, profile id/revision and governance revision. On load, a stored session whose fingerprint does not match the current identity is discarded entirely (approvals included) rather than per-entry reconciled. The pane states how many decisions expired.

**DD-6 — `Skip` is a session decision, `Ignore` is not.**
`Ignore` removes a finding from the list and persists in `ignoredFindings` (existing behaviour, unchanged). `Skip` records a session decision that excludes one occurrence from the plan without hiding it, and `Undo decision` clears it. Both are reversible; neither is the same as the other.

**DD-7 — Direct-format reset is gated on a proof predicate.**
`resetCharacterFormatting` is planned only when a paragraph's provenance shows the overriding character properties are _paragraph-wide_ (`provenance.<prop> === "direct"` on the whole run) and the profile declares `styleControlledFormatting: true` for that style. Any run-level emphasis — a `bold`/`italic` on a character span — makes the finding non-actionable with `correctionReason`, per §14.7.

**DD-8 — Deterministic rule ids are stable strings.**
`language/*`, `typography/*`, `formatting/*`, `structure/*`, `integrity/*`. Existing categories (`typography.emDash`, `houseStyle.terminology`, `formatting.headingHierarchy`, …) are **retained** so governance `GovernanceRule.source` bindings, fingerprints, stored ignores and the planner's `houseStyle.spellingVariant` source removal stay coherent. New rule ids are additive.

**DD-9 — `spellingVariant` stays a metadata field.**
`HouseStyleSchema.spellingVariant` remains (default `"en-US"`), is no longer read by any rule, is removed from `ProfileEditor` and from `diffFields`, and is listed in the new metadata-only manifest asserted by the T4 orphan test. `GOVERNANCE_RULE_SOURCES` loses `"houseStyle.spellingVariant"` (decision D3) because a rule bound to a category no rule produces is an invisible setting.

**DD-10 — Coverage is additive, not a replacement.**
`CoverageReport` is extended (not replaced) with `requestedScopes`, `examinedScopes`, `unsupportedScopes`, `protectedScopes` and `blockers`, and a `DeterministicCoverage` projection is derived from it in `src/analysis/deterministic/coverage.ts`. The existing Apply gate reads `complete`, which now also accounts for mandatory-but-unexamined scope.

---

## 5. Files

### 5.1 New — source

| File                                                      | Purpose                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analysis/deterministic/contracts.ts`                 | `DeterministicReviewOptions`, `DeterministicReviewReport`, `DeterministicReviewSummary`, `DeterministicFindingGroup`, `DeterministicCoverage`, `DeterministicRuleContext`, `DeterministicPlanContext`, `ScopeKind`, `CoverageBlocker` |
| `src/analysis/deterministic/deterministicReviewEngine.ts` | `runDeterministicReview()` — the only deterministic entry point                                                                                                                                                                       |
| `src/analysis/deterministic/ruleRegistry.ts`              | `DeterministicRule` interface, the registered rule list, `profilePath` audit, metadata-only manifest                                                                                                                                  |
| `src/analysis/deterministic/coverage.ts`                  | `buildDeterministicCoverage()`, mandatory-scope blocker derivation                                                                                                                                                                    |
| `src/changes/deterministicChanges.ts`                     | Pure `ruleId` → `Change[]` mapping (DD-1)                                                                                                                                                                                             |
| `src/taskpane/reviewSession.ts`                           | Pure session identity/fingerprint helpers and invalidation                                                                                                                                                                            |
| `src/taskpane/components/ReviewGroupCard.tsx`             | Grouped review card with `Review occurrences` / `Approve all N`                                                                                                                                                                       |
| `src/taskpane/components/PendingChangeCard.tsx`           | One pending change as a card with BEFORE/AFTER and Remove                                                                                                                                                                             |

### 5.2 Modified — domain

| File                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/domain/StyleProfile.ts`      | `LanguageConventionProfile`, `TerminologyRule`, `CapitalisationProfile`, `AbbreviationProfile`, `NumberProfile`, `DateProfile`, `CurrencyProfile`, `UnitProfile`, `TypographyProfile`, `ParagraphStyleStandard`/`CharacterStandard`/`ParagraphStandard`/`ListFormattingStandard`/`TableFormattingStandard`/`HeaderFooterStandard`/`PageStandard`, `DocumentFormattingProfile`, `DocumentStructureProfile`, `DeterministicStyleProfile`; additive defaults so old records parse |
| `src/core/domain/GovernanceProfile.ts` | `includeTables` default → `false`; `ScopePolicy` gains `mandatoryScopes`; `GOVERNANCE_RULE_SOURCES` loses `houseStyle.spellingVariant`, gains the new `language.*` / `formatting.*` sources                                                                                                                                                                                                                                                                                    |
| `src/core/domain/Finding.ts`           | `DeterministicFindingMetadataSchema` on `FindingSchema` (optional, defaulted); `ReviewedFindingSchema` extended with `decision: "approved" \| "skipped" \| "no-change"` and `sessionId`                                                                                                                                                                                                                                                                                        |
| `src/core/domain/Change.ts`            | Payload additions for indentation / keep-with-next / keep-lines-together / page-break-before on `setParagraphFormat`                                                                                                                                                                                                                                                                                                                                                           |
| `src/core/domain/ResolvedPolicy.ts`    | Resolve the new deterministic sections into the immutable policy snapshot                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/core/domain/index.ts`             | Re-exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 5.3 Modified — analysis / rules / formatting

| File                                   | Change                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/analysis/consistencyChecker.ts`   | **Deleted** (D5)                                                                                                                                                                                                                |
| `src/analysis/index.ts`                | Export the new engine; stop exporting `checkConsistency`; stop re-exporting `acquireAnalysisContext` from `../word/…` on the deterministic path (keep a type-only import to avoid the existing barrel cycle)                    |
| `src/analysis/coverage.ts`             | Requested/examined/unsupported/protected scopes and mandatory-scope blockers                                                                                                                                                    |
| `src/analysis/analysisContext.ts`      | `AnalysisContext` gains `tables`, `headersFooters`, `sections`; `AnalysisCapabilities` gains the new flags                                                                                                                      |
| `src/analysis/unifiedFindings.ts`      | Accept the new rule categories; unchanged sort/dedupe semantics                                                                                                                                                                 |
| `src/rules/typography.ts`              | Gated whitespace, non-breaking-space, slash/percentage/currency spacing; all nine settings wired                                                                                                                                |
| `src/rules/houseStyle.ts`              | `TerminologyRule`-driven terminology/case/whole-word; capitalisation proper-nouns and prohibited variants; abbreviations; dates; numbers; currency; units. `SPELLING_VARIANT_TABLE` and `checkSpellingVariant` **deleted** (D3) |
| `src/rules/registry.ts`                | Rebuilt as thin descriptors delegating to the analysis registry, or deleted if the analysis registry supersedes it (decided in T4)                                                                                              |
| `src/formatting/formattingSnapshot.ts` | New paragraph properties; `TableSnapshot`, `TableRowSnapshot`, `HeaderFooterSnapshot`, `SectionSnapshot`; capability/scope input types (DD-2)                                                                                   |
| `src/formatting/analyzer.ts`           | `findFormattingIssues({ snapshot, profile, capabilities, scope })`; body/heading/list/table comparisons; direct-format finding no longer blanket (DD-7)                                                                         |
| `src/formatting/normalizer.ts`         | Removed in T13 (superseded by `changes/deterministicChanges.ts`) or reduced to a delegating wrapper — decided in T13                                                                                                            |
| `src/formatting/wordStyles.ts`         | Level-aware lookup driven by the profile's heading standards                                                                                                                                                                    |

### 5.4 Modified — Word boundary

| File                              | Change                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/word/analysisAcquisition.ts` | New capability property groups; table, header/footer, section acquisition; `unsupported` derived from what was actually skipped rather than hard-coded (DD-3) |
| `src/word/capabilityProbe.ts`     | Probes for the new families; `supportsTables`, `supportsHeadersFooters`, `supportsSections`, `supportsParagraphIndent`, `supportsParagraphPagination`         |
| `src/word/formattingReader.ts`    | Extended to the new DTOs so post-apply readback can verify them                                                                                               |
| `src/word/revisionAdapter.ts`     | Apply the new `setParagraphFormat` payload fields; verify table/section targets are unsupported and refuse rather than guess (§6, §8.3)                       |
| `src/word/documentObserver.ts`    | Call `runDeterministicReview`; report `DeterministicCoverage`                                                                                                 |
| `src/reformat/orchestrator.ts`    | Use the new engine; per-change verification result; remaining-findings refresh; drop `includeRawText`/`registry` from the deterministic path                  |

### 5.5 Modified — state / taskpane

| File                                                                                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/state/migration.ts`                                                                                                                                                                                                                                                                                                                                               | `CURRENT_STATE_VERSION` 12 → 13; `migrateV12ToV13` adds the empty session block; no data back-fill                                                       |
| `src/core/state/persistence.ts`                                                                                                                                                                                                                                                                                                                                             | `STORAGE_KEY` `ToneForge.State.v13`; `deterministicReviewSession` field; session-aware approval writers; the v12 key joins `LEGACY_STORAGE_KEYS`         |
| `src/taskpane/pages/Dashboard.tsx`                                                                                                                                                                                                                                                                                                                                          | Remove the consistency merge; category summary; grouped review; Approve/Skip/Approve all/Undo; 8-point pre-apply validation; post-apply result rendering |
| `src/taskpane/components/PendingChanges.tsx`                                                                                                                                                                                                                                                                                                                                | Cards, sticky footer, `Preview N changes` → `Apply N with Track Changes`                                                                                 |
| `src/taskpane/components/ProfileEditor.tsx`                                                                                                                                                                                                                                                                                                                                 | New information architecture (T21); spelling-variant dropdown removed (D3)                                                                               |
| `src/taskpane/pages/Profile.tsx`, `src/taskpane/components/CoverageBanner.tsx`, `src/taskpane/components/ConsistencyReviewResults.tsx`, `src/taskpane/components/FindingCard.tsx`, `src/taskpane/components/FindingDetail.tsx`, `src/taskpane/components/FindingsList.tsx`, `src/taskpane/components/GovernancePolicySection.tsx`, `src/taskpane/troubleshooting/checks.ts` | Updated for the new contracts, the removed merge, and the new scope defaults                                                                             |
| `src/taskpane/taskpane.css`                                                                                                                                                                                                                                                                                                                                                 | Card, sticky-footer, coverage-summary and profile-IA styles; remove `.tf-pending-table*`                                                                 |
| `src/style/versioning.ts`                                                                                                                                                                                                                                                                                                                                                   | Add the new diff fields; remove `Spelling variant`                                                                                                       |
| `eslint.config.mjs`                                                                                                                                                                                                                                                                                                                                                         | New scopes (DD-4)                                                                                                                                        |

### 5.6 Docs

`docs/architecture.md`, `docs/decision-log.md` (ADR-0082 onward, plus a fix for the duplicate ADR-0080 number), `docs/project-state.md`, `ROADMAP.md`, `docs/ux-state-matrix.md`, `docs/CHANGELOG.md`, `docs/manual-verification.md` (host-unverified stages), and the 37 broken links in `ROADMAP.md`, `docs/project-state.md`, `docs/decision-log.md`, `plans/**`.

---

## 6. Ordered tasks, dependencies and affected files

Tasks are ordered; each is independently verifiable. `→` means "requires".

### Phase D0 — baseline

**T0. Baseline lock and golden fixtures.**
Record current outputs for typography, house style, formatting, planner and adapter; add `tests/fixtures/deterministicReview.ts` with the eleven integration fixtures named in spec §26.
Depends on: nothing. Files: `tests/fixtures/`, new `tests/unit/analysis/deterministic/goldenFixtures.test.ts`.

### Phase D1 — engine isolation

**T1. ESLint scopes for the new module.** _(DD-4)_
Depends on: nothing. Files: `eslint.config.mjs`.

**T2. `src/analysis/deterministic/` contracts, registry skeleton, engine.**
`contracts.ts` (full spec §3.1/§12/§13/§20 shapes), `ruleRegistry.ts` (interface + list, initially wrapping the existing engines), `deterministicReviewEngine.ts` (`runDeterministicReview`), `coverage.ts`.
Depends on: T1. Files: the four new modules.

**T3. Rewire callers; delete `consistencyChecker.ts`.**
`documentObserver`, `reformat/orchestrator`, `analysis/index.ts`, `Semantic.tsx` (if it referenced the report), and every test importing `checkConsistency`.
Depends on: T2. Files: [`documentObserver.ts`](../src/word/documentObserver.ts), [`orchestrator.ts`](../src/reformat/orchestrator.ts), [`analysis/index.ts`](../src/analysis/index.ts), `consistencyChecker.ts` **delete**, `tests/unit/analysis/consistencyChecker.test.ts` → `tests/unit/analysis/deterministicReviewEngine.test.ts`.

**T4. Remove the C1–C10 merge (D2).**
`Dashboard.tsx` drops `consistencyFindings`; `ConsistencyReviewResults.tsx` drops `Review in Findings`; `ConsistencyReview.tsx` props narrow; Troubleshooting coverage text updated.
Depends on: T3. Files: `Dashboard.tsx`, `ConsistencyReviewResults.tsx`, `ConsistencyReview.tsx`, `DebuggingPanel.tsx`, `checks.ts`, affected tests.

**T5. Rule registry and finding metadata (spec §11, §12).**
Registry gains the `analyze`/`plan` interface; `DeterministicFindingMetadata` added to `FindingSchema`; the **orphan-setting assertion** test enumerating every profile path and requiring a registered rule or an explicit metadata-only entry.
Depends on: T2, T3. Files: `ruleRegistry.ts`, `Finding.ts`, `src/rules/registry.ts` (decide: delete or thin delegate), new `tests/unit/analysis/deterministic/ruleRegistry.test.ts`.

### Phase D2 — profile schema

**T6. Deterministic profile schema (spec §4, §5, §6).**
`StyleProfile.ts` gains `language`, `typography` (extended), `formatting`, `structure`; `ResolvedPolicy` resolves them; `versioning.ts` diffs them; `migration` unchanged (additive defaults only).
Depends on: T5. Files: `StyleProfile.ts`, `ResolvedPolicy.ts`, `versioning.ts`, `ProfileRecord.ts` (unchanged, verify), `tests/unit/core/domain/StyleProfile.test.ts`, `tests/unit/core/state/migration-v13.test.ts`.

### Phase D3 — text rules

**T7. Terminology rules (spec §4.2 terminology).**
Depends on: T6. Files: `houseStyle.ts`, `houseStyle.test.ts`.

**T8. Capitalisation, abbreviations, dates, numbers, currency, units (spec §4.2).**
Depends on: T6, T7. Files: new `src/rules/language/*.ts` (capitalisation, abbreviations, dates, numbers, currency, units) + `houseStyle.ts` orchestration + tests.

**T9. Typography completion (spec §5).**
All nine listed settings plus whitespace normalisation, non-breaking spaces, slash/percentage/currency spacing. Every field proven wired by the T5 assertion.
Depends on: T6, T5. Files: `typography.ts`, `TypographyRulesSchema`, tests.

**T10. Remove generic spell-check duplication (D3, spec §4.3).**
Delete `SPELLING_VARIANT_TABLE`, `checkSpellingVariant`, the planner case, the `houseStyle.spellingVariant` governance source, the `ProfileEditor` dropdown, and the `versioning` diff entry. Keep the schema field as metadata (DD-9).
Depends on: T8, T9. Files: `houseStyle.ts`, `planner.ts`, `GovernanceProfile.ts`, `ProfileEditor.tsx`, `versioning.ts`, `houseStyle.test.ts`, `registry.test.ts`, `GovernancePolicySection.tsx`.

### Phase D4 — formatting

**T11. Acquisition for the new paragraph properties (spec §8.2, DD-3).**
Depends on: T6. Files: `analysisContext.ts`, `analysisAcquisition.ts`, `capabilityProbe.ts`, `formattingSnapshot.ts`, `formattingReader.ts`, `Dashboard.tsx` (`UNPROBED_CAPABILITIES`), `orchestrator.ts` (`FALLBACK_CAPABILITIES`), `analysisAcquisitionLoads.test.ts`, `capabilityProbe.test.ts`.

**T12. Profile-driven formatting checks (spec §7, §10).**
`findFormattingIssues({ snapshot, profile, capabilities, scope })`; body style, headings 1–9, direct-formatting rule (DD-7), lists, empty headings reclassified as `integrity`.
Depends on: T6, T11, T5. Files: `analyzer.ts`, `normalizer.ts` (removed or reduced), `wordStyles.ts`, `analyzer.test.ts`, `normalizer.test.ts`, `wordStyles.test.ts`.

### Phase D5 — planner

**T13. Planner completion (spec §14) and `deterministicChanges.ts` (DD-1).**
Text, style-first `applyStyle`, `setParagraphFormat` (including the new properties), `setCharacterFormat`, gated `resetCharacterFormatting` (DD-7), `setListLevel` only when proven, and §14.7 non-actionable findings.
Depends on: T12, T10, T4. Files: new `src/changes/deterministicChanges.ts`, `planner.ts`, `Change.ts`, `revisionAdapter.ts`, `preconditions.ts`, `conflictDetector.ts`, `approvalPolicy.ts`, plus `tests/unit/changes/deterministicChanges.test.ts` and a registry↔planner parity test.

### Phase D6 — review session and grouped approval

**T14. Review session (spec §16, D4, DD-5).**
Depends on: T13. Files: `migration.ts`, `persistence.ts`, `Finding.ts`, new `src/taskpane/reviewSession.ts`, `Dashboard.tsx`, `tests/unit/core/state/migration-v13.test.ts`, `persistence.test.ts`, new `reviewSession.test.ts`.

**T15. Grouped findings and batch approval (spec §13).**
Grouping by `safeBatchKey`; the seven batch-approval preconditions; `Approve all N` only where safe.
Depends on: T14, T5. Files: `contracts.ts`, `deterministicReviewEngine.ts`, new `ReviewGroupCard.tsx`, `FindingsList.tsx`, `Dashboard.tsx`, new `tests/unit/taskpane/reviewGroups.test.tsx`.

### Phase D7 — Pending Changes

**T16. Pending Changes cards (spec §17, §18).**
Depends on: T14, T15. Files: `PendingChanges.tsx`, new `PendingChangeCard.tsx`, `taskpane.css`, `ExportChangesButton.tsx`, `findingsAndPending.test.tsx`.

**T17. Approval semantics (spec §15).**
`Approve` / `Skip` / `Approve all` / `Undo decision` / `Go to text`; no state transition labelled `Apply` unless Word is mutated.
Depends on: T15. Files: `FindingDetail.tsx`, `FindingCard.tsx`, `FindingsList.tsx`, `reviewGate.ts`, `Dashboard.tsx`, `checks.ts`, `reviewGate.test.ts`, `reviewedPlan.test.ts`, `findingsAndPending.test.tsx`.

### Phase D8–D10 — lists, tables, headers/footers, sections

**T18. Lists (spec §8, §10.4).**
Depends on: T12, T13. Files: `formattingSnapshot.ts`, `analysisAcquisition.ts`, `analyzer.ts`, `deterministicChanges.ts`, tests.

**T19. Tables (spec §8.3, §10.5).**
`TableSnapshot` DTO, capability-gated acquisition, supported-property comparison, advisory-only where mutation is unsafe, `editable` flag.
Depends on: T11, T12, T13. Files: `formattingSnapshot.ts`, `analysisAcquisition.ts`, `capabilityProbe.ts`, `analyzer.ts`, `revisionAdapter.ts` (refuse unsupported table mutation), tests.

**T20. Headers/footers and sections (spec §8.4, §8.5).**
Scope-policy gated; only verified properties; everything else explicitly `unsupported`.
Depends on: T19. Files: as T19 plus `formattingReader.ts`, tests.

### Phase D11–D13 — truthfulness, verification, certification

**T21. Coverage truthfulness (spec §9, §20, D11).**
`DeterministicCoverage`; `mandatoryScopes`; the compliant/incomplete verdict; the `Review in findings` remaining-issues action.
Depends on: T14, T19, T20. Files: `DocumentSnapshot.ts`, `analysis/coverage.ts`, `analysis/deterministic/coverage.ts`, `CoverageBanner.tsx`, `Dashboard.tsx`, `orchestrator.ts`, `checks.ts`, tests.

**T22. Post-apply verification (spec §19, D12).**
Per-change success/failure; verified/unverified counts; refreshed findings; remaining non-compliance; the exact result block in §19.
Depends on: T13, T21. Files: `orchestrator.ts`, `formattingReader.ts`, `PendingChanges.tsx`, `Dashboard.tsx`, `reformatOrchestrator.test.ts`, `safeApply.test.ts`.

**T23. Deterministic Style and Review UI (spec §21, §22).**
Profile editor IA with progressive disclosure and unsupported markings; Deterministic Review header with profile/revision/coverage and category counts.
Depends on: T6, T12, T21. Files: `ProfileEditor.tsx`, `Profile.tsx`, `Dashboard.tsx`, `taskpane.css`, `ProfileEditor.test.tsx`, `Dashboard*.test.tsx`.

**T24. Auto-scan invariants (spec §23).**
Explicit tests that auto-scan updates findings, never approves, never applies, invalidates changed targets, and never claims whole-document compliance from a narrowed scan.
Depends on: T14, T21. Files: `DashboardAutoScan.test.tsx`, new assertions in `documentObserver.test.ts`.

**T25. Host certification (D13).**
Record every host-dependent stage as **host-unverified** in `docs/manual-verification.md` with a named procedure. No Word host is available in this environment, so this is documentation, not evidence.
Depends on: all. Files: `docs/manual-verification.md`, `docs/project-state.md`, `ROADMAP.md`.

**T26. Documentation, ADRs, and the pre-existing verification debt.**
ADRs from **ADR-0082**; fix the duplicate ADR-0080; fix the 37 broken links; update `architecture.md`, `project-state.md`, `ROADMAP.md`, `ux-state-matrix.md`, `CHANGELOG.md`.
Depends on: all. Files: §5.6.

**T27. Coverage floor.**
New modules land under `src/analysis/**`, `src/rules/**`, `src/formatting/**`, `src/changes/**` and are inside the `vitest.config.ts` coverage `include`, so they must be tested to hold the 80% functions floor (currently 79.97%).
Depends on: all. Files: tests only.

---

## 7. Test coverage plan

### Domain

- `StyleProfileSchema` parses every new section; old profiles (no new fields) parse unchanged; `metadataOnlyProfilePaths()` lists `houseStyle.spellingVariant`.
- State v12 → v13 migration yields an empty session block and preserves everything else; corrupt state still falls back to defaults.
- A `semantic`-kind profile cannot enter `runDeterministicReview` (throws).
- Every profile path maps to a registered rule or is metadata-only (the §11 assertion).

### Rules

- Each of the nine typography settings, both directions.
- Terminology: whole-word, case-sensitive, severity, longest-match, overlap suppression.
- Capitalisation: sentence case, proper nouns, required capitalisation, prohibited variants, heading case.
- Abbreviations: approved, preferred expansion, first-use, prohibited variants.
- Dates: each configured pattern, in and out of compliance.
- Numbers: decimal/thousands separators, percentage spacing, word threshold, negative numbers, ranges.
- Currency: symbol/code, spacing, separators, magnitude abbreviation.
- Units: spacing, approved symbols, capitalisation, consistent presentation.
- No generic spell-check findings remain; `program`→`programme` fires only as configured terminology.

### Formatting

- Body style compliance; each heading level 1–9; paragraph spacing; line spacing; alignment; indentation when supported and explicitly unsupported otherwise.
- Direct formatting does not erase legitimate emphasis (DD-7): a run-level bold yields a non-actionable finding with a reason, never a reset Change.
- Lists: level compared, not reset to 0.
- Tables: supported properties compared; unsupported reported as advisory with a coverage limitation.
- Unsupported-property coverage for every new capability flag set to `false`.

### Planning

- Every actionable finding maps to the correct Change type and carries an exact precondition.
- Paragraph ranges stay paragraph targets.
- No protected target is mutated.
- No Change is created for an unsupported correction.
- Batch grouping only for equivalent, conflict-free, unprotected, low-risk, semantically neutral groups.
- Registry↔planner parity (DD-1).

### Review state

- Approve adds only that occurrence; Skip excludes it; Undo reverses it; Approve-all affects only the safe equivalent group.
- Profile revision change invalidates decisions; changed target invalidates a decision; a document edit invalidates the session.
- No reviewed-set fallback can produce the full plan (the `reviewedPlan(...) ?? fullPlan` defect stays dead, pinned by a test).

### Word adapter

- Style application; paragraph formatting including the new properties; character formatting; reset safety; list level; tracked text replacement; stale rejection; conflict rejection; post-apply verification.

### Integration (spec §26 fixtures)

`program → programme`; em-dash convention; Heading 2 style; body paragraph spacing; list-level mismatch; mixed direct formatting; protected quotation; table formatting; unsupported scope; profile revision between scan and apply; document edit between preview and apply. Each as a fixture plus an end-to-end test through the engine → planner → gate → adapter.

### Component

`PendingChanges` cards and sticky footer; `ReviewGroupCard` approve-all; `ProfileEditor` progressive disclosure with unsupported markings; `CoverageBanner` incomplete/mandatory-blocked; `Dashboard` Approve/Skip/Approve all/Undo; `ConsistencyReviewResults` with the merge removed; `troubleshooting/checks.ts` remedy labels.

---

## 8. Acceptance criteria

### Spec §27 — the 24 gates

| #   | Gate                                                | How it is demonstrated                                                                                   |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Zero LLM calls                                      | ESLint scope on `analysis/deterministic/**`; a test that runs the engine with a throwing provider double |
| 2   | No semantic / C1–C10 findings                       | Report type has no field for them; a test feeds both in and asserts absence                              |
| 3   | Complete supported document-standard schema         | Schema test enumerating every §6 interface                                                               |
| 4   | Every editable field wired                          | The §11 orphan assertion                                                                                 |
| 5   | Every auto-correctable field wired to a safe Change | Registry↔planner parity test                                                                             |
| 6   | Unsupported fields explicit                         | `unsupported`/`unsupportedByHost` derived from real skips, not a constant                                |
| 7   | Spelling delegated to Word                          | No spell dictionary in `src/rules/**`; a test asserting `SPELLING_VARIANT_TABLE` is gone                 |
| 8   | Profile comparison, not generic assumptions         | Analyzer signature and tests                                                                             |
| 9   | Direct formatting not cleared                       | DD-7 test                                                                                                |
| 10  | Tables checked or excluded                          | Table findings and coverage                                                                              |
| 11  | Headers/footers/sections checked or excluded        | Same                                                                                                     |
| 12  | Coverage prevents false compliance                  | Mandatory-scope blocker test                                                                             |
| 13  | Grouped approval                                    | Group tests                                                                                              |
| 14  | Session binding                                     | Session invalidation tests                                                                               |
| 15  | Pending contains only approved changes              | Card-list test                                                                                           |
| 16  | No UI writes Word                                   | Existing ESLint block plus a test                                                                        |
| 17  | All writes through the adapter                      | Existing gates                                                                                           |
| 18  | Track Changes host-verified                         | **Host-unverified** — recorded in `manual-verification.md` (D1)                                          |
| 19  | Applied changes re-read and verified                | Post-apply verification tests                                                                            |
| 20  | Remaining deviations shown                          | Result-block test                                                                                        |
| 21  | Narrow-pane UI without horizontal tables            | No `.tf-pending-table` rule remains; card test                                                           |
| 22  | Auto-scan never approves or applies                 | T24 tests                                                                                                |
| 23  | Host gaps fail closed                               | Capability defaults false (DD-3)                                                                         |
| 24  | Full compliance needs a full scan                   | `isFullScan` + coverage test                                                                             |

### Additional criteria

- `npm run verify` is fully green, including the `docs` and `coverage` stages that fail at HEAD.
- No test asserts less than its name claims.
- Every architectural change has an ADR from ADR-0082 onward.
- `docs/project-state.md` and `ROADMAP.md` reflect the new state, with host-unverified items marked as such rather than passed.

### Validation commands (Windows-compatible)

```bat
npm run typecheck
npm run lint
npm run format
npm run secrets:scan
npm run docs:validate
npm run skills:validate
npm run test
npm run test:coverage
npm run build:check
npm run secrets:verify-build
npm run validate
npm run release:package
npm run release:package:check
npm run verify
```

`npm run release:check` stays blocked by the open human Word-host gate; that is expected and is not a regression.

---

## 9. Risks

| Risk                                                                                            | Likelihood   | Mitigation                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New Office.js families cannot be proven in any host                                             | Certain (D1) | `DD-3`: every new capability defaults to `false`; acquisition skips and reports `unsupported`; host certification recorded as an open procedure, never as a pass |
| Registry/planner split drifts (DD-1)                                                            | Medium       | Parity test asserting the two rule-id sets are identical                                                                                                         |
| Profile schema growth breaks `diffProfiles` and the profile-state budget                        | Medium       | Extend `diffFields` in T6; re-run `profileStateBudget.test.ts` and `profileMigration.test.ts`                                                                    |
| Renaming `Review` → `Approve` breaks assistive-tech flows and the troubleshooting remedy labels | Medium       | Update `checks.ts` remedy labels and pin them with the existing label test                                                                                       |
| Coverage floor regresses further as new modules land                                            | High         | T27 is an explicit task, not a by-product                                                                                                                        |
| `analysis/index.ts` barrel already reaches back into `word/` (cycle risk)                       | Medium       | Keep type-only imports for `AnalysisCapabilities`; do not add a runtime import from `word/` to the deterministic barrel                                          |
| `normalizeFormatting` and `deterministicChanges` become two mapping paths                       | Medium       | Remove `normalizer.ts` in T13 rather than leaving a delegate; update its test                                                                                    |
| The duplicate `ADR-0080` in the decision log makes new ADR references ambiguous                 | Certain      | Fix the numbering in T26 before adding ADR-0082                                                                                                                  |
| Auto-preview builds a plan the user has not seen approved                                       | Medium       | Existing reviewed-only projection stays the single narrowing; a test asserts the full plan is unreachable                                                        |

---

## 10. Follow-up work outside this pass

- D13 host certification on the Desktop/Web matrix.
- The Semantic Review, Indexed Consistency and LLM Settings specifications, which share `Finding`, `Persistence` and the Dashboard with this work.
