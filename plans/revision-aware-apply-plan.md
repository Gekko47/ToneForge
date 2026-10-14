# Plan — Revision-aware apply: inspect before editing, author as ToneForge

## Goal

Make the single mutation path (`word/revisionAdapter.ts`) revision-aware:

1. **Inspect** existing tracked changes before any mutation.
2. **Refuse atomically** when a proposed edit overlaps an existing unaccepted revision.
3. Stay **idempotent** against ToneForge's own revisions (do not re-apply).
4. **Author ToneForge's text revisions under `ToneForge`**, so the pane can tell its
   own revisions from another user's.
5. **Fail closed** when the inspection API is unavailable — never fall back to
   blind replacement.

## Platform facts this plan is built on

- `Word.TrackedChange.author` is **read-only**. There is no API to set the author of
  a revision produced by `insertText`. The only way to author under a chosen name is
  `Range.insertOoxml()` with explicit `w:ins` / `w:del` markup carrying `w:author`.
  (Confirmed against Microsoft Learn: `Word.Revision` / `Word.Interfaces.RevisionLoadOptions`.)
- Detection is `Body.getTrackedChanges()` (**WordApi 1.6**) → `Word.TrackedChange`
  with `author`, `date`, `text`, `type` (`Added`/`Deleted`/`Formatted`), and `getRange()`.
- `Range.insertOoxml(ooxml, insertLocation)` (WordApi 1.1) is the authoring primitive.
- ADR-0144 fixes the coordinate space: change offsets live in **raw** `body.text`,
  the space `Range.set`/`Range.select` count.
- ADR-0139 recorded the limitation this plan removes: "revisions ToneForge applies are
  authored as the signed-in user, so the accept-all view cannot distinguish 'ToneForge
  wrote this' from 'the user wrote this'." App-authored revisions remove that ambiguity.

## Settled decisions (from the user)

| Axis             | Decision                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author scope     | **Text** changes (`insertText`, `replaceText`, `deleteRange`) authored via OOXML as `ToneForge`. **Formatting** changes stay native (signed-in user) — documented limitation. |
| Overlap policy   | **Refuse the whole plan** (atomic), consistent with today's precondition preflight.                                                                                           |
| Inspection point | **Apply time only** (preflight). No scan-time annotation in this phase.                                                                                                       |
| Host fallback    | **Fail closed**: refuse apply when WordApi 1.6 inspection is unavailable.                                                                                                     |

## Architecture

```
change-plan-preflight (existing)          revision-aware additions
-------------------------------           ------------------------
applyReviewedPlan (orchestrator)
  └─ applyChangePlanWithTracking (word)
       └─ applyChangePlan (word)
            ├─ validatePlanBeforeApply            ← unchanged
            ├─ docHash / STAGE_01 gates           ← unchanged
            ├─ verifyLivePrecondition (per change)← unchanged
            ├─ NEW: revision-overlap preflight
            │    ├─ readTrackedRevisions()        ← word/revisionInspection.ts (Office read)
            │    └─ assessRevisionOverlap()       ← changes/revisionOverlap.ts (pure)
            └─ applySingleChange (per change)
                 ├─ text types → buildTrackedRevisionOoxml() → range.insertOoxml()
                 └─ formatting types → native range APIs (unchanged)
```

Boundary compliance (`docs/architecture.md`):

- `core/domain/TrackedRevision.ts` — the DTO + author constant (importable by both sides).
- `changes/revisionOverlap.ts` — **pure**; imports `core/domain` only. No Office, no React.
- `word/revisionInspection.ts` — Office read through `runInWord`; never accept/reject.
- `word/revisionOoxml.ts` — pure string builders; no Office dependency.

The new capability flags ride through `WordCapabilities` → `toAnalysisCapabilities` →
`AnalysisCapabilities`, so the probe stays the one source of host truth.

## Deliverables

### 1. `src/core/domain/TrackedRevision.ts` (new)

```ts
export const TONE_FORGE_REVISION_AUTHOR = "ToneForge";

export const TrackedRevisionSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.enum(["Added", "Deleted", "Formatted", "None"]),
  author: z.string(), // "" when the host withheld it
  date: z.string().nullable(), // ISO 8601 when served, else null
  text: z.string(),
  range: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .nullable(), // null when offsets are not reliably readable
  target: ChangeTargetSchema.optional(),
});
export type TrackedRevision = z.infer<typeof TrackedRevisionSchema>;
```

### 2. `src/changes/revisionOverlap.ts` (new, pure)

```ts
export type RevisionOverlap =
  | { kind: "none" }
  | { kind: "own"; revision: TrackedRevision } // ToneForge already wrote this
  | { kind: "foreign"; revision: TrackedRevision } // another author's unaccepted revision
  | { kind: "unknown"; reason: string }; // could not locate reliably

export function assessRevisionOverlap(
  change: Change,
  revisions: readonly TrackedRevision[],
): RevisionOverlap;
```

Rules (spec §5, conservative):

- No revision overlapping the target → `none`.
- Overlapping revision authored by `TONE_FORGE_REVISION_AUTHOR` → `own`.
- Overlapping revision by any other author → `foreign`.
- Offsets unreadable on **both** the revision and the change → fall back to
  paragraph/node identity plus text containment; if that is also inconclusive → `unknown`.
- Half-open interval overlap (`start < other.end && other.start < end`); a zero-width
  insertion matches the node it lands in.

`own` and `foreign` both refuse; the _reason_ differs (already applied vs. another
author's revision). Every reason names the cause and the control that resolves it (ADR-0069).

### 3. `src/word/revisionOoxml.ts` (new)

```ts
export interface RevisionMarkupContext {
  author: string;
  date: string;
  nextId: () => number;
}
export function escapeXmlText(text: string): string;
export function buildTrackedRevisionOoxml(
  change: Change,
  ctx: RevisionMarkupContext,
): string | null;
```

- `insertText` → `<w:ins w:id w:author w:date><w:r><w:t xml:space="preserve">…</w:t></w:r></w:ins>`
- `replaceText` → `<w:del …><w:r><w:delText xml:space="preserve">OLD</w:delText></w:r></w:del>` + `<w:ins …>NEW</w:ins>`, where `OLD` is `change.precondition.expectedText`.
- `deleteRange` → `<w:del …><w:r><w:delText …>OLD</w:delText></w:r></w:del>`.
- Formatting types → `null` (caller stays on the native path).
- XML-escape `& < > " '`; always `xml:space="preserve"`.
- Insert **inline run-level** markup for character-range targets; `<w:p>`-wrapped for
  paragraph-unit targets.
- ponytail: a single shared `nextId` counter seeded per apply; the alternative (a
  host `w:id` registry) has no API. Ceiling noted; upgrade path is a per-document id map.

### 4. `src/word/revisionInspection.ts` (new)

```ts
export interface TrackedRevisionRead {
  supported: boolean; // false when getTrackedChanges is absent
  revisions: TrackedRevision[];
  error?: string;
}
export async function readTrackedRevisions(): Promise<TrackedRevisionRead>;
```

- `runInWord`: `body.getTrackedChanges()`, `load("items/author,items/date,items/text,items/type")`,
  `sync()`; then per item `getRange()` + `load(["start","end"])` guarded so one bad
  range costs that row, not the read.
- **Never** calls `accept`, `reject`, `acceptAll`, `rejectAll` (asserted by test — the
  ADR-0012 non-destructive rule).

### 5. `src/word/capabilityProbe.ts` — two new capabilities

- `supportsTrackedChangeInspection` — `requirements.isSetSupported("WordApi","1.6")`
  **or** `typeof body.getTrackedChanges === "function"` (guarded, non-destructive).
- `supportsInsertOoxml` — `typeof body.insertOoxml === "function"`.
- Add both to `WordCapabilities`, `DEFAULT_CAPABILITIES`, `toAnalysisCapabilities`,
  `AnalysisCapabilities`, and the probe list.

### 6. `src/word/revisionAdapter.ts` — the enforcement

- `RefusalCategory` gains `"revision_inspection_unavailable"`, `"revision_overlap"`, `"already_applied"`.
- **New atomic preflight** in `applyChangePlan`, between `verifyLivePrecondition` and the
  apply loop:
  - If `STAGE_01_CAPABILITIES?.supportsTrackedChangeInspection !== true` → refuse the whole
    plan with `revision_inspection_unavailable`.
  - Else `readTrackedRevisions()`; assess every ordered change.
  - Any `foreign` → refuse whole plan (`revision_overlap`), naming the author and type.
  - Any `own` → refuse whole plan (`already_applied`), naming ToneForge as the author.
  - Any `unknown` → refuse whole plan (`revision_overlap` with the stated reason).
- **`applySingleChange`**: `insertText` / `replaceText` / `deleteRange` route through
  `buildTrackedRevisionOoxml()` + `range.insertOoxml(markup, "Replace")` when
  `supportsInsertOoxml`; otherwise throw a stated refusal (fail closed). Formatting
  branches unchanged.
- `prepareTrackedEditing` (`src/reformat/trackedEditing.ts`): require
  `supportsTrackedChangeInspection` for every plan and `supportsInsertOoxml` for any plan
  containing a text change, mirroring the existing `getUnsupportedChangeIds` shape.

### 7. `src/types/office.d.ts`

- `Body.getTrackedChanges?()`, `Body.insertOoxml?()`, `Range.insertOoxml?()`,
  `TrackedChange`/`TrackedChangeCollection` structural declarations — all **optional**,
  because absence is the interesting case (the ADR-0084 pattern already in this file).

### 8. Tests

- `tests/unit/changes/revisionOverlap.test.ts` — pure: none / own / foreign / unknown;
  half-open boundaries; zero-width insert; identical phrases in different paragraphs
  resolved by node identity, not text alone.
- `tests/unit/word/revisionOoxml.test.ts` — author attribute is `ToneForge`; escaping of
  `& < > " '`; `xml:space="preserve"`; `w:del` uses `w:delText`; formatting types return
  `null`.
- `tests/unit/word/revisionInspection.test.ts` — Office double serving `getTrackedChanges`;
  absent API → `supported: false`; per-row range failure degrades one row; **absence of
  any accept/reject call**.
- `tests/unit/word/revisionAdapter.apply.test.ts` — foreign overlap refuses the whole plan;
  own overlap refuses as already applied; unsupported inspection refuses (fail closed);
  text change goes through `insertOoxml` with the app author; formatting change still uses
  the native path.
- `tests/unit/word/capabilityProbe.test.ts` — the two new probes, absent-host behaviour.
- `tests/fixtures/trackedRevisions.ts` — shared revision fixtures.

### 9. Docs

- **ADR-0145** in `docs/decision-log.md` — Revision-aware inspection and app-authored
  revisions. Records: author is read-only; OOXML is the only authoring path; atomic
  overlap refusal; formatting remains user-authored (documented limitation); fail closed
  on WordApi 1.6; and that the real-host behaviour is a human gate (ADR-0051).
- `ROADMAP.md` status ledger + `docs/project-state.md` evidence index.
- `docs/manual-verification.md` — new human steps: a new revision shows author
  `ToneForge`; a document with a foreign unaccepted revision refuses Apply naming the
  author; a host without WordApi 1.6 refuses Apply.
- `docs/architecture.md` — add the revision-aware additions to the data-flow diagram and
  the new modules to the boundary table.

## Word-API-first review of the scan and apply flows

Principle: read and track changes through the Word API. A hand-rolled adjustment
is permitted only where the host exposes no API for the task — and then it must
refuse rather than guess.

### Hand-rolled adjustments found, and what supersedes them

| Where                                                             | Hand-rolled today                                                                                            | Native API that supersedes it                                                                                                         | Action                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `analysisAcquisition.buildSnapshot` (lines 1110-1113)             | `rawText.indexOf(text, bodyCursor)` reconstructs each paragraph's absolute offsets by searching for its text | `Paragraph.getRange("Whole")` + `Range.start` / `Range.end` — the read `selectionScope` already performs, gated on WordApiDesktop 1.4 | **Replace.** Keep `indexOf` only as a stated fallback when the host serves no offsets                                                      |
| `documentReader.getStructuredSnapshot` (lines 357-360)            | the same `indexOf` locating                                                                                  | same                                                                                                                                  | **Replace**, same fallback rule                                                                                                            |
| `documentReader.splitParagraphRanges` (lines 476-485)             | splits body text on `/\n\s*\n/` to fabricate paragraph boundaries, then marks them `editable: true`          | `body.paragraphs` is the real collection; no API guesses paragraphs from text                                                         | **Remove the fabrication.** A host with no paragraph collection reports structural coverage `unsupported` rather than inventing paragraphs |
| `rules/protection.ts` `detectTrackedDeletionRanges` (lines 44-55) | matches a synthetic `{{ DELETE … }}` marker                                                                  | `TrackedChange.type === "Deleted"` from `body.getTrackedChanges()`                                                                    | **Delete.** `protectTrackedDeletions` reads real revisions through the inspection reader                                                   |
| `revisionAdapter.verifyLivePrecondition` (text kind)              | slices `body.text` at `[start, end]` and compares to `expectedText`                                          | `body.getRange("Whole").set({start,end})` then `load("text")` — ask the range for its own text                                        | **Replace**, keeping the slice only on a host without `Range.set`                                                                          |
| `revisionAdapter.countRecordedRevisions`                          | re-reads `getTrackedChanges().items.length`                                                                  | the new `readTrackedRevisions()`                                                                                                      | **Unify** — one reader, one truth                                                                                                          |

### Hand-rolled but no API exists — keep, and say why

| Where                                                 | Why it stays                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `revisionAdapter.orderChanges` (reverse offset order) | Word has no batch-apply API; changes are applied one at a time, end-first                                               |
| `revisionAdapter.resolveBreakEnums`                   | Desktop Word does not expose `Office.InsertBreakBehavior`, so `Word.BreakType` must be resolved with a fallback         |
| `enableRevisionTracking` / `restoreRevisionTracking`  | already native (`changeTrackingMode` / `trackRevisions`); unchanged                                                     |
| `analysisAcquisition.readBodyTextViews`               | reads `getReviewedText("Current")` + `body.text`; both native, and detection still needs the accept-all view (ADR-0139) |
| `revisionAdapter.preservationLiterals`                | a content-preservation check, not an Office read/write; no API answers it                                               |
| `documentObserver` full rescan + debounce             | no reliable document-level change API (ADR-0094); the paragraph-event path is removed in any case                       |

### Consequence for ADR-0144

Once paragraph offsets come from the range API, the raw-vs-accept-all offset
mismatch ADR-0144 worked around stops being a mismatch: the host's own offsets
already count the characters `Range.set` counts. `readBodyTextViews` still
supplies the accept-all text for detection, but the `indexOf` reconstruction
ADR-0144 introduced as the fix is superseded by the offsets themselves. Record
this in the new ADR, and amend ADR-0144 rather than silently contradicting it.

## Apply and Apply-all preflight — locate against the live document first

Both **Apply** (one finding) and **Apply all of this type** (every finding of the
type) must run a preflight that _locates_ the target in the live document before
any write. The plan's recorded offsets come from the scan; the document may have
moved since. Nothing is written on a target that cannot be located.

- `locateLiveTarget(change)` resolves a change to a live `Range` through the API:
  a paragraph unit by `nodeId` / `uniqueLocalId` and its paragraph index
  (`Paragraph.getRange("Whole")`), a character unit by
  `body.getRange("Whole").set({ start, end })` after the live text at those
  offsets is confirmed to equal the change's `precondition.expectedText`. If
  neither resolves, it refuses with a reason.
- The located range's own text is read through the API (`load("text")`), never
  sliced from `body.text`.
- **Apply** calls it for the one change. **Apply all** calls it for _every_ change
  in the type group, and refuses the whole batch if any one cannot be located — a
  batch that writes some findings and silently drops others is the failure this
  prevents.
- The revision-overlap preflight (`readTrackedRevisions` + `assessRevisionOverlap`)
  runs against the same located targets, so "is this target already revised" is
  asked about the range actually about to be written.

`overlayAccept` / `overlayAcceptAll` in the Dashboard already narrow the plan to
one change or to the group's changes and hand it to `applyReviewedPlan`; the
change is inside `applyReviewedPlan` — locate every change in the plan before it
writes, and refuse the whole plan when any target cannot be located.

### Apply order

`orderChanges` still applies from the end of the document toward the start. This
is not an API substitute: it is bookkeeping that exists because Word exposes no
batch-mutation API, and every individual mutation goes through the API
(`insertOoxml`, the formatting setters). Once targets are re-located it is an
optimisation rather than a correctness requirement — a stale offset cannot be
written — and it is kept because it costs nothing and keeps the plan's original
coordinates valid for non-overlapping changes.

## Removals — the paragraph-event path is dead code once apply is revision-aware

ToneForge will locate its own revisions by author + range, so the host
paragraph-event guessing — added only to work out which paragraphs an edit had
shifted — is removed. Nothing is lost: `documentObserver` already forces a full
rescan whenever an event is imprecise (`requiresFullRescan`, a deletion, a
remote edit, or no ids), so the narrowed path was only ever the rare case.

**Definite removals (user-confirmed):**

- `src/word/wordParagraphEvents.ts` — delete.
- `src/word/capabilityEvidence.ts` — delete (`CapabilityEvidenceTier` exists only
  for the paragraph-event capability).
- `src/taskpane/workflow/workflowState.ts` — drop the `CapabilityEvidenceTier`
  import, the `document.capabilityTier` field, and the `document/changedNodes`
  action + `changedNodeIds`. Nothing in `src` ever writes them; only a test reads
  `capabilityTier`, and `changedNodes` was the paragraph-event payload.
- `src/word/documentObserver.ts` — delete `ScanScope`, `narrowTo`, the `scope`
  field, the `change?` parameter on `onDocumentChanged`, and the narrowing block
  inside `performScan`; always scan the whole acquired document.
- `src/taskpane/pages/Dashboard.tsx` — drop the `createWordParagraphEventAdapter`
  import and wiring; call `observer.onDocumentChanged()` with no argument.
- `tests/unit/word/wordParagraphEvents.test.ts` — delete.
- `tests/unit/word/incrementalScanScope.test.ts` — delete.
- `tests/unit/word/autoScanInvariants.test.ts` — drop the `WordParagraphChange`
  import, the `change()` helper and the `onDocumentChanged(change())` calls; keep
  its coverage-honesty assertions.
- `tests/unit/taskpane/workflow/workflowState.test.ts` — drop the
  `capabilityTier` / `changedNodes` assertions.

Keep: `selectionWatcher.ts` (live caret) and `navigationGuard.ts` (navigation
serialisation) — neither is about offsets.

**Consequential — the incremental declaration is now dead. Remove it.** Once the
observer never narrows, `incremental` is a constant `false` from its only
producer. _Confirmed:_ remove the `incremental` /
`incrementalReason` conveyance from `analysis/analysisContext.ts`,
`word/analysisAcquisition.ts`, `analysis/coverage.ts`,
`analysis/deterministic/coverage.ts`, `analysis/deterministic/contracts.ts`,
`analysis/deterministic/deterministicReviewEngine.ts`, the `DocumentSnapshot.ts`
coverage schema, and `taskpane/autoPreview.ts` `isFullScan`, plus the affected
test assertions. The separate `examinedNodeIds` shortfall guard **stays** — it
protects a different invariant (a caller that acquires the whole document and
examines part of it) and is not paragraph-event specific.

## Execution order

1. Domain DTO + author constant.
2. Pure overlap matcher + its tests.
3. OOXML builders + their tests.
4. Office type declarations + capability probes + probe tests.
5. Inspection reader + its tests.
6. Adapter wiring: `locateLiveTarget` (the locate-and-verify preflight, shared by
   Apply and Apply-all), the revision-overlap preflight, and the `insertOoxml`
   route in `applySingleChange`; adapter tests for single-apply and all-of-type.
7. `prepareTrackedEditing` capability gate + its tests.
8. Scan reads paragraph offsets from the Word range API: `Paragraph.getRange("Whole")`
   offsets in `analysisAcquisition.acquireScope`/`buildSnapshot` and
   `documentReader.getStructuredSnapshot`, with `indexOf` demoted to a stated
   fallback where the host serves no offsets. Tests for both host states.
9. Delete the fabricated paragraph fallback (`splitParagraphRanges`): a host with no
   paragraph collection reports structural coverage `unsupported` instead of
   inventing paragraphs. Update callers and tests.
10. Delete the synthetic tracked-deletion marker (`detectTrackedDeletionRanges`) and
    drive `protectTrackedDeletions` from real revisions. Update `rules/index.ts` and its tests.
11. `locateLiveTarget` / `verifyLivePrecondition` read the range's own text via
    `getRange` + `load("text")`, keeping the body slice only where `Range.set` is absent.
12. Unify `countRecordedRevisions` with `readTrackedRevisions()`.
13. Remove the paragraph-event path (files above) and repair every affected test.
14. Remove the now-dead `incremental` conveyance (confirmed).
15. Docs: the new Word-API-first ADR, an amendment to ADR-0144, ROADMAP,
    project-state, manual-verification, architecture.
16. Remove the temporary `[TF-*]` `console.error` debug markers added to
    `Dashboard.tsx`, `orchestrator.ts`, `revisionAdapter.ts`, `FindingDetailOverlay.tsx`.
17. Full verification: `npm run verify` (typecheck → lint → format → tests → build → manifest).

## Risks and honest limits

- **OOXML authoring is unverified in a real host.** `insertOoxml` preserving `w:author`
  under Track Changes is a documented technique, not something this suite can prove. The
  plan states it as a human gate, never as established (ADR-0051).
- **Replacing text via OOXML must delete the original inside `w:del`.** For a
  character-range replacement the `w:del` content must be the raw text at that range; the
  change's `precondition.expectedText` supplies it, and a mismatch is already refused by
  the precondition preflight.
- **Formatting revisions still carry the signed-in user's name.** Explicitly a documented
  limitation, to be revisited only when `w:rPrChange`/`w:pPrChange` authoring is taken on.
- **Offsets from `TrackedChange.getRange()` may not be body-relative.** Where they are not,
  the matcher degrades to node identity + text containment and, when that is inconclusive,
  refuses — the conservative direction the spec asks for.
