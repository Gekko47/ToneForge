# Plan: Wire Deterministic Revision Engine into Semantic Review Process

## Goal

Reuse the deterministic revision write path (tracked revision creation, revision overlap preflight, apply path) in the semantic review flow, while preserving the semantic review end-to-end experience and keeping the semantic UI as the driver.

## Current State

### Semantic Review Flow

1. `SemanticReview.tsx` — user selects text → clicks "Review selection"
2. `reviewSemanticSelection()` in `src/analysis/semantic/semanticReviewEngine.ts` — sends to LLM, returns assessment + proposed revision
3. `SemanticReview.tsx` — displays assessment, comparison, preservation summary
4. User clicks "Apply" → `applyApprovedSemanticRevision()` in `src/reformat/semanticApply.ts`
5. `semanticApply.ts` — builds `Change` from `ApprovedSemanticRevision`, creates `ChangePlan`, calls `applyReviewedPlan()` in `orchestrator.ts`
6. `orchestrator.ts` — calls `prepareTrackedEditing()` → `applyChangePlan()` in `revisionAdapter.ts`
7. `revisionAdapter.ts` — runs revision overlap preflight (gated on `supportsTrackedChangeInspection === true`), locates targets, applies changes via Word

### Deterministic Review Flow

1. `Dashboard.tsx` — shows findings overlay → Accept/Accept All
2. `applyReviewedPlan()` in `orchestrator.ts` with `skipRemainingFindingsRefresh: true`
3. Same path as steps 6-7 above

### Key Shared Components

- `src/word/revisionAdapter.ts` — sole mutation path, revision overlap preflight, tracked change management
- `src/word/revisionInspection.ts` — reads tracked changes via `Body.getTrackedChanges()`
- `src/reformat/orchestrator.ts` — `applyReviewedPlan()`, `prepareTrackedEditing()`
- `src/reformat/trackedEditing.ts` — `prepareTrackedEditing()`

## Changes Required

### 1. Remove diagnostic console.warn from revisionAdapter.ts

**File**: `src/word/revisionAdapter.ts` lines 241-259
Remove the `console.warn` block that logs revision preflight diagnostics (planId, revisions with author/type/range/text, ordered changes). This is temporary diagnostic code that bypasses redaction.

### 2. Remove diagnostic console.warn from revisionInspection.ts

**File**: `src/word/revisionInspection.ts` — THREE console.warn blocks to remove:

- Lines 78-84: "revision inspection diagnostic" — logs rawItemCount and itemsIsArray (non-sensitive metadata, but still a diagnostic)
- Lines 98-104: "revision item load failed" — logs index and error message (non-sensitive)
- Lines 108-116: "revision item diagnostic" — logs index, author, type, text (SENSITIVE: document content and author names)

All three bypass redaction. The one at lines 108-116 is the most critical privacy concern.

### 3. Wire skipRemainingFindingsRefresh into semantic apply

**File**: `src/reformat/semanticApply.ts` line 228
Add `skipRemainingFindingsRefresh: true` to the `applyReviewedPlan()` call.

**Note**: The semantic flow already skips the refresh because it doesn't pass `profile` to `applyReviewedPlan()` (the condition at orchestrator.ts line 1059 is `options.profile === undefined || options.skipRemainingFindingsRefresh === true`). Adding the flag is redundant but future-proof — if someone later adds a profile to the semantic flow, the refresh would still be skipped.

### 4. Add caret-following paragraph selection to semantic review

**File**: `src/taskpane/pages/SemanticReview.tsx` + `src/word/selectionScope.ts`
The semantic process follows the caret and selects text in that paragraph or the selected text. This is already partially implemented via `readSelectionScope()`. The existing `SemanticReviewScope.tsx` component reads the selection and displays it. The review button triggers `reviewSemanticSelection()` with the selected text.

**No changes needed here** — the caret-following behavior is already wired through `readSelectionScope()` → `SemanticReviewScope.tsx` → `reviewSemanticSelection()`. The semantic process already follows the caret and selects paragraph text.

### 5. Verify revision overlap preflight gate

**File**: `src/word/revisionAdapter.ts` line 206
The gate already runs only when `supportsTrackedChangeInspection === true`. This is correct — the semantic flow will use the same gate. No changes needed.

### 6. Ensure semantic finding generation and display remains the driver

The semantic UI in `src/analysis/semantic/` and `src/taskpane/components/semantic/` already drives the semantic review experience. The deterministic overlay UI in `src/taskpane/pages/Dashboard.tsx` is NOT used for semantic review. The semantic flow keeps its own:

- `SemanticReviewScope.tsx` — selection display
- `SemanticAssessmentView.tsx` — assessment display
- `SemanticRewriteComparison.tsx` — side-by-side comparison
- `PreservationSummary.tsx` — preservation check results

## What This Plan Does NOT Do

- Does NOT copy the deterministic overlay UI (Accept/Accept All buttons, finding cards)
- Does NOT route semantic review through `planChanges` or the deterministic review gate
- Does NOT merge semantic findings into the deterministic findings list
- Does NOT change the semantic prompt, assessment, or preservation logic
- Does NOT change the deterministic review or apply semantics

## Phase C: Fix selection scope bug (selection_offsets_incomplete)

**Problem**: `context.requirements?.isSetSupported?.("WordApiDesktop", "1.4")` returns `false` on Word Desktop 16.01 because `context.requirements` is `undefined` in the execution context. This causes `range.load(["text"])` (no offsets), both offsets default to `-1`, and the guard at line 293 returns `unavailable`.

**Fix (Option 1)**: In `src/word/selectionScope.ts`, lines 237-265 and 293-301:

1. Remove the `servesOffsets` conditional — always `range.load(["text", "start", "end"])`
2. Extend the existing try/catch at lines 239-252 to fall back to the caret-paragraph path (lines 314-319) instead of returning `unavailable`
3. Extend the offset guard at line 293 to fall back to the caret-paragraph path instead of returning `unavailable`

This is not slower on hosts that support 1.4 (they already load all 3). On hosts without 1.4, it does one extra round-trip but falls back to caret-paragraph instead of returning an error.

## Validation

1. `npm run verify` — full verification chain must pass
2. Semantic review end-to-end: select text → review → apply → tracked change created
3. Deterministic review still works: findings → accept → tracked change created
4. Revision overlap preflight runs for both flows when `supportsTrackedChangeInspection === true`
5. No duplicate post-apply refresh in semantic flow
6. Selection scope bug fixed: caret selection on Word Desktop returns caret-paragraph instead of `unavailable`
