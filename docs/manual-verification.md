# ToneForge — Manual Word Verification (Stage 27)

The canonical release status and open gate list are in
[`ROADMAP.md`](../ROADMAP.md). This file is the evidence record for real Word
hosts; it is not a replacement plan.

**Current evidence status: PARTIAL.** Desktop Word has recorded the Stage 01
probe and Stage 18 text-mutation smoke. Web Chrome, web Edge, Mac, and the
newer Phase C/E host paths remain open.

## Evidence rules

- Record the host product, version, browser/engine, build, and date.
- Record the exact capability result and any exception.
- Mark unsupported behavior explicitly; do not infer it from unit tests.
- Use a fresh disposable document for mutation checks.
- A PASS for a text path does not close break, style, list, protection,
  navigation, ribbon, context-menu, or observer gates.

## Host matrix

| Host                     | Version | Browser/engine    | Sideload | Task pane | Probe   | Current evidence                                                                                                                           |
| ------------------------ | ------- | ----------------- | -------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Word on Windows          | unknown | Edge WebView2 153 | PASS     | PASS      | PARTIAL | Desktop text insert/replace and tracking smoke recorded below. Breaks/styles remain false; Phase C/E and accessibility matrix remain open. |
| Word on the web (Chrome) | —       | Chrome            | PENDING  | PENDING   | PENDING | Not recorded.                                                                                                                              |
| Word on the web (Edge)   | —       | Edge              | PENDING  | PENDING   | PENDING | Not recorded.                                                                                                                              |
| Word on Mac              | —       | Safari/WebKit     | PENDING  | PENDING   | PENDING | Not recorded; Mac is conditional on the release-host decision.                                                                             |

## Desktop evidence — 2026-09-22

### Capability probe

The later Desktop probe returned:

```json
{
  "supportsInsertText": true,
  "supportsReplaceText": true,
  "supportsInsertParagraph": true,
  "supportsInsertBreak": false,
  "supportsStyles": false,
  "supportsRevisions": true,
  "hostName": "Word",
  "hostVersion": null
}
```

Interpretation:

- Text insertion/replacement and paragraph insertion were available.
- Tracking manageability was available through the corrected Word API path.
- Break support remained unavailable in the tested host because the required
  `Word.BreakType` value was absent; the probe did not guess an enum.
- Styles remained unavailable under the tested probe; a named-style lookup
  signal requires live re-probe before being trusted.
- Host version was not available through the observed context.
- Web and Mac results were not collected.

### Stage 18 text smoke

On a disposable Lorem Ipsum document with Track Changes enabled in Word:

- Gate refusal returned `applied: false` without fatal exceptions.
- Explicit gate enablement was required before mutation.
- Tracked text applies returned `managed: yes` and recorded counts.
- Repeated runs showed the documented best-effort recorded-count plateau.
- Only `insertText`/`replaceText` were exercised live.
- `insertBreak`, `applyStyle`, `setListLevel`, and formatting paths remain
  mock-verified.
- A fresh-document single-change insert-versus-replace check remains requested.

The abridged run is:

```text
Applied 0 of 1 change(s) — Stage 01 gate blocked.
Applied 0 of 2 change(s) — Stage 01 gate blocked.
Stage 01 gate enabled for this session.
Applied 1 of 1 change(s) — tracking managed: yes.
Applied 2 of 2 change(s) — tracking managed: yes.
Demo plan applied 2 of 2 change(s) — tracking managed: yes.
```

## Required remaining procedure

For each host:

1. Build with `npm run build` and sideload using `npm run sideload`.
2. Confirm the task pane loads with compact Office/Fluent styling; the hamburger
   opens navigation at the narrowest task-pane width, Escape/overlay dismissal
   works, and the active profile/version remains in the fixed header.
3. In Settings, change and save Styling, LLM, and Telemetry independently. Reload
   and confirm the committed Styling choice restores the matching Fluent/CSS
   palette. Confirm Settings offers no API-key entry, legacy credentials can be
   cleared, and no credential or document text appears in logs.
4. In Troubleshooting, turn **Enable tracked editing** off and confirm Apply is
   refused while Preview still works. Turn it on, confirm the fresh host probe,
   then perform the host capability probe and record the full JSON.
5. Create a deterministic formatting deviation that produces a
   `resetCharacterFormatting` change. Confirm Governance counts, Findings, the
   Safe Reformat preview, and Pending Changes all describe the same current scan.
6. Edit the document after preview and confirm stale Apply refusal. Resolve no
   conflicts through mutation; verify protected-content and conflict refusal.
7. Apply a current plan and record managed Track Changes, the exact applied count,
   and successful readback. Any `applied: false`, unsupported operation,
   unverified result, or thrown error must be reported as failure/refusal—not
   success.
8. Verify selection, paragraph, break, style, list, and tracking behavior
   appropriate to the host.
9. Verify Phase C ribbon, navigation/highlight, and context-menu behavior.
10. Verify Phase D consent, provider, and failure states.
11. Verify Phase E preflight, bounded progress, cancellation, and result states.
12. Record failures and limitations; do not mark a host complete without
    evidence.

## Known limitations

- Desktop Word: break/style limitations and unavailable host version.
- Web and Mac: no evidence yet.
- Full-document AI review, live provider/broker behavior, observer change-range
  behavior, keyboard/screen-reader behavior, and long-document measurements: no
  live evidence yet. The development broker is not production evidence.
- The consistency seam is reserved and no C1–C10 engine is present.
