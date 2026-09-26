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

## Local debugging workflow

ToneForge supports two equivalent local Word debugging entry points:

1. **Visual Studio Code / Edge WebView2:** select **Word Desktop (Edge
   Chromium)** in **View** | **Run** and press F5. The tracked
   [`launch.json`](../.vscode/launch.json) and [`tasks.json`](../.vscode/tasks.json)
   start the existing Webpack server, sideload the add-in, open Word, and attach
   the Microsoft Debugger for Edge extension. This requires that extension to be
   installed in Visual Studio Code.
2. **Terminal workflow:** the existing `office-addin-debugging` commands.

```text
npm run dev
npm run sideload
npm run stop
```

For F5, record whether the pre-launch task started, Word opened, the webview
attached, breakpoints fired, and Shift+F5 completed cleanup. Microsoft documents
that breakpoints inside `Office.initialize` and `Office.onReady` are ignored;
record initialization failures separately through runtime diagnostics or Edge
developer tools.

The `sideload` step loads the add-in in Word; Edge/WebView2 developer tools and
Microsoft runtime logging are used when host-level diagnostics are required.
Closing Word or the server does not reliably unregister the add-in, so every
session must end with `npm run stop`.

Microsoft 365 Agents Toolkit is a project creation/import environment for
Microsoft 365 apps, agents, and Office Add-ins. It is not a drop-in debugger for
ToneForge's existing repository. A future Agents Toolkit migration would
require a separately approved import/restructure project and is not part of
this evidence record. See
[`plans/dependency-remediation-plan.md`](../plans/dependency-remediation-plan.md).

## Host matrix

| Host                     | Version | Browser/engine    | Sideload | Task pane | Probe   | Current evidence                                                                                                                                               |
| ------------------------ | ------- | ----------------- | -------- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word on Windows          | unknown | Edge WebView2 153 | PASS     | PASS      | PARTIAL | Desktop text insert/replace and tracking smoke recorded below. Breaks/styles remain false; Phase C/E and accessibility matrix remain open.                     |
| Word on the web (Chrome) | —       | Chrome            | PENDING  | PENDING   | PENDING | Not recorded. A debug path now exists via **Word on the Web (Chrome)** in [`.vscode/launch.json`](../.vscode/launch.json); no evidence has been collected yet. |
| Word on the web (Edge)   | —       | Edge              | PENDING  | PENDING   | PENDING | Not recorded. A debug path now exists via **Word on the Web (Edge)** in [`.vscode/launch.json`](../.vscode/launch.json); no evidence has been collected yet.   |
| Word on Mac              | —       | Safari/WebKit     | PENDING  | PENDING   | PENDING | Not recorded. Out of scope: Mac is not a release commitment and no Mac hardware is available, so no Safari/WebKit debug configuration is provided.             |

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

## Local debugging evidence — 2026-09-25

Reported by the maintainer on Windows with Word Desktop, after the dependency
remediation recorded in
[`plans/dependency-remediation-plan.md`](../plans/dependency-remediation-plan.md).

| Check                                | Result            | Notes                                                            |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------- |
| F5 from Visual Studio Code           | **PASS (launch)** | The pre-launch task ran and Word Desktop opened with the add-in. |
| Breakpoint firing in task-pane code  | **Not reported**  | Required before the debugger gate can be called complete.        |
| `npm run sideload` from the terminal | **PASS**          | Manual sideload works with the upgraded tooling chain.           |
| `npm run stop` cleanup               | **Not reported**  | Still required at the end of every session.                      |

This closes the tooling question only: both the `office-addin-debugging@5.1.6`
chain and the VS Code F5 path reach Word Desktop. It does **not** close the
wider host matrix, which still needs break, style, list, tracking, ribbon,
accessibility, provider, and performance evidence, plus the web and Mac hosts.

## Required remaining procedure

For each host, build and sideload with the current documented workflow, and
record which Word version/build and browser engine were used:

```text
Build:    npm run build
Sideload: npm run sideload
Cleanup:  npm run stop
```

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
