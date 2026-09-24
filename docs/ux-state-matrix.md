# ToneForge UX State Matrix

This matrix covers the Phase C Word-native task-pane states. Status is always
communicated with text; colour is supplementary only. A disabled action is
listed with the service condition that must be satisfied before it can run.

| State                        | Trigger                                           | Expected visual/status                                             | Enabled actions                         | Disabled actions                | Service state                           |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------- | --------------------------------------- |
| Initial loading              | Task pane opens                                   | “Loading…” with status announcement                                | None                                    | Scan, AI review, Apply          | Office initialization pending           |
| No profile                   | Dashboard starts without a profile                | Plain-language setup message                                       | Open Style profile                      | Scan, Apply                     | No active StyleProfile                  |
| Scanning                     | Scan now or initial observer scan                 | Live status with last scan time                                    | View findings when results exist        | Apply while scan is running     | Document observer scanning              |
| No findings                  | Scan completes with no findings                   | “No open governance findings.”                                     | Scan now                                | View findings when empty        | Findings array empty                    |
| Open findings                | Scan returns findings                             | Mandatory/advisory counts and category list                        | View findings, Go to text, Ignore       | Apply without preview           | Findings available                      |
| Finding card                 | User opens findings                               | Category, source, severity, explanation, actual/expected, location | Go to text, Apply, Ignore               | Unsupported navigation          | Finding is in current run               |
| Coverage complete            | Coverage report is complete                       | “Coverage Complete” and processed character count                  | Normal review actions                   | None                            | `CoverageReport.complete === true`      |
| Coverage incomplete          | Required node inaccessible                        | “Coverage Incomplete” and reason text                              | Re-scan, inspect exclusions             | Apply                           | `CoverageReport.complete === false`     |
| Stale findings               | Document changes after scan                       | “Findings are stale” and re-scan prompt                            | Re-scan now                             | Apply stale results             | Observer status is stale                |
| Pending changes empty        | Pending Changes view has no plan                  | “No pending changes to review.”                                    | Return to governance                    | Apply, Reject                   | No ChangePlan                           |
| Pending changes ready        | Preview produced a plan                           | Before/after, risk, source rule, conflicts                         | Apply after review, Reject              | Apply with unresolved conflicts | Plan is current and conflict-free       |
| Apply succeeded              | Orchestrator verified and applied plan            | Result count and tracking status                                   | Scan again                              | Apply same stale plan           | Mutation path completed                 |
| Apply refused                | Hash mismatch, conflict, or gate refusal          | Plain-language refusal reason                                      | Re-run preview, Reject                  | Apply stale plan                | Orchestrator refusal                    |
| AI provider missing          | No API key configured                             | Deterministic-only message                                         | Open Settings, deterministic actions    | All AI review actions           | Provider absent                         |
| Consent absent               | AI entry point selected without opt-in            | Consent explanation                                                | Open Settings, deterministic actions    | AI review actions               | Explicit raw-text consent absent        |
| Selection unsupported        | Host cannot expose selection                      | Capability explanation                                             | Paragraph/document entry when available | Review selection                | `supportsSelection === false`           |
| Paragraph unsupported        | Host cannot resolve paragraphs                    | Capability explanation                                             | Selection/document entry when available | Review paragraph                | `supportsParagraphResolution === false` |
| Context-menu unavailable     | Host does not expose context-menu extension point | Task-pane AI entry remains available                               | Task-pane AI review                     | Context-menu invocation         | `supportsContextMenu === false`         |
| Content consistency reserved | Normal dashboard                                  | `CONTENT CONSISTENCY` label only                                   | None                                    | Content consistency actions     | Phase H reserved; no engine             |
| Navigation unsupported       | Host rejects range selection                      | Logged safe no-op and user message                                 | Return to findings                      | Unsupported Go to text          | Source locator cannot select range      |

## Accessibility requirements

- Every actionable control has an accessible name and keyboard focus.
- Finding content and actions are exposed in DOM order.
- Status and refusal messages use `role="status"` or `aria-live`.
- Errors are announced with `role="alert"`.
- Disabled controls expose an adjacent text explanation, not colour alone.
- Navigation returns focus predictably to the task-pane control after preflight.
