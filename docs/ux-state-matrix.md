# ToneForge UX State Matrix

## Production taskpane contract

The production main view is a compact governance workflow, not a developer
dashboard. It presents one current document-readiness state at a time:
not started, scanning, fresh, clean, stale, incomplete, or failed. Coverage
means that the requested in-scope content was inspected without unexpected
processing gaps; it does not mean that zero findings exist or that unsupported
and protected areas were silently included. Findings and Pending Changes are
collapsible sections on this page, while AI Review is isolated on its own page.
Once Safe Reformat previews a plan, its report is the single current
Governance/findings source until Apply or a new scan supersedes it. Reformat
preview is not a mutation action; Pending Changes owns the single plan-level
Apply and Reject workflow. A fixed header contains a Fluent hamburger navigation
panel and a non-wrapping active-profile summary. Capability probes, coverage
acquisition diagnostics, and the tracked-editing preference live in
Troubleshooting; the production taskpane contains no historical Stage 18 smoke
controls.

This matrix covers the Phase C Word-native task-pane states. Status is always
communicated with text; colour is supplementary only. A disabled action is
listed with the service condition that must be satisfied before it can run.

| State                        | Trigger                                                      | Expected visual/status                                             | Enabled actions                           | Disabled actions                | Service state                                                               |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Initial loading              | Task pane opens                                              | “Loading…” with status announcement                                | None                                      | Scan, AI review, Apply          | Office initialization pending                                               |
| No profile                   | Dashboard starts without a profile                           | Plain-language setup message                                       | Open Style profile                        | Scan, Apply                     | No active StyleProfile                                                      |
| Scanning                     | Scan now or initial observer scan                            | Live status with last scan time                                    | View findings when results exist          | Apply while scan is running     | Document observer scanning                                                  |
| No findings                  | Scan completes with no findings                              | “No open governance findings.”                                     | Scan now                                  | View findings when empty        | Findings array empty                                                        |
| Open findings                | Scan returns findings                                        | Mandatory/advisory counts and category list                        | View findings, Go to text, Review, Ignore | Apply without preview           | Findings available                                                          |
| Finding card                 | User opens findings                                          | Category, source, severity, explanation, actual/expected, location | Go to text, Review, Ignore                | Unsupported navigation          | Finding is in current run                                                   |
| Coverage complete            | Requested scope has no unexpected processing gaps            | “Coverage Complete” and scope-qualified language                   | Normal review actions                     | None                            | `CoverageReport.complete === true`; technical details in Troubleshooting    |
| Coverage incomplete          | An unexpected required node or processing window gap remains | “Coverage Incomplete” and reason text                              | Re-scan, inspect exclusions               | Plan-level Apply                | `CoverageReport.complete === false`                                         |
| Stale findings               | Document changes after scan                                  | “Findings are stale” and re-scan prompt                            | Re-scan now                               | Apply stale results             | Observer status is stale                                                    |
| Pending changes empty        | Pending Changes view has no plan                             | “No pending changes to review.”                                    | Return to governance                      | Apply, Reject                   | No ChangePlan                                                               |
| Pending changes ready        | Preview produced a plan                                      | Before/after, risk, source rule, conflicts                         | Apply after review, Reject                | Apply with unresolved conflicts | Plan is current and conflict-free                                           |
| Apply succeeded              | Orchestrator verified and applied plan                       | Result count and tracking status                                   | Scan again                                | Apply same stale plan           | Mutation path completed                                                     |
| Apply refused                | Hash mismatch, conflict, or gate refusal                     | Plain-language refusal reason                                      | Re-run preview, Reject                    | Apply stale plan                | Orchestrator refusal                                                        |
| AI provider missing          | No approved provider or development broker available         | Deterministic-only message                                         | Open Settings, deterministic actions      | All AI review actions           | No usable `ProviderConnection`; the registry falls back to the offline mock |
| Consent absent               | AI entry point selected without opt-in                       | Consent explanation                                                | Open Settings, deterministic actions      | AI review actions               | Explicit raw-text consent absent                                            |
| Selection unsupported        | Host cannot expose selection                                 | Capability explanation                                             | Paragraph/document entry when available   | Review selection                | `supportsSelection === false`                                               |
| Paragraph unsupported        | Host cannot resolve paragraphs                               | Capability explanation                                             | Selection/document entry when available   | Review paragraph                | `supportsParagraphResolution === false`                                     |
| Context-menu unavailable     | Host does not expose context-menu extension point            | Task-pane AI entry remains available                               | Task-pane AI review                       | Context-menu invocation         | `supportsContextMenu === false`                                             |
| Content consistency reserved | Normal dashboard                                             | `CONTENT CONSISTENCY` label only                                   | None                                      | Content consistency actions     | Phase H reserved; no engine                                                 |
| Navigation unsupported       | Host rejects range selection                                 | Logged safe no-op and user message                                 | Return to findings                        | Unsupported Go to text          | Source locator cannot select range                                          |

## Provider connection states (Phase 4)

The Provider and privacy Settings section has its own state machine, separate
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
| Tracked editing disabled | Troubleshooting toggle is off | Plain-language disabled state; preview remains available | Preview, enable tracked editing | Apply | Adapter is disarmed |
| Debugging view | Troubleshooting is opened | Technical inspection is isolated and clearly labeled as troubleshooting | Probe, diagnose, enable/disable tracked editing | Unmanaged edits | Managed Track Changes remains mandatory |
| Theme selection | User chooses and saves system, light, or dark | Committed choice updates Fluent and CSS palettes and persists across reloads | Save/cancel Styling, all workflow actions | Other Settings saves until committed | Theme preference is available |
| Settings isolation | User edits one Settings section | Only that section becomes dirty and can save/cancel independently | Relevant section save/cancel | Other section save actions | Drafts remain local to their section |
| Navigation | Hamburger pressed or Escape/overlay dismiss | Fluent panel exposes active destination and returns focus to the trigger | Navigate, dismiss | Closed panel actions | Drawer is modal and responsive |

## Accessibility requirements

- Every actionable control has an accessible name and keyboard focus.
- Finding content and actions are exposed in DOM order.
- Status and refusal messages use `role="status"` or `aria-live`.
- Errors are announced with `role="alert"`.
- Disabled controls expose an adjacent text explanation, not colour alone.
- Navigation returns focus predictably to the task-pane control after preflight.
