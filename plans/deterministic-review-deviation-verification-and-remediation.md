# Deterministic Review — Independent Verification and Remediation Plan

Audit under review: `systematic review/ToneForge_DETERMINISTIC_REVIEW_IMPLEMENTATION_DEVIATION_AUDIT.md`
Baseline spec: `plans/toneforge-deterministic-review-systematic-implementation.md`

This records the result of independently re-verifying every audit claim against the
current working tree. It does **not** adopt the audit's conclusions. Several claims are
confirmed, several are confirmed but worse than described, and several are inaccurate,
obsolete, or already implemented.

## Product-owner direction (supersedes the audit's §3 and T1)

The audit's recommendation to delete the legacy profile is **rejected**. The governing
decision is now:

- `houseStyle` and all of its subsets **stay**, and are a first-class part of the
  deterministic standard.
- The expanded `language.*` settings are **reinstated** as user-editable for
  Deterministic Review rather than being treated as a supersession of `houseStyle`.
- `houseStyle` is the **compact authoring surface**; `language.*` is the **rich
  authoring surface**. Both are deterministic-review inputs. Neither governs the other.
- **Terminology leaves the Governance Profile entirely.** On the governance policy page
  the _Preferred terms_, _Banned terms_ and _Required terms_ sections are deleted.
  Governance keeps **rules, protection, scope, editorial and everything else**. Wording
  is a deterministic-review standard, authored in the deterministic editor.

### Verification of the governance-terminology premise

The audit and the existing code both assume terminology is entangled with governance in
a way that requires resolution work. Independent tracing shows the opposite, and this
simplifies the change substantially:

- `TerminologyPolicySchema` (`src/core/domain/GovernanceProfile.ts:123`) carries
  `preferredTerms`, `bannedTerms`, `requiredTerms`, `locale`.
- Its **only** consumers are `resolveHouseStyle` and `resolveLanguage`
  (`src/core/domain/ResolvedPolicy.ts:250-251`), and both exist solely to feed
  deterministic rules.
- A repository-wide search for terminology references under `src/ai/` returns **zero**
  results. Terminology has **no** semantic consumer and is not part of the semantic
  pipeline. There is nothing to pull out of it.
- `requiredTerms` is read by nothing outside its own schema and editor — it is dead.
- `terminology.locale` is likewise unconsumed.
- `GOVERNANCE_RULE_SOURCES` (`GovernanceProfile.ts:327`) does carry the literal
  `"houseStyle.terminology"`, and `scopeForSource` maps a `houseStyle.` prefix to the
  `houseStyle` scope. That is a _rule binding_, not a wording store, and it must
  survive the extraction (ND-6).

So the resequencing is a **straight extraction**, not a disentanglement: delete the
terminology policy from the governance contract and its editor, reinstate the authoring
in the deterministic editor, and leave the rule-binding source intact.

### Persistence verification — terminology will survive a save/load round trip

Traced before planning, so the relocation does not silently drop stored terminology:

- `StyleProfileSchema` carries `language` (`StyleProfile.ts:638`) with
  `terminology`, `bannedTerms` and `legacyPreferredTerminology`, each defaulted, so a
  record written before these existed still parses.
- `ProfileRecordSchema` (`ProfileRecord.ts:59`) persists the whole `StyleProfileSchema`
  as `draft`, inside every `PublishedVersion` and every `ProfileRevision`. There is one
  write path and no side table, so terminology written into the profile is persisted and
  revisioned with everything else.
- `diffFields` (`versioning.ts:159`) already carries `{ label: "Language conventions",
path: ["language"] }`, so a terminology edit appears in the revision changelog. The
  legacy `houseStyle.preferredTerminology` / `houseStyle.bannedTerms` entries at lines
  136-137 must stay, because `houseStyle` is retained by owner decision.

**Consequence:** the extraction is safe with no data migration. New terminology
authored in the deterministic editor lands in `language.terminology` and
`language.bannedTerms`, is persisted through `ProfileRecord`, and is diffed by the
existing whole-section entry.

### The three sections being relocated — exact mapping

| Governance section (removed) | Deterministic destination                                                              | Consumed by             |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| Preferred terms              | `language.terminology[]` (TerminologyRule: source, replacement, severity, case, scope) | `findTerminologyIssues` |
| Banned terms                 | `language.bannedTerms[]`                                                               | `findTerminologyIssues` |
| Required terms               | **no equivalent exists** — see below                                                   | nothing                 |

`requiredTerms` is the one section with no destination in the current schema. **Resolved
by owner decision:** it is a _wording substitution_, part of the deterministic review
pipeline, persisted under the style profile. It is therefore relocated as a first-class
deterministic field rather than dropped — see D3 below.

---

## Owner decisions (2026-10-02)

These supersede the corresponding audit recommendations.

### D1 — Required terms are a wording substitution

`requiredTerms` becomes a deterministic-profile wording rule enforced by the pipeline
and saved with the profile, not a completeness check and not a governance concern.
Destination: a new deterministic field alongside `language.terminology`.

### D2 — Decimal and thousands separators are distinct settings with distinct owners

`typography.decimalSeparator` owns the decimal separator (`1.00`);
`typography.thousandsSeparator` owns the group separator (`1,000`). These are **not**
duplicates and are **not** collapsed.

The group separator is identified structurally: a separator preceded by one to three
digits from a non-digit boundary and followed by exactly three digits is a thousands
group mark. `1,000` is therefore a thousands separator; `1.00` is a decimal separator.
The finding is a **recommendation the user accepts or declines** — not a silent rewrite.

This resolves the audit's §5 complaint: it was right that two settings looked like
duplicates, but its conclusion (collapse them) was wrong. ND-1/ND-2 stand as real
defects and are fixed by the structural discriminator plus the accept/decline flow.

### D3 — `emDashSpacing` removed from the page and the wiring

The spacing control for em dashes is removed entirely: not exposed, not in the schema,
not in the registry, not in the planner. Interpretation stated explicitly so it can be
corrected if wrong: this removes the `typography.emDashSpacing` field
(`enum ["spaced","tight"]`), **not** the orthogonal `typography.emDash` representation
field. `enDashSpacing` is a separate setting and is retained.

The audit's §16 hazard — `emDash: "space"` silently deleting a meaningful punctuation
mark — is removed with it, since "space" was reachable only through the spacing control.

### D4 — `units.symbols` becomes a preferred rendering map

`metre -> m`, `kilo<gram> -> kg` and equivalents become enforced substitutions rather
than a recognition dictionary.

### D5 — Language dropdown that enforces a locale across the document

`language.locale` is reinstated from its current metadata-only state to a dropdown that
selects a document language and drives the conventions derived from it. This resolves
ND-5's `locale` half and removes `language.locale` from
`METADATA_ONLY_PROFILE_PATHS`.

### D6 — Batch approval is user opt-in, presented as an identified group

Never automatic. The UI presents a group of occurrences sharing one change, and the
user explicitly accepts that set.

**Verified — the policy is already correctly implemented in `src/taskpane/batchApproval.ts`:**
`approveGroup` is a pure function that returns decisions for the caller to record; it
never applies anything, and `skipGroup`/`undoGroup` are likewise explicit. All-or-nothing
is enforced, with a refusal reason. `safeBatchApproval` is computed per group at
grouping time and a refused group has no enabled control
(`batchApprovalLabel`, `deterministicReviewEngine.ts:129-177`).

**New defect (ND-7) — the whole module is unreachable.** A repository-wide search shows
`approveGroup`, `skipGroup`, `undoGroup` and `batchApprovalLabel` are referenced **only**
by `tests/unit/taskpane/batchApproval.test.ts`. No component imports them. The opt-in
batching D6 requires is fully built, fully tested, and never wired to the UI — so today
there is no batching control for the user to opt into at all.

D6 is therefore not a policy change. It is a wiring task: present each group as one
identified set of occurrences with an explicit accept/decline control, in the review UI.

---

## Verification summary

| Audit item                         | Verdict                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| §3 P0 dual profile model           | **Rejected as written** — both models are retained by owner decision; the real defect is that no single _section_ owns a given setting |
| §4 P0 registry test too weak       | **Confirmed** — and one declaration is actively false                                                                                  |
| §5 P0 number profile               | **Confirmed and materially worse** — plus an unlisted figure-corruption defect                                                         |
| §6 P0 currency partial             | **Confirmed**                                                                                                                          |
| §7 P1 abbreviations                | **Confirmed**                                                                                                                          |
| §8 P1 heading case                 | **Confirmed** — declaration is false                                                                                                   |
| §9 P1 unit symbols                 | **Confirmed** — decision required                                                                                                      |
| §10 P1 `supported` flag            | **Confirmed**                                                                                                                          |
| §11 P1 formatting corrections      | **Confirmed**                                                                                                                          |
| §12 P1 weak targets                | **Confirmed**                                                                                                                          |
| §13 P1 precondition gaps           | **Confirmed**                                                                                                                          |
| §14 P1 legacy categories           | **Confirmed**                                                                                                                          |
| §15 P1 heading hierarchy heuristic | **Confirmed**                                                                                                                          |
| §16 P1 em dash `space`             | **Confirmed**                                                                                                                          |
| §17 P1 coverage truthfulness       | **Partly obsolete** — machinery exists; the verdict surface does not                                                                   |
| §18 P2 editor incomplete           | **Confirmed and worse**                                                                                                                |
| §19 P2 not Fluent                  | **Confirmed**                                                                                                                          |
| §20 P2 duplicate editors           | **Confirmed**                                                                                                                          |
| §21 P2 batch approval              | **Requires reading grouping internals**                                                                                                |
| §22 P2 direct formatting           | **Confirmed, intentional**                                                                                                             |
| §23 P2 manual-action model         | **Requires UI verification**                                                                                                           |
| §24 P2 taxonomy                    | **Confirmed**                                                                                                                          |
| §25 D0–D13 ledger                  | **Largely accurate**; source comments stale, audit itself sound                                                                        |
| §27 behavioural test               | **Confirmed absent**                                                                                                                   |
| §28 fixtures                       | **Partly present** — needs extension                                                                                                   |

---

## Newly discovered defects not in the audit

### ND-1 (P0) — `typography.decimalSeparator` corrupts grouped figures

`checkDecimalSeparator` in `src/rules/typography.ts` matches `\d<sep>\d`. Under a
dot-decimal profile `wrongSeparator` is `,`, so `1,000` matches and the rule offers a
`replaceText` that rewrites the group mark.

`findNumberIssues` in `src/rules/language.ts` guards exactly this with `isGroupMark`,
and its comment describes the corruption it prevents. The typography rule has no such
guard, and both run under the same registry rule (`typography/numbers`).

Consequence: a default profile rewrites `1,000` to `1.000` — altering a figure.

### ND-2 (P0) — Overlapping numeric findings on one character

`typography/numbers` dispatches both the typography scanner and `findNumberIssues`. Both
report the same comma at the same offset under default settings, yielding two changes
over one range. The planner's conflict detector is entitled to refuse the whole plan, so
one defect can block unrelated corrections.

### ND-3 (P1) — `language.capitalisation.headingCase` claimed twice, read by neither

`src/analysis/deterministic/ruleRegistry.ts` declares `headingCase` in `profilePaths`
for both `language/legacyTitleCase` and `language/capitalisation`. Neither body reads it:
`findCapitalisationIssues` never references it, and the legacy rule reads
`policy.houseStyle.capitalization.titleCaseWords`.

`unwiredProfilePaths()` passes because the path is _claimed_ — the precise failure the
audit describes in §4.

### ND-9 (P0) — `report.groups` is computed by the engine and consumed by nothing

`runDeterministicReview` builds `groups: groupFindings(input.findings, protectedNodeIds)`
(`deterministicReviewEngine.ts:373`) and `DeterministicReviewReportSchema` carries it.
`groupFindings` computes the per-group `safeBatchApproval` verdict and
`batchRefusalReason` (`contracts.ts:145-165`).

No component under `src/taskpane/` reads `groups`. `Dashboard.tsx` renders
`FindingsList`, `FindingsToolbar` and `CoverageBanner` and nothing group-shaped; the
only `groups` identifier in the taskpane tree is in
`ConsistencyReviewResults.tsx:150`, which is the **semantic consistency** grouping
(`groupConsistencyIssues`) — an unrelated engine.

The wiring therefore breaks in **two** places, not one: the batch-approval module is
never imported (ND-7), and the group data it would consume is never rendered either
(ND-9). Both halves of the grouping feature are built, tested, and absent from the
running product.

This is the concrete form of audit §21's claim that "grouping correctly refuses many
unsafe property changes" — correct, and unreachable.

### ND-10 (P1) — Findings are listed one-per-row with no group context

`FindingsList` renders `FindingCard` per finding. A finding that is one member of a
twenty-occurrence group is presented identically to a standalone one: no count of how
many occurrences share its correction, no "this also appears 19 times", and no route to
accept the set.

D6 requires the group to be presented _as a group of entries with the same change_.
Today the user sees twenty rows and approves twenty times. This is a missing information
model more than a missing button: the grouping exists in the data and is discarded
before the screen.

### ND-11 (P1, verified-correct) — The single-occurrence path is fully wired

Traced and **correct**; recorded so Phase 5 is scoped as an addition rather than a
rebuild:

`FindingDetail` exposes Review / Approve / Skip / Undo decision / Ignore.
`Dashboard.tsx:1178` routes Approve through `reviewFinding(...)`, which enforces the
same conditions Apply enforces, so no button announces a change the adapter would
refuse. Approve is disabled-with-reason rather than absent for a finding the planner
cannot correct, and Skip stays available because declining is always permitted.

The path findings → `reviewGate` → ChangePlan → `prepareTrackedEditing` /
`applyReviewedPlan` → `revisionAdapter` is complete. The gap is confined to groups.

### ND-4 (P1) — Duplicate percentage and currency spacing rules

`typography.percentageSpacing` and `typography.currencySpacing` duplicate
`language.numbers.percentageSpacing` and `language.currency.symbolSpacing`. Both are
declared correctable. Same overlapping-range hazard as ND-2.

### ND-5 (P1) — Governance-owned terminology fields that nothing consumes

`requiredTerms` and `terminology.locale` are editable in
`GovernancePolicySection.tsx` and read by no code. Two settings in the _governance_
contract that govern nothing — the same defect class as §4, in the wrong record. Both
are removed with the rest of the terminology block rather than migrated.

### ND-7 (P0) — The entire batch-approval module is unreachable

`src/taskpane/batchApproval.ts` exports `approveGroup`, `skipGroup`, `undoGroup` and
`batchApprovalLabel`. A search across the repository finds importers in exactly one
place: `tests/unit/taskpane/batchApproval.test.ts`. No component under `src/taskpane/`
imports any of them.

The module is correct, pure and well tested — and dead. The user's D6 requirement
("batching must be user opt-in, presented as a group the user can accept") cannot be
satisfied because there is no control anywhere in the running add-in. Audit §21's
"grouping correctly refuses many unsafe property changes" describes logic the user
cannot reach.

### ND-8 (P1) — `language.locale` is inert but presented as an editable text input

`language.locale` is listed in `METADATA_ONLY_PROFILE_PATHS`, so the registry audit
passes while nothing reads it — yet `DeterministicStyleSections.tsx:308-315` renders it
as a free-text input labelled "Locale metadata (recorded, not enforced)". A user can
type a locale and it governs nothing. D5 converts it into a real, enforced dropdown,
which removes the defect rather than documenting it.

### ND-6 (P2) — `houseStyle.terminology` also names a governance rule binding

`GOVERNANCE_RULE_SOURCES` includes the literal `"houseStyle.terminology"`
(`GovernanceProfile.ts:327`) and `scopeForSource` maps any `houseStyle.` prefix to the
`houseStyle` scope. Deleting the terminology _policy_ does not delete this: a governance
rule still needs to bind to the terminology finding category to set its severity and
auto-fix. The source must be retained and re-pointed at whatever category the
deterministic terminology rule actually emits, so the extraction does not silently
unbind every terminology rule.

---

## UX and wiring audit — deterministic review

Requested as a separate pass. The full path was traced end to end:

```text
acquireAnalysisContext
  -> runDeterministicReview   (findings + groups + coverage)
  -> reformat orchestrator    (preview plan)
  -> Dashboard: CoverageBanner, FindingsList, FindingDetail
  -> Approve -> reviewFinding -> ChangePlan
  -> Pending changes -> prepareTrackedEditing -> applyReviewedPlan -> revisionAdapter
```

| Stage                             | Verdict                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Acquisition to findings           | **Wired.** `documentObserver` and the orchestrator both call the engine.                                                          |
| Coverage presentation             | **Wired.** `CoverageBanner` reads the deterministic projection and renders Unknown / Complete / Incomplete with blockers. Honest. |
| Finding list and detail           | **Wired.** One finding per row with Review/Approve/Skip/Undo/Ignore.                                                              |
| Approve through the change gate   | **Wired.** `reviewFinding` refuses before announcing a change the adapter would reject.                                           |
| Apply path                        | **Wired.** Single mutation path via the orchestrator; `revisionAdapter` is the sole writer.                                       |
| **Groups**                        | **Not rendered (ND-9).** Computed, carried in the schema, discarded before the screen.                                            |
| **Batch approval**                | **Not wired (ND-7).** Pure functions exist; no component imports them.                                                            |
| **Group context per finding**     | **Absent (ND-10).** No indication an occurrence belongs to a set.                                                                 |
| **Manual action for detect-only** | **Absent.** Audit §23 confirmed: no "Manual correction required / Go to item" affordance for table, page or header findings.      |
| **Verdict vocabulary**            | **Partial.** Three verdicts render today; audit §17 asks for four, and "Compliant within checked scope" is not expressible.       |

**Honest summary: the single-occurrence path is correct and complete; the grouped path
is entirely absent.** D6 requires building the presentation, but it sits on top of a
working approve-through-gate flow rather than replacing it.

---

## UX redesign — four owner requests

### UX-1 — "Go to item" for non-mutation findings

`FindingDetail` already renders a **Go to text** button
([`FindingDetail.tsx:216`](src/taskpane/components/FindingDetail.tsx:216)) wired through
`goToFinding` → `findingNavigation` → `navigateToFinding`, with a supersede guard so two
rapid clicks cannot start two host navigations. That control is present for every finding,
including detect-only ones.

So audit §23's gap is narrower than stated: the _navigation_ exists, but there is no
**manual-action signal**. A table, page or header finding renders with the same action row
as a correctable one, with Approve merely disabled — the reader cannot tell "ToneForge
will fix this" from "you must fix this yourself".

Change: add a distinct **Manual correction required** state for findings with
`correctionAvailable === false`. It keeps Go to item, omits Approve rather than disabling
it, states what the user must do, and never offers an inert Apply affordance. This is a
presentation change on the verified-correct path (ND-11), not a rewiring.

### UX-2 — Subgrouped presentation for D6

Yes — and the shape already exists. `report.groups` carries exactly what D6 needs:
`occurrenceGroupKey`, `safeBatchApproval`, `batchRefusalReason`. Only the presentation is
missing.

```text
Group header   typography.emDashSpacing  ·  14 occurrences  ·  same change
               [ Accept all 14 ]  [ Decline all ]        (explicit, opt-in)
  ├ occurrence 1   "  — and prolonged "        [ Go to ] [ Accept ]
  ├ occurrence 2   "  — further delay "       [ Go to ] [ Accept ]
  └ ...
```

- The **group** is the unit of batch decision; the **occurrence** is the unit of
  navigation and single accept.
- Accept-all is disabled carrying the engine's own `batchRefusalReason` when
  `safeBatchApproval` is false — never silently hidden, and never applied automatically.
- A group of one renders as a plain occurrence row, so the common case stays slim.
- Groups collapse to a summary line by default and expand on demand, which also serves
  UX-3.

### UX-3a — Two card styles, not one (owner correction)

Owner is right that a single slim card would discard information the Consistency Review
genuinely needs.

What differs between the two surfaces:

- **Source.** Always "Deterministic / Document scan" on one side, always "AI" on the
  other. Constant either way, so it earns its place in neither header.
- **Risk.** `none` for essentially every deterministic finding; genuinely meaningful for
  a contradiction.
- **Severity.** Rule-derived warning/error on one side; confidence-derived on the other,
  where the confidence value itself is information.
- **Occurrence count and group membership.** Central to D6 on the deterministic side;
  not applicable to a cross-report finding.
- **Evidence shape.** One span rendered as Actual then Expected, versus two statements
  compared through `EvidenceSplit`.

Design: **a shared shell with two densities**, which keeps the module's single-format
principle intact rather than abandoning it.

- `FindingDetail` keeps the shared structure, landmark handling and accessibility
  behaviour — the reason it was extracted in the first place.
- A `variant` prop selects the density: `deterministic` renders the slim summary line,
  occurrence count and group controls; `consistency` renders the fuller header with
  confidence, risk and the comparison panel.
- Neither variant invents its own action vocabulary; the same Go to / Accept / Decline
  set is used on both, so a reviewer learns it once.
- The variant is passed by the caller, never inferred from `finding.source` inside the
  component, so the two surfaces cannot drift by accident.

This resolves the tension the file header warns about: one format so the surfaces cannot
diverge, but no flattening of a genuinely richer finding into a sparse one.

### UX-3 — Slimmer finding cards

The current card prints six header tokens per row
([`FindingDetail.tsx:171-174`](src/taskpane/components/FindingDetail.tsx:171)): source,
"Document scan", severity, risk, status. For a typography substitution, source and
"Document scan" are constant noise, and risk is `"none"` for nearly every deterministic
finding.

- Default to a **one-line summary**: category · message · occurrence count · status dot.
- Move source, risk and the raw range into an expandable detail region.
- Replace `Location: 1420–1423 (character)` with a human phrase ("paragraph 42") — a raw
  offset is not actionable and reads as a rendering fault.
- Render Actual/Expected as an inline before→after rather than two separate paragraphs.
- Status as a coloured dot plus accessible text, not a sentence in the header.
- Group membership and count join the summary line, which is what makes UX-2 legible.

Presentation only, and applied to the `deterministic` variant alone — see UX-3a.

### UX-4 — Deterministic style page: collapsible, uniform, Fluent

Current state confirmed: `DeterministicStyleSections` renders **native** `<input>`,
`<select>` and checkbox controls (lines 90, 112, 145, 294, 310, 344, 396, 428, 448,
487-505) inside hand-built `<fieldset>`/`<legend>` blocks, and `ProfileSection` is a
bespoke frame rather than a Fluent `Accordion`. Audit §19 confirmed this.

- Migrate every control to Fluent `TextField`, `Dropdown`, `Switch`, `SpinButton`,
  `Textarea`, `Checkbox` with ToneForge tokens.
- Replace the bespoke `ProfileSection` frame with Fluent `Accordion`, so collapse,
  keyboard and focus behaviour come from the component rather than being re-implemented.
- Sub-divide the two largest sections so the page is not four long scroll regions:
  Language splits into Terminology / Capitalisation / Abbreviations / Numbers / Dates /
  Currency / Units; Typography into Dashes / Quotes / Whitespace / Spacing. Formatting
  already splits by standard block and gains section-level collapse.
- **Preserve the per-section host-capability marking.** The file header explains why it is
  per-section, and that is a correctness feature, not styling — a Fluent `Badge` carries
  it.

### UX-4a — Theme defect: confirmed, and already diagnosed in the source

The owner reports fields rendering **white on the dark theme**. Confirmed. The stylesheet
already documents the cause at `taskpane.css:273-289`, naming this exact symptom:
"Dropdowns and TextFields on the profile pages rendering light-on-dark while the
surrounding surface followed the theme."

The `:not([class*="ms-"])` guard was an attempted fix and is fragile on two counts:

1. It depends on Fluent's internal `ms-` class prefix, which is not a public contract and
   changes between versions.
2. It cannot cover Fluent components whose root is not an `<input>` — a Dropdown's button
   and popup, Switch internals, SpinButton.

A second, separate contribution: the theme is applied twice, to the document element
**and** to an inner wrapper (`theme.tsx:85-93`), while the Fluent theme comes from
`createDefaultTheme(isDark)`. Two themes exist and are selected by reference, so a
mismatch between the CSS-variable theme and the Fluent theme object is possible — and the
`ms-` prefix guard is exactly the specificity workaround that lets the two disagree
silently.

Resolution, in order:

1. Migrate the editor controls to Fluent (UX-4) so the theme object paints them, removing
   native inputs from the equation.
2. Replace the `ms-` prefix guard with a stable, ToneForge-owned class on our own
   controls, so native-control rules can never reach a Fluent component regardless of
   Fluent's internal naming.
3. Add a test asserting a ToneForge field in the dark theme carries no hard-coded light
   background. Assert the rule, not a computed style — jsdom computes no styles.
4. **Record the residual limit honestly:** jsdom cannot verify Word's actual rendering.
   The CSS comment already says so, and the visual check stays a manual item in
   `docs/manual-verification.md`. It must not be reported as fixed by an automated test.

## Target architecture

```text
GovernanceProfile
  protection, scope (mandatory scopes), editable-area rules
  — no terminology —

Deterministic profile
  houseStyle   -> compact authoring surface (terminology map, sentence case, title words)
  language.*   -> rich authoring surface  (term rules, banned terms, caps, abbreviations,
                                          numbers, dates, currency, units)
  typography   -> dashes, quotes, ellipsis, whitespace, punctuation
  formatting   -> style standards per paragraph kind
  structure    -> hierarchy and integrity policy

ResolvedPolicy
  merges profile sections with governance *protection* only
```

The invariant that replaces "one canonical model": **for any given document behaviour,
exactly one section owns it, and the registry proves it behaviourally.** Two authoring
surfaces for the same behaviour is the defect; two surfaces for _different_ behaviours
is the design.

---

## Sequencing

Each phase leaves the tree green. Order is dependency-driven: ownership must be settled
before rules are rewired onto it.

### Phase 0 — Baseline

Establish that typecheck, lint and the existing deterministic suites are green before
any change, so every later failure is attributable.

### Phase 1 — Terminology extraction from governance

1. Delete `TerminologyPolicySchema` and the `terminology` key from
   `GovernanceProfileSchema`. Governance keeps rules, protection, scope and editorial.
2. Delete the Preferred terms / Banned terms / Required terms sections from
   `GovernancePolicySection.tsx`, including their draft state, `policyProblem`
   validation and patch handling.
3. Repoint `resolveHouseStyle` and `resolveLanguage` so they no longer merge governance
   wording into the profile; the profile's own sections become authoritative.
4. Reinstate preferred- and banned-terminology authoring in the deterministic editor,
   writing `language.terminology` and `language.bannedTerms` so nothing is lost.
5. Retain and re-point the `houseStyle.terminology` rule binding (ND-6) so governance
   rules stay bound to the terminology findings they govern.
6. Drop `houseStyle` from the governance `scope` enum only if no remaining source uses it.
7. Record the ADR: governance owns protection and editability, the profile owns wording.

### Phase 2 — One owner per behaviour (numbers first, ND-1/ND-2/ND-4)

6. Assign `language.numbers` sole ownership of separators, percentage spacing,
   percentage/currency spacing, ranges, thresholds, negatives.
7. Remove duplicate ownership from `typography`; keep typography for dashes, quotes,
   ellipsis, whitespace, slash/bracket/hyphen spacing.
8. Guard `checkDecimalSeparator` against group marks (ND-1).
9. Wire `language.numbers.thousandsSeparator` and `negativeNumber`.
10. Assert no two rules emit overlapping findings on one character.

### Phase 3 — Close inert language fields

11. `abbreviations.preferredExpanded`.
12. `capitalisation.headingCase` implemented for real; delete the false declaration (ND-3).
13. Currency separators; classify `magnitude` honestly as metadata-only.
14. Decide and implement `units.symbols` as a preferred-rendering map.

### Phase 4 — Formatting, targets, planner hardening

15. Replace user-controlled `supported` with requested/enabled, derived against
    `WordCapabilities`.
16. Structural `FindingTarget` kinds (table, header, footer, section, list, text).
17. Fix `sectionRange(table.index)`; give header/footer real targets.
18. Extend `FormattingStateSchema` with acquired indentation, keep-with-next,
    keep-lines, page-break-before.
19. Remove `headingStyle()` message parsing; heading hierarchy report-only.
20. Remove `emDash: "space"` as an automatic correction.
21. Converge planner categories on the canonical taxonomy.

### Phase 5 — Product truthfulness

22. Coverage verdict states.
23. Manual-action affordance for detect-only table/page/header findings.

### Phase 6 — Editor

24. Reinstate full `language.*` reachability alongside `houseStyle`, no duplication.
25. Fluent UI migration with ToneForge tokens.
26. Remove the duplicated flat panels.

### Phase 7 — Gate and evidence

27. `profileBehaviour.test.ts` as the real implementation gate.
28. Construction-report acceptance fixtures.
29. Second-pass review: dead code, duplicated logic, weak assertions, stale docs.
30. `npm run verify`; honest reporting.
31. Synchronise the audit document with explicit per-item dispositions.
32. ADRs and ROADMAP/docs status.

### Out of scope — genuine external blocker

Word host certification (audit §25 D13, T11). No automated run can close it. It stays
recorded as pending in `docs/manual-verification.md` and must never be reported as
passed.

## Execution log

### Phase 1 — COMPLETE

Verification after the phase: `lint` 0 warnings, `typecheck` clean,
**2459 tests / 179 files passing**.

What was changed:

- `TerminologyPolicySchema` and the `terminology` key deleted from
  `GovernanceProfileSchema`; the three editors removed from
  `GovernancePolicySection.tsx`.
- `resolveHouseStyle` / `resolveLanguage` lost their governance parameter and no
  longer import `TerminologyRuleSchema` at all.
- `language.requiredTerms` added to the deterministic profile, with a **new rule**:
  `findTerminologyIssues` emits `language.terminology.missing` at a zero-length
  range, registered in `ruleRegistry.ts` and marked report-only in
  `deterministicChanges.ts`. The field was previously editable, type-checked,
  round-tripped and inert.
- A per-rule editor (`TerminologyRow`) in `DeterministicStyleSections.tsx` exposing
  source, replacement, `wholeWord`, `caseSensitive` and `severity` — chosen over the
  `term: replacement` textarea because a line format can express a substitution and
  nothing else, and writing it back would silently reset the other four fields.
- `tryPatchLanguage` uses `safeParse` so a half-typed term reports an inline message
  instead of throwing inside a keystroke and unmounting the pane.
- New tests: `tests/unit/rules/requiredTerms.test.ts` (13),
  `tests/unit/core/state/terminologyPersistence.test.ts` (5),
  `DeterministicStyleSections.test.tsx` rewritten (26, from 23).
- ADR-0110 records the split.

Findings recorded rather than absorbed:

- **ND-6 is not a defect.** `GOVERNANCE_RULE_SOURCES` binds **finding categories**,
  not profile fields — `ruleForSource` is called from `approvalPolicy.ts` with
  `finding.category`. So `houseStyle.terminology` there is correct as written and
  was **left unchanged**.
- **ND-12 (new).** The preferred-term finding carries category
  `houseStyle.terminology` while its `profilePath` is `language.terminology.<id>`.
  The category now contradicts the field that produced it. Deferred to the Phase 4
  taxonomy convergence, which has the planner and registry blast radius.
- **ND-13 (new, pre-existing).** `houseStyle.preferredTerminology` /
  `houseStyle.bannedTerms` are a **second live terminology engine** emitting the
  same two categories as `language.terminology` / `language.bannedTerms`. One
  document can therefore produce two overlapping findings for one misspelling, from
  two records. This was true before Phase 1 and was invisible because neither was
  authorable where a user would look twice; the new editor makes it visible.
  Not fixed here — retiring the flat record touches `ProfileEditor`,
  `resolveHouseStyle`, `versioning.ts`, the planner's quoted-replacement parser and
  seven test files. It is Phase 6 work and is stated in the component test's comment
  rather than asserted away.

## CORRECTION — ND-13 was misdiagnosed, and the correction matters more than the fix

The account above is **wrong**. `ruleRegistry.ts` calls `findHouseStyleIssues`
through `selectCategories(..., ["houseStyle.capitalization.titleCase"])`, so
**both** house-style terminology checks were filtered out of every report. The
fields were not a duplicate engine — they were **inert**: authored, validated,
persisted, and able to produce no finding at all. That is the "it saved but ignored
my entry" failure in its purest form, and it is worse than a duplicate, because a
duplicate announces itself in the findings list.

Root cause of the invisibility: `PROFILE_FIELD_PATHS` declared **no** `houseStyle`
field at all. The one mechanism built to catch an unreachable profile field was not
looking at that section, so `unwiredProfilePaths()` was green while two user-facing
fields governed nothing.

### Phase 1b — Terminology merge (ND-13), COMPLETE

Verification: `lint` 0 warnings, `typecheck` clean, **2455 tests / 179 files**.

- `checkPreferredTerminology` / `checkBannedTerms` deleted from `houseStyle.ts`,
  along with `overlaps`, `boundedTermPattern` and `TerminologyCandidate`.
- `HouseStyleSchema.preferredTerminology` / `.bannedTerms` deleted. Zod strips them
  on load, which is asserted rather than assumed.
- `ProfileEditor` now writes `language.*`. `foldTerminology` keeps a matched rule's
  `id`, `caseSensitive`, `wholeWord`, `severity` and `scope`, so editing the compact
  `term: replacement` form cannot silently downgrade a mandatory term set in the
  per-rule editor. That merge is why the capability was moved rather than deleted.
- `versioning.ts` diff paths moved to `language.terminology` / `language.bannedTerms`,
  so a terminology edit still appears in the changelog.
- `REVIEW_PROFILE` seeded through `language.terminology`. The corpus previously
  passed **because** `findTerminologyIssues` also reads
  `language.legacyPreferredTerminology` — so the fixture satisfied the engine through
  a neighbouring field while the field under test did nothing. That is why
  `deterministicReviewEngine.test.ts`'s "uses a profile the corpus can actually run"
  passed straight over ND-13.
- `PROFILE_FIELD_PATHS` now declares `houseStyle.capitalization.titleCaseWords`, and
  the legacy title-case rule's `profilePaths` names that field instead of falsely
  claiming `language.capitalisation.headingCase`, which it never read.
- `houseStyle.test.ts` rewritten (13 tests), including a regression guard that the
  exact text a user would have typed produces nothing here. Two of my first drafts
  asserted wrong offsets; the surviving Unicode cases now assert what the rule means
  — a title-case check tests the word's _first_ casing, and JS counts a surrogate
  pair as two units.

### Phase 3a — D4 (units symbols) and D5 (locale), COMPLETE

Verification: `lint` 0 warnings, `typecheck` clean, **2493 tests / 181 files**.
ADR-0111 records the shared principle.

**D4 — `units.symbols` reads its keys.** The record is named-unit → preferred symbol
(`kilogram` → `kg`). Only the _values_ were read, forming the word list the spacing
check matched; the keys existed solely to word a casing message. A document writing
"5 kilogram" against a house saying "5 kg" produced no finding. New
`language.unit.preferredSymbol` category, correctable on the grounds that a name and
its symbol denote the same quantity, with a `safeBatchKey` so one "Approve all" can
never span two different corrections. Guards: a name that is its own symbol
contributes nothing; multi-word names match whole; a symbol written in the wrong case
is the capitalisation check's alone, so the two never overlap.

**D5 — `locale` is enforced.** It was a free string nothing read, listed in
`METADATA_ONLY_PROFILE_PATHS`, presented as an editable text box. It now supplies the
default numeric date shape when no preferred format is declared, and is a closed enum
so a typo cannot parse cleanly and match nothing. `METADATA_ONLY_PROFILE_PATHS` is
now **empty** — an empty list is a claim that every profile field is read, and it is
checkable.

The prerequisite nobody had noticed: `describeDateShape` could not tell `dmy` from
`mdy` — both were just `"numeric"` — so a locale supplying an `id` could never match.
It now returns `dmy` when the first field exceeds 12, `mdy` when the second does, and
`numeric` when both readings are valid. That boundary is what keeps the locale honest:
it silences the unambiguous wrong-order case and leaves `05/03/2026` to the existing
`requireUnambiguous` refusal, because resolving an ambiguous date by convention would
be the tool deciding which day the author meant.

**A behaviour change, recorded rather than shipped quietly.** A profile with no
declared date format now reports day-first dates under the default `en-US`, where it
previously reported nothing. Two existing tests encoded the old contract — "no
preference declared is not a preference for the shape already there" — and were
rewritten with the old reasoning preserved in a comment, because the sentence was
correct while `locale` governed nothing and is no longer.

The registry guard caught the last omission: `unwiredProfilePaths()` failed until
`language.locale` was added to a rule's `profilePaths`, even though `findDateIssues`
already read it. A field counts as wired only when a rule with a body _claims_ it —
stricter than "something reads it", and correctly so.

Three of my own test bugs here, recorded because each pointed at a real ambiguity:
reading `safeBatchKey` off the finding root rather than `finding.deterministic`;
asserting `metre → m` was a case-only difference when it is a genuine rendering
preference; and choosing a text for the precedence test that the _declared_ format
correctly rejected.

### Phase 3b — `preferredExpanded` and the missing language editors, COMPLETE

#### What the next Phase 3 item uncovered

`language.abbreviations.preferredExpanded` was declared "long form → the short
form to use in running text", listed in `PROFILE_FIELD_PATHS`, and named in
`language/abbreviations`'s `profilePaths`. The registry therefore reported it as
wired. `findAbbreviationIssues` read `approved`, `requireFirstUseExpansion` and
`prohibitedVariants` and never this one — the same defect class as ND-13, under a
different field name.

Implementing it required answering a prior question: _where does a user set it?_
**Nowhere.** The same turned out to be true of every other language subsection:

- **Abbreviations** — all four fields (`approved`, `preferredExpanded`,
  `requireFirstUseExpansion`, `prohibitedVariants`) had no control.
- **Numbers** — `percentageSpacing`, `numberWordThreshold`, `negativeNumber`,
  `rangeStyle`: no control.
- **Dates** — `formats` and `requireUnambiguous`: no control.
- **Currency** — all five fields: no control.
- **Units** — `valueSpacing`, `capitalisation`, `symbols`: no control.

The section carried a sentence saying these were "set in the House style panel".
It was false in four directions, and the House style panel holds terminology,
banned terms, title-case words and one sentence-case toggle.

**This is a distinct defect from everything else in this audit, and the
distinction matters.** `unwiredProfilePaths()` cannot see it. The guard reads
`profilePaths` — a declaration by the rule about what it reads — and it has no
view of the editor. So "a rule reads a field" and "a user can set a field" are
indistinguishable to it. D4 and D5 made `units.symbols` and `language.locale`
_readable_ in the previous step; had they shipped without these editors, they
would have been enforced in the registry and still unreachable in the product.

Recorded as ADR-0112.

#### What was done

- **`language.abbreviation.preferredExpanded` implemented.** A long form written
  where the house prefers the short one, correctable (the two forms denote the
  same thing), with a `safeBatchKey` because every occurrence wants the same edit.
- **Read together with `requireFirstUseExpansion`.** A house may legitimately want
  the long form once and the short form after. A long form preceding the first
  short form is the expansion the profile demanded; reporting it would ask the
  user to delete what the other rule just told them to add. Where a form is also
  in `prohibitedVariants`, the prohibited rule wins the claim — two owners for one
  character is ND-2.
- **`DATE_SHAPE_IDS` / `DATE_SHAPE_LABELS` moved into the domain** and shared by
  the rule and the editor, so an author cannot type a shape id no rule will match.
  `unrecognised` is not authorable. `describeShape` now derives its names from
  the same table rather than keeping a private copy.
- **Every language field has a control**, in grouped fieldsets: Capitalisation,
  Abbreviations, Numbers, Dates, Currency, Units.
- **A tri-state control for the tri-state settings.** `requireFirstUseExpansion`
  offers `Not set / Required / Not required`. "Not set" removes the key rather
  than writing `undefined`.
- **Exactly one date format may be `preferred`.** The rule takes the first, so two
  would make the answer depend on array order the user never sees.
- **Blank means "never", not zero,** for `numberWordThreshold`.
- **The false sentence is gone**, replaced by one that is true of every control.
- **`parseTerminology` takes the vocabulary it reports in** (`TermNouns`), so an
  abbreviation field says `Preferred short form line 1 must use "long form: short
form"`. Default wording is unchanged.

#### Two accessibility defects fixed along the way

- **The banned-terms textarea had no accessible name at all.** A heading above it
  is a visual grouping, not a label. Now wired with `aria-labelledby`.
- **Every new field folds its hint into the accessible name.** Controls now use
  `htmlFor`/`id` with the hint in `aria-describedby`, so the name is the label
  and the hint is a description.

#### A test that was not testing what it said

Making the two accessible names exact surfaced a `ProfileEditor` test that matched
the banned-terms control by prefix _and_ by display value. Both the deterministic
section and the House style form write `language.bannedTerms` (ADR-0110) and both
held "utilize", so the matcher resolved to whichever the DOM listed last — the
test was editing one control and asserting on another. Rewritten to name the
control exactly.

The same reasoning rewrote the "three vocabularies" assertion: it counted
`<textarea>` elements page-wide, and had begun asserting about the newly-added
language editors rather than about the vocabularies it was written for.

#### Verification

- `npm run typecheck` — clean.
- `npm run lint` — 0 warnings.
- `npm test` — **2525 tests / 182 files passing** (was 2493 / 181).

New tests: `tests/unit/rules/preferredExpanded.test.ts` (17).
Extended: `tests/unit/taskpane/components/DeterministicStyleSections.test.tsx`
(+16, including a `describe` block asserting every language convention has a
control that writes the field the rule reads).

#### Still open in Phase 3

`language.capitalisation.headingCase` remains the one declared-and-unread field:
`language/capitalisation` still names it in `profilePaths` and
`findCapitalisationIssues` does not read it. It is the remaining false claim of
the ND-3 family, and it is **not** given a control here — a dropdown for a
setting nothing reads is the defect this log has spent four phases removing.

### Phase 3c — `headingCase`, the last false claim of ND-3, COMPLETE

#### The defect

`language.capitalisation.headingCase` was declared in the schema, listed in
`PROFILE_FIELD_PATHS`, and named in `language/capitalisation`'s `profilePaths` —
and read by nothing. The registry reported it as wired. This is the same failure
mode as ND-13 (`houseStyle` terminology) and as `preferredExpanded`, and it is
the third and last instance of it in the language profile.

It was **not** given a control in Phase 3b, on purpose: a dropdown for a setting
nothing reads is exactly the defect this log has spent four phases removing. The
rule had to exist first.

#### What was done

- **`checkHeadingCase` implemented** in `src/rules/language.ts`. A heading is a
  paragraph whose style name matches `^(heading|title|subtitle)\b`, reconstructed
  from `styleByStart` as the gaps between consecutive paragraph keys — the same
  reconstruction `styleAt` already relies on.
- **Three conventions, three correction stories.** `upper` raises every lower-case
  letter; `title` caps significant words; `sentence` reports capitalised words
  past the first. The first two are correctable — raising or capping one letter
  inside a word cannot change which word it is — and the third is not, because
  lower-casing a word the profile has not listed as a proper noun may destroy one.
- **Acronyms are never reported.** Flagging `IBM` in a heading would make the rule
  cry wolf on every document that names a product, and a rule users stop reading is
  worse than no rule.
- **Minor words, proper nouns and the word after a colon are excused.** A house can
  overrule the minor-word list by listing the word in `properNouns`, which is
  checked first. Exactly one word after a colon is excused — excursing the rest
  would let a heading in any case at all hide behind one colon.
- **The category registered and made correctable**, and the editor gained the
  tri-state dropdown.
- **`language/capitalisation`'s `profilePaths` comment rewritten** to say what it
  used to be: a claim the rule made about a field it never read.

#### A limitation stated rather than discovered

The style-name match is English. A localized Word reports `Überschrift 1` where an
English one says `Heading 1`, so **the rule is silent on a non-English host**. That
is the safe direction — a heading-case check that cannot tell a heading from a body
paragraph must not guess — and it is stated in the code and in the editor's own
hint, so a German user learns it from the product rather than from a bug report.

#### Verification

- `npm run typecheck` — clean.
- `npm run lint` — 0 warnings.
- `npm test` — **2554 tests / 183 files passing** (was 2525 / 182).

New tests: `tests/unit/rules/headingCase.test.ts` (29), covering the unset state,
body paragraphs, an absent style map, each of the three conventions, per-occurrence
offsets, style recognition, absolute offsets across paragraphs, and the two
end-to-end registrations.

#### Four of the seven Phase 3 items are now closed

- `abbreviations.preferredExpanded` — done (Phase 3b)
- `capitalisation.headingCase` — done (this phase)
- Every language field reachable from a control — done (Phase 3b, ADR-0112)

Still open: currency separators and `magnitude`, and `numbers.negativeNumber`.

### Phase 3d — `currency.magnitude`, and a course correction, COMPLETE

#### What was attempted, and why it was withdrawn

The plan item read "implement currency thousands/decimal separators; classify
magnitude as metadata-only". The first half was implemented, and it was wrong.

`typography` already owns both separators **document-wide** — that is owner
decision D2, and it was made precisely because the number profile's copies of
those two fields produced two findings at one offset and a planner entitled to
refuse the whole plan. Adding a _currency-scoped_ owner for the same characters
reproduces ND-2 exactly: the comma in `£1,000` reported once by `typography` and
once by the currency rule, two changes over one offset.

A second owner for a character is not a new feature. It is the same defect this
whole audit exists to remove, so the change was withdrawn rather than shipped:

- **`currency.thousandsSeparator` and `currency.decimalSeparator` are removed from
  the schema**, for the reason `NumberProfileSchema` has none, and the comment
  says so.
- **The two editor controls are removed**, with a comment pointing at Typography.
- **The rule keeps no separator check.** The code comment records that the absence
  is deliberate, so a later reader does not "fix" it back.

What the plan item got right is its second half. `magnitude` was the genuinely
inert field, and it is now read.

#### `currency.magnitude` implemented

- An amount is a digit run written immediately after a currency symbol or one of
  the ten codes, allowing the gap the spacing rule also measures. A figure with no
  marker before it is not a currency amount, so `4,200,000` in prose and `5 metre`
  never reach the check.
- **`full` house + abbreviated amount** → reported. **Abbreviating house + an
  amount of four digits or more** → reported.
- **Report-only, and that is the design.** Abbreviating `4,200,000` as `4.2m`
  replaces the figure with a rounded one; expanding `4.2m` needs the tool to
  decide which magnitude the author meant. Listed in
  `DETERMINISTIC_REPORTED_ONLY_CATEGORIES`, which the registry's own gate requires
  for any category a `correctable` rule emits.
- A three-digit amount is left alone even under an abbreviating house: `£900` is
  not a large amount, and deciding what "large" means is the house's call.

#### One bug the tests caught, worth recording

The first implementation rejected any run that did not end in a digit, to avoid
treating a sentence's full stop as part of an amount. But the run pattern
_deliberately_ includes `.` and `,` because they appear inside an amount — so
`£4,200,000.` ended in a full stop and the **entire rule was silent on every
amount at the end of a sentence**. Trailing separators are now trimmed instead of
rejecting the run. A guard that is right in principle and wrong in practice is
worse than no guard, and only a test with a trailing full stop would have found it.

#### Verification

- `npm run typecheck` — clean.
- `npm run lint` — 0 warnings.
- `npm test` — **2568 tests / 184 files passing** (was 2554 / 183).

New tests: `tests/unit/rules/currencyMagnitude.test.ts` (13).
Changed: the currency editor test now asserts the two controls are _absent_, with
the ND-2 reason attached, so nobody re-adds them.

#### Phase 3 status

- `abbreviations.preferredExpanded` — done (Phase 3b)
- `capitalisation.headingCase` — done (Phase 3c)
- `currency.magnitude` — done (this phase); currency separators removed as a
  duplicate owner rather than implemented
- Every language field reachable from a control — done (Phase 3b, ADR-0112)

Still open: `numbers.negativeNumber`.

### Phase 3e — `numbers.negativeNumber`, COMPLETE — Phase 3 closed

#### The last declared-but-unread field in the language profile

`negativeNumber` is "how a negative number is written": `minus` or `parenthesis`.
Declared in the schema, listed in `PROFILE_FIELD_PATHS`, named in
`typography/numbers`'s `profilePaths` — and read by nothing. The fifth and last
instance of the defect class this log has spent four phases removing.

Implemented, with both directions correctable: `(5)` and `-5` are the same number
written two ways, and neither correction changes the value or the author's prose.
That is what distinguishes it from the range rule's `to` form, which changes
register and is therefore reported only.

#### Two boundaries the tests forced, both in the safe direction

**A hyphen that continues a word is not a negative.** The first pattern excluded
only digit-flanked hyphens, so `clause AB-12` was reported as `-12`. The sign must
now not be preceded by a letter, digit, slash or hyphen — the three cases where a
hyphen continues a word or a run rather than starting one.

**A single digit in parentheses is never reported.** The first implementation
reported `(5)` and exempted `(1)`, which are the same shape. There is nothing in
the text to tell them apart, so the rule now exempts _all_ single-digit
parenthesised numbers and reports `(12)`, `(1.5)` and `(4,200)`. That means a
genuine `(5)` is not reported — an under-report rather than a wrong correction,
and one stated boundary instead of two contradictory ones.

The Unicode minus (`U+2212`) is accepted alongside the ASCII hyphen, because a
document pasted from a typesetter will carry it and the rule should not be silent
on that document.

#### Verification

- `npm run typecheck` — clean.
- `npm run lint` — 0 warnings.
- `npm test` — **2582 tests / 185 files passing** (was 2568 / 184).

New tests: `tests/unit/rules/negativeNumber.test.ts` (14).

#### Phase 3 is closed

Every field in `language` is now read by a rule with a body, reachable from a
control, and classified as correctable or report-only. The five inert fields this
audit found in the language profile:

- `houseStyle.preferredTerminology` / `bannedTerms` — removed; the terminology
  merge (Phase 1b)
- `units.symbols` keys — a preferred rendering map (ADR-0111)
- `language.locale` — the default date shape (ADR-0111)
- `abbreviations.preferredExpanded` — enforced, read with the first-use rule (3b)
- `capitalisation.headingCase` — enforced (3c)
- `currency.magnitude` — enforced (3d); the currency separators were **removed**
  as a duplicate owner rather than implemented
- `numbers.negativeNumber` — enforced (this phase)

Two further categories were added while wiring them:
`language.unit.preferredSymbol`, `language.abbreviation.preferredExpanded`,
`language.capitalisation.headingCase`, `language.currency.magnitude`,
`language.number.negative`.

Next: the Phase 2 remainder, then Phase 4.
