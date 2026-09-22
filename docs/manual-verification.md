# ToneForge — Manual Word Verification (Stage 27)

This file records manual Word host results. **Status: IN PROGRESS — Stage 01 Desktop Word result recorded; full Stage 27 matrix still pending.**

## Stage 18 unit verification note

- `tests/unit/word/revisionAdapter.test.ts` (16 tests) plus `tests/unit/word/revisionAdapter.apply.test.ts` (12 tests) cover gate refusal, validation failure, missing `currentDocHash`, hash mismatch, successful application, `body.getRange("Whole")` plus `range.set({ start, end })` offset resolution, all eight change kinds, reverse-offset application order, out-of-bounds range errors, unsupported-host refusal, per-change isolation, invalid-range and missing-payload pre-flight checks, and the `setStage01Passed(true)` capability-snapshot requirement.
- `npx tsc --noEmit`, `npx eslint src tests --max-warnings 0`, `npx vitest run` (401 tests), `npm run build`, and `npm run validate` pass for the Stage 18 code and tests. `npm run stage:verify` reports format FAIL only on pre-existing unformatted files outside Stage 18 scope (e.g. `src/core/state/persistence.ts`, `src/taskpane/`); all Stage 18 files are Prettier-clean.
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
