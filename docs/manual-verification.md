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

### After changing a manifest

A manifest change behaves nothing like a code change, and this has cost real
debugging time: the ribbon tab and the context-menu entry were both absent from
a live Word after being added, correctly, to both
[`manifest.json`](../manifest.json) and [`manifest.xml`](../manifest.xml).

**A manifest change requires a full Word restart, not a pane refresh.** Word
reads and caches the manifest when the add-in is first registered. Closing the
task pane, reloading the webview, or restarting the Webpack dev server changes
none of that — Word is still holding the manifest it read at registration.

The order matters, because stopping after the wrong step leaves a stale
registration behind:

```text
npm run stop          # unregister first, or Word keeps the old manifest
# close every Word window — a background Word process keeps the registration
npm run sideload      # re-register with the new manifest
```

Both npm scripts operate on [`manifest.xml`](../manifest.xml), which is the
manifest the Office Add-in debugging tool registers. The unified
[`manifest.json`](../manifest.json) is the deployment manifest and is validated
in CI, but a local sideload does not read it — which is exactly why a control
added to only one of the two files produces a build that passes every check and
a Word that has never heard of it.

If the ribbon or context menu is still missing after that, the cause is not in
this repository, and an absent control is not by itself evidence of a rejected
manifest: Word can also fail to register a manifest it has already accepted, a
control can fail to render, and a host can silently drop a command the platform
does not support. Treat it as unknown until Word says otherwise, and use Word's
own logs and UI diagnostics to establish the cause. Check, in order:

1. **Both manifests.** `manifest.json` (unified, v1.30) and `manifest.xml` must
   declare the same controls. A control in one and not the other is the most
   common cause, and it fails silently.
2. **`npm run validate`.** `scripts/validate-manifest.mjs` checks the JSON
   against the schema and verifies referenced files exist. The schema check in
   `tests/unit/commands/commandContracts.test.ts` catches the shape errors that
   a real Word only reports as "the add-in did not load".
3. **The shared runtime.** `Office.ribbon.requestUpdate` and
   `Office.contextMenu.requestUpdate` — which is what enables and disables the
   semantic button at runtime — require a shared runtime. The manifest declares
   the `SharedRuntime`, `RibbonApi`, and `ContextMenuApi` capabilities, and the
   runtime that carries the commands (`CommandsRuntime`) is `lifetime: "long"`.
   If that lifetime is ever shortened, or a capability is dropped, those calls
   reject and the control stays at whatever state it was declared in — the
   semantic button ships `enabled: false` and is turned on at runtime, so it
   would remain greyed out with no error shown to the user.
4. **Word's add-in log.** On Windows this is under
   `%LOCALAPPDATA%\\Microsoft\\Office\\16.0\\Wef\\`.

None of this involves a provider. The ribbon tab and the context-menu entry are
declared statically in the manifest and are present whether or not an LLM is
configured; a missing model affects only the requests that would have been made
after a control is pressed.

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

## Open gate — the structural scopes are host-unverified (ADR-0086)

Every capability this pass added — tables, sections, headers and footers, page
setup — was implemented against Microsoft's **published API reference**, not
against a Word host. The probe can be wrong the same way the old
`paragraphFormat` request was wrong (ADR-0084): it checks that a member exists,
which is not the same as the member serving what was asked of it.

`npm run host:matrix` reports **0 fully passing hosts**. The procedure below is
what would turn "documented limitation" into "verified", and it has not been run.

Run on **Desktop Word** first, on a document that has all four, and record the
result of each. A failure is as useful as a pass here — ADR-0084's defect was
found by a name the API reference did not list, and it cost a scan its whole
paragraph-format family silently.

1. **Tables (§8.3).** In a document containing a table, run a scan. Record
   whether the coverage banner reports `tablesExamined` above zero, and whether a
   table style that differs from the profile produces a `formatting.tableStyle`
   finding. Then check the acquisition log for a `GeneralException`: `style`,
   `styleBuiltIn`, `values`, `rowCount` and `headerRowCount` are the only names
   requested, and Word rejects the whole request if any of them is wrong.
2. **Sections and page setup (§8.5).** Record whether `sectionsExamined` matches
   the section count, and whether a portrait document with a landscape profile
   standard produces a `formatting.pageSetup` finding naming the orientation.
3. **Headers and footers (§8.4).** Add a header, then scan. Record that **six**
   entries appear for a one-section document — three slots × two kinds — and that
   a section with no footer reports it as `required: false` rather than omitting
   it. Reading only the primary slot would make the first-page and even-page
   entries permanently unreported.
4. **Word on the web, same document.** This is the case the second transaction
   exists for. Record whether the scan _completes_ — body text, paragraphs,
   styles and all — with `sectionsExamined: 0` and a `PageSetup` warning in the
   log. A scan that reports text-only here would mean the desktop-only
   `pageSetup` request is still being folded into the shared load.
5. **The scope policy (§9).** With headers and footers switched off in the
   governance policy, confirm the scan does **not** read them and that the
   coverage report lists the scope as excluded rather than as checked. This is
   the assertion that `planAcquisitionLoads` now receives `policy.scope` at all.
6. **`mandatoryScopes` (ADR-0087).** Add a mandatory scope the host cannot read,
   confirm Apply is refused and the banner names the scope; then remove it from
   the mandatory list and confirm Apply is available while the banner still
   reports the gap as a limitation.
7. **The post-apply report (§19).** Apply a plan of two or more changes. Record
   that the result block lists **every** change with its own outcome and that the
   counts add up, and that the remaining-findings line reflects a fresh scan of
   the document rather than the pre-apply list.

## Known limitations

- Desktop Word: break/style limitations and unavailable host version.
- Web and Mac: no evidence yet.
- Full-document AI review, live provider/broker behavior, observer change-range
  behavior, keyboard/screen-reader behavior, and long-document measurements: no
  live evidence yet. The development broker is not production evidence.
- The C1–C10 consistency engines are implemented and unit tested, but none has
  been run against a real document in Word. The unit tests prove the comparison
  logic; only a host run can show that a real document produces the conflicts the
  engine claims it would, and that the model adjudication behaves as reported
  when it is genuinely consulted.
- **The table, section, header/footer and page-setup scopes are host-unverified**
  (ADR-0086). They are implemented, unit tested against strict host doubles, and
  written to fail closed — every capability defaults to `false`, so a host that
  does not serve them reports them as unsupported rather than as compliant. What
  is unverified is whether the property names are right: they come from
  Microsoft's published reference, and ADR-0084 is the record of what a name from
  that reference that the host does not have costs. See the open gate above.
- **The post-apply result block and the deterministic profile sections have not
  been rendered in Word** (ADR-0088, ADR-0089). The unit tests prove what they
  render and when; they cannot show the pane at 320px with the collapsible
  sections open, or the result block beside a list of tracked revisions.

## Open gate — re-test of the live-Word corrections (ADR-0065–0070)

Six defects were found by using the add-in in a real Word document. All six are
fixed and unit-verified. **None has been re-tested in Word**, which is the whole
point of recording them here: a fix verified only by the suite that did not catch
the original bug is not a verified fix.

Re-run, in this order, and record the result of each:

1. **Apply on a list-only document** (ADR-0066). Open a document made entirely
   of list items, scan, review one finding, apply it. The original symptom was
   `Required in-scope node type inaccessible: paragraph/heading` and a permanently
   disabled Apply. Record whether coverage reports complete and whether Apply
   becomes available.
2. **Apply writes only what was reviewed** (ADR-0065). With a plan of several
   changes, review exactly one. Record that the button reads `Apply 1 reviewed
change`, that the preview table shows one row, and — the part that matters —
   that the applied Word revision count is 1, not the plan's length.
3. **Semantic profile management** (ADR-0068). With no semantic profile, confirm
   **Create empty profile** reaches an editable profile without a sample or a
   provider. Then create a second, switch between them, and confirm the pending
   rewrite is dropped on the switch.
4. **No stale flash while typing** (ADR-0067). Type continuously for several
   seconds. Record whether the stale banner appears at all. It should appear
   only if a refresh genuinely fails — never merely because you are typing.
5. **Every refusal names its control** (ADR-0069). Open Troubleshooting with
   auto-scan off and tracked editing off. Record that each entry names a
   control, and that renaming a control in code now fails a test.
6. **Ribbon and context menu after a clean re-sideload** (ADR-0070). Follow
   **After changing a manifest** above exactly. Record whether the tab and the
   menu entry appear. If they do not, record that as **unknown** — an absent
   control is a symptom with several possible causes (a rejected manifest, a
   stale cached copy of the manifest, or the entry simply being off the screen
   in a collapsed group), and naming the cause here would be a claim the test
   has not earned. Capture `%LOCALAPPDATA%\Temp\OfficeAddins.log.txt` and let
   the host's own diagnostics establish the cause before recording it as a
   rejection.

Until this is recorded, describe these six as "fixed and unit-verified, not yet
confirmed in a host". No release claim rests on them.

## Open gate — incremental scan scope (ADR-0063)

The observer narrows a scan to the paragraphs Word reports as changed when the
host supplies a complete set of local ids. The _decision_ is unit tested
exhaustively; whether Word actually supplies them is not, and cannot be.

Record for each host build:

1. Whether a single-paragraph edit produces a coverage report whose
   `examinedNodeIds` is a strict subset of the acquired nodes, or whether it
   stays whole-document. Record the count in both cases.
2. Whether `source` is reported as `local` for a local edit.
3. Whether an event ever arrives with `requiresFullRescan: true` for an ordinary
   keystroke burst. If it does, the narrowing is inert in practice and the pane
   is running the conservative path, which is correct but is not a speedup.
4. Whether deleting a paragraph triggers a full rescan, and whether a remote
   collaborator edit does. Both are expected to widen to the whole document.

Until this is recorded, describe the behaviour as "incremental where the host
reports complete local ids, conservative full rescan otherwise" and do not
claim a measured speedup.

## Open gate — selection-change events in Word (ADR-0094)

The semantic pane reads the selection on an explicit click, at the size of the
selection. Whether a Word host will _tell_ it when the selection moves is a
different question, and it is open.

What is established from the published requirement sets: `WordApi` and
`WordApiDesktop` expose no document-level selection event — the only Word
`onSelectionChanged` is `ContentControl`'s (WordApi 1.5), which reports
content-control focus. The Office surface does expose one:
`Office.context.document.addHandlerAsync("documentSelectionChanged", …)`, with
Microsoft's own note that in Word "selection events are text or content focused"
and that handlers must be tested per host.

Nothing below may be marked passed from a unit test run. A mock cannot raise an
event the host never raises.

Record for each host build — Word for Windows, desktop Word on the web, Word on
the web:

1. Whether
   `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler)`
   resolves. Record the error if it rejects.
2. Whether moving the selection across a paragraph boundary fires the handler,
   and how long after the move it arrives.
3. Whether collapsing and re-expanding the selection fires it.
4. Whether an undo or a remote collaborator's edit fires it.
5. Whether the handler keeps firing after the task pane is closed.

A host that fires gets a subscription in P7 that re-reads and invalidates; a
host that does not keeps the explicit "Use current selection" read, which is the
control that works everywhere. **Record the host and version that declined —
do not record "Word has no selection events", which is a claim about a product
rather than about a build.**

## Open gate — the two semantic destinations (P9)

The split shipped in P7 and was made navigable in P9: one ribbon command
labelled **Semantic Review**, opening `semantic-review`, and a second pane
destination `semantic-style` reached from the drawer and from the Review page.
Nothing below can be checked from a test run — the destination is a host
behaviour, and the labels are read by Word, not by us.

**Requires the full sideload cycle** (`npm run stop` → close every Word window →
`npm run sideload`), because the label and supertip live in the manifest and
Word caches the manifest at registration. A pane refresh shows the old labels.

Per host (Windows desktop, Mac desktop, Word on the web):

1. Confirm the ribbon control reads **"Semantic Review"** and its supertip says
   a revision is approved **on the Semantic Review page**. A supertip naming
   Deterministic Review is the pre-P9 text and means Word is holding a cached
   manifest.
2. Right-click a paragraph and confirm the context-menu entry reads the same
   thing. The two manifests are separate files; one updated and one stale shows
   up here and nowhere else.
3. Press the ribbon control with a selection active. Confirm the pane opens
   **Semantic Review** and the selection is already read — it must not need
   selecting again.
4. Press it with **nothing** selected. Confirm the pane opens and says the
   selection is empty rather than reviewing the whole document.
5. Open the drawer. Confirm **Semantic Review** and **Semantic Style** are both
   present, adjacent, and that neither is labelled "Semantic".
6. From the Review page, press **Semantic Style**. Confirm the style editor
   opens; press its breadcrumb and confirm it returns to **Semantic Review**, not
   to Deterministic Review.
7. With **no** deterministic profile configured, open Home and press
   "Set up semantic style profile". Confirm it lands on Semantic Style. The
   style editor is the one page that can _create_ a profile, so it must be
   reachable without one.
8. Confirm the control is still disabled when no semantic style profile exists,
   and that learning one turns it on without a Word restart.

Record the host and version for each. A label that is correct in one manifest and
stale in the other is a passing build and a wrong product, so check both.

## Open gate — live accessibility evidence

The accessibility claims in `docs/accessibility.md` are covered by jsx-a11y lint
and by component tests that assert roles, names, and state. They are **not**
screen-reader evidence, and unit tests cannot produce any: axe and Testing Library
check the markup contract, not whether a user can hear it work.

Nothing below may be marked passed from a unit test run.

### 1. Task-pane keyboard traversal

With the task pane open and no host interaction:

1. Tab from the browser chrome into the pane. Confirm the first stop is the
   navigation trigger, not the document.
2. Tab through every control. Confirm no stop is invisible or zero-size.
3. Open the navigation drawer, confirm Tab is contained inside it, confirm
   Escape closes it, and confirm focus returns to the trigger.
4. Reach Findings, expand it, and confirm the list, the toolbar, and each card
   are all reachable and that the position readout updates.
5. Repeat on a 320px-wide pane. Confirm nothing is clipped horizontally.

### 2. One live region

With a screen reader running, open the task pane and run a scan.

1. Confirm a scan result is spoken **once**. Three sources write to one region,
   so a burst must collapse into a single sentence rather than three.
2. Confirm an apply refusal and a scan completion in quick succession are spoken
   in the order they happened, not in DOM order.
3. Confirm a rescan of an unchanged document does not repeat the same sentence.

### 3. Disabled controls and their reasons

1. Turn tracked editing off, then attempt to apply. Confirm the disabled reason
   is reachable by keyboard and the Open Settings button is reachable from it.
2. With tracked editing on and an incomplete coverage report, confirm the apply
   refusal names what was not processed.

### 4. Dark theme contrast

**This section previously overclaimed.** It said the inline hex values had
been replaced "for exactly this", while two components still carried them — and
both of those had no production caller, so nothing rendered them and nothing
looked wrong. That is now fixed and enforced by a lint rule rather than by a
claim; the check below is what the lint rule cannot do.

1. Switch to dark theme. Confirm no component falls back to a hardcoded light
   palette. `npm run lint` rejects a colour literal in any file under
   `src/taskpane/`, with `src/taskpane/fluentTheme.ts` exempt because it
   _defines_ the palette. Run it before looking, so what you are judging is
   rendering and not a literal someone has not committed yet.
2. **Dropdowns and text fields must not render light-on-dark.** This is the
   reported defect and the one no test can settle. Every Fluent component
   renders a real `<input>` underneath carrying an `ms-` class, and
   `taskpane.css` used to style bare `input, select, textarea` — so the rule
   landed on Fluent's own fields as well as on the native ones. The rules are
   now scoped with `:not([class*="ms-"])`. Open the Deterministic Style
   Profile tab in dark theme and confirm every Dropdown and TextField is
   legible, including the ones inside a collapsed section.
3. Open the Semantic tab in dark theme. Confirm the section frames follow the
   theme; one of them was a literal `#edebe9`, the light theme's own neutral,
   so its border stayed light while every other surface followed the token.
4. Confirm focus indicators remain visible in both themes. Focus rings
   deliberately still apply to Fluent's inputs — they are an outline, not a
   palette, and a keyboard focus indicator is not something Fluent should own.
5. Repeat the whole section in light theme. A rule that only works because the
   page happens to be light is not a themed rule.

### 5. Reduced motion

With the OS reduced-motion preference set, confirm no non-essential animation
runs. The theme module derives `reducedMotion` from the media query; confirm it
also suppresses the announcement debounce visual behaviour if any is added.

Record host product, version, browser, screen reader and version, build, and
date for each. Until this is recorded, `docs/accessibility.md` claims markup
conformance only.
