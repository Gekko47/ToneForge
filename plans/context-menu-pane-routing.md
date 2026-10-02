# Context-menu pane routing

> **Status: implemented; superseded in part.** The first four steps landed, and so
> did the deep link (ADR-0109). The pane-identity conclusion in this document was
> **wrong** and is corrected below \u2014 see _Correction_, _The rule that was misread_,
> and _The page is the instruction_. Read this as a record of how the defect was
> found, not as the current design.

Make Semantic Review in the right-click menu open the one ToneForge task pane
\2014 the one already open if there is one \2014 and read the selected text into it.

## The problem, as reported

1. Right-click \u2192 **Semantic Review** opens a **second, blank** ToneForge window
   beside the pane the user already has.
2. The pane does not receive the selected text, or the caret's paragraph.
3. Clicking **Use current selection** in the pane also reported
   "There is nothing to review here" for a caret in a paragraph.

Bug 3 is **fixed** (ADR-0105) and confirmed working in a real Word. Bugs 1 and 2
are what this plan addresses.

## What actually causes bug 1

The context-menu control is an **`ExecuteFunction`** action. Its handler calls
`Office.addin.showAsTaskpane()`.

Microsoft documents the two kinds of add-in command, and the difference is the
whole defect:

| Kind                  | What it does         | Who provides the code |
| --------------------- | -------------------- | --------------------- |
| **Task pane command** | Opens the pane       | **Office**            |
| **Function command**  | Runs your JavaScript | Your runtime          |

A task pane command is declared entirely in markup with
`<Action xsi:type="ShowTaskpane">`, and **the host resolves the pane and opens
it**. No JavaScript runs, so the host has nothing to fall back to.

Our context menu is a function command. It replaced the one mechanism Office
guarantees with one we drive, and `showAsTaskpane()` is where it fails:

- It takes **no pane id**. There is no way to tell it which pane to raise.
- Its documentation says only that it "shows the task pane associated with the
  add-in". When the host cannot resolve that, it has been observed opening the
  shared runtime's **function file** (`/commands.html`) instead \2014 a window that
  is blank because it contains no UI at all.
- The blank window identified itself: it logged `syncSemanticRibbon` with
  `ControlIdNotFound`, and that message is emitted **only** by `commands.ts`,
  never by the task pane.

### Four wrong diagnoses, recorded so they are not repeated

This took five attempts. Each was defended with evidence and each was wrong.

1. **The `TaskpaneId` forked the pane** (ADR-0101). Removing it was reasonable,
   but it was not the cause \2014 and removing it took away the pane's identity
   without giving the shared runtime one to use.
2. **`localStorage` was blocked, so the instruction never arrived.** True \2014 the
   host reports "Tracking Prevention blocked access to storage" \2014 but that is
   not what opened the window. The instruction route and the pane-opening route
   are separate problems.
3. **`showAsTaskpane()` should be guarded so it only runs when the instruction
   was delivered.** It fixed the symptom once, which is exactly why it was
   believed, and it was reverted because it also stopped the pane being raised
   at all.
4. **`Office.addin` existing means the commands and the pane share one JavaScript
   context.** It does not. `showAsTaskpane` being available says the runtime is
   _long-lived_, not that a module instance is shared. This one caused a
   regression between two otherwise identical builds.

**What the pattern has in common.** Each fix was reasoned from documentation or
architecture and verified only in a mock. What finally identified the culprit was
a **console message in the offending window** \u2014 evidence from the host itself.
A symptom reported from the window you did _not_ expect is the cheapest evidence
available, and it should be read before the next build-and-sideload cycle, not
after it.

## Correction: one pane is made by a SHARED `TaskpaneId`, not by having one opener

The reasoning below concludes that the pane should be declared once. That is
wrong, and the `Action` element reference settles it:

> _"When you have multiple `ShowTaskpane` actions, use a different `<TaskpaneId>`
> if you want an **independent** pane for each. **Use the same `<TaskpaneId>` for
> different actions that share the same pane.** When users choose commands that
> share the same `<TaskpaneId>`, **the pane container will remain open** but the
> contents of the pane will be replaced with the corresponding Action
> `SourceLocation`."_
>
> \u2014 Microsoft, _Action element_

So the correct shape is **two `ShowTaskpane` controls sharing one `TaskpaneId`**.
That is what "the same pane, already open, reused" means, and Microsoft documents
it as the normal pattern for several controls addressing one pane.

**The observed symptom follows precisely.** With the `TaskpaneId` removed, two
`ShowTaskpane` actions with no id are two independent panes, which is what a real
Word then reported: _"the context menu currently opens its own pane which works
and the ribbon button runs its own instance."_ The `showAsTaskpane()` blank window
was the same fact seen from the other side.

### The rule that was misread

The shared-runtime guidance says that under a `<Host>` with a long-lifetime
`<Runtime>`, _none_ of the descendant `<Action>` elements should have a
`<TaskpaneID>`. That rule was quoted here as a **prohibition** and the element was
removed. It concerns the **auto-open** convention
(`Office.AutoShowTaskpaneWithDocument`), not a prohibition on naming a pane \u2014 and
the authoritative `Action` reference shows sharing a `TaskpaneId` as normal.

Removing it was a mistake, and the repository check was rewritten to **require**
its absence. A check that fails on the correct manifest is a check guarding the
defect; that is now the fourth time it has happened in this area.

### Corrected plan

1. **Restore `<TaskpaneId>ButtonId1</TaskpaneId>` on both `ShowTaskpane` actions.**
   One pane, shared, raised rather than duplicated.
2. **Invert the guard**: every pane-opening control must carry **the same** id.
   The rule is neither "no id" nor "one opener" \u2014 it is one **identity**.
3. **The text-pipe needs no channel.** With one pane the context menu re-raises
   the pane already open, so no instruction is written and no cross-document
   channel is involved \u2014 which matters, because `localStorage` is blocked on this
   host (ADR-0106).
4. **The pane reads the selection when summoned**: a **fresh** pane reads on
   mount, and an **existing** pane re-reads on `onVisibilityModeChanged`.
   `readSelectionScope()` already handles both a dragged selection and a caret
   expanded to its paragraph (ADR-0105, verified in a real Word), so this is
   existing behaviour invoked at the right moment, not new capability.
5. **Revert ADR-0104**, record the correction, and amend ADR-0107.

### Honest caveat

That `onVisibilityModeChanged` fires when an **already-open** pane is raised is
documented but **not verified in this host**, and no claim is made that it is. If
it does not fire, the fallback is for the pane to re-read on every arrival it can
observe, at the cost of a redundant read when the user switches back. That is a
small regression, not a failure.

## What is possible, and what is not

**Possible.** The context menu opens the one pane and, when the pane is already
open, Office raises it. Office resolves the pane itself, so the blank-window
fallback cannot occur.

**Also possible, and this section was wrong about it.** Telling the pane
**which page** to show. See _The page is the instruction_ below: `SourceLocation`
is the deep link, and no beacon is needed.

## The page is the instruction (ADR-0109)

The reasoning above assumed that because a task pane command runs no JavaScript,
it cannot address a page. It can. The same Microsoft sentence that settles the
identity settles this:

> _"...the pane container will remain open but the contents of the pane will be
> replaced with the corresponding Action `SourceLocation`."_
>
> \u2014 Microsoft, _Action element_

So the source location is not merely a destination. **It is the one thing such a
command can say**, and the supported way to address a page. That is a stronger
mechanism than the beacon deferred below, because it is resolved by the host
before any of our code runs \u2014 there is nothing to lose in transit, and nothing to
fail.

The shape:

| Route                               | `TaskpaneId` | `SourceLocation`        | Opens on         |
| ----------------------------------- | ------------ | ----------------------- | ---------------- |
| Ribbon \u2192 ToneForge             | `ButtonId1`  | `Taskpane.Url`          | the landing page |
| Context menu \u2192 Semantic Review | `ButtonId1`  | `Taskpane.Semantic.Url` | Semantic Review  |

**One identity, two pages.** The guard follows: what must be unique is the
`TaskpaneId`, and differing sources are not merely allowed but asserted. What must
still hold is that every opener's source **resolves** \u2014 a `resid` with no resource
opens nothing and reports nothing (ADR-0082).

**The division of labour.** The command chooses the page; the page chooses the
text. The selection read stays in the page and runs on mount, exactly as ADR-0108
decision 3 arranged, so the deep link composes with the read rather than replacing
it.

**What this cost in the repository.** Four checks named pages or commands
literally \u2014 the manifest validator's hard-coded pane id, the release checker's two
hard-coded page names, the build checker's entry list, and the registry exemption
for one command id. **All four broke on the addition**, and one of them broke in
the _test fixture_ rather than the product. Each now reads its page list **from
`manifest.json`**, and the registry exemption is **by kind**: `openPage` is a task
pane command, so it is not a function command and cannot appear in
`commandDefinitions.json`. A check that restates its subject is wrong in one
direction only.

**"Review in Editor" is not a model for this.** It is Microsoft's first-party
Editor pane, built into Word \u2014 not an add-in, with no manifest and **no public
API to open it**. Nothing can imitate it directly. The transferable idea is the
one above: a command whose code is provided by Office is a task pane command.

## Steps in this change (1\u20134)

### 1. The context menu becomes a task pane command

`manifest.xml`: the `ToneForgeSemanticContextControl` action changes from
`ExecuteFunction`/`ToneForgeSemantic` to `ShowTaskpane` with the same
`SourceLocation` the ribbon entry point uses.

`manifest.json`: the context-menu entry's action becomes an `openPage` action
pointing at the same runtime that already carries `ToneForgeTaskpane`, so both
routes address one pane.

### 2. One pane identity

The context menu and the ribbon entry point declare the **same** source
location. This is the shape ADR-0104 describes, and it is what makes "the pane
you already have" the pane that opens.

### 3. `showAsTaskpane()` leaves the function commands, permanently

`commandHandlers.ts` no longer calls it. This is already true from the previous
attempt; what is new is that it is now **correct** rather than a workaround,
because no function command needs to open a pane.

### 4. Declare the API instead of casting it

`Office.addin` is entirely absent from `src/types/office.d.ts`, which is why every
call was a hand-rolled cast \u2014 the exact weakness ADR-0084 warns about. Add
`showAsTaskpane`, `hide`, and `onVisibilityModeChanged` as **optional** members
(absence is the interesting case and must stay expressible) and
`VisibilityMode` as the enum the handler receives.

## Deferred: step 5, the pane announcement

Only if the host test shows a pane that opens but does not navigate.

The pane posts a liveness beacon on mount over a channel a privacy setting
cannot switch off; the pane re-reads the selection when it sees one, through the
**same** code path as **Use current selection**, which is already known to work.

**This mechanism is unproven in a real Word**, exactly as `BroadcastChannel` was.
It is deliberately not bundled with the manifest change so that a failure has one
cause and one fix.

## Tests

- The context-menu control declares `ShowTaskpane`, in both manifests.
- Every pane-opening control carries **the same** `TaskpaneId` \u2014 one identity, not
  one opener.
- Each pane opener names a **distinct page that resolves**, served from the one
  origin the manifest declares.
- **No function command may call `showAsTaskpane`**, for any destination \u2014 the
  assertion that would have caught this on the first attempt.
- A pane command whose source names a resource that does not exist is rejected.
- The navigation instruction is consumed exactly once across every delivery
  route.
- `Office.addin` declarations match the host's documented shape.
- The release checker bundles **every** page the manifest names, so a second page
  shipping no JavaScript fails the build rather than the user.

## Verification

`npm run verify` \u2014 all thirteen stages.

Then, in a real Word, **after a full sideload cycle** (`npm run stop`, close every
Word window, `npm run sideload` \u2014 Word caches the manifest at registration):

1. With **no** pane open, right-click a paragraph \u2192 Semantic Review. Expect one
   pane, opening on Semantic Review.
2. With a pane **already open**, right-click a selection \u2192 Semantic Review.
   Expect no second window, and the existing pane raised. Whether it
   _navigates_ is the step-5 question.
3. Confirm the selection or caret paragraph appears in the Selection card.

## Evidence

`docs/decision-log.md` (ADR-0101, ADR-0104, ADR-0105, ADR-0106, ADR-0108,
ADR-0109);
`docs/manual-verification.md`; `src/commands/commandHandlers.ts`;
`src/shared/office/taskpaneNavigation.ts`; `manifest.xml`; `manifest.json`;
Microsoft: _Add-in commands_, _Show or hide the task pane of your Office
Add-in_, _Configure your Office Add-in to use a shared runtime_.
