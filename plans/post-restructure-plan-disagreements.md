# Disagreements with the revised `post-restructure-remediation-plan.md`

> **SUPERSEDED — 2026-09-28.** Every point below has been resolved by the
> product owner and the resolutions are carried into
> [`post-restructure-remediation-plan.md`](./post-restructure-remediation-plan.md)
> as settled decisions S1–S9. Retained as the decision record; do not implement
> from this file.

**Status:** resolved. Nothing below was implemented as written.

I accept most of the revision. It is materially more careful than my first
draft: it corrected three claims of mine that were wrong, replaced several
over-confident causal assertions with properly hedged ones, and caught a real
contradiction between the original plan's guard specification and the guard that
was actually built. Those concessions are listed in the first section so they are
not relitigated.

Everything in the second section is where I disagree, and the third section
lists what I think the plan is still missing entirely.

---

## 1. Where the revision is right and I was wrong

| My original claim                                                    | The revision is correct because                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Ten selections in 200 ms produce one host call."                    | [`createNavigationGuard`](../src/word/navigationGuard.ts:16) documents and implements a different contract: at most one jump in flight plus one replaceable queued request, so a burst of ten produces **two** host calls. My wording was copied from the original plan, which specified a contract the implementation deliberately does not honour. The revision's replacement — assert bounded, non-overlapping calls and latest-queued settlement — is the right test. |
| "Give the body node its acquired text so the in-scope check passes." | Wrong. [`buildCoverage`](../src/analysis/coverage.ts:117) accepts any included node with non-empty text; headings and list items already satisfy it. Adding body text to satisfy a coverage predicate is fixing the wrong end.                                                                                                                                                                                                                                            |
| "Collapse the two Apply gates into one."                             | Under-specified and slightly dangerous. The layered checks in [`PendingChanges`](../src/taskpane/components/PendingChanges.tsx:76), the Dashboard callback, and [`applyReviewedPlan`](../src/reformat/orchestrator.ts:543) are defence in depth. The correct change is one shared _user-facing readiness explanation_, with the fail-closed checks left in place. The revision says exactly that.                                                                         |

Two further revisions are genuine improvements I had not considered:

- **Reviewed keys carry no document identity.** They live in
  `localStorage["ToneForge.ReviewedFindingFingerprints.v1"]` with no document id,
  so migrating them onto versioned state would silently attach one document's
  review decisions to another. Discarding them pending fresh review is the
  correct call.
- **Separate relocation policies for review and ignore.** These are genuinely
  different decisions. A review is consent to apply a specific correction at a
  specific offset and should invalidate when the text moves; an ignore is "stop
  showing me this" and should tolerate an edit above it. I had collapsed both
  onto one occurrence key, which would have broken one of the two behaviours.

---

## 2. Where I disagree

### 2.1 The Home page is an instruction, not an option to be gated

The revision reframes D1 as "a discoverability and feedback defect, not proof
that the profile gate should be removed" and makes a Home page "an optional UX
redesign, not a prerequisite for correcting the silent redirects" (D1, W0, W1).

The product owner asked for this directly:

> This can be fixed by having a Home page that prompts the user to set up a
> deterministic style profile, a semantic style profile and a LLM provider, with
> links to their relevant settings page. when any of them are not set up a
> warning must state when it is preventing until completed.

That is a specification for a Home page, a checklist of three named items, links
to their settings pages, and a warning per missing item. Treating it as a design
proposal awaiting approval risks shipping the silent-redirect fix and not the
page.

I agree with the revision's substantive caution, which is compatible: warnings
are not capability grants. A missing semantic profile warns that rewrites are
unavailable; it does not enable them. The caution and the instruction are not in
conflict, and the plan can hold both — but the Home page should be a committed
workstream item, not conditional.

**Asks:** confirm the Home page, the three-item checklist, the per-item warning
text, and the links are in scope, so W0/W1 stop gating them.

### 2.2 The rename is settled, not a decision gate

W2 opens with "**Decision gate:** rename the `home` navigation label to
**Deterministic Review** only after product terminology is approved; otherwise
retain **Document Governance**." D2 repeats the gate.

The instruction was explicit: "Document governance tab can be renamed
Deterministic Review". Re-opening it costs a round trip and risks the label
staying wrong. The accessibility cost the revision is pointing at is real but
small and is handled by updating the tests and the `aria-label` strings in the
same change, which the plan already schedules.

**Asks:** drop the gate; keep the test and `aria-label` updates as a
requirement inside the rename.

### 2.3 The revision drops the actual cause of the "not a pending change" message

D3 point 3 now reads that the claim "`pendingPlanRef` necessarily reads a
previous-render value is not established", and that the remaining issue is a
stale message. That correction is right about the _timing_ and wrong about the
_substance_, and it discards a confirmed defect.

The identity mismatch is this:

- The finding the user clicks comes from the **observer's** list
  ([`Dashboard.tsx:891`](../src/taskpane/pages/Dashboard.tsx:891)).
- The plan comes from the **preview run**
  ([`Dashboard.tsx:927`](../src/taskpane/pages/Dashboard.tsx:927)).
- `reviewFinding` matches a change by `change.findingId === finding.id`
  ([`reviewGate.ts:73`](../src/taskpane/reviewGate.ts:73)).

Those two runs issue separate uuids, so the match can never succeed. Every
observer-sourced finding therefore takes the `no-change` branch and prints
"the planner proposes no correction for this finding" — which is verbatim what
the screenshot shows, on a finding that _does_ have a change.

Meanwhile [`reviewedPlan`](../src/taskpane/reviewGate.ts:158) matches by
`reviewKey` (fingerprint plus offset) and _does_ find it, which is why
Pending Changes shows 2 rows in the second screenshot. The gate and the
projection use two different identities for the same decision, and they disagree.

This is not a messaging defect. The gate is judging against a plan whose
`findingId` space it cannot address, so its verdict carries no information. The
fix is to give the gate and the projection one shared identity, not to
reconcile a message after the fact. W3 as written does not include that.

**Asks:** add a W3 item making `reviewFinding` resolve a change through the same
occurrence key the projection uses, with a test proving a reviewed finding on
the observer list reaches Pending Changes without a re-scan.

### 2.4 The D5 chain is real and should be ranked first, not hedged

D5 point 1 now concedes that the missing capabilities "do not establish which
capabilities the live host supports, or that this is the only cause of the
screenshot's Apply refusal", and W5 replaces the fix with "model probe success,
pending, and failure explicitly".

The hedging is right about the _first_ cause. It is wrong to let it demote the
second, which is a two-line provable chain and matches the screenshot exactly:

1. [`analysisAcquisition.ts:350`](../src/word/analysisAcquisition.ts:350) sets
   `includedInGovernance: false` on any paragraph containing a double-quoted
   span. A document that discusses quotations qualifies throughout.
2. [`coverage.ts:117`](../src/analysis/coverage.ts:117) finds no included node
   with text, and pushes `No in-scope document content was acquired` into
   `unprocessed`.
3. [`coverage.ts:176`](../src/analysis/coverage.ts:176) derives `complete` from
   `unprocessed.length === 0`, so `complete` is `false`.
4. [`PendingChanges.tsx:76`](../src/taskpane/components/PendingChanges.tsx:76) and
   [`orchestrator.ts:543`](../src/reformat/orchestrator.ts:543) both refuse Apply.

The screenshot's `unprocessed` line is that exact string, and the screenshot
document is visibly quote-heavy. This is a deterministic code path with no
host dependency. It should be the first hypothesis tested in W5, not a
candidate alongside probe-state modelling.

**Asks:** reorder W5 to put the acquisition/protection classification first and
treat probe-state modelling as secondary. Keep the hedge on the capabilities
cause.

### 2.5 The v10 → v11 semantic-copy gap is understated

Part A item 4.2 is marked "**Built; semantic-copy requirement differs**", and the
note says not to add the semantic-block copy "without an explicit data-policy
decision and migration tests".

The fact is a silent data loss, not a cosmetic difference. Original plan 4.2
step 2 required that each existing record's `semantic` block be copied into a new
semantic record. The shipped migration sets `semanticProfileRecords: {}`
([`migration.ts:264`](../src/core/state/migration.ts:264)), so **every user who
learned a semantic style before v11 has silently lost it**, with no message and
no way back.

A decision gate is appropriate — copying may be wrong. But the verdict should
say "existing learned semantic style is not migrated and is lost on upgrade",
because that is what a reader of the table needs to know, and the ADR should
record the decision either way.

**Asks:** restate 4.2 as an open data-loss item with an explicit decision, not a
verdict caveat.

### 2.6 XML/JSON manifest parity is already a settled decision

Part A item 7.4 is marked "**Declared; route parity incomplete**" and asks
whether "equivalent XML function routing is required". W8 asks the same again.

This was decided. [`commandRegistry.ts:27`](../src/commands/commandRegistry.ts:27)
carries `xmlNavigationTarget: "default"` with the comment "XML cannot encode
command-specific targets; all XML controls use the default pane", and
[`project-state.md:36`](../docs/project-state.md:36) records the XML fallback as
intentionally using `ShowTaskpane`. Re-opening it as an open question contradicts
a documented decision and invites churn against a constraint the XML schema
imposes.

**Asks:** restore 7.4 to "Built, deviation recorded", and drop the W8 parity
bullet.

### 2.7 W8 contradicts itself on the semantic pending-changes section

The "Contract corrections" paragraph states the semantic pending-section bullet
"is superseded by the shared reviewed projection and central Apply flow; do not
implement a second Apply surface". Twenty lines later, W8 still carries:

> Add the semantic pending-changes section filtered to `source === "ai" ||
"profile"`, satisfying 8.4, and assert no deterministic change appears there.

An implementer reading W8 top to bottom will build the section. If the intent is
a read-only projection with no second Apply button, say that; if the intent is to
drop 8.4, delete the bullet. Both are defensible — the current state, where a
semantic proposal is pushed to the shared gate and the Semantic tab has no
pending section at all, is the weaker option.

**Asks:** resolve the contradiction and state which.

### 2.8 W8 names the tab with the label W2 has not yet approved

W8 says "Reorder the **Deterministic Review** page" while W2 gates the rename.
Minor, but it indicates the plan is written from the end state backwards. Worth
normalising so a reader does not think the rename has already shipped.

---

## 3. What the plan is still missing

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why it matters |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **A guard owner is specified in two places.** W8 says "Keep one navigation owner across Governance and Consistency", but the two surfaces are different pages with different mounts, and [`FindingDetail`](../src/taskpane/components/FindingDetail.tsx:67) currently owns its own per-card navigation state. A `useRef` guard in each page is two guards. The plan needs to name where the single guard instance lives and how it survives a page switch.       |
| **Reviewed state is stated in three places with different rules.** D3 fix direction, W0, and W3 each describe review identity and retention. They currently agree, but three statements of one rule will drift. Consolidate to W3 and have the others reference it.                                                                                                                                                                                              |
| **No test for the reviewed-count disagreement visible in the screenshots.** The summary line says "Mandatory: 0 open / Advisory: 3 open" while the section header says "5". W5 asks for "one clearly defined set", which is right, but there is no named test asserting the two surfaces cannot disagree — which is the exact failure in screenshot 1.                                                                                                           |
| **`usePersistedState` is assumed to drive re-render on every write it needs.** W3 and W4 both depend on a save causing a re-render (an ignore must remove a card; a review must add a pending row). That is true today via `usePersistedState`, but moving reviewed state into `PersistedState` changes which hook owns it. The plan should state that reviewed writes go through the same store subscription, not through a separate `useState` plus an effect. |
| **The "Findings 3" header count vs "3 finding(s)" list count.** Screenshot 1 shows both, and the reviewed-flag change will alter the relationship. Not mentioned anywhere.                                                                                                                                                                                                                                                                                       |
| **No rollback statement for the state version bump.** W0 adds reviewed state to a v11 schema, which means v12 plus a migration. A user mid-review when the migration runs is the case that needs a stated answer; the plan says discard legacy keys but not what happens to a v11 store under v12.                                                                                                                                                               |

---

## 4. What I propose to change, in one list

1. Make the Home page and the three-item checklist a committed W1 deliverable
   (2.1).
2. Drop the rename gate in W2 and D2 (2.2).
3. Add the gate/projection identity mismatch to W3 as a defect, not a message
   reconciliation (2.3).
4. Reorder W5 to lead with the acquisition/protection classification (2.4).
5. Restate Part A 4.2 as an open data-loss item (2.5).
6. Restore 7.4 to a recorded deviation and delete the W8 parity bullet (2.6).
7. Resolve the W8 semantic pending-section contradiction (2.7).
8. Normalise the tab name in W8 (2.8).
9. Add the six items in section 3.

Sections 1 and 2.1–2.8 need a decision from you. Section 3 I can fold in
without a decision — they are clarifications, not changes of direction.
