# ToneForge — Manual Word Verification (Stage 27)

This file records manual Word host results. **Status: IN PROGRESS — Stage 01 Desktop Word result recorded; full Stage 27 matrix still pending.**

## Stage 18 live diagnosis — 2026-09-22 (taskpane probe + runtime diagnostics)

Sideloaded Desktop Word taskpane returned:

```json
{
  "supportsInsertText": true,
  "supportsReplaceText": true,
  "supportsInsertParagraph": true,
  "supportsInsertBreak": false,
  "supportsStyles": false,
  "supportsRevisions": false,
  "hostName": "Word",
  "hostVersion": null
}
```

Runtime diagnostics reported `Word.run: true`, `Word.InsertLocation: true`,
`Office.InsertBreakBehavior: false`, `Office.run: false`,
`Office.roamingSettings: false`, and no `Office.context.host`.

Root causes identified (see ADR-0026):

- `supportsInsertBreak: false` was a **probe bug, not a host gap**. The probe
  checked `Office.InsertBreakBehavior`, which this host does not expose, while
  the host _does_ expose `Word.BreakType` / `Word.InsertLocation`. Fixed by
  `hasWordBreakSupport()` (Word global first, Office fallback). Re-probing is
  expected to flip this flag to true.
- The adapter's `insertBreak` read `Office.BreakType` / `Office.InsertLocation`,
  which are `undefined` at runtime (TypeScript namespace merge only). Fixed by
  `resolveBreakEnums()` (Word global first, Office test-double fallback,
  explicit per-change error when neither exists).
- `supportsStyles: false` root cause is still unknown (loaded items empty).
  The probe now also accepts a named-style lookup method as a secondary
  signal; a live re-probe must confirm before trusting it.
- `supportsRevisions: false` (`document.trackedChanges` unavailable) is a
  genuine host limitation; the insert/replace fallback per ADR-0005/ADR-0008
  stands.
- `Office.roamingSettings: false` means persistence uses the localStorage
  fallback in this host (already handled per ADR-0007/ADR-0010).
- The diagnostics view double-encoded newlines (`JSON.stringify` on a string);
  fixed to render the preformatted text directly.

## Intended end-to-end flow (generation → preview → apply with tracking)

The Dashboard **Stage 18 smoke test** panel implements the full loop with
preview-before-apply at every step; nothing mutates without an explicit click:

1. **Generate (profile → selection).** Select text in the document, then
   **Check selection**: the panel loads the active style profile, runs the
   deterministic typography + house-style rules over the selection, and lists
   each finding with its body-relative range. No network is involved.
2. **Preview.** Findings (profile flow) or the demo summary lines (plan flow)
   render in the panel before anything mutates. An empty result reports
   success ("already matches") instead of applying nothing silently.
3. **Apply with revision tracking.** **Apply plan** snapshots the live hash,
   refuses on mismatch, enables tracking (`TrackAll`) when the host exposes
   `changeTrackingMode`/`trackRevisions`, applies each change independently,
   restores the prior mode, and reports per-change `applied` flags plus a
   tracking summary (`managed`, before/after mode, recorded count). When
   tracking control is unavailable the edits still apply and the report says
   `managed: no` — they are tracked only if Track Changes is on in the UI.
4. **Record.** Copy the probe JSON, the tracking summary, and the per-change
   results into the host matrix and the Stage 18 smoke section below.

**To close the Stage 18 hard gate, re-run in live Word after rebuilding:**

1. `npm run build`, sideload per `docs/onboarding.md`, open a test document.
2. Click **Probe Word capabilities** — expect `supportsInsertBreak: true` and
   (if the host carries WordApi 1.4) `supportsRevisions: true`; record the
   full JSON below with host version.
3. In **Stage 18 smoke test**, click **Enable mutations (Stage 01 gate)**,
   then **Build demo plan** (review the preview), then **Apply demo plan**.
   Record the applied counts, the tracking summary, and any exceptions.
4. Select a paragraph with a style deviation, **Check selection**, review the
   findings preview, then **Apply plan** and record the outcome.
5. Record everything in the host matrix and the Stage 18 smoke section below.

## Stage 18 live smoke result — 2026-09-22 (Desktop Word, Edge 153)

Human-run SmokePanel session on a Lorem Ipsum test document with Track
Changes enabled in the Word UI. No unhandled exceptions in any run.

Observed panel log (abridged, oldest first):

```text
Selection text was not found in the document body — re-select and try again.
Found 1 finding(s) producing 1 change(s). Review below, then Apply.
Applied 0 of 1 change(s). ... failed: Stage 01 ... not passed; mutation blocked
Found 2 finding(s) producing 2 change(s). Review below, then Apply.
Applied 0 of 2 change(s). ... failed: Stage 01 ... not passed (x2)
Stage 01 gate enabled for this session. Mutations allowed.
Found 1 finding(s) producing 1 change(s). Review below, then Apply.
Applied 1 of 1 change(s). Tracking [managed: yes, before: TrackAll, after: TrackAll, recorded: 1].
Found 2 finding(s) producing 2 change(s). Review below, then Apply.
Applied 2 of 2 change(s). Tracking [managed: yes, before: TrackAll, after: TrackAll, recorded: 3].
Demo plan ready with 2 change(s). Review below, then Apply.
Applied 2 of 2 change(s). Tracking [managed: yes, before: TrackAll, after: TrackAll, recorded: 5].
(+ 6 further demo cycles, each Applied 2 of 2, recorded: 5)
```

What this proves:

- Gate refusal works live (per-change `applied: false`, never fatal), then the
  explicit gate enable unblocks mutations — the exact safety sequence designed.
- `changeTrackingMode` management works live: `managed: yes` on every apply,
  which independently confirms the host carries WordApi 1.4 tracking control
  (the old `document.trackedChanges` probe could never have shown this).
- Selection flow applies 1/1 and 2/2 with recorded counts; demo flow applies
  2/2 repeatedly; document text visibly mutates (smoke markers appended).
- Hash/stale refusal and per-change isolation are unit-proven; the live log
  shows the gate path, which is the same refusal shape.

Caveats recorded honestly:

- `recorded` plateaued at 5 across later runs while text kept changing. Word
  likely coalesces adjacent same-author revisions, so the recorded count is
  best-effort evidence, not an exact audit counter. Per-change `applied` flags
  remain the tool's record.
- Repeated runs on one document compound edits (7 appended markers; opening
  characters re-tweaked each run). For clean evidence, use a **fresh test
  document per run**: paste the Lorem Ipsum text, run one demo cycle, record.
- Single-letter insertions observed (`Mmountains`, `Llive`, `FAR F!Far`) are
  consistent with repeated-run compounding, but insert-vs-replace range
  semantics deserve a dedicated fresh-doc single-change check as follow-up.
- Only `insertText`/`replaceText` were exercised live. `insertBreak`,
  `applyStyle`, `setListLevel`, and formatting paths remain mock-verified.

## Stage 18 unit verification note

- `tests/unit/word/revisionAdapter.test.ts` (16 tests) plus `tests/unit/word/revisionAdapter.apply.test.ts` (17 tests) plus `tests/unit/word/capabilityProbe.test.ts` (12 tests) plus `tests/unit/word/smokeApply.test.ts` (5 tests) plus `tests/unit/taskpane/components/smokePlan.test.ts` (9 tests) cover gate refusal, validation failure, missing `currentDocHash`, hash mismatch, successful application, `body.getRange("Whole")` plus `range.set({ start, end })` offset resolution, all eight change kinds, reverse-offset application order, out-of-bounds range errors, unsupported-host refusal, per-change isolation, invalid-range and missing-payload pre-flight checks, the `setStage01Passed(true)` capability-snapshot requirement, Word-global break-enum resolution (plus the unavailable-enums failure path), Word-global break detection, the styles lookup-method fallback, `changeTrackingMode`/`trackRevisions` manageability, tracked apply with restore and fallback, demo-plan building, stale refusal, and selection locating/planning.
- `npx tsc --noEmit`, `npx eslint src tests --max-warnings 0`, `npx vitest run` (429 tests), `npm run build`, `npm run validate`, and `npm run stage:verify` all pass.
- Live in-Word adapter smoke is still pending; no mutation was attempted in this repository run. The adapter targets the documented Word JavaScript API (`body.getRange("Whole")`, `range.set`, `range.style`, `range.paragraphFormat.set`, `range.font.set`, `range.listFormat.set`, `range.insertBreak` with `Word.BreakType` plus `Word.InsertLocation`) but live host behavior for `range.set` (WordApiDesktop 1.4) and formatting paths remains unproven until a human sideload session records results below.

## Host matrix

| Host                     | Version | Browser/Engine    | Sideload OK | Taskpane renders | Probe passes | Notes                                                                 |
| ------------------------ | ------- | ----------------- | ----------- | ---------------- | ------------ | --------------------------------------------------------------------- |
| Word on the web (Chrome) | —       | Chrome            | ⬜          | ⬜               | ⬜           |                                                                       |
| Word on the web (Edge)   | —       | Edge              | ⬜          | ⬜               | ⬜           |                                                                       |
| Word on Windows          | unknown | Edge WebView2 153 | ✅          | ✅               | partial      | Stage 01 desktop result recorded below; truthful flags, not all true. |
| Word on Mac              | —       | Safari/WebKit     | ⬜          | ⬜               | ⬜           |                                                                       |

## Stage 01 Desktop Word result — 2026-09-21

Sideloaded Desktop Word taskpane, dev server on `https://localhost:3000`, fresh Word window, no browser address bar.

`probeWordCapabilities()` returned:

```json
{
  "supportsInsertText": true,
  "supportsReplaceText": true,
  "supportsInsertParagraph": true,
  "supportsInsertBreak": false,
  "supportsStyles": false,
  "supportsRevisions": false,
  "hostName": "Word",
  "hostVersion": null
}
```

`probeOfficeRuntime()` reported:

```text
User agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0
Office global present: true (type: object)
Office.onReady: true
Office.initialize: false
Office.run: false
Office.context present: true
Office.context.host present: false
Host name: (null)
Host version: (null)
onReady host: Word
onReady platform: PC
Office.roamingSettings present: false
Office.InsertBreakBehavior present: false
Word global present: true
Word.run: true
Word.InsertLocation: true
```

Interpretation:

- The probe ran inside Desktop Word without unhandled exceptions.
- `hostName: "Word"` comes from the authoritative `Office.onReady(info)` payload (`onReady host: Word`, `onReady platform: PC`). `Office.context.host` is absent in this host, so context-derived host identity is unavailable.
- `supportsInsertText`, `supportsReplaceText`, and `supportsInsertParagraph` are genuinely available through `Word.run`.
- `supportsInsertBreak` is false because `Office.InsertBreakBehavior` is absent in this host.
- `supportsStyles` is false under the current probe (`context.document.styles` did not yield a non-empty loaded `items` collection).
- `supportsRevisions` is false because `document.trackedChanges` was unavailable in this host/API surface.
- Per Stage 01, `supportsRevisions: false` means PASS WITH DOCUMENTED LIMITATION: later stages must use tracked-change insertion with explicit documentation where native revisions are unavailable.
- Word on the web (Chrome/Edge) and Word on Mac have not been tested yet.

## Probe checklist

- [ ] `probeWordCapabilities()` returns `supportsInsertText: true`
- [ ] `supportsReplaceText: true`
- [ ] `supportsInsertParagraph: true`
- [ ] `supportsInsertBreak: true`
- [ ] `supportsStyles: true`
- [ ] `supportsRevisions: true` (or documented limitation)
- [ ] `hostName` is `"Word"`

## Procedure

1. Build the release artifact: `npm run build`
2. Sideload into each host per `docs/onboarding.md`
3. Open a test document
4. Run the capability probe via the taskpane
5. Record results above and in `docs/project-state.md`

## Known limitations

- Desktop Word (Edge WebView2 153, 2026-09-21): `supportsRevisions` is false; native revision behavior is unproven, so Stage 01 is PASS WITH DOCUMENTED LIMITATION.
- Same host: `supportsInsertBreak` is false because `Office.InsertBreakBehavior` is absent.
- Same host: `supportsStyles` is false under the current styles probe.
- Same host: `hostVersion` is null; `Office.context.host` is absent, so version must come from another authoritative source or remain documented as unavailable.
- Word on the web and Word on Mac remain untested.
