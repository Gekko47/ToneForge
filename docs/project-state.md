# ToneForge — Project State

This file is the historical stage-gate evidence index. **The canonical roadmap,
sequencing, status ledger, refactor mapping, and release-gate decisions are in
[`ROADMAP.md`](../ROADMAP.md).** Do not treat this file as a competing plan.

The original project protocol remains:

1. inspect the current implementation;
2. implement only the agreed stage scope;
3. run targeted tests and the ordered verification chain;
4. record architectural decisions in [`decision-log.md`](decision-log.md);
5. update the evidence below and cross-reference the canonical status in
   [`ROADMAP.md`](../ROADMAP.md);
6. commit only after the applicable gate passes.

## Canonical status pointer

See the tables and phase ledger in [`ROADMAP.md`](../ROADMAP.md) for the
authoritative status of Stages 00–28 and Refactor Phases A–H. This page records
supporting evidence and known limitations; it intentionally does not duplicate
the status table.

## Evidence index

| Evidence area                       | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Limitation / follow-up                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original stages 00–22               | Git history contains the stage implementations through `feat(safety): add stale-result protection and safe application`; source and tests are present.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | See the canonical Stage table in [`ROADMAP.md`](../ROADMAP.md) for status and exact qualifications.                                                                                                                                         |
| Production UX redesign              | The taskpane bundles its Office-native stylesheet, uses a Fluent hamburger panel and fixed profile summary, coordinates persisted light/dark themes, and isolates Styling/LLM/Telemetry settings. First run now opens profile setup without an active profile. Finding cards use Review and navigation feedback; ReformatPanel is preview-only; Pending Changes owns the single plan-level Apply and Reject workflow. Technical coverage diagnostics are isolated to Troubleshooting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Live Word accessibility, host matrix, and real in-Word recovery evidence remain open.                                                                                                                                                       |
| Troubleshooting boundary            | Troubleshooting provides non-destructive host/runtime diagnostics and an **Enable tracked editing** preference that probes on enable and disarms the adapter on disable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Managed Track Changes and all per-Apply capability checks remain mandatory; historical smoke helpers are not rendered.                                                                                                                      |
| Credential/privacy                  | Webpack injects only allowlisted non-secret values; local live-provider testing uses a Node-side same-origin broker; state v7 preserves v0-v6 compatibility, removes and purges legacy API keys, and persists governance policy history plus one profile record per profile; Settings has clear-secret UX and a loopback-only broker URL rule; recursive diagnostics redact credentials and content; sentinel dev/prod builds scan generated artifacts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Production broker authentication/custody, formal threat model, and live browser/host evidence remain open; browser-held production keys are not claimed.                                                                                    |
| Phase B observer                    | Commit `d9a7dbf` adds the observer, coordinator, status hook, and tests. Phase 0 corrects conservative full-rescan finding retention and keeps one accepted run identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The observer does not yet receive a verified Word change-range event; current fallback can rescan all nodes.                                                                                                                                |
| Phases A, C–F                       | Domain, state v5, coverage, protection, registered commands, AI review, UX, safe-apply verification, export, and regression tests are committed. Phase 0 adds first-run setup, stable ignored-finding fingerprints, navigation feedback, blank-setting cleanup, and truthful scope coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Live host behavior and structural/perf/security limitations remain qualified in the Refactor table in [`ROADMAP.md`](../ROADMAP.md).                                                                                                        |
| Phase 1 resolved policy/Learn Style | [`ResolvedPolicy`](../src/core/domain/ResolvedPolicy.ts) resolves learned profile evidence and normative governance for analysis and planning. [`learnStyleDraft()`](../src/style/learnStyle.ts) and the Profile Learn Style panel capture, quality-gate, measure, optionally interpret with explicit consent, and persist an editable draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Live Word sample capture and real provider consent flows remain external evidence.                                                                                                                                                          |
| Phase 3 record and settings         | [`ProfileRecord`](../src/core/domain/ProfileRecord.ts) is the single persisted store for a profile: one mutable draft, immutable published versions with explicit activation and restore-as-draft, and an append-only revision audit trail capped at the newest 20 plus every published revision. State v7 replaces `profiles`, `profileHistory`, and `profileLifecycles` with one `profileRecords` map and migrates v6 by folding the edit trail and the approval trail into non-colliding revision numbers. Revisions are plain integers, so a `ChangePlan` cites the exact revision it was built from. [`profileSelectors`](../src/core/state/profileSelectors.ts) replaces the old field reads with pure projections. [`ProfileRecordSection`](../src/taskpane/components/ProfileRecordSection.tsx) exposes the transitions and renders the [`ProfileHistoryCompare`](../src/taskpane/components/ProfileHistoryCompare.tsx) side-by-side view. Settings is split into Styling, Provider and privacy, and Telemetry sections over the pure [`settingsModel`](../src/taskpane/settings/settingsModel.ts) with the reduced-noise [`useAnnouncement()`](../src/taskpane/settings/useAnnouncement.ts) hook. | Live Word and assistive-technology behaviour of the new controls remains external evidence. The three-profile-at-cap payload is measured against the `Office.roamingSettings` budget in `tests/unit/core/state/profileStateBudget.test.ts`. |
| Stage 6 command/release scope       | [`COMMAND_REGISTRY`](../src/commands/commandRegistry.ts) is the typed source for command identity, labels, JSON/XML action metadata, navigation targets, and handlers. [`validate-manifest.mjs`](../scripts/validate-manifest.mjs) checks equivalent JSON/XML destinations and labels. [`verification-graph.mjs`](../scripts/verification-graph.mjs) is the named ordered graph used by local, CI, and release automation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | XML fallback intentionally uses `ShowTaskpane` navigation rather than JSON `executeFunction`; both real sideload paths and human host evidence remain external gates.                                                                       |
| Phase 5 consistency engine          | [`src/analysis/consistency/`](../src/analysis/consistency/README.md) implements C1–C10 as a separate opt-in non-deterministic engine with its own pipeline, its own third consent (`consistencyReviewConsent`, state v9), its own task-pane surface, and a coverage report. See the Phase 5 disposition below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verified only by unit tests and `MockAdapter`. Never run against a real document in a real Word host.                                                                                                                                       |
| Automated verification              | Typecheck, lint, format, secret/docs scans, tests, coverage, build, artifact budgets, manifest validation, and staging verification are release-chain gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Webpack emits no performance warnings; release acceptance remains blocked by host evidence.                                                                                                                                                 |
| Test suite                          | Full Vitest suite passes with 87 files and 767 tests; focused Phase 0–3 regression suites pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Warning/refusal tests intentionally emit diagnostic stderr logs.                                                                                                                                                                            |
| Coverage                            | `npm run test:coverage` passes the 80% gate with 93.16% lines, 93.16% statements, 81.05% functions, and 81.83% branches; taskpane behavior is component-tested and built separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `all: false` avoids Windows V8 path-case duplicate records; untested entrypoint TSX is not counted as exercised core code.                                                                                                                  |
| Host verification                   | Desktop Word evidence is recorded in [`manual-verification.md`](manual-verification.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Web Chrome, web Edge, Mac, and new Phase C/E paths remain open.                                                                                                                                                                             |
| Release                             | Version `0.2.0`, JSON manifest, XML fallback, changelog, deterministic staging, release gate, and release workflow exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Stage 27 host evidence is open; `npm run release:check` must remain blocked.                                                                                                                                                                |

## Historical stage notes

The following notes preserve the reasons for earlier decisions. They do not
supersede the canonical status table in [`ROADMAP.md`](../ROADMAP.md).

- Stage 01 is a hard-gate capability spike. The probe is non-destructive; live
  desktop evidence is recorded, while the full host matrix remains open.
- Stage 18 is the single Word mutation boundary. The live smoke exercises text
  insert/replace and tracking; unsupported break/style/list/format paths remain
  mock-verified.
- Stage 21 is the production reformat orchestrator. Deprecated smoke helpers
  remain for historical reproduction only.
- Stage 22 adds live re-hash, conflict refusal, adapter defense-in-depth, and
  preview/confirmation UX.
- Zoo rules under `.roo/rules/` remain governance controls and are not a second
  roadmap.

## Remediation history

- `manifest.xml` is present and validated; the earlier audit claim that it was
  missing was stale.
- `loadState()` invokes migration before schema parsing; the current schema is
  version 7, removes legacy API-key fields, preserves consent, seeds governance
  profiles/history for new profiles, folds the pre-v7 profile structures into one
  record per profile, and purges the v1-v6 storage records.
- The Stage 01 probe is non-destructive and no longer mutates the document.
- Fluent UI is v8 in [`package.json`](../package.json); the older v9 references
  in historical plans are superseded by the implementation.
- The refactor strategy is additive evolution, recorded in ADR-0031. The
  incoming refactor proposal is retained as design/history, not as a second
  status ledger.

## UX redesign evidence

- The main pane is intended to communicate: scan readiness, current findings,
  optional consented AI review, safe-reformat preview, and verified completion.
- [`Dashboard.tsx`](../src/taskpane/pages/Dashboard.tsx) renders first-run profile
  setup when no active profile exists, no longer renders raw runtime diagnostics,
  capability controls, or the deprecated Stage 18 smoke panel in the normal
  workflow, and uses stable fingerprints for ignored findings.
- [`DebuggingPanel.tsx`](../src/taskpane/components/DebuggingPanel.tsx) provides
  non-destructive host inspection, coverage diagnostics, and the persisted
  tracked-editing preference; the historical Stage 18 smoke controls are not
  rendered.
- [`TaskPaneHeader.tsx`](../src/taskpane/components/TaskPaneHeader.tsx) provides
  the Fluent navigation panel and the fixed active-profile summary at every
  responsive width.
- [`documentObserver.ts`](../src/word/documentObserver.ts) exposes current and
  accepted run metadata, retains findings from conservative full rescans, and
  discards superseded results before status emission.
- [`trackedEditing.ts`](../src/reformat/trackedEditing.ts) performs a fresh,
  plan-specific host preparation at every strict Apply and maps every change to
  its required capability.
- [`ReformatPanel.tsx`](../src/taskpane/components/ReformatPanel.tsx) is
  preview-only: it presents before/after data, provenance, and scope state, but
  does not expose a competing Apply or Reject action. The exact plan is reviewed
  in Pending Changes, where the single Apply path calls
  [`applyReviewedPlan()`](../src/reformat/orchestrator.ts:507) after all gates.
- [`PendingChanges.tsx`](../src/taskpane/components/PendingChanges.tsx) keeps
  source, risk, approval, precondition, conflict, and coverage state visible,
  provides disabled reasons for blocked Apply actions, and has a real Reject
  callback that closes the plan without mutating Word.

## Repository-side Stage 7/8 disposition

The repository-side UX, migration, policy-history, and structured refusal
work is complete. Automated component and migration tests cover the new states.
The historical smoke helpers remain controlled tooling and were not removed.
Live Word host behavior, screen-reader/browser evidence, 50k-word host
performance, and formal production credential custody remain external gates.

## Phase 4 disposition

Phase 4 is repository-complete. `npm run verify` passes all 13 stages of
`toneforge-repository-v1` at 106 files / 1253 tests with 94.3% lines, 83.07%
branches, and 81.29% functions. The four Phase 4 bugs listed in the changelog
were found and fixed by the new tests.

What Phase 4 does **not** close:

- No live provider request has been made. Every provider path is exercised
  through the offline mock and injected fetch doubles, so the gateway protocol is
  a typed contract, not a verified integration.
- The OpenRouter key path is proven to reach the local dev gateway and stop
  there. It has not been proven against the live OpenRouter API from inside
  Word.
- Production credential custody is still unresolved. The local dev broker is a
  development stand-in, not a release component.
- The human Word-host gate is open: `npm run host:matrix` reports 4 hosts and
  **0 fully passing**.

**Phase 6 is HELD** by release authority pending further testing. Its full scope
is preserved and resumable.

## Phase 5 disposition

Phase 5 implements the cross-report consistency engine that the ROADMAP had
reserved as "Phase H". Per ADR-0052 this supersedes both the plan's Phase 5
instruction to "keep C1–C10 deterministic" and the ROADMAP's "Phase H reserved
until release" — the release authority directed that these be non-deterministic
checkers in a separate engine with its own opt-in.

Repository-complete. It is a **separate** engine: its own pipeline, its own
third consent, its own entry point, its own coverage report. `consistency` was
added to `FindingKind`, so a consistency finding is an ordinary finding that
passes every existing gate and the single mutation path rather than bypassing
them.

Five real defects were found by the new tests and fixed, rather than adjusted
around:

1. `compareDates` treated a coarse month-only date as `same` against a precise
   date in the same month — a false negative that read as a decision. It is now
   `incomparable`, meaning "no conclusion", while a coarse date in a genuinely
   different month is still a conflict.
2. C4's proper-noun entity anchor was being pre-filtered out by the generic
   vocabulary-overlap threshold, discarding exactly the pairs C4 exists to find.
3. C8 did not recognise `Smith (2019)`, the most common citation form, so it
   would have been silently inert on most real text.
4. C10 detected narrowing only through conjunctions, missing the negation that
   does the actual work in "however three are not yet".
5. `normalizeSettings` spread raw persisted values over the defaults, so a
   stored `"yes"` in a consent field would have read as permission. All four
   consent flags are now derived from strict booleans.

What Phase 5 does **not** close:

- The engine has **never been run against a real document or a real model**.
  Every check, the pipeline, the bridge, and the surface are covered by unit
  tests using `MockAdapter` and injected fetch doubles. That is a typed
  contract, not a verified integration.
- The ten checks are heuristic. C1–C10 will both miss real conflicts below their
  subject-overlap thresholds and, more importantly, **will produce false
  positives on real prose**. They have not been calibrated against a corpus.
- The engine is quadratic and bounded at 400 statements. A document above that
  bound reports partial coverage rather than silently truncating, but partial
  coverage is not full coverage and a clean partial result is not a clean
  document.
- A consistency finding can propose rewriting prose. Below 0.7 confidence it is
  marked `actionable: false` and produces no change; above it, the plan still
  goes through the ordinary review and apply gates. No model has yet been asked
  to judge real candidate pairs, so the confidence scale is unvalidated.
- ADR-0052 is the **single** sanctioned exception to deterministic-first. It is
  recorded as an exception, not a precedent, and no other non-deterministic
  engine is authorized by it.

## Current open gates

1. Complete manual host verification in the matrix in
   [`manual-verification.md`](manual-verification.md). Current generated
   position: 4 hosts, 0 fully passing.
2. Approve the production credential broker/authentication architecture, complete
   the formal threat model, and record live browser credential-flow evidence. The
   local dev gateway is not a production substitute.
3. Record live 50k-word performance, observer event-range, and accessibility
   evidence.
4. Complete release acceptance in Word Windows plus web Chrome/Edge; Mac is
   conditional on the supported-host decision.
5. Take the deferred dependency-upgrade decision recorded in
   [`privacy-security.md`](privacy-security.md) before resuming Phase 6. `uuid`
   ships and carries a moderate advisory; its vulnerable code path is not
   reachable today, but the version is still in the bundle.
6. Calibrate the ten consistency checks against a real document corpus before
   any release claim rests on them. They are unvalidated heuristics today, and
   a check that fires on everything is worse than one that fires on nothing.
7. Run the consistency engine once against a real document in a real Word host
   with a real provider. Every result so far is a `MockAdapter` double.

The deterministic repository chain and 80% exercised-core coverage gate are
required to pass. The release check is intentionally blocked by the open human
Word-host matrix and production credential-custody/security evidence; see
[`manual-verification.md`](manual-verification.md) and
[`docs/privacy-security.md`](privacy-security.md).
