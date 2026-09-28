# Review — `navigation-and-tab-restructure-plan.md` against the current tree

> **SUPERSEDED — 2026-09-28.** The item-level verdict lives in Part A of
> [`post-restructure-remediation-plan.md`](./post-restructure-remediation-plan.md),
> which is the single source of truth for implementation. Retained as the
> evidence record.

**Reviewed:** the current `src/`, `tests/`, `manifest.json`, and `manifest.xml`.
**Verdict:** the plan was **substantially but not fully** implemented. The data
model, the page structure, and the context menu shipped. The navigation guard, the
page ordering, the revision toggle, the semantic pending-changes section, and the
capability probe did not. Three areas shipped in a defective form.

The remediation work is specified in
[`post-restructure-remediation-plan.md`](./post-restructure-remediation-plan.md).
This file is the evidence record only.

---

## Shipped as planned

| Plan item                                                 | Where it landed                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 Two profile namespaces                                | [`src/core/state/persistence.ts`](../src/core/state/persistence.ts:49), [`src/core/state/profileSelectors.ts`](../src/core/state/profileSelectors.ts:37) |
| 4.2 Migration v10 → v11                                   | [`src/core/state/migration.ts`](../src/core/state/migration.ts:263), `STORAGE_KEY = ToneForge.State.v11`                                                 |
| 4.3 Publish-in-place                                      | [`publishDraft()`](../src/core/domain/ProfileRecord.ts:193)                                                                                              |
| 4.4 `settings.autoScan` gates the observer                | [`src/taskpane/pages/Dashboard.tsx:525`](../src/taskpane/pages/Dashboard.tsx:525)                                                                        |
| 5.5 Ignored list with Restore                             | [`src/taskpane/components/IgnoredFindings.tsx`](../src/taskpane/components/IgnoredFindings.tsx)                                                          |
| 5.6 Mandatory/advisory summary                            | [`src/taskpane/findingsSummary.ts`](../src/taskpane/findingsSummary.ts)                                                                                  |
| 5.7 Coverage as its own section                           | [`src/taskpane/components/CoverageBanner.tsx`](../src/taskpane/components/CoverageBanner.tsx)                                                            |
| 5.8 Auto-preview on a full scan                           | [`src/taskpane/autoPreview.ts`](../src/taskpane/autoPreview.ts:42)                                                                                       |
| 5.10 Safe Reformat removed from the page                  | No longer rendered                                                                                                                                       |
| 6.1 Semantic fields removed from the deterministic editor | [`ProfileFormValues`](../src/taskpane/components/ProfileEditor.tsx:43)                                                                                   |
| 6.2 Save writes deterministic fields only                 | [`buildCandidate()`](../src/taskpane/components/ProfileEditor.tsx:150)                                                                                   |
| 6.5 Governance Policy off the profile tab                 | [`src/taskpane/pages/GovernancePolicy.tsx`](../src/taskpane/pages/GovernancePolicy.tsx)                                                                  |
| 6.6 Learn Style moved to the Semantic tab                 | [`src/taskpane/pages/Semantic.tsx:346`](../src/taskpane/pages/Semantic.tsx:346)                                                                          |
| 7.1–7.4 Governance Policy tab and both manifests          | [`manifest.json:136`](../manifest.json:136), [`manifest.xml:136`](../manifest.xml:136)                                                                   |
| 8.2 Measured and semantic style on the semantic record    | [`src/taskpane/pages/Semantic.tsx:400`](../src/taskpane/pages/Semantic.tsx:400)                                                                          |
| 8.3 Rewrite engine                                        | [`src/ai/prompts/rewritePrompts.ts`](../src/ai/prompts/rewritePrompts.ts), [`src/analysis/rewriteEngine.ts`](../src/analysis/rewriteEngine.ts)           |
| 9.1, 9.3, 9.4, 9.5 Consistency tab                        | [`src/taskpane/pages/ConsistencyReview.tsx`](../src/taskpane/pages/ConsistencyReview.tsx), grouping in `ConsistencyReviewResults.tsx`                    |
| 11.1–11.4, 11.6, 11.7 Context menu and ribbon fallback    | [`manifest.json:209`](../manifest.json:209), [`manifest.xml:241`](../manifest.xml:241)                                                                   |
| 12.1, 12.2 Settings and OAuth documentation               | [`src/taskpane/components/ScanningSettingsSection.tsx`](../src/taskpane/components/ScanningSettingsSection.tsx)                                          |

## Shipped partially

| Plan item                      | What is missing                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1 Navigation guard           | [`src/word/navigationGuard.ts`](../src/word/navigationGuard.ts) exists and is unit-tested, but nothing imports it. [`FindingDetail`](../src/taskpane/components/FindingDetail.tsx:94) calls [`navigateToFinding`](../src/word/sourceLocator.ts:40) directly. |
| 8.1 Learn Style                | Moved and working, but no pasted-source-text box — only "Learn from current document".                                                                                                                                                                       |
| 9.2 Consistency results format | Button label correct; no prev/next stepping, no auto-navigate.                                                                                                                                                                                               |
| 12.3 Troubleshooting           | Six checks exist; the three named in the plan are absent.                                                                                                                                                                                                    |

## Not built

| Plan item                                                | Why it matters                                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1b, 5.3 Auto-navigate on selection via the guard       | Without it the guard is dead code and arrowing through findings still floods the host.                                                                          |
| 5.1 Reorder, `PendingChanges` last                       | Pending changes sits second on the page.                                                                                                                        |
| 5.2 `Last scan` in the header row                        | It renders inside the stale banner instead.                                                                                                                     |
| 6.1b Remove the Measured and Semantic read-only sections | Both still render on the deterministic tab and duplicate the Semantic tab.                                                                                      |
| 6.3 "Show all revisions" toggle, collapsed by default    | The record section renders unconditionally; a separate private history lives in the editor.                                                                     |
| 8.4 Semantic pending-changes section                     | Absent.                                                                                                                                                         |
| 11.5 `supportsContextMenu` probe                         | [`capabilityProbe.ts:275`](../src/word/capabilityProbe.ts:275) still tests the ContextMenuApi 1.1 namespace, a different feature from a manifest-declared menu. |

## Shipped but defective

| Area                 | Defect                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2 Ignore list      | [`persistIgnore`](../src/core/state/persistence.ts:592) dedupes on **fingerprint only** — the identity of a rule, not an occurrence. Ignoring a second occurrence of the same rule deletes the first, and Restore is all-or-nothing per rule. |
| 5.8 Auto-preview     | The preview is built, but it calls `reformatDocument` with no capabilities and reports protection exclusions as acquisition gaps, so the plan it produces is permanently coverage-incomplete and Apply never enables.                         |
| 5.10 Dead components | [`ReformatPanel.tsx`](../src/taskpane/components/ReformatPanel.tsx) and [`GovernanceDashboard.tsx`](../src/taskpane/components/GovernanceDashboard.tsx) are unimported but still in the tree, carrying hardcoded colours.                     |

## Deviated, with a recorded reason

| Plan item                            | Deviation                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.4 Per-finding Apply, remove Review | Replaced by the review gate. The defect report reinstates Review as a reviewed flag and disables Ignore instead, so this item is superseded rather than outstanding. |
| 5.9 Apply All below prev/next        | Removed deliberately as a bypass around the review gate.                                                                                                             |
