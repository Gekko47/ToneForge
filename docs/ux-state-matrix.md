# ToneForge UX State Matrix

## Production taskpane contract

The production main view is a compact governance workflow, not a developer
dashboard. It presents one current document-readiness state at a time:
not started, scanning, fresh, clean, stale, incomplete, or failed. Coverage
means that the requested in-scope content was inspected without unexpected
processing gaps; it does not mean that zero findings exist or that unsupported
and protected areas were silently included. Findings and Pending Changes are
collapsible sections on this page, while AI Review is isolated on its own page.
Safe Reformat is rendered above them, because it is the control that produces the
plan they display. Once Safe Reformat previews a plan, its report is the single
current Governance/findings source until Apply or a new scan supersedes it.
Reformat preview is not a mutation action; Pending Changes owns the single
plan-level Apply and Reject workflow. A fixed header contains a Fluent hamburger
navigation panel and a non-wrapping active-profile summary. The header and
LLM Settings/General Settings/Troubleshooting navigation remain available on the
first-run profile setup state, so a user is not locked out of the AI Review
consent before they have a profile. Capability probes and coverage acquisition
diagnostics live in Troubleshooting; the tracked-editing preference is an
ordinary user setting on General Settings (ADR-0055) and Troubleshooting only
reports the current state. The
production taskpane contains no historical Stage 18 smoke controls; they were
removed in Phase 1 (ADR-0058).

This matrix covers the Phase C Word-native task-pane states. Status is always
communicated with text; colour is supplementary only. A disabled action is
listed with the service condition that must be satisfied before it can run.

| State                             | Trigger                                                                 | Expected visual/status                                                                                                                                                                       | Enabled actions                                       | Disabled actions                | Service state                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Initial loading                   | Task pane opens                                                         | “Loading…” with status announcement                                                                                                                                                          | None                                                  | Scan, AI review, Apply          | Office initialization pending                                                                        |
| No profile                        | Dashboard starts without a profile                                      | Plain-language setup message                                                                                                                                                                 | Open Style profile                                    | Scan, Apply                     | No active StyleProfile                                                                               |
| Scanning                          | Scan now or initial observer scan                                       | Live status with last scan time                                                                                                                                                              | View findings when results exist                      | Apply while scan is running     | Document observer scanning                                                                           |
| No findings                       | Scan completes with no findings                                         | “No open governance findings.”                                                                                                                                                               | Scan now                                              | View findings when empty        | Findings array empty                                                                                 |
| Open findings                     | Scan returns findings                                                   | Mandatory/advisory counts and category list                                                                                                                                                  | View findings, Go to text, Review, Ignore             | Apply without preview           | Findings available                                                                                   |
| Finding card                      | User opens findings                                                     | Category, source, severity, explanation, actual/expected, location                                                                                                                           | Go to text, Review, Ignore                            | Unsupported navigation          | Finding is in current run                                                                            |
| Coverage complete                 | Requested scope has no unexpected processing gaps                       | “Coverage Complete” and scope-qualified language                                                                                                                                             | Normal review actions                                 | None                            | `CoverageReport.complete === true`; technical details in Troubleshooting                             |
| Coverage incomplete               | An unexpected required node or processing window gap remains            | “Coverage Incomplete” and reason text                                                                                                                                                        | Re-scan, inspect exclusions                           | Plan-level Apply                | `CoverageReport.complete === false`                                                                  |
| Stale findings                    | A refresh fails, or the document changed and the re-scan has not landed | “Findings are stale” and re-scan prompt. A scheduled re-scan does **not** raise this: a banner that appears and clears inside the debounce window describes a transient state, not a problem | Re-scan now                                           | Apply stale results             | `DocumentObserverStatus.stale`; a scheduled scan is not staleness (ADR-0067)                         |
| Pending changes empty             | Pending Changes view has no plan                                        | “No pending changes to review.”                                                                                                                                                              | Return to governance                                  | Apply, Reject                   | No ChangePlan                                                                                        |
| Pending changes, none reviewed    | A plan exists but no finding has been marked reviewed                   | “{n} change(s) are waiting for review.” Apply is unavailable, and the reason is on the section — not only on a disabled button                                                               | Review on each finding, Reject                        | Apply                           | The plan contains no reviewed finding. Apply writes only reviewed changes (ADR-0065)                 |
| Pending changes ready             | At least one finding has been reviewed                                  | `Apply {n} reviewed change{s}` alongside before/after, risk, and source rule. The count is of reviewed changes, never of the whole plan                                                      | Apply reviewed changes, Reject all                    | Apply with unresolved conflicts | The reviewed subset of a current, conflict-free plan                                                 |
| Apply succeeded                   | Orchestrator verified and applied plan                                  | Result count and tracking status                                                                                                                                                             | Scan again                                            | Apply same stale plan           | Mutation path completed                                                                              |
| Apply refused                     | Hash mismatch, conflict, or gate refusal                                | Plain-language refusal reason                                                                                                                                                                | Re-run preview, Reject                                | Apply stale plan                | Orchestrator refusal                                                                                 |
| AI provider missing               | No approved provider or development broker available                    | Deterministic-only message                                                                                                                                                                   | Open LLM Settings, deterministic actions              | All AI review actions           | No usable `ProviderConnection`; the registry falls back to the offline mock                          |
| Consent absent                    | AI entry point selected without opt-in                                  | Consent explanation                                                                                                                                                                          | Open LLM Settings, deterministic actions              | AI review actions               | Explicit raw-text consent absent                                                                     |
| Selection unsupported             | Host cannot expose selection                                            | Capability explanation                                                                                                                                                                       | Paragraph/document entry when available               | Review selection                | `supportsSelection === false`                                                                        |
| Paragraph unsupported             | Host cannot resolve paragraphs                                          | Capability explanation                                                                                                                                                                       | Selection/document entry when available               | Review paragraph                | `supportsParagraphResolution === false`                                                              |
| Host cannot apply tracked changes | Probe reports `supportsRevisions === false`, or tracked editing is off  | The main page states which, and Apply is rendered unavailable with the same reason rather than failing on click                                                                              | Preview, review, Scan now                             | Apply                           | `applyReadiness` — the preference and the host verdict are separate facts with different remedies    |
| Word host unavailable             | A scan fails because the Office runtime is gone                         | "Word is unavailable", stating that the document has not changed                                                                                                                             | Scan again                                            | Apply                           | `DocumentObserverStatus.hostUnavailable`; distinct from stale findings, which need a re-scan instead |
| AI review entry                   | AI Review page                                                          | One `AI Review` section with a whole-document-only button, disabled with a single adjacent hint when consent or a provider is missing. The hint is stated once, not once per control.        | Open LLM Settings from the hint, otherwise the review | The consistency run             | `AiReviewSection`; the engine's own consent gate refuses a second time                               |
| Navigation unsupported            | Host rejects range selection                                            | Logged safe no-op and user message                                                                                                                                                           | Return to findings                                    | Unsupported Go to text          | Source locator cannot select range                                                                   |

## Semantic Style states

Semantic Style carries the only editable profile in the product, and the only
one a user creates by hand. Three rules shape it:

- **Consent governs sending text, not editing.** Typing a tone into a local
  field sends nothing. The editor is never disabled by missing semantic
  consent — doing so locked out exactly the user who had declined. (ADR-0068)
- **A blank profile is a first-class route in.** Learning needs a sample that
  passes the quality gate, so create-empty is what makes the page reachable for
  a document too short to sample, with no provider involved.
- **Learning does not activate.** A learned style is a draft. "Make this
  active" is a second press, and the page says so while it is unactivated.

| State                 | Trigger                                   | Expected visual/status                                                                                                          | Enabled actions                                      | Disabled actions                            | Service state                                                                                                  |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No semantic profile   | No record is active                       | "No semantic profile is active", explaining there is nothing to measure, edit, or match. Create empty profile is offered        | Create empty profile, learn from a sample or file    | Make this active                            | `activeSemanticProfileId === null`; the ribbon's semantic button is also off                                   |
| One profile           | A record is active                        | Picker lists it as **Active — {name}**; the editor is populated, and the sample diagnostics sit behind a closed disclosure      | Edit semantic values, switch, delete, activate       | Make this active while already active       | `effectiveProfile(record) !== null`                                                                            |
| Draft not active      | A style was learned or created just now   | "This draft is not active yet, so Semantic Review still uses the profile you chose before."                                     | Edit, make this active, publish, recall              | Nothing; activation is the one press needed | The record is created with `activate: false`                                                                   |
| Several profiles      | More than one record exists               | Every row names its target in its accessible name, so a screen reader user can tell them apart                                  | Switch, delete, create empty                         | Delete is offered for the last one too      | Switching drops any pending proposal — it was made against the previous voice                                  |
| Create empty          | User presses it with no sample available  | A blank record is created immediately, with no model call and no sample quality gate                                            | Edit semantic values by hand, make this active       | Nothing once the draft exists               | The `kind` is passed explicitly, or the record lands in the deterministic namespace                            |
| Sample too thin       | A sample under 100 words                  | A persistent badge carries the word count, the level, and the consequence. Acknowledgement is asked only for the two thin bands | Learn anyway, once acknowledged                      | Learn style until acknowledged              | Eligibility (40 words) and confidence (100/300/1000) are two axes; only one gates                              |
| Measured value absent | Learned from too short a sample           | "Sample diagnostics" is collapsed; opened, a missing value reads "not measured yet", never 0                                    | Show diagnostics, learn from a longer sample         | None                                        | `measured.*` is nullable by design; the block is derived, not authored                                         |
| Consent absent        | Semantic consent is off                   | The blocker is stated once, above the learn control, with an Open Settings button. The editor below stays usable                | Create empty profile, edit locally, use the document | Learn style                                 | Consent gates the request, not the record                                                                      |
| File refused          | A `.docx`, or a file over 1 MB, is chosen | The reason is stated beside the picker: a `.docx` is a binary archive, and the size is given                                    | Choose another file, or paste instead                | Nothing — no file was read                  | Extension checked first; the MIME type is advisory, and a control-character ratio catches a mis-picked archive |

## Semantic Review states

Semantic Review is the page the ribbon command opens. It sends the selected text
to a provider, so its states are about consent, cost and the host's write
capability rather than about a profile.

| State                   | Trigger                                  | Expected visual/status                                                                               | Enabled actions                                  | Disabled actions                                   | Service state                                                               |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Nothing read yet        | Arrival, or a read that has not happened | The scope card says nothing has been read, and reading is offered                                    | Use current selection                            | Review selection                                   | A local Word read; consent does not block it                                |
| Nothing selected        | The read found an empty selection        | "Nothing is selected. Select the paragraph you want reviewed."                                       | Use current selection                            | Review selection, Apply revision                   | `hasSelection: false` in the gate                                           |
| No profile              | No active semantic style                 | The blocker names Semantic Style, with a button to it                                                | Use current selection                            | Review selection, Regenerate review                | `hasProfile: false` in the gate                                             |
| Consent or provider off | Either permission is withdrawn           | The blocker states which one, and says it is not covered by the other permissions                    | Open Settings                                    | Review selection, Apply revision                   | Consent and provider reachability, re-derived from a strict boolean on load |
| Selection too long      | Over `MAX_REVIEW_SELECTION_CHARS`        | The cap is stated with the actual size, rather than the selection being silently shortened           | Use current selection, then narrow it in Word    | Review selection                                   | A stated refusal above the cap; a truncated review is not a review          |
| Review in flight        | The provider is being asked              | The button reads "Reviewing…"; nothing else is sent while it runs                                    | Keep original, once a proposal exists            | Review selection, Apply, Regenerate                | Caller cancellation is non-retryable; an internal timeout is retryable      |
| Proposal refused        | The local check protects something       | The hard and soft findings are listed with the values; Apply is disabled and the reason is beside it | Keep original, Regenerate review                 | Apply revision until the warnings are acknowledged | The check runs on this machine, before any write                            |
| Partial selection       | A partial range on a host without `set`  | Apply refuses with the host's cause and its remedy: select the whole paragraph                       | Keep original, regenerate with a whole paragraph | Apply revision on this host                        | `supportsRangedReplacement: false`; the whole-paragraph path still works    |
| Revision applied        | The write succeeded and read back        | "The revision was written as a tracked change. Reject it in Word to undo it."                        | Back to Deterministic Review                     | None                                               | The session outcome is recorded, with no document text and no document id   |

Every disabled control on both pages states its reason beside it, from one
registry (`src/taskpane/semantic/gates.ts`), so a button that is greyed out is
never indistinguishable from a button that is broken (ADR-0069). Each page keeps
exactly one live region (ADR-0062).

## Troubleshooting states

Troubleshooting answers two different questions, and the panel is the only place
both are answered in one place: what does this host support, and why is the pane
not doing what I expect. The second is derived by
`src/taskpane/troubleshooting/checks.ts`, a pure registry, so no other surface
can state a different reason for the same blocker (ADR-0069).

| State               | Trigger                             | Expected visual/status                                                                                                          | Enabled actions        | Disabled actions | Service state                                            |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------- | -------------------------------------------------------- |
| Blockers present    | One or more checks are true         | "Why something may not be working", one entry per true situation: the symptom, the cause, the remedy, and the control to change | Whatever the remedy is | None             | Only true situations are listed, most likely first       |
| No blockers         | Every check is false                | A plain statement that nothing is standing in the way, naming what was checked rather than asserting nothing is wrong           | Diagnose host          | None             | The absence of a listed problem is not a claim of health |
| Coverage incomplete | `CoverageReport.complete === false` | Names Analysis coverage diagnostics as the place the skipped parts are itemised, and says unsupported items are host limits     | Re-scan                | None             | A caller needing a specific node type must declare it    |

Every remedy names a control by its on-screen label and the page it lives on, for
example "General Settings → Scanning → Scan automatically as the document changes". A
remedy that does not say where to go is the same non-answer the panel was
already giving, one level of indirection further from the user.

## Provider connection states (Phase 4)

The LLM Settings page has its own state machine, separate
from document review. The rule that shapes it: **the pane never displays a
credential and never stores one.** A user can only see whether a connection
exists, what it is called, and what to do about it.

| State                   | Trigger                                               | Expected visual/status                                                                      | Enabled actions                   | Disabled actions           | Service state                                                      |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Provider offline        | Mock (offline) selected                               | Offline-stub explanation; no broker or key field                                            | Save, deterministic actions       | Connect, model list        | `llmProvider === "mock"`                                           |
| Awaiting connection     | A remote provider selected, no connection exists      | Auth note for that provider; broker URL field; key field for OpenRouter only                | Save, Connect                     | AI review actions          | No connection for the selected provider                            |
| Connecting              | Connect pressed                                       | "Connecting…" plus a disabled control, so the action cannot be double-submitted             | Disconnect                        | Connect                    | Authorization attempt in flight                                    |
| Model list loading      | Connection issued, catalog request in flight          | "Loading the model list…"                                                                   | Disconnect                        | Model dropdown             | Catalog request in flight                                          |
| Connected               | Catalog returned and bound to the same connection     | Connection present, Disconnect offered, model dropdown populated                            | Disconnect, model selection, Save | Connect, key field         | `status === "connected"` and a matching catalog                    |
| Model list empty        | Provider returned zero models                         | "This account has no models available."                                                     | Disconnect, Save                  | Model dropdown             | Catalog resolved as `empty`                                        |
| Model list stale        | Catalog past its expiry                               | "The model list is out of date. Reconnect to refresh it."                                   | Disconnect                        | Model dropdown             | Catalog resolved as `stale`                                        |
| Gateway unreachable     | Connection or catalog request failed at the transport | "Could not reach the provider gateway. Check that the local broker is running."             | Save, retry Connect               | Model dropdown             | No usable gateway origin                                           |
| Credential refused      | Gateway rejected the supplied key                     | The gateway's own reason, shown verbatim, so the user is not left guessing                  | Retry Connect                     | Model dropdown             | No connection persisted                                            |
| Disconnect confirmation | Disconnect pressed                                    | Explicit warning that this drops the credential and cannot be undone without re-entering it | Cancel, Confirm disconnect        | Connect                    | `status === "connected"`                                           |
| Disconnected            | Disconnect confirmed, or the call failed              | Key field reappears; model dropdown is withdrawn                                            | Connect                           | Model dropdown, Disconnect | No connection; the local record is cleared even if the call failed |

Two of these are deliberate rather than incidental:

- **A failed disconnect still clears the local record.** Leaving a
  `connected` record behind after the user pressed Disconnect would leave the
  pane claiming a working credential the gateway has already dropped.
- **A model catalog for a different connection is discarded, not displayed.**
  Otherwise the dropdown would offer models the current credential cannot use.

Every status is text. Colour is supplementary, and the destructive disconnect
warning is announced, not merely coloured.

## Consistency review states (Phase 5)

The consistency engine has its own entry point, its own consent, and its own
states. It never borrows a state from the spot or full-document review, because
a user who reached one of those has not agreed to this.

| State                        | What the user sees                                                                                                                                                                                         | What the add-in does                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Entry rendered, not runnable | The entry is always rendered on AI Review. Before consent or without a provider the button is disabled and an adjacent hint names what is missing, so the feature is discoverable but never silently armed | Refuses; the engine's own gate refuses a second time at run time                                           |
| Consent withheld             | The entry is visible; the button is disabled and names the missing consent, stating that it is separate from the permissions above                                                                         | Refuses; the engine's own gate refuses a second time at run time                                           |
| Consent given, no provider   | The entry is visible; the button is disabled and points to Settings                                                                                                                                        | Refuses                                                                                                    |
| Preflight                    | Scope in words and statements, the provider name, that a model judges part of the answer and can be wrong, and that nothing is changed                                                                     | Sends nothing. This is the last point a user can back out without anything leaving the add-in              |
| Preflight, over the bound    | As above, plus an alert naming how many statements will **not** be examined and that a clean result would not mean the document is consistent                                                              | Sends nothing                                                                                              |
| Running                      | Named phase, a live percentage, and a cancel button                                                                                                                                                        | Segments, compares, adjudicates, consolidates; re-checks cancellation between every candidate              |
| Cancelled mid-run            | A partial-results alert, never a clean finish                                                                                                                                                              | Discards the run entirely; no report is produced                                                           |
| Document changed mid-run     | An error naming the stale document                                                                                                                                                                         | Discards the report rather than reporting against text the user is no longer looking at                    |
| Complete, conflicts found    | Coverage first, then each issue with **both** compared statements, both section names, and a confidence percentage                                                                                         | Changes nothing in Word                                                                                    |
| Complete, partial coverage   | Coverage leads with "not a complete review"; the empty state says to check the coverage above before treating it as clean                                                                                  | Reports what it found and what it did not                                                                  |
| Deterministic-only run       | States plainly that no language model was used                                                                                                                                                             | Runs the direct comparisons, reports the unadjudicated candidates as a limitation, sets `usedModel: false` |
| Low-confidence issue         | Labelled advisory only, and stated as unable to change anything on its own                                                                                                                                 | `actionable: false`; the planner produces no change from it                                                |

The reporting rules above are the load-bearing part. A consistency engine's
failure mode is not crashing — it is producing a confident, wrong, or partial
result that reads as complete.

## Phase 0 workflow and trust contract

- First run without an active profile opens a plain-language Style Profile setup
  state; scan and plan actions are unavailable until a profile exists.
- A Finding card cannot mutate Word. **Review** records that the finding has
  entered the review state; it does not create a plan or claim that a mutation is
  ready. **Ignore** stores a versioned finding fingerprint that excludes
  generated UUIDs. Central plan navigation and selection context are Phase 2 B23
  work.
- ReformatPanel creates and previews a plan only. The exact plan must be reviewed
  in Pending Changes, where **Apply** calls the single reviewed-plan path and
  **Reject** discards it without mutation.
- Coverage is complete only when the requested scope has no unexpected processing
  gaps. Declared unsupported containers and protected exclusions remain visible
  in the report but do not imply that the requested scope was incomplete.
- Acquisition counts, acquisition diagnostics, and technical coverage details
  belong in Troubleshooting. Go-to-text operations expose a user-visible result
  while the Word host is working.

| Capability not verified | Strict Apply starts | Apply performs a fresh host probe and reports support per required operation | Preview, Troubleshooting, Back | Unsupported Apply | Per-Apply preparation is mandatory |
| Tracked editing disabled | General Settings toggle is off | Plain-language disabled state naming General Settings; preview remains available; Apply is unavailable with the reason attached | Preview, enable tracked editing in General Settings | Apply | Adapter is disarmed |
| Debugging view | Troubleshooting is opened | Technical inspection is isolated and clearly labeled as troubleshooting; the tracked-editing state is reported here but changed in General Settings | Probe, diagnose, open General Settings | Unmanaged edits | Managed Track Changes remains mandatory |
| Theme selection | User chooses and saves system, light, or dark | Committed choice updates Fluent and CSS palettes and persists across reloads | Save/cancel Styling, all workflow actions | Other General Settings saves until committed | Theme preference is available |
| General Settings isolation | User edits one General Settings section | Only that section becomes dirty and can save/cancel independently | Relevant section save/cancel | Other section save actions | Drafts remain local to their section |
| Navigation | Hamburger pressed or Escape/overlay dismiss | Fluent panel exposes active destination and returns focus to the trigger | Navigate, dismiss | Closed panel actions | Drawer is modal and responsive |

## Accessibility requirements

- Every actionable control has an accessible name and keyboard focus.
- Finding content and actions are exposed in DOM order.
- Status and refusal messages use `role="status"` or `aria-live`.
- Errors are announced with `role="alert"`.
- Disabled controls expose an adjacent text explanation, not colour alone.
- Navigation returns focus predictably to the task-pane control after preflight.
