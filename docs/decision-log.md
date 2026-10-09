# ToneForge — Architectural Decision Log

The canonical implementation status and plan are in [`ROADMAP.md`](../ROADMAP.md).
This log records architectural decisions; it does not duplicate the status
ledger.

## Existing decisions

ADR-0001 through ADR-0030 remain the historical decision record for the
repository baseline, domain, persistence, LLM, Office.js, rules, formatting,
findings, planning, orchestrator, and safe-application decisions. They are
preserved for traceability. The key current decisions are:

- Use the unified JSON manifest v1.30 and keep `manifest.xml` as a validated
  fallback.
- Use TypeScript strict contracts, Zod boundary validation, React 18, Fluent UI
  v8, Webpack 5, Vitest, and local Office state persistence.
- Keep deterministic engines free of Office, LLM, and UI imports.
- Keep `runInWord()` as the Word access boundary and the revision adapter as the
  sole mutation path.
- Use provider-agnostic OpenAI/mock adapters, retry, abort handling, redaction,
  and explicit raw-text consent.
- Migrate persisted state rather than discarding legacy data, with corrupt-state
  fallback to defaults.
- Treat real Word host results as human-only evidence; unit mocks never close a
  hard host gate.

## ADR-0031 — Evolution strategy: additive layering over replacement

- **Status**: Accepted (2026-09-24)
- **Context**: The refactor proposal used a different stage map and proposed
  replacing the monolithic prompt/architecture. Replacing the repository would
  discard committed work and break existing contracts.
- **Decision**: Add structured document, governance, coverage, protection, and
  review contracts around the existing `StyleProfile`, `Finding`, `Change`,
  `ChangePlan`, text snapshot, checker, orchestrator, and adapter. Preserve
  legacy fixtures through defaults/unions and retain deprecated smoke code only
  for historical verification.
- **Consequences**: The original 00–28 roadmap remains intact. The incoming
  proposal is mapped to Phases A–G and reserved Phase H in
  [`ROADMAP.md`](../ROADMAP.md). Worktree code is not treated as released or
  passed merely because it exists.
- **Evidence**: `src/core/domain/DocumentSnapshot.ts`,
  `src/core/domain/GovernanceProfile.ts`, `src/core/state/migration.ts`,
  `src/core/state/persistence.ts`, `src/analysis/coverage.ts`,
  `src/rules/protection.ts`, and `src/rules/registry.ts`.

## ADR-0032 — Consent-gated bounded AI review

- **Status**: Accepted (2026-09-24)
- **Context**: UX entry points required a safe request contract, context
  boundary, response validation, and separate consent for spot and full-document
  review.
- **Decision**: Use `ReviewRequest`, a bounded context minimizer, protected-node
  exclusion, Zod-validated structured responses, separate consent settings, and
  normal `ChangePlan` output. Review never mutates Word directly.
- **Consequences**: Raw text is minimized and explicitly gated; malformed or
  out-of-context output fails closed; preview/apply uses the existing safety
  path. Full-document review is bounded and coverage-gated, but live host and
  token/freshness evidence remains open.
- **Evidence**: `src/core/domain/ReviewRequest.ts`, `src/ai/review/*`,
  `src/ai/prompts/spotPrompts.ts`, and the Phase D/E component tests.

## ADR-0033 — Release remains blocked on host evidence

- **Status**: Superseded by ADR-0034 (2026-09-24)
- **Context**: The original audit found duplicate Windows path-case coverage
  records that halved global coverage and blocked Stage 26.
- **Decision**: Superseded after the V8 coverage scope was corrected to exercised
  production modules without duplicate Windows records.
- **Consequences**: Stage 26 is restored to PASS; release remains blocked only
  by human Word-host evidence.
- **Evidence**: `vitest.config.ts` and `npm run test:coverage`.

## ADR-0034 — Separate deterministic release gates from human host evidence

- **Status**: Accepted (2026-09-24)
- **Context**: Automated tests cannot prove real Word behavior, but coverage,
  manifest structure, secret/docs checks, build output, and release staging are
  deterministic repository gates.
- **Decision**: Enforce 80% coverage over exercised production modules with V8
  `all: false` to avoid Windows path-case duplicates; keep UI behavior under
  component tests and production build validation. Keep Stage 27 partial and
  Stage 28 blocked until the supported host matrix is complete.
- **Consequences**: Repository gates can be fully green while release remains
  correctly blocked. Unsupported capabilities use safe no-ops, disabled states,
  or documented limitations; Phase H remains reserved.
- **Evidence**: `vitest.config.ts`, `npm run test:coverage`,
  `docs/manual-verification.md`, `scripts/release-check.mjs`, and
  `docs/project-state.md`.

## ADR-0035 — Separate production governance UX from troubleshooting

- **Status**: Accepted (2026-09-24)
- **Context**: The current taskpane combined the production governance workflow,
  raw capability/runtime output, and deprecated Stage 18 smoke controls. This
  made a preview look like proof of mutation readiness and made stale, clean, and
  debugging states appear together.
- **Decision**: Keep the main taskpane focused on document readiness, findings,
  consent-gated AI review, and safe reformat. Move capability probes, runtime
  diagnostics, stage/gate details, and historical smoke controls to a dedicated
  Troubleshooting view. Require explicit confirmation before historical smoke
  mutations and never treat smoke success as production orchestration evidence.
- **Consequences**: Normal users get a compact, understandable workflow. Debugging
  remains discoverable but secondary, and unsupported mutation capability is
  represented as blocked readiness rather than a failed or misleading Apply.
- **Evidence**: `src/taskpane/pages/Dashboard.tsx`,
  `src/taskpane/components/DebuggingPanel.tsx`,
  `src/taskpane/components/SmokePanel.tsx`, and `docs/ux-state-matrix.md`.

## ADR-0036 — Observer run identity and one reviewed plan

- **Status**: Accepted (2026-09-24)
- **Context**: Recurring “Stale run cancelled: runId mismatch” warnings came from
  generating and immediately comparing a new run ID inside the scan. Preview
  and apply also regenerated separate plans, allowing contradictory UI states.
- **Decision**: Generate one run identity per scheduled scan, coalesce document
  events, discard obsolete async results before commit, and expose accepted run
  metadata. Preview retains the exact `ChangePlan`; apply consumes that plan and
  performs freshness and capability checks before the single mutation path.
- **Consequences**: Repeated document events do not commit obsolete findings.
  A valid preview can be shown while Apply is truthfully blocked by host
  readiness, and stale plans are refused rather than partially interpreted.
- **Evidence**: `src/word/documentObserver.ts`,
  `src/analysis/incrementalCoordinator.ts`, `src/reformat/orchestrator.ts`, and
  `src/taskpane/components/ReformatPanel.tsx`.

## ADR-0037 — Fail-closed tracked application and single production mutation path

- **Status**: Accepted (2026-09-24)
- **Context**: The previous safe-reformat path could leave its internal mutation
  gate unset, allow a legacy conflict acknowledgement, and apply edits when the
  host did not expose controllable revision tracking. Its text-hash check also
  treated an unchanged hash as evidence that tracked edits failed, which is not
  valid for non-text or revision-backed changes.
- **Decision**: Prepare the internal gate automatically from the verified host
  probe, expose no user-facing safety switches, refuse unresolved conflicts, and
  refuse every plan when managed Track Changes cannot be established. The single
  reviewed-plan path reports per-change application and verification separately.
  Text plans use fresh text-hash readback. Style, character, character-reset,
  paragraph, and list-level plans use a fresh formatting snapshot and verify the
  expected state operation by operation. Every operation is guarded by its own
  verified Word capability.
- **Consequences**: Safe reformat is fail-closed and no longer depends on the
  Troubleshooting page. Unsupported hosts do not receive partial edits. Track
  Changes remains the required protection mechanism, and the UI keeps the exact
  previewed plan visible in Pending Changes.
- **Evidence**: `src/reformat/orchestrator.ts`, `src/reformat/index.ts`,
  `src/word/revisionAdapter.ts`, `src/taskpane/components/ReformatPanel.tsx`,
  and `tests/integration/reformatOrchestrator.test.ts`.

## ADR-0038 — Per-Apply tracked-editing preparation with a troubleshooting disabler

- **Status**: Accepted (2026-09-24)
- **Context**: Applying a `resetCharacterFormatting` change failed because the
  adapter accidentally shared `setListLevel` validation with that empty payload.
  The task pane also depended on startup-time capability state, reported a
  resolved refusal as success, bundled no task-pane stylesheet, and mixed CSS and
  Fluent theme state. Users need a safe way to disable editing without confusing
  it with the mandatory Track Changes mechanism.
- **Decision**: Separate reset-formatting and list-level validation. Require every
  strict Apply to run a fresh, plan-specific capability probe when tracked editing
  is enabled. Expose a Troubleshooting-only **Enable tracked editing** preference;
  disabling it immediately disarms mutation but leaves preview available. Never
  bypass managed Track Changes. The task pane uses a Fluent navigation panel, a
  fixed non-wrapping active-profile summary, coordinated persisted light/dark
  themes, independent Styling/LLM/Telemetry settings, and one preview report as
  the current Governance and Pending Changes source. Success requires both
  `applied === true` and `verified === true`.
- **Consequences**: Every Apply pays the cost of a non-destructive capability
  probe and refuses unsupported plans as a whole. The troubleshooting preference
  persists in localStorage and defaults to enabled. Unsupported or disabled hosts
  fail closed. UI tests cover theme persistence, per-section saves, navigation,
  profile placement, tracked-editing preparation, and truthful Apply contracts.
- **Evidence**: `src/reformat/trackedEditing.ts`, `src/reformat/orchestrator.ts`,
  `src/word/revisionAdapter.ts`, `src/taskpane/components/TaskPaneHeader.tsx`,
  `src/taskpane/components/SettingsForm.tsx`,
  `src/taskpane/components/PendingChanges.tsx`, and the related unit/integration
  tests under `tests/unit` and `tests/integration`.

## ADR-0039 — Brokered credentials and credential-free ordinary state

- **Status**: Accepted for repository development; production custody unresolved (2026-09-24)
- **Context**: Development Webpack injected the complete `.env` object, while
  Settings and v3 state persisted a browser-readable API key. Those paths made a
  reusable credential available to static assets or ordinary application state.
  The repository also lacked generated-artifact sentinel coverage and recursive
  prompt/content redaction.
- **Decision**: Exclude API keys from browser environment contracts and ordinary
  state. Migrate persisted state to v5, remove and purge legacy credential fields,
  and preserve consent. For optional local live-provider testing, read `.env`
  only in the Webpack Node process and proxy consented requests through the
  same-origin development endpoint without a browser authorization header.
  Preserve provider abstraction, explicit user-supplied adapter support, retry,
  abort, and redaction. Fail development and production sentinel builds when
  generated artifacts contain secret-shaped values.
- **Consequences**: Settings no longer accepts a key and offers a legacy-clear
  action. Mock remains the offline default. The local broker is not a production
  service and does not establish production authentication. A production broker,
  identity/authorization model, formal threat model, and live browser evidence
  remain release blockers; browser-held production keys are not claimed as
  supported.
- **Evidence**: `webpack.dev.js`, `webpack.prod.js`, `src/core/config/env.ts`,
  `src/core/state/migration.ts`, `src/core/state/persistence.ts`,
  `src/ai/providers/openaiAdapter.ts`, `src/shared/utils/redaction.ts`,
  `scripts/check-build-artifacts.mjs`, `scripts/verify-bundle-secrets.mjs`, and
  focused state/provider/settings/redaction tests.

## ADR-0040 — Persist governance policy history with style profile history

- **Status**: Accepted (2026-09-24)
- **Context**: Style profile restores must not silently restore an older protection or scope policy. Existing state v4 preserved style snapshots but not governance snapshots or policy revisions on plans.
- **Decision**: State v5 adds `governanceHistory`, seeds it from persisted governance profiles, updates the active governance snapshot when a style profile is saved, preserves both storage backends, and keeps legacy state versions migratable. Reformat plans capture the active governance policy revision. Governance policy diffs are independent from `StyleProfile` diffs.
- **Consequences**: Profile and policy history can be restored/audited separately, and plan readiness can expose policy revision. Existing v0-v4 records are upgraded rather than discarded. Live policy editing and host evidence remain open product work.
- **Evidence**: `src/core/state/migration.ts`, `src/core/state/persistence.ts`, `src/core/domain/GovernanceProfile.ts`, `src/style/versioning.ts`, and `src/taskpane/components/VersionDiff.tsx`.

## ADR-0041 — Single command registry and named verification graph

- **Status**: Accepted (2026-09-24)
- **Context**: Stage 6 found duplicated command metadata, a validator that only
  checked JSON action IDs, and local/CI/release verification graphs with
  different stage membership. The dual-format manifest remains intentional:
  JSON uses executeFunction actions while XML fallback uses ShowTaskpane.
- **Decision**: Define command metadata in `src/commands/commandDefinitions.json`
  and validate it at runtime into the typed `COMMAND_REGISTRY` used by
  `commands.ts`. Validate equivalent command IDs, labels, and XML task-pane
  destinations without claiming XML execute-function parity. Define the ordered
  `toneforge-repository-v1` graph in `scripts/verification-graph.mjs`; make
  `verify`, `stage:verify`, CI, and release invoke it. Keep clean-install and
  human host evidence as explicit separate gates.
- **Consequences**: A manifest or command-label drift fails before packaging.
  JSON and XML remain deployable through their documented action mechanisms.
  Release remains blocked until the human Word-host matrix is complete.
- **Evidence**: `src/commands/commandRegistry.ts`,
  `src/commands/commands.ts`, `scripts/validate-manifest.mjs`,
  `scripts/verification-graph.mjs`, `scripts/clean-install-check.mjs`,
  `scripts/check-release-package.mjs`, and the command contract tests.

## ADR-0042 — Contain the Office sideload chain by parent release, not nested overrides

- **Status**: Accepted (2026-09-25)
- **Context**: Sideloading is a required debugging path, but
  `office-addin-debugging@4.x` reached
  `@microsoft/teamsfx-cli@1.1.5` through `office-addin-dev-settings@^1.15.1`,
  pulling `@azure/msal-node@1.0.0-beta.6`/`1.18.4`, `@azure/ms-rest-js`,
  `@azure/ms-rest-azure-js`, `@azure/core-http`, and legacy `msal`. This
  produced 10 `EBADENGINE` warnings and 42 deprecation warnings during
  `npm ci`. The obvious remedies were nested `overrides` or
  `npm audit fix --force`, both of which fork Microsoft's tooling graph.
  `office-addin-dev-settings@2.1.0` is the first release with no TeamsFx
  dependency. `office-addin-debugging@6.x` and `7.x` reach it only by
  introducing `@microsoft/m365agentstoolkit-cli`, which the maintainer
  explicitly rejected for this repository.
- **Decision**: Move the single parent declaration to
  `office-addin-debugging@^5.1.6`, the minimum release line past the
  TeamsFx boundary that does not adopt Agents Toolkit. Add no `overrides`,
  no `resolutions`, and no nested lockfile edits. Regenerate
  `package-lock.json` through npm only. Remove the unused direct
  `@playwright/test` and `esbuild` declarations. Retain `@types/uuid`,
  because `uuid@9.0.1` ships no declarations of its own.
- **Consequences**: `npm ci` emits zero `EBADENGINE` warnings, deprecation
  warnings fall from 42 to 13, lockfile entries fall from 1600 to 1341, and
  `npm audit` findings fall from 44 to 25. The `start` and `stop` CLI
  contracts are byte-identical, so `sideload`, `stop`, `start:desktop`, and
  the VS Code pre-launch task are unaffected. One dev-only deprecation
  remains (`@microsoft/teamsapp-cli@3.0.2` via `office-addin-dev-settings`),
  and the remaining audit findings require a Vitest 2 to 5 major migration or
  the rejected Agents Toolkit jump. Both are deliberately out of scope.
  Microsoft 365 Agents Toolkit stays deferred as a separate project
  import/restructure initiative.
- **Evidence**: `package.json`, `package-lock.json`,
  `plans/dependency-remediation-plan.md` (Section 7), and the passing
  `toneforge-repository-v1` graph.

## ADR-0043 — Project the task pane from one canonical workflow

- **Status**: Accepted as the Phase 2 implementation contract (2026-09-25)
- **Context**: The task pane currently coordinates findings, coverage, preview,
  Pending Changes, navigation, and Apply across multiple component-local states.
  That works for the initial screens but creates a risk that the view, the plan,
  and the mutation path can disagree. The approved modern UX plan requires B23:
  the task pane must be a projection of one canonical analysis → plan → review →
  apply workflow, not a parallel workflow.
- **Decision**: Introduce a provider-agnostic workflow state owned by an
  orchestration service. Task-pane views may select, review, navigate, reject,
  and request the next user task, but they must not own independent mutation or
  readiness state. The existing `ChangePlan` identity, document hash, policy
  revision, and fail-closed adapter gates remain authoritative.
- **Consequences**: B23 is an additive refactor in Phase 2, with migration and
  component tests required. The current Phase 0 preview-only ReformatPanel and
  plan-level Pending Changes Apply/Reject actions are compatibility steps toward
  the projection and remain the only production mutation path until Phase 2 is
  complete.
- **Evidence**: `plans/toneforge-modern-ux-provider-consistency-implementation-plan.md`,
  `src/taskpane/pages/Dashboard.tsx`, `src/taskpane/components/ReformatPanel.tsx`,
  `src/taskpane/components/PendingChanges.tsx`, and
  `src/reformat/orchestrator.ts`.

## ADR-0044 — Keep Phase 0 review and coverage semantics truthful

- **Status**: Accepted (2026-09-25)
- **Context**: The previous task-pane presentation could imply that a Finding
  could be applied directly, that declared unsupported scope meant the requested
  scope was incomplete, or that acquisition diagnostics belonged in the normal
  workflow. The observer also needed to retain findings produced by a
  conservative full rescan. Ignored-finding persistence based on generated UUIDs
  was not stable across analysis runs.
- **Decision**: Use a first-run profile setup state; make ReformatPanel
  preview-only; expose one plan-level Apply and Reject in Pending Changes; keep
  acquisition diagnostics in Troubleshooting; define coverage completeness as
  the absence of unexpected processing gaps while retaining unsupported and
  protected exclusions; await navigation results and report failures; and key
  ignored findings by a versioned content fingerprint that excludes UUIDs.
- **Consequences**: The UI no longer claims more certainty or completeness than
  the analysis provides, and no duplicate production mutation action is exposed.
  The Phase 0 verification gate passes with 73 files and 693 tests; live Word
  accessibility, host behavior, and release evidence remain separate gates.
- **Evidence**: `src/taskpane/pages/Dashboard.tsx`,
  `src/taskpane/components/FindingCard.tsx`,
  `src/taskpane/components/ReformatPanel.tsx`,
  `src/taskpane/components/CoverageBanner.tsx`,
  `src/taskpane/components/DebuggingPanel.tsx`,
  `src/taskpane/findingFingerprint.ts`, `src/analysis/coverage.ts`, and
  `src/word/documentObserver.ts`.

## ADR-0045 — Resolve learned style and governance into one policy contract

- **Status**: Accepted (2026-09-25)
- **Context**: `StyleProfile` is the learned and measured style contract, while
  `GovernanceProfile` is the normative scope, protection, terminology, editorial,
  and rule envelope. Analysis previously read the profile typography and
  house-style fields directly, and planning captured a governance revision only
  when a caller supplied a policy. That allowed learned evidence and normative
  policy to be interpreted independently and produced plans without a policy
  revision on the default path.
- **Decision**: Add `ResolvedPolicySchema` and `resolveResolvedPolicy()` in
  `src/core/domain/ResolvedPolicy.ts`. The resolver keeps typography and measured
  style as learned evidence, merges normative terminology and non-default editorial
  overrides, and exposes scope, protection, rules, and provenance. Analysis
  consumes the resolved contract and the orchestrator always captures and checks
  its governance revision.
- **Consequences**: Deterministic and semantic engines receive one effective
  policy, and plan/apply validation cannot silently omit the current policy
  revision. Existing governance defaults do not erase learned semantic evidence.
  A later lifecycle contract can add explicit draft/published editorial overrides
  without changing the current resolution rule.
- **Evidence**: `src/core/domain/ResolvedPolicy.ts`,
  `src/analysis/consistencyChecker.ts`, `src/reformat/orchestrator.ts`, and
  `tests/unit/core/domain/ResolvedPolicy.test.ts`.

## ADR-0046 — Separate editable drafts from immutable published profile versions

- **Status**: Superseded in part by ADR-0048, which retires the duplicate
  structure this decision introduced
- **Context**: Before Phase 3, a stored style profile was edited in place, so an
  unapproved change silently altered what the document was checked against and
  there was no way to tell an approved version from a work in progress. Phase 1
  separated learned style from normative governance, which made the remaining
  question explicit: which version of a profile is authoritative.
- **Decision**: A profile owns at most one mutable draft and an ordered list of
  immutable published versions. Publishing appends a new snapshot and never
  mutates an existing one. Activation is always an explicit user action, and
  editing a published version restores it as a new draft. The effective profile
  is the active published version, falling back to the draft when nothing is
  published. State schema version 6 persists the lifecycle and migrates v5 by
  seeding each profile's stored history as its published versions, so an
  existing organization keeps its approved state.
- **Consequences**: An unpublished edit can no longer change analysis
  behaviour, and rollback is a version activation rather than a data restore.
  The cost was a second persisted structure alongside `profiles` and
  `profileHistory`, with `upsertProfile` writing the legacy view while the
  lifecycle owned the authoritative version — two sources of truth that could
  only agree by convention. ADR-0048 retires that duplication by folding all
  three into one `ProfileRecord` and replaces semver with plain integer
  revisions. Live Word and assistive-technology behaviour of the new controls
  remains external evidence.
- **Evidence**: `src/core/domain/ProfileRecord.ts` (successor to
  `ProfileLifecycle.ts`), `src/core/state/persistence.ts`,
  `src/core/state/migration.ts`,
  `src/taskpane/components/ProfileRecordSection.tsx`,
  `tests/unit/core/domain/ProfileRecord.test.ts`, and
  `tests/unit/core/state/profileRecordPersistence.test.ts`.

## ADR-0047 — Split Settings into independently-saved sections over a pure model

- **Status**: Accepted
- **Context**: `SettingsForm` held every draft, baseline, validation rule, and
  save path for styling, provider, consent, and telemetry in one component. A
  failed save, or a cancel, operated across unrelated settings, and the
  validation rules were only reachable through a React render.
- **Decision**: Settings is a composition shell over three independently-saved
  sections — Styling, Provider and privacy, and Telemetry. Validation, draft
  normalization, and draft/baseline comparison live in a pure `settingsModel`
  module that imports no Office, LLM, or UI code, and is unit tested directly.
  Live-region announcements route through a reduced-noise hook that collapses a
  burst of updates into a single message.
- **Consequences**: A failed save in one section can no longer discard unsaved
  edits in another, the broker URL rule is testable without rendering, and
  assistive technology is interrupted once per outcome rather than per
  keystroke. Provider and privacy consent remain one section because they share
  a single save transaction: splitting them would allow a consent change to
  persist separately from the provider it authorizes.
- **Evidence**: `src/taskpane/settings/settingsModel.ts`,
  `src/taskpane/settings/useAnnouncement.ts`,
  `src/taskpane/components/RedactionSettingsSection.tsx`,
  `src/taskpane/components/StylingSettingsSection.tsx`,
  `src/taskpane/components/TelemetrySettingsSection.tsx`, and
  `tests/unit/taskpane/settings/settingsModel.test.ts`.

## ADR-0048 — One profile record is the single source of truth

- Status: Accepted
- Date: 2026-09-25
- Supersedes: the duplication consequence of ADR-0046

### Context

ADR-0046 separated an editable draft from immutable published versions, but it
did so by _adding_ a `profileLifecycles` map alongside the existing `profiles`
array and `profileHistory` map. That left three persisted views of the same
data, written on every change by two independent code paths (`upsertProfile()`
and `saveProfileLifecycle()`).

Two consequences followed:

1. **Duplication rather than derivation.** `profiles[]` held the same
   `StyleProfile` values that `profileHistory[id][n]` already held. They could
   not drift today only because every write updated all three; nothing enforced
   that invariant, so a partial write would have been silent.
2. **Ambiguous revision numbers.** `ProfileEditor` bumped `version.patch` on
   every save while `ProfileLifecycle` wrote to the same field for a different
   purpose, so "1.0.7" did not identify a single event.

Separately, semver (`major.minor.patch`) is the wrong model here. There is one
author of a revision — the record — and no compatibility promise between
revisions, so ordering is all that is needed.

### Decision

One persisted `ProfileRecord` is the only store of profile data. State version
7 replaces `profiles`, `profileHistory`, and `profileLifecycles` with a single
`profileRecords` map keyed by profile id.

A record owns:

- `draft` — the one editable working copy (`null` when none exists).
- `published[]` — immutable approved versions, each carrying its own revision.
- `revisions[]` — the append-only audit trail, one entry per recorded event.
- `activePublishedRevision` and `nextRevision`.

**Revisions are plain integers.** `StyleProfile.version: ProfileVersion`
(semver) becomes `StyleProfile.revision: number`. `ProfileVersionSchema`,
`formatProfileVersion()`, `bumpProfileVersion()`, and `BumpType` are deleted.
`ChangePlan`, `ReviewRequest`, and `ResolvedPolicy` cite `profileRevision:
number` instead of `profileVersion: string`, so a plan identifies exactly the
revision it was built from.

**Every audit event consumes its own number.** `updateDraft`, `publishDraft`,
`activatePublished`, `restoreAsDraft`, and `discardDraft` each allocate
`record.nextRevision`. Publishing no longer reuses the draft's number, so a
number in `revisions[]` identifies exactly one event and `published[].revision`
can never collide with an edit.

**Retention keeps the newest 20 revisions and never drops a published one.**
`REVISION_RETENTION_CAP` is 20; `append()` filters the trail to the newest 20
plus any entry whose revision appears in `published[]`, so an approved version
stays auditable however long the edit trail grows.

**Reads are pure projections.** `upsertProfile()`, `saveProfileLifecycle()`,
`loadProfileLifecycle()`, `appendSnapshot()`, and `sameSnapshot()` are deleted.
`saveProfileRecord()` / `loadProfileRecord()` / `createProfileRecord()` are the
only writer. Everything that previously read `profiles[]` or `profileHistory`
now uses the pure selectors in `src/core/state/profileSelectors.ts`
(`selectAllProfiles`, `selectActiveProfile`, `selectRecordList`,
`selectRecordSummary`, `selectRevisions`), which cannot mutate state.

**The v6 → v7 migration preserves both trails.** The approval trail becomes
`published` and owns revisions `1..N`; the edit trail continues from `N+1`, so
no number is reused. A corrupt record is dropped without discarding the others,
and every surviving record is seeded with a normative governance policy.

### Consequences

Positive:

- Exactly one write path and one persisted structure, so no two views can
  disagree and no invariant has to be maintained by convention.
- A revision number is a stable, human-quotable identifier for a plan, an
  audit entry, and a stored snapshot.
- Restoring an old snapshot cannot forge a revision: the editor loads its
  _content_ as an unsaved draft and the record assigns the next number on save.
- The audit trail is bounded and its growth is measured. Three profiles at the
  cap plus ten extra saves each serialize well under a third of the
  `Office.roamingSettings` budget
  (`tests/unit/core/state/profileStateBudget.test.ts`).

Negative:

- Persisted state grows, because a record stores its own full snapshots rather
  than a bare profile list. The cap plus the budget test bounds this.
- A record is a larger unit of write than a single profile field, so a save
  rewrites the whole record. The payload is small enough that this is not a
  concern at the current cap.
- `version` → `revision` is a breaking contract change for any external
  consumer of `ChangePlan` or `ReviewRequest`. None exists today.

### Evidence

- `src/core/domain/ProfileRecord.ts` — the record, its transitions, and the cap.
- `src/core/state/profileSelectors.ts` — pure read projections.
- `src/core/state/migration.ts` — `buildRecordsFromLegacy()` folds both trails.
- `tests/unit/core/domain/ProfileRecord.test.ts`,
  `tests/unit/core/state/profileMigration.test.ts`,
  `tests/unit/core/state/profileStateBudget.test.ts`.

## ADR-0049 — The add-in holds only opaque connection references

- Status: Accepted
- Date: 2026-09-26
- Extends: ADR-0039 (brokered credentials)

### Context

ADR-0039 established that credentials are brokered, but the concrete shape of
the boundary had never been written down. Three questions were open, and each
one had a wrong answer available that looked reasonable.

1. **What does the add-in persist?** Persisting an access token, a refresh
   token, or an API key puts a long-lived credential into `roamingSettings` and
   `localStorage`, both of which are readable by any code sharing the origin and
   both of which survive a reinstall.
2. **Where can a request originate from?** If Settings offered a free-text
   gateway URL, a user could point the add-in at a host they control and receive
   every request, including document text.
3. **How many providers?** The previous adapter took an `apiKey` field. Adding
   Anthropic and OpenRouter to that shape would have multiplied the ways a
   credential could be held rather than eliminated them.

### Decision

The add-in persists **only an opaque connection reference** — a non-secret
identifier the gateway issued — and holds the live session token in memory for
the lifetime of the pane.

- [`ProviderConnection.ts`](../src/core/domain/ProviderConnection.ts) defines the
  record. It has **no field capable of holding a secret**, and a test reflects
  over the schema shape to keep that true.
- [`gatewayClient.ts`](../src/ai/gateway/gatewayClient.ts) accepts only a
  same-origin path or a loopback HTTP(S) origin. A production origin must be
  build-time configuration, so there is no field in Settings that can name one.
- [`SessionTokenStore`](../src/ai/gateway/gatewayClient.ts) has no serialization
  or persistence method at all. A page reload ends the session, which is the
  intended behavior rather than a limitation.
- The provider enum is `openai | anthropic | openrouter | mock`, and every
  adapter is a `GatewayRoutedAdapter`. The `apiKey` credential mode is removed;
  it no longer exists anywhere in `src/`.

### Consequences

Positive: a stolen storage blob yields a connection reference that is useless
without the gateway session that created it. The provider set can grow without
adding credential shapes. The add-in has no way to be pointed at an arbitrary
host.

Negative: a user must re-authenticate when the pane reloads. The gateway becomes
a required component for every remote provider, so the local development broker
in [`dev-gateway.mjs`](../scripts/dev-gateway.mjs) is not optional tooling — it
is part of the contract until a production gateway exists. Removing a connection
is genuinely destructive: it drops the credential on the gateway side, which the
UI states plainly before the user confirms.

### Evidence

- `src/core/domain/ProviderConnection.ts`, `tests/unit/core/domain/ProviderConnection.test.ts`
- `src/ai/gateway/gatewayClient.ts`, `tests/unit/ai/gateway/gatewayClient.test.ts`
- `src/ai/gateway/oauthState.ts`, `tests/unit/ai/gateway/oauthState.test.ts`
- `tests/unit/scripts/sentinelInjection.test.ts`

## ADR-0050 — A user-supplied API key reaches the provider only through the gateway

- Status: Accepted
- Date: 2026-09-26
- Refines: ADR-0049 for the one provider that takes a user-held key

### Context

ADR-0049 removed the browser-held `apiKey` mode. OpenRouter is the one provider
whose credential genuinely belongs to the end user: they hold an OpenRouter
account, not a ToneForge account. Refusing to support that would be a real
functional loss, and re-adding a browser-held key field would undo ADR-0049.

The tension: a key the user pastes into a Word add-in is a key in the pane's
memory, in the bundle's heap, and on its way to whichever origin the request goes
to.

### Decision

The key is held in **component state only**, submitted **once** to the local
gateway over the existing loopback same-origin and nonce-protected channel, and
dropped the moment that request settles — success or failure. Only the opaque
connection reference comes back, and only that is persisted.

[`OpenRouterConnectionSettings.tsx`](../src/taskpane/components/OpenRouterConnectionSettings.tsx)
exists as a separate component precisely so the key cannot leak into the shared
settings draft: `LlmSettingsDraft` has no field that could hold one, so the
ordinary save path is incapable of persisting it.

### Consequences

Positive: the key never reaches `roamingSettings`, `localStorage`, a log line, a
bundle, or a URL. Disconnecting genuinely revokes it, because the gateway drops
it. `buildProductionManifest` refuses any manifest whose values look
credential-shaped, so a pasted key cannot reach a shipped manifest either.

Negative: the key is in the pane's memory for as long as the user is typing it,
and closing the pane without disconnecting leaves the gateway-side credential
live until it expires. The local development broker becomes a trust boundary —
which is why it enforces same-origin, nonce, HTTPS upstream, and explicit
approval for a self-hosted endpoint. This remains a **development** arrangement;
Phase 6 owns the production equivalent.

### Evidence

- `src/taskpane/components/OpenRouterConnectionSettings.tsx`
- `tests/unit/taskpane/components/OpenRouterConnectionSettings.test.tsx`
- `tests/unit/taskpane/settings/openRouterSettings.test.ts`
- `scripts/dev-gateway.mjs`, `tests/unit/scripts/devGateway.test.ts`
- `scripts/production-manifest.mjs`, `tests/unit/scripts/productionManifest.test.ts`

## ADR-0051 — An all-green automated run is never reported as a release

- Status: Accepted
- Date: 2026-09-26
- Extends: ADR-0033, ADR-0034 (human host evidence blocks release)

### Context

ADR-0033 and ADR-0034 separated deterministic release gates from human Word-host
evidence, but the machine-readable output did not exist to express that
separation. `runVerificationGraph()` printed PASS lines to a console and threw
on failure. Two consequences followed.

1. A consumer of the output — CI, a release job, a dashboard — could not tell a
   passing repository from a released one, because the human gate was not in the
   data at all. Its absence read as completion.
2. A failing run said only _which_ stage failed, not _whose_ problem it was. A
   registry outage and a type error were indistinguishable.

The same problem existed in the host matrix. `docs/manual-verification.md`
records what a human observed, but an unrecorded cell — a dash, a blank,
`TBD` — is not a pass, and a table nobody has updated in a year still looks
authoritative.

### Decision

Every automated run emits `build/verification/summary.json`, on success **and** on
failure, and the summary is built to be hard to misread.

- Each stage carries an `owner`: `repository-code`, `dependency-install`,
  `build-package`, or `external-evidence`. A failure names the class of problem.
- The `word-host-evidence` gate is recorded in every summary and is **always**
  `pending`. Its status is not read from the caller's result map at all, so a
  pass cannot be manufactured for the one gate only a human can satisfy.
  `openExternalGates` is populated even on a fully green run.
- The host-matrix dashboard maps every unrecorded cell to `unknown`, never to a
  pass; a row with two passes and one silence is `partial`; evidence older than
  ninety days is flagged stale; and `releaseReady` is typed as the literal
  `false` so no code path can set it.

### Consequences

Positive: a consumer cannot mistake a green run for a released product without
deliberately ignoring an explicit field. Failures are actionable from the
summary alone.

Negative: the summary is a contract. Adding, renaming, or removing a stage or an
ownership class is a breaking change for every consumer, which is the intent —
these are release-gate semantics, not log formatting. The staleness threshold is
a judgement call encoded in code; it is a named constant so it can be argued
with rather than discovered.

### Evidence

- `scripts/verification-graph.mjs`, `tests/unit/scripts/verificationSummary.test.ts`
- `scripts/host-matrix.mjs`, `scripts/generate-host-matrix.mjs`,
  `tests/unit/scripts/hostMatrix.test.ts`
- `npm run host:matrix` — currently reports 4 hosts, 0 fully passing

## ADR-0052 — Content consistency is a separate, opt-in, non-deterministic engine

- Status: Accepted
- Date: 2026-09-26
- Supersedes: the deterministic-first reading of Phase 5 step 3 in
  [`plans/toneforge-modern-ux-provider-consistency-implementation-plan.md`](../plans/toneforge-modern-ux-provider-consistency-implementation-plan.md),
  and the "Phase H reserved until core release" constraint in
  [`ROADMAP.md`](../ROADMAP.md)
- Extends: ADR-0031 (additive layering), ADR-0032 (consent-gated AI review)

### Context

ToneForge's governing rule is deterministic-first: interpretation goes to a model
only where a rule cannot decide, and the deterministic engine is what runs while a
user types. C1–C10, the cross-report content-consistency checks, do not fit that
shape. Comparing two statements in different sections and deciding whether they
_contradict_ is interpretation. No rule answers it, and a rule that approximated
one would be confidently wrong on exactly the cases that matter.

Two prior positions had to be overturned rather than refined:

1. The plan's Phase 5 step 3 said to "keep C1–C10 deterministic unless a specific
   check is explicitly semantic and consent-gated". That makes the engine
   deterministic by default, which is the opposite of what these checks are.
2. [`ROADMAP.md`](../ROADMAP.md) reserved the seam until "core release
   acceptance and a separately approved privacy/consent design". Reserving it
   indefinitely would have meant the engine shipped after a release users had
   already installed — a worse sequence than shipping it opt-in alongside the
   feature it belongs to.

A third constraint was inherited from ADR-0031: layering only, never replacement.
The engine must therefore produce findings that flow through the existing planner,
review, and mutation path, not a parallel one.

### Decision

**C1–C10 are ten cross-report, non-deterministic checkers in a self-contained
engine, run only on explicit user opt-in.**

- The engine lives in `src/analysis/consistency/` and is the **single sanctioned
  exception** to deterministic-first. It does not weaken the rule for anything
  else; `rules/`, `formatting/`, and `style/metrics` remain pure.
- It has **its own pipeline** — segment, compare, adjudicate, consolidate — with
  its own progress, cancellation, and stale-run handling. It is never called from
  the live typing observer or any other incremental path. A cross-report check
  over a moving document produces contradictory answers, so it runs on a
  whole-document snapshot the user chose to review, never continuously.
- It has **its own opt-in toggle** and **its own consent flag**
  (`consistencyReviewConsent`, distinct from spot review, full-document review,
  and semantic opt-in). A user who agreed to send text for one of those has not
  agreed to send it for this.
- It reuses the **already-configured provider and model**. It introduces no second
  credential, no second settings surface, and no second model selection.
- Within the engine, each check compares **deterministically first** and escalates
  a candidate to model adjudication only when the structured comparison is
  genuinely ambiguous. Most candidates never reach the model.
- Output flows through the **existing** `ChangePlan` and the **sole** mutation
  path. Consistency findings carry a distinct `kind: "consistency"`, so a user can
  tell at a glance which findings came from a non-deterministic engine.

### Consequences

Positive: the deterministic engine's guarantees are intact and its tests stay
pure. The user sees, before anything is sent, exactly what this feature does and
that it is separate from the others. Because the output is a normal `ChangePlan`,
the protection, stale, conflict, approval, coverage, and capability gates all apply
unchanged — a consistency finding cannot bypass one of them.

Negative: this is the one part of ToneForge that cannot be fully verified by unit
test. "These two sentences contradict" has real false positives and real false
negatives, and no test can enumerate them. So the engine reports its own coverage
honestly, every finding carries the pair of statements that produced it, and
adjudication records a confidence. A low-confidence finding is surfaced as
advisory rather than actionable, because a non-deterministic engine that silently
rewrites prose is a worse outcome than one that asks.

The engine is also slower than the typing path: cross-report comparison is
quadratic in the number of statements. That is a reason to keep it opt-in and off
the incremental path, not a reason to bound it silently — the bound is stated in
the coverage report.

### Evidence

- `src/analysis/consistency/contracts/` — the ten check IDs, the consent gate, and
  every shape the engine produces or consumes (replaces the old `contracts.ts`)
- `src/analysis/consistency/checks/` — the ten check identities and their
  deterministic-first flags
- `src/analysis/consistency/indexedEngine.ts` — the indexed pipeline (replaces the
  old `engine.ts`)
- `eslint.config.mjs` — the documented `ai/providers` exception for this directory
- `tests/unit/analysis/consistency/`

### Amendment (2026-10-08) — the engine is the indexed replacement, R1–R7

The windowed pairwise engine this ADR first described was replaced by the indexed
engine in `plans/indexed-consistency-authoritative-plan.md`. The exception itself
is unchanged; only the implementation moved. The replacement adds the full claim
schema and evidence validation (R1), two-pass extraction with canonical
resolution (R2), normalisation, nine blocking indices, and C1–C10 retrieval (R3),
the claim-pair diff, deterministic E-resolver, and pre-model gates (R4), the
`DecisionPlan` compiler, decision adapter, and bounded expansion (R5), 16-outcome
D-derivation, post-model gates, and confidence with intervals (R6), and the
encrypted `ConsistencyStore`, coverage V3, results UI, and decision-model
benchmark (R7). The boundary rules in this ADR — never reached from the typing
path, `ai/providers` allowed and nothing else, output is an ordinary `Finding` —
still hold and are still enforced by `eslint.config.mjs`.

## ADR-0053 — Manifest validation reads Microsoft's published schema, not the CLI's converter

- Status: Accepted
- Date: 2026-09-26

### Context

The `manifest` verification stage shells out to
`office-addin-manifest validate manifest.json`. That CLI first runs the manifest
through its own generated type guard, `TeamsManifestConverter.jsonToManifest`,
before any schema check runs. In every published build of
`@microsoft/app-manifest` — verified against `1.1.2` and the latest
`1.1.3-beta.2026092303.0` — that guard declares the top-level `extensions` key as
an optional **object**.

Three published sources agree it is an **array**:

- Microsoft's v1.30 JSON schema, which defines `elementExtensions` as
  `"type": "array", "maxItems": 1`
- the package's own `TeamsManifestV1D30.d.ts`, which declares
  `extensions?: ElementExtension[]`
- Microsoft's v1.30 manifest documentation, whose syntax block shows
  `"extensions": [ { ... } ]`

The CLI also indexes the key as an array itself
(`manifestHandlerJson.js` reads `appManifest.extensions?.[0]`), so the guard and
its own consumer disagree. The result is a crash — not a validation report — for
every spec-correct unified manifest, which is why the stage passed on developer
machines and failed only in CI, where the validator runs on Linux but not on
Windows.

### Decision

Validate `manifest.json` against Microsoft's published v1.30 JSON schema directly,
using `AppManifestUtils.validateAgainstSchema` — the same function the CLI itself
calls once it has converted the manifest. The schema is read from the installed
`@microsoft/app-manifest` package, which is already a transitive dependency of
`office-addin-manifest`.

The CLI is not used for the schema check, and the CLI's converter is not
workaround-ed. Reshaping `manifest.json` to an object to satisfy the broken guard
would have made the add-in wrong: Word reads the published schema, and an object
there is a manifest that does not load.

This also made the real defect visible. With the broken guard out of the way, the
schema check reported that every ribbon control was missing `icons` and
`supertip`, both required by `extensionCommonCustomGroupControlsItem`. Those were
added, which is a genuine conformance fix the CLI's crash had been hiding.

### Consequences

- The manifest stage now fails on what is actually wrong with the manifest, on
  every platform, instead of crashing on what is right with it.
- `validateManifests` is now async, because `validateAgainstSchema` is. Its five
  test call sites were updated, and `scripts/validate-manifest.d.mts` now declares
  a `Promise`.
- The stage still skips the schema check on Windows, matching the platform split
  that predates this decision. A test now runs the check with
  `runOfficialValidator: true` unconditionally, so a manifest cannot lose schema
  conformance without a Windows developer seeing it.
- This decision should be revisited when `@microsoft/app-manifest` fixes its
  type guard. At that point the CLI is usable again and this indirection can be
  removed.

### Evidence

- `scripts/validate-manifest.mjs` — `readPublishedSchema`, `validatePublishedSchema`
- `manifest.json` — `icons` and `supertip` on every ribbon control
- `tests/unit/commands/commandContracts.test.ts` — the schema check runs in the
  suite, and a dropped `supertip` is rejected
- `node_modules/@microsoft/app-manifest/build/json-schemas/teams/v1.30/MicrosoftTeams.schema.json`
- `node_modules/@microsoft/app-manifest/build/generated-types/teams/TeamsManifestV1D30.d.ts`

## ADR-0054 — VS Code launches the browser for a web debug session, with an explicit CDP port

- Status: Accepted
- Date: 2026-09-26
- Extends: ADR-0051 (an all-green automated run is never reported as a release)

### Context

The host matrix in [`manual-verification.md`](manual-verification.md) still had to record
Word on the web in both Chrome and Edge, and the only debug path the repository had was
`Word Desktop (Edge Chromium)`, which attaches to the WebView2 CDP port 9229. Reaching
the web hosts meant working out what `office-addin-debugging` can actually do, and the
answer is that it cannot do it. Version 5.1.6 was read directly rather than assumed:

- The `start` command accepts no `--browser` option and no remote-debugging-port option.
- `startDebugging()` calls `devSettings.enableDebugging()` only when the app type is
  `desktop` **and** the platform is Windows. The web path never enables a debug port.
- For the web app type, `sideloadAddIn()` requires an explicit `--document` URL and then
  calls `open()` on the **default** browser, with no debug port on the resulting process.

So the "attach to the browser that office-addin-debugging launched" model has nothing to
attach to. A configuration written in that shape would have looked plausible, appeared in
the Run and Debug picker, and failed on first use with a timeout.

The second constraint is that web sideloading is not a local operation. It is an Office
Online query-string protocol: the document URL is appended with `wdaddindevserverport`,
`wdaddinmanifestfile`, `wdaddinmanifestguid`, and optionally `wdaddintest`, and Office
Online registers the add-in from those parameters. That means a real document URL in a
real tenant is required, and that URL contains a tenant and site name.

### Decision

Invert the direction of control. VS Code launches the browser with an explicit
`--remote-debugging-port`, and the `url` is the sideload URL that `office-addin-debugging`
would otherwise have opened. The `preLaunchTask` starts only the dev server, via a new
`start:web` script that passes `--no-sideload` so the task never opens a second,
un-debuggable browser window. The launch configuration is solely responsible for the
browser.

The sideload query string is assembled once in a `variables` block in
[`.vscode/launch.json`](../.vscode/launch.json) and shared by both web configurations, so
Chrome and Edge cannot drift apart. Chrome takes 9222 and Edge takes 9223, which keeps
both clear of the 9229 WebView2 port and lets the desktop and web paths coexist.

The document URL is supplied through a `promptString` input rather than written into the
file. [`.gitignore`](../.gitignore) deliberately un-ignores `launch.json` and `tasks.json`
so they are shared with the team, which means a hardcoded document URL would commit a
tenant and site name into the repository. Prompting keeps that out of git at the cost of
one paste per session.

Mac and Word for Mac are out of scope. No Safari or WebKit configuration is emitted
anywhere, and the Mac matrix row now says so explicitly instead of leaving the row looking
merely forgotten.

### Consequences

- The web hosts become reachable for manual verification, which is a precondition for
  Stage 27. This does not close it. The Chrome and Edge matrix rows stay `PENDING` with
  their evidence unchanged, because a configuration that has not been run is not evidence.
  Per ADR-0051, the existence of the path is not a result.
- Web sideloading is only reachable for someone with a document in a tenant, so the web
  path is not reproducible on a machine without Office on the web access. The desktop path
  remains the one that works everywhere.
- Each web configuration uses its own `userDataDir` under `.vscode/.debug-profile/`, so the
  first run needs a separate Office sign-in. The sign-in then persists. This isolation is
  what makes two fixed ports sufficient, and it also means these profiles are not the
  developer's everyday browser profile.
- Two web configurations can be run only one at a time; a second F5 on a port already in
  use will fail to attach.
- The sideload query string is now duplicated between `launch.json` and the behavior of
  `office-addin-dev-settings`. If Microsoft changes the protocol, this configuration is the
  thing that will silently stop registering the add-in. The parameters are documented in
  [`onboarding.md`](onboarding.md) so a failure is diagnosable.
- If a future `office-addin-debugging` version adds browser selection and a debug port for
  the web app type, this indirection should be removed in favor of the supported flag.

### Evidence

- [`.vscode/launch.json`](../.vscode/launch.json) — the `variables` block, the two web
  configurations, and the unchanged desktop attach
- [`.vscode/tasks.json`](../.vscode/tasks.json) — `Debug: Word Web Dev Server` and
  `Debug: Word Web Sideload`
- `package.json` — the `start:web` script
- `node_modules/office-addin-debugging/lib/cli.js` — the `start` option surface
- `node_modules/office-addin-debugging/lib/start.js` — desktop-and-Windows-only debugging
- `node_modules/office-addin-dev-settings/lib/sideload.js` — `generateSideloadUrl` and the
  `open()` call that opens the default browser

## ADR-0055 — AI Review is one surface running one engine

- Status: Accepted
- Date: 2026-09-26
- Amends: ADR-0052 (the consistency engine is a separate, opt-in, non-deterministic engine)
- Affects: Phase D (spot review) and Phase E (full-document review) task-pane surfaces

### Context

The AI Review page presented two independent things as if they were peers: a
selection/paragraph/full-document style review, and the cross-report consistency
check. Each carried its own disclosure, its own consent story, and its own set of
buttons. A user opening the page had to read two descriptions of what the feature
would do with their document before choosing anything, and the two descriptions
disagreed about scope — one promised a minimized selection, the other the whole
document.

The duplication was visible in the rendered output. A single missing consent was
announced three times, once per disabled control, because each control carried its
own copy of the same prerequisite sentence. Nothing had changed for the user: they
still had to work out which of four consents applied.

Both review engines remain implemented and tested. What was wrong was the
presentation, and the navigation around it: three ribbon targets
(`ai-review-selection`, `ai-review-paragraph`, `ai-review-document`) each opened the
pane part-way into a flow, so a ribbon click could begin a review whose disclosure
the user had not yet seen.

### Decision

The task pane offers **one** AI Review, and it is the cross-report consistency
check. [`AiReviewSection`](../src/taskpane/components/AiReviewSection.tsx) owns the
whole ladder — disclosure, one consent-gated action, preflight, progress, results —
and renders exactly one prerequisite hint.

- The three `ai-review-*` navigation targets collapse to `ai-review`. Navigation now
  shows the disclosure and starts nothing until the user chooses to. Command IDs and
  labels are unchanged, so both manifests stay valid.
- `spotReviewConsent` and `fullDocumentReviewConsent` lose their Settings toggles.
  The persisted fields, the Zod schema, and the migrations are **kept**, so no state
  version bump is required and existing state loads unchanged.
- The engines are untouched: `spotReview` and
  [`reviewEntireDocument`](../src/reformat/orchestrator.ts) remain, as do their
  consents.

### Consequences

Positive:

- One page, one description, one action, one prerequisite. A missing consent is
  stated once.
- A ribbon button can no longer open the pane mid-flow.
- The remaining AI Review consent is unambiguous: exactly one feature depends on it.

Negative, and deliberately accepted:

- **This is a product change, not a bug fix.** Phase D and Phase E lose their
  user-facing entry points. They are no longer reachable from the add-in. The
  ROADMAP rows for those phases are updated to say so rather than left claiming a
  shipped surface.
- The `AiReviewEntry`, `AiReviewResult`, `FullReview*`, and `ConsistencyReviewEntry`
  components remain in the tree, covered by tests, but are no longer mounted. They
  are retained as library surfaces so a future decision to reintroduce a review mode
  does not require rebuilding them. They are not dead code in the sense that matters
  — nothing imports them, and a reviewer should treat re-mounting any of them as
  reopening this ADR.

### What this ADR explicitly does not change

ADR-0052 still holds in full. Consolidating the surface merges nothing about
consent: `consistencyReviewConsent` is still stored separately, still defaults to
`false`, and is still not implied by `semanticOptIn` or anything else. A future
change that lets one consent enable another would contradict ADR-0052, not this ADR.

- Evidence: [`AiReviewSection.tsx`](../src/taskpane/components/AiReviewSection.tsx),
  [`Dashboard.tsx`](../src/taskpane/pages/Dashboard.tsx),
  [`taskpaneNavigation.ts`](../src/shared/office/taskpaneNavigation.ts),
  [`commandDefinitions.json`](../src/commands/commandDefinitions.json),
  [`RedactionSettingsSection.tsx`](../src/taskpane/components/RedactionSettingsSection.tsx),
  and `tests/unit/taskpane/components/AiReviewSection.test.tsx`.

## ADR-0056 — Analysis acquisition is gated on probed capabilities and degrades to text

- Status: Accepted
- Date: 2026-09-26
- Relates to: ADR-0038 (fresh capability probing before every mutation)

### Context

[`acquireAnalysisContext()`](../src/word/analysisAcquisition.ts) accepted an
`AnalysisCapabilities` record and then ignored it. It unconditionally loaded
`document.styles`, every style's `font`, and per-paragraph `style`,
`styleBuiltIn`, `uniqueLocalId`, `isListItem`, `alignment`, `lineSpacing`,
`spaceAfter`, `spaceBefore`, and `font` — regardless of what the probe had found.

On live Desktop Word the probe reports `supportsStyles: false`,
`supportsParagraphFormat: false`, and `supportsInsertBreak: false`. The acquisition
asked for those families anyway. Word does not decline the one unsupported property;
it rejects the entire request with a generic `GeneralException`. The cost was the
whole scan, not the one property: the observer latched `phase: "failed"`, Findings
stayed permanently stale, and safe reformat reported the same failure.

The failure was also undiagnosable. `redactDiagnosticContext` treats any key
matching `/error/i` as potential document content and replaces it wholesale, so
every host failure was logged as `[REDACTED_CONTENT]`. Redacting a message that
might quote a paragraph is right; redacting a Word error code is not.

### Decision

Two changes, both in the Word boundary.

1. **Ask only for what the probe says exists.** `planAcquisitionLoads()` builds the
   request from the probe result. Each optional property family is bound to one
   capability; `document.styles` is not touched at all when `supportsStyles` is
   false. Every property deliberately not requested is named in
   `AcquisitionDiagnostics.unsupported`, so a text-only result is never reported as
   a formatting-aware one.

2. **Degrade rather than fail.** The probe can be wrong — a requirement set can be
   added by the host after the probe ran. On a host rejection, the acquisition
   retries once with a text-only scope and records the degradation, rather than
   losing every scan to one property. A second failure propagates: that is the
   runtime being gone, not the document being unreadable, and
   [`performScan()`](../src/word/documentObserver.ts) reports the two differently.

Separately, [`describeError()`](../src/shared/utils/logger.ts) builds a diagnostic
context from a thrown value using the allowlisted keys `errorName`, `errorCode`, and
`errorMessage`. Those three bypass the content rule but still pass through
credential redaction and a 200-character cap, so an exception message that happens
to embed a paragraph is truncated rather than logged in full. The blanket `error`
key is still fully redacted.

### Consequences

Positive:

- A host that cannot serve styles or paragraph format still gets deterministic
  findings over the whole document, with an honest coverage report.
- A Word host failure is diagnosable from the console again, including its error code.
- The skip list is data, so a coverage claim is derived from what was actually read.

Negative:

- Acquisition results now depend on the probe. A stale probe yields a narrower
  scope than before. The degraded retry exists precisely because that is preferable
  to a rejected request, and the skip list makes the narrowing visible rather than
  silent.
- Three diagnostic fields now reach the log where a blanket `error` key previously
  suppressed them. They are capped and credential-redacted, but the exemption is a
  real change to the redaction contract and is covered by tests in
  `tests/unit/shared/utils/errorDiagnostics.test.ts`.

- Evidence: [`analysisAcquisition.ts`](../src/word/analysisAcquisition.ts),
  [`documentObserver.ts`](../src/word/documentObserver.ts),
  [`redaction.ts`](../src/shared/utils/redaction.ts),
  [`logger.ts`](../src/shared/utils/logger.ts),
  `tests/unit/word/analysisAcquisitionLoads.test.ts`, and
  `tests/unit/taskpane/fluentTheme.test.ts`.

### Amendment (2026-09-27) — the degraded scope is now honoured by the readers

Decision 2 above was implemented as a retry of the _request_ only. The DTO
builders that ran after the retry still read `listItem.level`, `style`,
`styleBuiltIn`, `isListItem`, `font`, and the paragraph-format family
unconditionally — properties the degraded plan had deliberately not loaded.

On a real Office proxy, reading a property that was never loaded throws
`PropertyNotLoaded` rather than returning `undefined`. The consequence was that
the retry converted a `GeneralException` into a `PropertyNotLoaded` and still
failed, while logging that it had recovered. This is visible in the field as a
paired `ItemNotFound` / `PropertyNotLoaded` warning on every scan.

`readPlanned()` now gates every optional read on the same
`AcquisitionLoadPlan` that built the request, and the plan is threaded into
`buildSnapshot()` and `buildFormatting()`. The `try`/`catch` inside it remains as
a second line of defence for a host that accepts a load and then refuses to
serve it, but the plan check is what prevents the read.

Two consequences follow from making the degradation honest:

- A list level is reported as `unsupportedProperties` only when the plan
  _requested_ it and the host would not serve it. A scope ToneForge chose is not
  a host limitation, and reporting it as one would be a false coverage claim.
- A degraded scope cannot classify a node as a list item, because `isListItem`
  is not a base property. Such a node is reported as a plain paragraph.

The unit suite did not catch this because the shared Office mock in
`tests/setup.ts` returns `undefined` for an unloaded read. The regression test in
`tests/unit/word/analysisAcquisitionDegradedScope.test.ts` uses a `Proxy` double
that throws on any unserved property, matching the host, and asserts that no
property outside the degraded plan is read at all.

### Amendment (2026-09-27) — a refusal is remembered for the session

Making the retry safe left it still expensive. The observer rescans on every
document change, and the plan was rebuilt from the probe on every scan, so a
host that refuses one property family cost a full failed Word transaction per
scan for the rest of the session. Each failure also emitted a status, re-rendering
the task pane.

`acquireAnalysisContext()` now remembers the refusal and the capability set it
happened under, and starts degraded when the same set is seen again. The
capability set is stored alongside the flag deliberately: a fresh probe result is
new evidence, and `prepareReformatHost` re-probes before every Apply, so a host
that gains the family is picked up on that path instead of being written off for
the session.

This deliberately does **not** split `supportsListLevel` into a read and a write
capability, which is the underlying defect: the probe answers "can I write a
list level?" by checking for `listFormat.set`, and that answer gates the
"can I read one?" request for `listItem`. Those are separate APIs. A sampled
read probe is the obvious correction and is deferred, because a false negative
there narrows scope on a capable host, and the honest position is to measure it
on live Desktop Word first.

The cost, accepted deliberately: on a host that refuses a family, formatting
coverage is reduced for the session rather than recovered by a later
successful scan. The alternative was paying a guaranteed failed transaction on
every scan, and the skip list still reports the narrowing rather than hiding it.

## ADR-0057 — A Fluent theme is inverted, and the token scope is the document element

- Status: Accepted
- Date: 2026-09-26

### Context

Two independent defects made the task pane look broken in dark mode.

First, [`createDefaultTheme()`](../src/taskpane/fluentTheme.ts) set only a
`palette`. Fluent v8 decides whether a component paints itself against light or dark
neutrals from `theme.isInverted`; the palette only supplies the values it paints
_with_. A dark palette on a non-inverted theme therefore produces light-bodied
`Dropdown`, `TextField`, `Toggle`, and `MessageBar` controls sitting on a dark page.

Second, the theme class was applied to an inner wrapper `<div>`, while the CSS custom
properties are consumed by `html` and `body`. A wrapper cannot supply variables to its
own ancestors, so `background: var(--tf-bg)` on `body` resolved to nothing and fell
through to the user-agent default of white — the white frame around the content card.
Native `<input>`, `<select>`, and `<textarea>` elements are not Fluent components and
are never painted by the theme object at all.

### Decision

- `createDefaultTheme(dark)` sets `isInverted: dark` and writes the dark palette the
  way Fluent expects an inverted theme to be written: light foregrounds, a
  dark-to-light surface ramp. The page canvas is owned by CSS, not by the palette —
  `IPalette` has no `backgroundColor`, and a shell that paints its own background is
  the only way the area around the card stops falling back to UA white.
- `ThemeProvider` applies the theme class to `document.documentElement`, so `html`
  and `body` resolve the custom properties.
- `color-scheme` is declared per theme, and native form controls are given explicit
  `background-color` and `color`.

### Consequences

Fluent controls and native controls now follow the same theme as the rest of the
page, and the canvas is owned in one place. The dark palette is coupled to Fluent's
inverted-theme conventions, so a future Fluent upgrade that changes the ramp will
need this function revisited; `tests/unit/taskpane/fluentTheme.test.ts` pins the
`isInverted` contract so a regression there is caught immediately.

- Evidence: [`fluentTheme.ts`](../src/taskpane/fluentTheme.ts),
  [`theme.tsx`](../src/taskpane/theme.tsx),
  [`taskpane.css`](../src/taskpane/taskpane.css), and
  `tests/unit/taskpane/fluentTheme.test.ts`.

### Amendment (2026-09-27) — the theme object is built once, not per render

`ThemeProvider` called `createDefaultTheme(isDark)` inline in its JSX, so every
render produced a new theme object and handed `FluentThemeProvider` a new
identity. Each new identity invalidates the theme for every Fluent consumer in
the pane, forcing a full restyle of every `Dropdown`, `TextField`, `Toggle`, and
`MessageBar` on every render.

On an idle pane that is waste. Under the scan failure described in the ADR-0056
amendment it was worse: a failing scan emits a new status on every attempt, and
each of those emissions restyled the whole pane. The user-visible symptom was
the task pane locking up during a theme change.

Both themes are now built once with `useMemo` and selected by reference, so the
identity is stable across re-renders that do not change the theme and changes
exactly once when the preference does.

This is deliberately not observable through Fluent's own `useTheme`, which
returns a stable reference even when the provider is handed a new object.
`tests/unit/taskpane/theme.test.tsx` therefore counts calls to
`createDefaultTheme` through a module mock — the construction count is the
property under test, and it is the thing that was actually wrong.

## ADR-0058 — The Stage 18 smoke path is removed, and readiness is decided once

- Status: Accepted
- Date: 2026-09-26
- Affects: `word/`, `reformat/`, `taskpane/`, and the Stage 18 and Phase F documentation
- Amends: ADR-0038 (per-Apply tracked-editing preparation)

### Context

`word/smokeApply.ts` exported `enableSmokeMutations()`, which called
`setStage01Passed(true, capabilities)` directly, bypassing
`prepareTrackedEditing`. Nothing in `src/` imported the component that called it,
so the path was dead — but shipping it meant the user-facing statement "Track
Changes can never be bypassed", made in two places in the UI, was a claim about
the bundle rather than about the running add-in.

Separately, apply readiness was computed in two places that did not agree.
`PendingChanges` computed `canApply` from plan-level gates only and was never
given its own `applyDisabledReason`, so a user on a host without revision support
saw an enabled Apply and only learned otherwise from the refusal message. The
tracked-editing preference also reported "Enabled" before any probe had run: the
flag defaults to on, while `STAGE_01_PASSED` stays false until
`prepareTrackedEditing` probes the real host.

### Decision

1. `SmokePanel`, `smokePlan`, and `smokeApply` are deleted. `setStage01Passed` is
   called from `prepareTrackedEditing` only. The Stage 18 live evidence in
   `docs/manual-verification.md` is retained as a record, not as a tool.
2. Apply readiness is computed once, in the pure `applyReadiness` helper, from
   the same facts the apply gate checks: the preference, the probe result, and
   the change types in the plan. One call feeds both the disabled reason on the
   Apply button and the host-readiness verdict on the governance page.
3. The preference and the readiness are separate concepts. A host that has not
   been probed is `probePending`, not "ready" and not "blocked": Apply still
   works, because it re-probes at the gate, but nothing may be claimed about
   that host yet.

### Consequences

A disabled Apply always carries its reason, computed from the same inputs that
will refuse it. The user learns their host's capability before planning rather
than after clicking. The smoke path can no longer be revived without adding a new
production caller for `setStage01Passed`, which is now a single obvious call site.

- Evidence: [`applyReadiness.ts`](../src/taskpane/settings/applyReadiness.ts),
  [`trackedEditing.ts`](../src/reformat/trackedEditing.ts),
  [`PendingChanges.tsx`](../src/taskpane/components/PendingChanges.tsx),
  `tests/unit/taskpane/settings/applyReadiness.test.ts`.

## ADR-0059 — The retired review surfaces are removed, and the batcher is salvaged

- Status: Accepted
- Date: 2026-09-26
- Affects: `ai/review/`, `taskpane/components/`, `taskpane/pages/Dashboard.tsx`
- Implements: the decision recorded in ADR-0055

### Context

ADR-0055 removed the Phase D and Phase E task-pane entry points, and did so
deliberately: there is one review surface running one engine. What remained was
the engines, their orphaned components (`FullReviewPreflight`, `FullReviewProgress`,
`FullReviewResults`, `AiReviewEntry`, `AiReviewResult`, `AiUnavailable`,
`ConsistencyReviewEntry`), `buildRewritePrompt`, and `navigationController` — all
imported only by their own tests.

`Dashboard.resolvePendingPlan` also still accepted a full-document result and a
spot result, and the call site passed `null` for both. Two of its three branches
were unreachable while reading as live capability.

### Decision

The orphaned components and the two dead `resolvePendingPlan` parameters are
deleted, and the components are deleted rather than kept warm on the theory that
a future review surface will want them.

`ai/review/batcher.ts` is the exception: `partitionReviewBatches` is a working
partitioning primitive that the consistency engine needs for long documents. Its
logic is moved into `analysis/consistency/` rather than imported, because that
module may not reach `ai/` by ADR-0052.

### Consequences

`src/` no longer contains a symbol whose only caller is a test, so coverage
reflects reachable behaviour. A maintainer reading `ai/review/` no longer finds
what looks like a second live review path. The review pipeline that wrapped the
batcher is gone; nothing in the product runs it.

- Evidence: [`Dashboard.tsx`](../src/taskpane/pages/Dashboard.tsx),
  `tests/unit/taskpane/pages/Dashboard.test.ts`.

## ADR-0060 — Provider availability is stated from what the runtime can reach

- Status: Accepted
- Date: 2026-09-26
- Affects: `ai/gateway/`, `taskpane/settings/`, `core/config/`
- Amends: ADR-0049 and ADR-0050 (credential custody)

### Context

Two sources of truth contradicted each other. `ai/gateway/oauthState.ts` resolves
Anthropic to `"oauth"` and OpenAI to `"featureGated"`, while the Provider dropdown
in Settings told the user both were "Deployment-managed. The gateway holds the
credential; the add-in never sees it."

Only one is true, and a user acting on the wrong one is told to expect a
connection flow that does not exist.

### Decision

Provider availability is derived from what the runtime can actually reach, and
the dropdown renders every provider in that set with its reason. A provider that
is not reachable is shown disabled with a sentence explaining why, rather than
offered and failing at request time.

The OAuth state machine stays, but ships behind an explicit deployment flag
rather than sitting next to a UI that contradicts it. Whether Anthropic OAuth can
be turned on is a credential-custody decision, not a UI decision.

### Consequences

Every option the dropdown offers is one the add-in can use. A user selecting an
unavailable provider learns why in one sentence instead of after a failed
request. Enabling provider OAuth later is a one-flag change plus a connect
surface, not a rewrite.

- Evidence: [`providerComposition.ts`](../src/taskpane/settings/providerComposition.ts),
  [`settingsModel.ts`](../src/taskpane/settings/settingsModel.ts),
  [`oauthState.ts`](../src/ai/gateway/oauthState.ts).

## ADR-0061 — Governance policy is authorable, and takes precedence over learned evidence

- Status: Accepted
- Date: 2026-09-26
- Affects: `core/state/`, `core/domain/`, `changes/`, `taskpane/pages/Profile.tsx`
- Implements: Phase 3 of [`implementation-plan.md`](../plans/implementation-plan.md)

### Context

`GovernanceProfile` models `rules`, `terminology`, `scope`, `protection`, and
`editorial`, and `resolveResolvedPolicy` gives them precedence over learned
evidence. But `saveProfileRecord` overwrites only `style`, and no UI could author
any of the rest — so the entire normative half of the policy contract was
permanently at its schema defaults, and "Mandatory / Advisory" in the governance
dashboard was a label derived from a finding's severity rather than a policy a
user had set.

`VersionDiff` already had a governance-diff branch that had never been rendered
with both arguments.

### Decision

Governance policy becomes authorable: rules bind to finding categories so
`autoFix` and `severity` mean something at plan time; scope and protection become
explicit controls; terminology reuses the existing `term: replacement` parser.
Every policy change bumps the version and appends to history, so a `ChangePlan`
cites the exact policy revision it was built under and an older one is refused.

Protection defaults that are safety properties — quoted text, captions, tracked
deletions — require an explicit confirmation to disable, because a protection
preference is a safety downgrade and must read as one.

### Consequences

A governance author can state intent rather than thresholds, and the dashboard
counts reflect authored policy. Making scope editable means a user could narrow
analysis to nothing, so the coverage banner names the excluded set and a test
refuses a scope policy that excludes all body content.

- Evidence: [`GovernanceProfile.ts`](../src/core/domain/GovernanceProfile.ts),
  [`persistence.ts`](../src/core/state/persistence.ts),
  [`ResolvedPolicy.ts`](../src/core/domain/ResolvedPolicy.ts).

## ADR-0062: One live region per pane, with an explicit announcement priority

**Status:** Accepted

**Context.** The Dashboard has three independent message sources: the document
observer reports scan phase and failures, the apply path reports results and
refusals, and the consistency review reports blockers and outcomes. Each rendered
its own `role="status"` element. A scan that completed while an apply refusal
was still on screen updated two live regions in the same tick, and a screen
reader read them in DOM order rather than in the order the events happened. The
plan also found `useAnnouncement` written and unit-tested but never adopted by
any component.

**Decision.** The pane owns exactly one polite live region. Which of the three
messages speaks is decided by `deriveAnnouncement`
(`src/taskpane/state/announcement.ts`), a pure function with a fixed priority:
unreachable host, then scan error, then review blocker, then apply result, then
scan phase. The visible surfaces stay visible as ordinary text. The region is
fed through `useAnnouncement`, so a burst collapses into one sentence, and
re-announcement is suppressed until the sentence actually changes.

**Consequences.**

- The priority order is now testable without rendering anything, which is why it
  lives in a pure module rather than inside the effect.
- A new message source must be added to the priority list rather than given its
  own live region, or the singular-region test fails.
- The review blocker outranks the apply result. The two are not simultaneous in
  practice, and when they are, the thing blocking the current view is the one
  worth speaking.
- `useAnnouncement` is no longer dead code, and its existing tests cover the
  debounce half of the behaviour this ADR describes.

**Rejected.** Leaving the regions per surface and relying on debounce alone. It
fixes the interruption count but not the ordering, and three regions still means
three places for a future change to add a fourth.

## ADR-0063: Incremental scanning narrows the examined scope and retains nothing

**Status:** Accepted

**Context.** `wordParagraphEvents.ts` normalises Word paragraph events,
computing `uniqueLocalIds` and `requiresFullRescan`, and the Dashboard wired the
adapter with a callback that discarded the payload and called
`onDocumentChanged()`. Every triggered scan therefore examined every acquired
node, and the coverage diagnostic hardcoded `incremental: false` with a reason
saying no verified changed-range event existed. The event adapter was wired and
its output thrown away.

**Decision.** Forward the payload. When the host reports a local event with a
complete set of ids, examine only those nodes and say so in the coverage report
— including the exact examined count against the acquired count.

Five cases force a conservative full rescan: an event that could not name every
id, a deletion, a remote edit, an event naming no paragraphs, and an event whose
ids are not present in the freshly acquired document.

**No cross-run retention.** A narrowed run reports only what it re-derived and
carries nothing over from the previous run. Growing one paragraph shifts every
character offset after it, so a finding retained in an untouched paragraph can
point at the wrong sentence while looking entirely normal. Re-anchoring is the
fix, not retention, and re-anchoring is not available here.

**Consequences.**

- Scopes accumulate across a debounce burst rather than replacing one another.
  Two paragraphs edited inside one window both need examining, and keeping only
  the most recent would silently skip the first. A full rescan clears any
  pending narrow scope, so an imprecise event is never narrowed by a precise one
  that arrived earlier in the same burst.
- A narrowed run is visibly partial, which is a behaviour change for anyone who
  reads the coverage banner. That is the point.
- The performance claim is host-dependent and remains ungated by these tests.
  The scope _decision_ is unit tested exhaustively; whether Word actually reports
  complete local ids is a live-host question recorded in
  `docs/manual-verification.md`.

**Deviation from the implementation plan.** The plan proposed retaining findings
from unscanned nodes. That is not implemented, for the offset reason above, and
the deviation is deliberate rather than an omission.

## ADR-0064: Semantic findings are anchored to a verified span, or refused

**Status:** Accepted

**Context.** Every semantic deviation carried `range: { start: 0, end:
text.length }`, `nodeIds: []`, `actionable: false`, and the reason "full-document
semantic deviation has no locally verified target span". The planner could
therefore never produce a change from one, and the `semanticOptIn` toggle could
only ever produce advisory text. That was honest, and it also made the toggle
close to pointless.

**Decision.** Outcome A of the implementation plan. The model must return a
verbatim `anchor` alongside each deviation, and that anchor is resolved against
the acquired nodes by `resolveAnchor`. A unique match produces a finding that is
`actionable`, carries the node id, a document-absolute range, and an exact
`actual`/`expected` pair so the change has a real precondition. The anchor is
required in the response schema rather than optional, because a deviation that
cannot be quoted describes nothing the product could act on.

Three refusals, and each is a way a model can be wrong:

- **Absent.** A quote that is not in the document means the model paraphrased.
  Fuzzy matching is refused, not offered: it produces a finding pointing at a
  sentence that says something else.
- **Ambiguous.** A quote appearing more than once has two possible targets and no
  way to choose, and an edit to the wrong one is a silent corruption.
- **Unaddressable.** A node with no document offset offers nothing to point at.
  A node-relative offset would address whatever text happens to sit there in
  someone else's document.

A refused finding still appears, with the specific reason as its
`advisoryReason`, so the user sees why it cannot be acted on.

**Consequences.**

- An anchored semantic finding is plannable but still AI-sourced and medium-risk,
  so the change still requires approval. Being plannable is not being safe.
- The planner now prefers `finding.expected` over parsing a quoted replacement
  out of the message prose for semantic findings. The suggestion has already been
  verified against a real offset; re-deriving it from prose would discard that
  verification and would fail on any suggestion not phrased as `Use "x" instead
of "y"`. The prose parser remains for unanchored findings.
- `detectSemanticDeviations` now takes the acquired nodes. With none, every finding
  stays advisory, which is the correct answer rather than a crash.
- The prompt states the quoting rule explicitly, including that a deviation the
  model cannot quote is one it should not report.

## ADR-0065: Apply writes only the findings the user has reviewed

- **Status**: Accepted (2026-09-28)
- **Context**: `reviewOne()` added a finding id to `reviewedFindingIds` and
  changed nothing else. The plan handed to Apply was the whole auto-previewed
  plan, so Review was decorative: the user could mark three of forty findings
  and Apply would write all forty. Worse, the marking was invisible — the
  pending-changes table did not indicate which rows had been reviewed, so the
  control read as a no-op.
- **Decision**: Apply receives a plan filtered to reviewed findings, and the
  button says so: `Apply {n} reviewed change{s}`. The duplicate "Apply all
  changes" path is removed rather than kept as a shortcut, because a shortcut
  around the review gate is the exact affordance the gate exists to prevent.
- **Consequences**:
  - A finding id cannot be the review key. The observer's scan and the preview
    that builds the plan are separate runs issuing separate UUIDs, so an id
    recorded against one is absent from the other. `reviewKey` is
    `fingerprint@range.start` instead, which both runs compute identically.
  - Offsets are compared exactly, not with the 400-character
    `POSITION_TOLERANCE` that `isIgnoredFinding` uses. The difference is
    deliberate: an ignore should survive the user typing above the finding, but
    a review was given for specific text in a specific plan, and carrying it to
    different text at a different offset is not the same consent.
  - A re-scan invalidates reviews whose text has moved. That is correct — the
    plan it was given for no longer exists — but it means reviewing is work
    that a scan can undo, which is stated on the empty state rather than left
    to be discovered.

## ADR-0066: Coverage completeness is a discovery claim, not a type requirement

- **Status**: Accepted (2026-09-28)
- **Context**: `buildCoverage` defaulted `requiredNodeTypes` to
  `["body", "paragraph/heading"]` and required at least one acquired node of
  each, reporting `Required in-scope node type inaccessible: paragraph/heading`
  otherwise. A document consisting entirely of list items therefore reported
  itself incomplete forever, and because an incomplete plan blocks Apply, the
  document could never be written to. The `body` alternative made it worse: it
  is satisfied by every document, so the check could only ever produce a false
  alarm, never a true one.
- **Decision**: `requiredNodeTypes` defaults to `[]` — callers declare node
  types they specifically need, and nothing is inferred. Completeness is
  instead decided by a shape-independent question: were any in-scope nodes with
  actual text acquired? Zero means the acquisition failed, which is the only
  condition the check can honestly detect.
- **Consequences**:
  - A caller that genuinely needs a node type must now say so. This is the
    honest direction: the previous default asserted a requirement nobody had
    established.
  - The check can no longer detect "we read the document but skipped a
    construct we should have handled". That is a per-rule concern, not a
    coverage one, and is reported by the rule's own diagnostics.
  - Three existing tests encoded the old default. They were retargeted rather
    than deleted, because they were testing real behaviour — the type
    requirement still works when declared.

## ADR-0067: Staleness is not declared while a re-scan is already scheduled

- **Status**: Accepted (2026-09-28)
- **Context**: `scheduleScan()` set `stale = true` on the first change event,
  before the debounce elapsed. With a 300 ms debounce the findings list flashed
  "findings are stale" on essentially every keystroke, then cleared — a banner
  that appears and vanishes faster than it can be read and that described a
  transient state rather than a problem.
- **Decision**: Scheduling a scan does not mark findings stale. Staleness is
  declared only when a refresh genuinely fails, in which case the phase becomes
  `stale` rather than `failed`: the document did not break, the refresh did.
  The debounce is raised to 1200 ms, and the Dashboard no longer overrides it.
- **Consequences**:
  - The banner now means one thing — the findings you are looking at cannot be
    refreshed — instead of two, one of which was self-cancelling.
  - A failed refresh is reported as staleness rather than failure because the
    findings on screen remain valid; they are simply not current. Calling it a
    failure implied the scan had produced nothing.
  - A narrowed incremental scan that cannot plan from its own scope now triggers
    a follow-up full scan. Previously the user could be left with findings from
    a partial scope and no plan, which read as the product having found nothing.

## ADR-0068: Semantic profiles are managed on the tab that edits them

- **Status**: Accepted (2026-09-28)
- **Context**: `selectKindRecordList`, `setActiveSemanticProfile`,
  `createSemanticProfileRecord`, and `removeSemanticProfile` all existed in the
  persistence layer and none had a caller. The Semantic tab could display the
  one profile Learn Style had just created, so there was no way to hold a
  second voice, no way to start from a blank profile, and no way to remove one.
  Learn Style requires a sample passing the quality gate, so a user whose
  document is too short had no route onto the tab at all.
- **Decision**: `SemanticProfilePicker` manages the list on the Semantic tab:
  switch, create empty, delete. Create-empty takes no sample and no provider.
- **Consequences**:
  - The picker holds the record list and the active id as state rather than
    deriving them from the page's one-time state snapshot. Deriving left the
    list showing a deleted profile and still marking the previous one active
    after a switch — telling the user their rewrite matched a voice they had
    just left.
  - Each row's control names its target in the accessible name. Three buttons
    all reading "Use this one" is not a list a screen reader user can navigate.
  - Switching or deleting drops any pending proposal. A rewrite made against
    the previous profile must not survive a switch, and nothing is silently
    re-pointed at a profile the user did not choose.
  - Consent does not gate this. Declining semantic consent withholds sending
    text to a provider; typing a tone into a local field sends nothing, so
    disabling the editor locked out exactly the user who had declined. The
    editor's `disabled` prop was removed.

## ADR-0069: Every refusal names the control that resolves it

- **Status**: Accepted (2026-09-28)
- **Context**: Blockers were explained in prose, or not at all. Apply refused
  by an unreviewed plan rendered as a disabled button with no reason anywhere
  near it. The troubleshooting page answered "what does this host support" and
  could only be consulted if the user had already found it, and its diagnostics
  function was private to it, so no other surface could reuse or contradict it.
- **Decision**: `src/taskpane/troubleshooting/checks.ts` is a pure registry —
  state in, notes out — and every remedy carries a `remedyTarget` naming the
  actual control by its on-screen label and the page it lives on, e.g.
  "Settings → Scanning → Scan automatically as the document changes". Only
  situations that are currently true are returned.
- **Consequences**:
  - A target is a label, not a navigation destination. The pane's destinations
    and the command layer's targets are different unions with no mapping
    between them, and a link landing the user one screen early — where they
    must still find the control — is not better advice than naming it.
  - Returning only true situations is what keeps the one relevant line
    distinguishable on a page people arrive at _because_ something is wrong.
  - Because the registry reads no store, no two surfaces can state a different
    reason for the same blocker. The Dashboard passes the live plan and review
    counts it already holds, rather than the panel re-deriving them.
  - A test pins every remedy label, so renaming a control without updating the
    remedy that points at it fails the build.

## ADR-0070: A manifest change requires re-registration, and the two manifests must agree

- **Status**: Accepted (2026-09-28)
- **Context**: The ribbon tab and context-menu entry were both absent from a
  live Word after being added correctly to both `manifest.json` and
  `manifest.xml`. The likely explanation at the time was a missing LLM
  configuration, which is wrong: both are declared statically and exist whether
  or not a provider is set. The real causes are documented in
  `manual-verification.md` and are properties of Word, not of this repository.
- **Decision**: Record the procedure rather than change the code. `npm run stop`
  then close every Word window then `npm run sideload`, in that order, because
  both npm scripts operate on `manifest.xml` and a background Word process
  holds the old registration.
- **Consequences**:
  - `npm run sideload` reads `manifest.xml`, not the unified `manifest.json`.
    The JSON is the deployment manifest, validated in CI, and a local sideload
    never sees it — so a control added to only one file passes every check in
    this repository and produces a Word that has never heard of it. This is the
    single most likely cause and it fails silently.
  - The semantic ribbon button ships `enabled: false` and is enabled at runtime
    through `Office.ribbon.requestUpdate`, which needs the shared runtime
    (`SharedRuntime`, `RibbonApi`, `ContextMenuApi`, with `CommandsRuntime` at
    `lifetime: "long"`). If any of that is shortened or dropped, the call
    rejects and the button stays greyed out with no error shown — which looks
    identical to a missing tab, and is why the shared-runtime requirement is
    stated explicitly rather than left to the manifest.
  - `probeWordCapabilities` previously checked `Office.contextMenus` and
    `Office.ui.contextMenus`, neither of which exists; the runtime API is
    `Office.contextMenu.requestUpdate`. The probe answered `false` on every
    host and had no test. It now probes the namespace that exists, and
    `supportsRibbonUpdate` was added for the same reason.

## ADR-0078: The semantic rewrite is applied on its own path, sharing only the writer

- Amends: ADR-0005 (one mutation path) and ADR-0065 (Apply writes only reviewed
  findings)
- Status: Accepted (2026-09-28)
- **Context**: The Semantic tab offered one control — hand the proposal to the
  deterministic review gate. That gate resolves a finding against a deterministic
  plan, and a semantic proposal is not in one, so it refused every rewrite with
  "the planner proposes no correction for this finding". The user received a
  paragraph they could neither apply nor refine, and no message naming a control
  that would have worked.
- **Decision**: `src/reformat/semanticApply.ts` builds the single `replaceText`
  change a rewrite is and hands it to the same `applyReviewedPlan` the
  deterministic flow uses. The tab shows the original and the proposal side by
  side, with **Apply revision** and **Regenerate review**. Regenerate re-sends
  the identical prompt and selection — it closes over the same state rather
  than re-reading anything.
- **Consequences**:
  - The review experience is separate; the writer is not. ADR-0005 admits exactly
    one writer, and `taskpane/` may not import `word/revisionAdapter`, so
    sharing `applyReviewedPlan` is a requirement rather than a convenience. What
    is kept apart is the gate, the projection, and the pending-changes section —
    none of which can express a prose rewrite.
  - The change's range and its exact text precondition both come from the
    verified proposal. Recomputing either would discard the anchor check that
    makes an AI-supplied offset safe to use, and the precondition is what stops a
    user who edited the paragraph in between from having the rewrite written into
    whatever now occupies those offsets.
  - The `target` rides inside `range`, not beside it. `ChangeSchema` has no
    top-level `target` field, so a sibling key is not rejected — it is stripped.
    The anchored node would have silently never reached the plan, and the write
    would have fallen back to offsets alone.
  - Apply re-reads the document rather than reusing the hash from when the model
    was asked. The two are separated by however long the user spent reading the
    result, and the precondition is only meaningful against the document as it is
    now.
  - The confirmation outlives the proposal. A successful apply clears the
    proposal, because it described text that no longer exists; the message was
    first rendered inside the proposal card, so clearing it removed the only
    sentence saying the write had happened.
  - A throw is reported as a fault and a refusal as a refusal. Collapsing the two
    is what left the old flow with a button that failed silently.

## ADR-0079: A ribbon command is delivered whenever it is pressed

- Amends: ADR-0063 (incremental scanning narrows scope) and the target list in
  ADR-0071 (the first run reports rather than locks)
- Status: Accepted (2026-09-28)
- **Context**: The task pane read its navigation instruction once, on mount. A
  ribbon or context-menu command pressed while the pane was already open wrote
  its instruction to storage and nothing read it: the button did nothing, with no
  error, and the next mount picked up a stale instruction from whenever the user
  happened to reopen the pane. Separately, the instruction the "Scan Now" command
  wrote named a target the arrival mapping no longer handled, so that command ran
  its scan and opened no page at all.
- **Decision**: `subscribeToTaskpaneTarget` listens for the `storage` event and
  consumes on delivery, and the mount-time consumption and the subscription share
  one `applyArrival`. The target is named `review`, matching the destination the
  header calls Deterministic Review.
- **Consequences**:
  - The commands run in a different document from the task pane, which is
    exactly the case `storage` events exist for: the event fires in the _other_
    same-origin document, so the pane learns of a command without polling. A
    `setInterval` would have been a second thing to keep running and to stop.
  - The listener checks the key, because `storage` fires for every key the other
    document writes.
  - Sharing one `applyArrival` is what stops the two from drifting again. Two
    copies of a mapping is how a renamed destination ended up handled in one and
    not the other, and the failure is silent by construction: an unmatched
    target simply opens nothing.
  - The consumed instruction is still cleared, so a delivered command cannot
    re-fire on the next mount.

## ADR-0085: One navigation guard, owned by the pane, shared by every surface

- Amends: ADR-0064 (semantic findings are anchored to a verified span)
- Status: Accepted (2026-09-28)
- **Context**: `navigationGuard` documented five rules — one attempt in flight,
  one queued and replaceable, the superseded attempt aborted and forbidden from
  claiming the result, a repeated jump coalesced, a replayed attempt id stale —
  and had a full test suite. It had **no callers**. Every finding card called
  `navigateToFinding` itself, so clicking one card and then another started two
  host navigations, and because `office.run` cannot be cancelled whichever
  finished last won: the card that reported "selected" was the one that happened
  to resolve last, not the one the user had most recently asked for.
- **Decision**: `src/taskpane/findingNavigation.ts` owns one guard for the whole
  pane. Every surface — Deterministic Review's findings, Consistency Review's
  results, the Semantic tab's proposal — goes through `goToFinding`.
- **Consequences**:
  - One guard, not one per card. A guard per surface would have left two cards
    on the same page racing each other, which is the original defect.
  - It is module state rather than context, because the guarantee is about a
    host shared between components: a card that unmounts mid-navigation must
    not cancel it, and a card that mounts must not get a guard that knows
    nothing about the attempt already running.
  - The superseded caller is told it was superseded. Reporting success would
    contradict what the pane had just done, and reporting a failure would blame
    the host for a decision the pane made.
  - Two sequential jumps to the _same_ finding are still coalesced, and that is
    the guard working rather than a missing call — the user gains nothing from
    a second selection change to the place they are already at. `reportHostMoved`
    exists so a click elsewhere in the document releases that.

## ADR-0081: A style can be learned from pasted text, attributed as pasted

- Status: Accepted (2026-09-28)
- **Context**: Learn Style read the open document. A document too short to pass
  the sample-quality gate therefore left someone with no way to create a profile
  from their own writing at all: the one control on the tab that could create a
  profile was the one that could not fire. `createSemanticProfileRecord`
  already offered an empty-profile route, but that is an empty profile — the
  user still had no way to get their own measured metrics in.
- **Decision**: The Semantic tab gains a paste box beside Learn Style. It is the
  same `learnStyleDraft` call with a sample from `captureFromText`, so the
  quality gate, the profiler and the provider consent are identical.
- **Consequences**:
  - Pasting is not a way around the quality gate or around consent. The control
    is disabled with an empty box, so the empty case never reaches the gate and
    reports a confusing "sample too short" instead.
  - `CapturedSample["source"]` gained `pasted`, and `captureFromText` now
    defaults to it. The default was `document`, which is a different claim: text
    the user pasted is neither their selection nor the document they have open,
    and the learned profile is attributed to this value in the evidence it
    shows. That is the record of where a profile came from, not a label.
  - The source is a parameter rather than a post-hoc assignment, so a caller
    cannot attribute a sample to a source the function did not read it from.

## ADR-0077: One palette, one exemption, and no rule that reaches into Fluent

- Amends: ADR-0057 (a Fluent theme is inverted; the token scope is the document
  element)
- Status: Accepted (2026-09-28)
- **Context**: Drop boxes and input sections were reported as not following the
  global theme. The palette was never wrong: `taskpane.css` declares a complete
  token set under two theme classes, and `createDefaultTheme` sets
  `isInverted`. Three things had gone wrong around it. `ProfileEditor` had a
  literal `#edebe9` — the light theme's own neutral, pasted in — so its section
  frames stayed light in dark mode. An unscoped `input, select, textarea` rule
  carrying `background-color` also applied to Fluent's own fields, because
  every Fluent component renders a real `<input>` underneath carrying an `ms-`
  class. And two components still held hardcoded colours.
- **Decision**: `npm run lint` rejects any colour literal under
  `src/taskpane/`, with `fluentTheme.ts` exempt because it _defines_ the values
  the tokens carry. The native-control rules are scoped with
  `:not([class*="ms-"])`. `ReformatPanel` and `GovernanceDashboard` are
  deleted rather than restyled.
- **Consequences**:
  - Deleting rather than restyling is the point for the two components. Neither
    had a production importer — `GovernanceDashboard` was reachable only from
    its own test — and both carried hardcoded colours. A theme rule for a
    component no user can reach is a rule with nothing to keep consistent, and
    the fact that nothing rendered them is why nothing looked wrong.
  - `manual-verification.md` previously claimed the inline hex values had
    already been replaced. That claim was false and is now corrected, because a
    verification document asserting something untrue is worse than one with no
    claim.
  - Focus rings deliberately still apply to Fluent's inputs. They are an
    outline rather than a palette, and keyboard focus is not something Fluent
    should be the only owner of.
  - **This does not establish that the rendering is correct.** jsdom cannot
    compute styles, so whether Word paints a Dropdown dark is a manual
    verification step and is recorded as one. What the tests pin is that the
    token sets match, the scoped selectors are present, and the lint rule is
    still scoped to the files it is meant to cover.

## ADR-0076: The semantic tab owns the semantic profile and its measured context

- Amends: ADR-0068 (semantic profiles are managed on the tab that edits them)
- Status: Accepted (2026-09-28)
- **Context**: The deterministic profile editor rendered a read-only **Measured
  style** list of all eight metrics and a read-only **Semantic style** list,
  under its own `<h1>Style Profile</h1>`, directly beneath the page's `<h1>
Deterministic Style Profile</h1>`. Neither list was editable, so the
  deterministic tab looked like it owned a semantic profile and a metrics view
  it could not change. The Semantic tab already owned the semantic editor but
  displayed only four of the eight measured metrics.
- **Decision**: Measured style moves to the Semantic tab, complete — all eight
  metrics, not the four it already showed. The deterministic editor keeps a
  sentence naming where they went, and gives up its own heading; the page owns
  the one `h1`.
- **Consequences**:
  - A move is not a deletion. Removing those blocks from the deterministic tab
    without moving the other four metrics would have left em dash, en dash and
    curly quote frequency and capitalization consistency displayed nowhere —
    numbers the engine still uses and no one could see. A test pins all eight
    by label, so a partial move fails the build.
  - The two surfaces never both showed the same list, so there was no second
    copy to keep in step. That is the reason this was safe to do at all, and
    the reason a test asserting the count matters.
  - Measured values are still _written_ by `learnStyleDraft`, which computes
    them from the sample and stores them on the semantic record the editor
    reads. A blank profile has none, and says "not measured yet" rather than
    printing a zero.
  - `capitalizationConsistency` is a proportion between 0 and 1, not a
    percentage. It needs a formatter of its own: rendering it with the
    integer-rounding used for word counts printed `1` for 96.5%, and the
    per-100-words rates need one decimal or 0.4 reads as none at all.
  - The semantic settings are saved through `saveSemanticProfileRecord`, and
    the rewrite and the ribbon command both read that same record, so an edit
    is the input the engine reasons about. A write to the deterministic record
    under the same id would leave the two namespaces silently divergent.

## ADR-0074: A protection exclusion is not an acquisition failure

- Amends: ADR-0066 (coverage completeness is a discovery claim) and
  ADR-0065 (Apply writes only reviewed findings)
- Status: Accepted (2026-09-28)
- **Context**: Apply was permanently unavailable, with
  `Coverage is incomplete; apply is blocked` and
  `Unprocessed: No in-scope document content was acquired` — on a document the
  pane was visibly reading, since the findings list beside it was full.
  `buildCoverage` asked whether any node was both in scope and non-empty.
  `analysisAcquisition` sets `includedInGovernance: false` on any paragraph
  containing a double-quoted span, so a document that discusses quotations — a
  style guide, an editorial memo, anything about typography — has every
  paragraph protected, no in-scope content exists, and a policy setting was
  reported as a read that never happened. `complete` is derived from
  `unprocessed` and it gates Apply, so the misclassification denied the one
  action the product exists to offer.
- **Decision**: `complete` reflects _acquisition_, not governance eligibility.
  An `unprocessed` gap is raised only when no content was acquired at all. A
  document whose every paragraph is protected is reported as `protectedOnly`,
  which is complete and carries its exclusions with their reasons in
  `excluded`, exactly as before.
- **Consequences**:
  - A document nothing was read from is still incomplete and still refused. The
    two states remain distinguishable, and the distinction is the fix: one means
    "we read nothing" and the other means "we read it and excluded it".
  - The plan such a document produces is legitimately empty. An empty plan
    beside a refusal read as two contradictory answers to the same question, so
    the refusal is the part that had to go.
  - A caller that genuinely needs in-scope content can still ask for it, through
    the existing `requiredNodeTypes` option, which is opt-in precisely because
    the unconditional version of this question is the bug.

## ADR-0075: The preview plans against probed capabilities, never a fallback

- Amends: ADR-0056 (acquisition is gated on probed capabilities)
- Status: Accepted (2026-09-28)
- **Context**: The auto-preview called `reformatDocument` with no
  `capabilities`, so the orchestrator used `FALLBACK_CAPABILITIES` — every flag
  false. The resulting report listed `styles, styleBuiltin, isListItem,
listItem, alignment, lineSpacing, spaceAfter, spaceBefore, font` as
  unsupported for a Word host serving every one of them. The pane was asserting
  its own ignorance as the host's, in the document shown to the user as
  diagnostics. A second copy of the same claim had already been hand-written at
  the other call site.
- **Decision**: `toAnalysisCapabilities` narrows the probe result to the shape
  acquisition consumes, and the preview passes it. Before the probe answers,
  one shared `UNPROBED_CAPABILITIES` constant stands in for all of them — every
  flag false, because nothing has been probed and no capability may be claimed.
- **Consequences**:
  - A preview built before the probe resolves is provisional. It does not claim
    the document's preview hash, so the corrected plan is built when the probe
    lands. Claiming the hash would have made the fallback permanent rather than
    momentary, through the same guard that prevents needless replanning.
  - The narrowing drops `supportsRibbonUpdate`, which is a ribbon concern with
    no meaning to acquisition. Declaring the drop is the point: adding a
    capability is a deliberate act in two places rather than an accident in one.
  - The consistency report referenced its own hand-maintained copy of the
    coverage schema. It now references `CoverageReportSchema` directly. Two
    copies of a schema that gates Apply is the wrong shape — the first field
    added to one and not the other is silently dropped on the way through the
    report, and the report is what the gate reads.

## ADR-0071: The first run reports; it does not lock

- Amends: ADR-0069 (every refusal names the control that resolves it)
- Status: Accepted (2026-09-28)
- **Context**: `Dashboard` returned a `NoProfileSetup` component when no
  deterministic profile existed. Its `navigate` collapsed every destination
  except Settings, Troubleshooting, and home back to home — where home _was_ the
  profile editor. The header's other items were therefore rendered and inert,
  so a user could not read the AI consent, change the theme, or inspect
  Troubleshooting before committing to anything. A user whose document was too
  short for Learn Style's quality gate had no route to the blank profile that
  would have unblocked them, because the editor they were stranded on was
  Learn Style's. The prerequisite is real; enforcing it by making half the
  application unreachable is not a way to communicate it.
- **Decision**: The app shell renders with or without a profile. `Home` is a
  page of its own that states what is outstanding and what each item currently
  prevents, and links to the control that resolves it. The prerequisite is
  unchanged: scanning and applying still need a deterministic profile, and the
  surfaces that need one say so. The setup state is computed by a pure
  `src/taskpane/setupStatus.ts` so the checklist cannot drift from the store.
- **Consequences**:
  - Every warning is phrased as what is _unavailable_, never as what will
    become available. A warning that promises a capability is a capability grant
    the page cannot make, and the real gates still decide.
  - `Home` and the findings list were one destination called `home`. They are
    now `landing` and `review`, because a single destination could only show
    one of them and the first run could only show the other.
  - Absence of an LLM provider never blocks deterministic work. A checklist
    that implied it did would send users to configure a provider they do not
    need in order to fix a deterministic profile.
  - Leaving the profile editor with no profile returns to the checklist. It
    cannot be handled by re-resolving the profile alone: that sets the state to
    the value it already holds, React bails out of the re-render, and the user
    is left on the editor with only the header to escape by — the same lockout
    arriving through the back button.

## ADR-0072: Review and ignore are different identities for the same finding

- Amends: ADR-0065 (Apply writes only the findings the user has reviewed)
- Status: Accepted (2026-09-28)
- **Context**: Both concepts keyed on `findingId` and, at the store, on a
  fingerprint. Three defects followed. Reviewing a finding in one scan did not
  admit its change in the next, because a re-scan issues new ids — so the user
  had to press Re-scan and click again, which is why re-scan felt mandatory. The
  projection resolved a change by looking it up with `findingId` in a map it had
  built by identity, so every review reported "no change" for a finding that had
  one. And ignoring a reviewed item did not simply remove it: the ignore list was
  pruned by fingerprint, so ignoring one finding cleared the ignore entries of
  every _other_ occurrence of the same rule, which is what made a second ignore
  appear to resurrect the first.
- **Decision**: `src/taskpane/occurrenceIdentity.ts` owns two identities. Review
  identity is exact — fingerprint, node ids, and both range bounds — because a
  review is a decision about one span. Ignore identity is the fingerprint and
  node ids with a 400-character relocation tolerance, because an ignore is a
  decision about a recurring problem surviving edits above it. Ignored entries
  additionally carry an occurrence key so two occurrences of the same rule in
  one paragraph are separate rows with separate Restore actions.
- **Consequences**:
  - A review does not survive the document moving the finding, and that is
    deliberate: a reviewed span that is now elsewhere is not the span the user
    approved. Stale reviews are pruned against the live identities.
  - The gate and the projection resolve through the same identity, so a finding
    cannot be admitted by one and refused by the other.
  - `reviewedPlan` returns a discriminated union rather than a plan or `null`,
    which makes the previous `?? fullPlan` fallback inexpressible. Falling back to
    the whole plan is exactly how an unreviewed change reached Pending Changes.
  - Reviews live in the store, not in component state mirrored into
    `localStorage`. The write bypassed `saveState` and so never notified
    subscribers, and the pane re-rendered only when something else changed.
  - Once a finding is reviewed its Ignore control is disabled. The two decisions
    are contradictory, and the store would otherwise have to resolve the
    contradiction on the user's behalf.

## ADR-0073: The two manifests need not agree, and that is a recorded deviation

- Amends: ADR-0053 (manifest validation reads the published schema) and
  ADR-0070 (a manifest change requires re-registration)
- Status: Accepted (2026-09-28)
- **Context**: ADR-0070 records that a control added to only one manifest passes
  every check in this repository and produces a Word that has never heard of it.
  `scripts/validate-manifest.mjs` compares the JSON against the XML today, which
  is the correct check, but the naming surfaces have been drifting: the
  "Deterministic Review" rename touches group labels and supertips in both
  files, and a label is exactly the kind of string that gets updated in the file
  a developer happens to have open.
- **Decision**: Every naming change is applied to both files, and the parity
  check stays. The finding is recorded here rather than left as an open
  question so that a future divergence is read as a regression against a stated
  decision rather than as a discovered oversight.
- **Consequences**:
  - `npm run validate` is the gate. A rename that reaches one manifest and not
    the other fails the build.
  - This does not fix the underlying hazard that a manifest change requires
    re-registration before Word will show it. That remains a Word-side property
    documented in `manual-verification.md` under ADR-0070.

## ADR-0080: The sideloadable manifest is checked against the host's rules, not only for internal consistency

- **Status**: Accepted
- **Context**: Sideloading stopped working and reported only "This add-in is no
  longer available" — a dialog naming no file and no field, which reads as a
  broken procedure. The procedure was correct. Two separate defects in
  `manifest.xml` each made Word reject the entire manifest at registration, and
  neither was visible to any check in this repository.

  The first, from commit `c240784`, replaced `ToneForge.GovernanceGroupLabel`
  with `ToneForge.DeterministicReviewGroupLabel` — 39 characters against
  Microsoft's 32-character cap on a `resid` and the resource `id` it resolves
  to. The second, from commit `8a4878f`, declared a context-menu
  `<Control id="ToneForgeSemanticContextControl">` with no `xsi:type`, which is
  required (`Button`, `Menu`, or `MobileButton`).

  The second is the one that kept the add-in broken after the first was fixed.
  Its significance is disproportionate to its size: Word does not fail that one
  control, it fails to parse the manifest and refuses the whole add-in, so every
  ribbon control disappeared at once. A fault introduced to add a context-menu
  entry removed the entire ribbon.

  Nothing caught either one. ADR-0073's parity check compares the two manifests
  against each other, and both were edited together, so it passed on both
  changes. The published v1.30 schema validation covers `manifest.json` — the
  deployment manifest — while every `sideload` and `start:*` script reads
  `manifest.xml`, which nothing schema-validated. `npm run verify` stayed green
  throughout.

- **Decision**:
  - A resource id is an internal identifier with a hard host limit, and a
    user-visible label is free text. The two are never the same string; the
    label lives in `DefaultValue` and the id stays short.
  - `scripts/validate-manifest.mjs` now checks the XML manifest against host
    rules rather than only against itself: `validateResourceIdLength` rejects
    any `resid` or `bt:*` resource `id` over 32 characters, and
    `validateControlType` rejects any `Control` missing `xsi:type`. Both run in
    `validateManifests`, not inside `validateXmlFallback`, because a caller
    supplying XML directly bypasses that function — the first draft of the
    length guard was placed there and its own test proved the point by failing.
  - No equivalent guards are added for `manifest.json`. Its identifiers and
    required properties are schema-validated against the published v1.30
    schema, so duplicating them would be a second thing to keep correct. The
    XML manifest is the unvalidated one; that is where the checks belong.
- **Consequences**:
  - Word's diagnostic is the authority on what Word will accept, and it is
    readable: `%LOCALAPPDATA%\Temp\OfficeAddins.log.txt` recorded
    "Add-in manifest parsing encountered an unexpected child node, Line=266,
    CharPosition=16" while the user saw a dialog naming nothing. That log is
    now the documented second step in `docs/onboarding.md`, after
    `npm run validate` and before a cache clear, because it converts a guess
    into a line number.
  - A manifest defect is total, not partial. One bad element removes every
    command, so a symptom reported as "the context menu is missing" is a
    manifest-wide failure wearing a local costume. The remedy for a missing
    control is to validate the manifest, not to re-declare the control.
  - Parity between the manifests, from ADR-0073, is necessary and not
    sufficient. Two files agreeing they are internally consistent says nothing
    about whether a host will load them, and only one of the two is
    schema-checked at all.
  - The two checks encode specific limits, not a general schema. The next host
    rule to be exceeded will still reach the log before it reaches this
    repository; the log is the feedback channel, and adding a check is the
    response.

## ADR-0082: A ribbon UI element id is unique across the surface, and the check is in the repository

- Amends: ADR-0080 (the sideloadable manifest is checked against the host's
  rules, not only for internal consistency)
- Status: Accepted (2026-09-30)
- **Context**: Development sideloading stopped working again, with the same
  dialog as ADR-0080 — "This add-in is no longer available" — and `npm run
validate` green throughout. The procedure was correct and had been run. This
  time the Office runtime log named the cause directly:

  ```text
  Unexpected  Duplicate UI element id specified
              SolutionId:96df86d6-...  Control Type:Button  id:ToneForgeProfile
  ```

  Word requires every tab, group, and control id on a ribbon surface to be
  unique, and a repeat makes it reject the _entire_ manifest. `manifest.xml`
  declared `<Group id="ToneForgeProfile">` and, inside it,
  `<Control xsi:type="Button" id="ToneForgeProfile">`. Every other group in the
  file ends in `Group` — `ToneForgeGroup`, `ToneForgeGovernanceGroup`,
  `ToneForgeAIReviewGroup`, `ToneForgeChangesGroup` — and this one did not, so the
  group had been renamed at some point to match its label and taken a name a
  control already held.

  ADR-0080's two checks could not see it, and neither can the parity check from
  ADR-0073: both manifests were edited together, so they agreed on a manifest
  the host would not load. The unified JSON manifest is schema-validated and the
  XML fallback is not, exactly as ADR-0080 recorded — and the published schema
  does not express ribbon-wide id uniqueness either, since that is a host rule
  rather than a structural one.

- **Decision**:
  - The group is renamed `ToneForgeProfileGroup` in both manifests, and
    `SEMANTIC_RIBBON_GROUP` in `src/commands/ribbonState.ts` moves with it. The
    group and the control keep their distinct identities; the collision was
    never a reason to rename the control, which is the id the semantic ribbon
    update addresses and which appears in `ribbonState.ts`, the tests, and the
    host.
  - `scripts/validate-manifest.mjs` gains `validateUniqueUiElementIds`, which
    rejects any `Tab`, `Group`, or `Control` id used more than once inside the
    `ToneForge` ribbon, naming the pair of element kinds. It runs in
    `validateManifests` alongside ADR-0080's checks, for the same reason: a
    check that only runs on one of the two entry points is a check the suite
    cannot exercise.
  - The scan is bounded to the ribbon tab and covers ribbon ids only. Resource
    ids (`Icon.32x32`, `Taskpane.Url`) are a different namespace with a
    different rule — the 32-character cap, already enforced by
    `validateResourceIdLength` — and a name shared between the two namespaces is
    legal.
  - A second test reads the real `manifest.xml` and asserts every ribbon id is
    unique, so the assertion does not depend on the validator being correct.
- **Consequences**:
  - ADR-0080's closing note predicted this: the next host rule to be exceeded
    would reach the log before it reached this repository, and adding a check is
    the response. That is now twice true, and the pattern is the procedure worth
    keeping — read `%LOCALAPPDATA%\Temp\OfficeAddins.log.txt` before clearing a
    cache or re-running a sideload, because it converts a guess into a line.
  - A manifest defect is total. Every ribbon control vanished over one repeated
    id, which is why a symptom reported as "the add-in does not load" is a
    manifest fault until the log says otherwise.
  - The duplicate ADR-0080 (this entry is 0082; two entries carried 0080) was
    resolved in this pass: the navigation-guard entry was renumbered to
    **ADR-0085**, because ADR-0082 amends _this_ entry by number and a renumber
    of the manifest entry would have broken that reference. It did not
    affect this defect, but a decision log with two different decisions under one
    number is the same class of problem as two UI elements under one id: the
    reference no longer identifies one thing.
  - The check encodes one specific host rule, not a general schema. Group and
    control ids are in separate namespaces per Microsoft for _some_ surfaces, so
    this is deliberately scoped to the `ToneForge` tab rather than applied
    across every manifest the tool might read.

## ADR-0083: Agent governance lives in `.cline` and `.roo`, and neither is allowed to drift

- Amends: ADR-0031 (additive layering) and the Stage 03 scope in
  [`ROADMAP.md`](../ROADMAP.md)
- Status: Accepted (2026-09-30)
- **Context**: The repository shipped Stage 03 with a single governance file
  (`.cline/rules/toneforge.md`) and four skills under `.roo/skills/`. Nothing was
  wrong with the arrangement, and nothing in it was enforced either: Cline has no
  skills, so a Cline user got four Zoo rules and no Cline skills at all.

  Auditing the `.roo` content against the code found it had drifted badly, and
  the drift was not cosmetic:

  - **Credentials were described wrongly.** The rules stated that API keys "are
    stored only in `Office.roamingSettings`". ADR-0049 removed that mode
    entirely, and `ProviderConnection` now has no field capable of holding a
    secret, with a test reflecting over the schema to keep it that way. A rule
    that tells an assistant keys live in `roamingSettings` is a rule that invites
    the exact regression ADR-0049 was written to prevent.
  - **The module map described a repository that does not exist.**
    `src/analysis/`, `src/rules/`, `src/formatting/`, `src/changes/`, and
    `src/reformat/` were all listed as "planned" and "do not create early". All
    are implemented. `src/ui/` was listed and never existed.
  - **The state version was six releases out of date** — v1 against a real v13.
  - **The apply path was stale**: `STAGE_01_PASSED` framed as the gate, with the
    Stage 18 smoke helpers still described as usable. ADR-0058 deleted them
    because they made the user-facing claim "Track Changes can never be
    bypassed" untrue.
  - **The deterministic-first exception was absent entirely.** ADR-0052 makes
    `src/analysis/consistency/` the single sanctioned non-deterministic engine.
    No rule or skill mentioned it, so nothing warned an assistant away from
    treating a second one as ordinary.

  The failure mode is the interesting part. Stale governance is worse than none,
  because it is read as current and confidently acted on. Nothing in the
  verification graph would have caught any of it: `skills:validate` checked
  frontmatter and that referenced paths existed, and every stale claim above
  pointed at a file that does exist.

- **Decision**:
  1. `.cline/skills/` holds six skills — `toneforge-scaffold`,
     `toneforge-architecture`, `toneforge-officejs`, `toneforge-llm`,
     `toneforge-testing`, and `toneforge-consistency`. The two new ones cover
     module boundaries and the C1–C10 engine, neither of which any skill
     described.
  2. `.cline/rules/` holds an always-on `toneforge.md` plus seven path-scoped
     rules using Cline's `paths:` frontmatter, so a rule loads when the matching
     files are in context rather than on every request.
  3. `.roo/skills/` and `.roo/rules/` are **kept and corrected**, not deleted.
     Two assistants are in use here, and deleting one tool's governance to save
     duplication would push whoever uses it back to unmanaged work.
  4. `scripts/validate-skills.mjs` now validates both roots, each against its own
     expected skill set, and a missing reference is a failure with no
     planned-path allowance. Every module these skills reference is implemented,
     so a skill pointing at a directory that was never built is a defect rather
     than a forward-looking note.
  5. Skills state what has _not_ been verified — the open host gate, the
     uncalibrated consistency checks, the model never having run — so a reader
     cannot mistake a typed contract for an integration.
- **Consequences**:
  - Correctness first: the credential claim in rule 3 is the one that mattered
    most. It is now stated as what the code does — OpenRouter's key lives in
    component state, is submitted once, and is dropped when the request settles,
    with the credential held by the **local development gateway's memory** and
    never by the add-in.
  - Two sets will drift again unless both are checked, which is why the
    validator covers both roots rather than just one.
  - The graph does not prove the guidance is _correct_, only that it is
    well-formed and that its references resolve. Governance files are prose, and
    a prose claim about code can rot the moment the code changes. The Cline and
    Roo sets are now corrected against a 2026-09-30 reading of the repository;
    a later change to `ProviderConnection`, the apply path, or the state version
    must update them in the same commit or it re-creates this defect.
  - The duplicate ADR-0080 was resolved by renumbering the navigation-guard entry
    to ADR-0085, as ADR-0082 recorded. The manifest entry kept the number
    because ADR-0082 amends it.
- **Evidence**: `.cline/skills/`, `.cline/rules/`, `.roo/skills/`,
  `.roo/rules/`, `scripts/validate-skills.mjs`, `npm run skills:validate`, and
  `docs/stages/03-cline-governance.md`.

## ADR-0084: A property name the host does not have is a compile error, and the flow controls are left unread

- Amends: ADR-0056 (analysis acquisition is gated on probed capabilities and
  degrades to text) — its guard covers properties whose absence the host
  declares, and says nothing about a name the host has never heard of
- Status: Accepted (2026-09-30)
- **Context**: Analysis acquisition asks Word for a paragraph's properties with
  `load([...])`. Word does not decline the one name it cannot serve — it rejects
  the entire call with a generic `GeneralException`, so a single bad name costs
  every other property in the same request. That is why
  `planAcquisitionLoads` builds its request from the capability probe rather
  than from the shape of the API we wish existed.

  That guard only covers properties whose _absence the host declares_. It cannot
  cover a name the host has never heard of, and two of those have shipped:

  - `keepNext`, `keepLines` and `pageBreakBefore` were requested from
    `Word.Paragraph`, which has none of them. They are properties of
    `Word.ParagraphFormat`.
  - `21ce84d` replaced those three with a request for `paragraphFormat` on the
    paragraph, on the premise that this was the way to reach
    `Word.ParagraphFormat`. It is not. Microsoft's `Word.Paragraph` reference
    lists no such member, and `Word.ParagraphFormat` names only
    `Word.ConditionalStyle` and `Word.Style` as its users. The commit moved the
    defect up one level rather than removing it.

  Nothing caught either. `tsc` passed, because acquisition typed its paragraph
  double locally with `load?: (properties: string | string[]) => unknown`, so
  every name was a valid `string`. `src/types/office.d.ts` is a hand-rolled
  subset — `interface Paragraph` declares four members — so it is not an
  authority either. And the host doubles in `tests/setup.ts` and
  `analysisAcquisitionDegradedScope.test.ts` serve whatever name they are asked
  for; the degraded-scope double modelled _"throws if you read what you did not
  load"_ but not _"rejects a name I do not have"_.

  The consequence was silent. A rejected transaction triggers the in-session
  text-only fallback, so the scan still completed and still produced findings —
  without indentation, spacing or alignment, which is a formatting-coverage loss
  the coverage report cannot distinguish from a paragraph that happens to match.

- **Decision**:
  1. `LOADABLE_PARAGRAPH_PROPERTIES` in `src/word/analysisAcquisition.ts` is the
     single declared list, typed `as const` so `ParagraphProperty` is a union.
     `CAPABILITY_PROPERTY_GROUPS`, `readPlanned` and
     `AcquisitionLoadPlan.paragraphProperties` all take that type. Adding a name
     Word does not have is a compile error.
  2. The list is annotated with the reference it is derived from, because a
     declared list can only say a name is _absent_, never that it is _wrong_.
  3. `analysisAcquisitionDegradedScope.test.ts` carries an **independent** copy
     of the property list and its host double now rejects any request outside it,
     with `GeneralException`, independently of the `ItemNotFound` path. The two
     lists are compared by a test, so a name added to one and not the other
     fails the suite. This is the check that survives the case the compiler
     cannot: someone who adds a plausible name to both the module's list and its
     own tests.
  4. `tests/setup.ts` keeps `paragraphFormat` on the **Range** double, where it
     is real and `revisionAdapter` uses it, with a comment recording that the
     same name on a paragraph is not, and why.
  5. The flow controls are not examined. `keepNext`, `keepLines` and
     `pageBreakBefore` are `null` in the DTO, the answer "not read", and the
     analyzer skips a comparison it has no evidence for.
- **Consequences**:
  - Spec §6's `ParagraphStandard` compares style name, font, alignment, spacing
    and indentation, and does **not** compare pagination, on every host. The
    profile fields `keepWithNext`, `keepLinesTogether` and `pageBreakBefore`
    remain editable and remain in the diff, and are compared against `null`.
    That gap is real and is recorded rather than papered over; closing it
    requires an API that can serve those values, and until one exists a request
    for them costs the whole paragraph-format family on a real host.
  - The two lists must be edited together, which is the intent. It is a
    deliberate second statement of the same fact, not a duplicate to be
    deduplicated: one copy cannot check itself.
  - **This is not verified against a Word host.** The argument that the old
    request was rejected comes from Microsoft's published API reference, not from
    an observed failure, and the new checks are assertions about the test double
    rather than about Word. `npm run host:matrix` reports 0 fully passing hosts
    and `word-host-evidence` remains open. A real Desktop Word scan is what would
    confirm that the paragraph-format family now survives, and until one runs
    this ADR records a documented limitation, not a verified fix (ADR-0051).
  - `src/types/office.d.ts` remains a loose subset. Making it an authority for
    property names is a separate piece of work and was deliberately not folded
    in here.
- **Evidence**: `src/word/analysisAcquisition.ts`,
  `tests/unit/word/analysisAcquisitionDegradedScope.test.ts`,
  `tests/unit/word/analysisAcquisitionLoads.test.ts`, `tests/setup.ts`, commits
  `21ce84d` and `04a888a`, and
  <https://learn.microsoft.com/javascript/api/word/word.paragraph>.

## ADR-0086: A structural scope is read, counted, and reported from the same load plan

- Amends: ADR-0084 (a property name the host does not have is a compile error) —
  its `LOADABLE_*` tuples covered paragraphs only, and the structural families
  were being read with no equivalent declaration
- Status: Accepted (2026-10-01)
- **Context**: The table, section and header/footer scopes (spec §8.3–§8.5) had
  been read for some time and used for nothing. Acquisition loaded
  `body.tables` and `document.sections`, the load plan tracked both, and
  `buildFormatting` produced neither DTO — so the analyzer's `checkTableFormatting`,
  `checkHeaderFooterFormatting` and `checkPageSetup` compared empty arrays on every
  scan and the registry's three `formatting/*` rules were declared with a body that
  could never fire.

  Three defects sat underneath that, and each would have survived a test written
  against the same fixture:

  1. `planAcquisitionLoads` was never passed `policy.scope`.
     `includeTables`, `includeSections` and `includeHeadersFooters` were read by
     nobody, so every scan requested all three structural scopes whatever the
     governance author had switched off. A scope policy that cannot stop a read is
     not a scope policy.
  2. The `footers` entry of `STRUCTURAL_SCOPES` carried neither a `policyFlag` nor
     the `requiresSections` dependency its sibling `headers` entry carried. It
     therefore re-enabled the whole collection on a host whose sections were
     unreadable and under a policy that had switched headers off.
  3. `acquisition.unsupported` named `tables`, `headers`, `footers` and `sections`
     unconditionally, from a constant. A scan that read every table in the
     document reported that it had read none, and coverage refused to call it
     complete on the strength of a gap that had been closed.

- **Decision**:
  1. `LOADABLE_TABLE_PROPERTIES` and `PAGE_SETUP_PROPERTIES` are `as const`
     tuples in `analysisAcquisition.ts`, for ADR-0084's reason: a load of a name
     Word does not have is refused with a generic exception that costs the whole
     request.
  2. `Section.pageSetup` (WordApiDesktop 1.3) is read in **its own guarded
     transaction**, never in the shared body/section load. `Section` and
     `SectionCollection` are WordApi 1.1, so naming a desktop-only nested object in
     the shared load gets the _entire_ request refused on Word on the web — taking
     the body text, the paragraphs and the styles with it. The refusal is
     remembered per capability set, so the observer does not pay a failed
     transaction per keystroke.
  3. Every structural object the scan reads becomes a `DocumentNode`
     (`table`, `section`, `header`, `footer`), because `coverage.ts` counts what
     was _examined_ by looking for nodes of those types. Without them a scan that
     read every table reported `tablesExamined: 0`, which reads as "this document
     has no tables" — the false-compliance claim §9 exists to prevent, produced by
     a count rather than by any decision. Each is `editable: false` and
     `includedInGovernance: true`: the object _is_ examined, it is simply not
     something this pass may change, because `revisionAdapter` refuses table,
     section and header/footer mutation (spec §8.3).
  4. `acquisition.unsupported` is derived from `plan.skipped` plus a named
     `NEVER_ACQUIRED_SCOPES` constant for the families this pass never attempts
     (fields, content controls, shapes, text boxes, footnotes, comments). The
     second list is constant because spec §8.6 requires those scopes to be
     _explicitly excluded_ rather than silently unexamined.
  5. Table `headerRow` and `cellStyleName` are reported as `null` — "not read" —
     because `Word.TableLoadOptions` has neither. `columnCount` is derived from
     `values`, the only evidence of width on that load-options list. A field the
     API cannot serve is `null`, not a guess, so the analyzer skips the comparison
     rather than inventing a value.
- **Consequences**:
  - Every header/footer slot of every section is read — three slots × two kinds —
    because `required` in the profile is a claim about whether a header _is_, and
    the only evidence Word serves for a header that does not exist is a blank
    body. Reading only `Primary` would leave the first-page and even-page slots
    permanently unreported, which is the same false-compliance claim as reading
    none.
  - `ScopePolicySchema` gains `includeSections`, defaulted. A defaulted field means
    no migration, which is how the spec's "no back-migration" answer is honoured
    by construction rather than by a migration step.
  - `DocumentNodeSchema` gains `section`. `header` and `footer` already existed,
    and `coverage.ts` sums them: Word's model distinguishes them and the scope
    policy does not, so a merged `headerFooter` type would have made the count a
    count of one type while every acquisition emitted two.
  - `CoverageReport.acquisition.unsupported` grows a permanently non-empty tail.
    That is the point: it is the difference between "this document has no
    shapes" and "we do not read shapes".
  - **This is not verified against a Word host.** Every property name here was
    read from Microsoft's published API reference rather than from an observed
    Word response, and the header/footer and page-setup paths in particular have
    never run against a real document. `npm run host:matrix` reports 0 fully
    passing hosts and `word-host-evidence` remains open. Until a Desktop Word scan
    runs, this ADR records a documented limitation, not a verified capability
    (ADR-0051).
- **Evidence**: `src/word/analysisAcquisition.ts`,
  `src/core/domain/DocumentSnapshot.ts`,
  `src/word/capabilityProbe.ts`,
  `tests/unit/word/analysisAcquisitionStructuralScopes.test.ts`,
  `tests/unit/formatting/analyzer.test.ts`,
  <https://learn.microsoft.com/javascript/api/word/word.interfaces.tableloadoptions>
  and
  <https://learn.microsoft.com/javascript/api/word/word.interfaces.pagesetuploadoptions>.

## ADR-0087: Compliance is gated on what the author made mandatory, not on every scope the policy asked for

- Amends: ADR-0056 (analysis acquisition is gated on probed capabilities and
  degrades to text) — a host gap was treated as a reason to refuse Apply
- Status: Accepted (2026-10-01)
- **Context**: `DeterministicCoverage.complete` meant "every requested scope was
  examined", and every requested-but-unexamined scope became a blocker.

  The consequence was that a document with no tables, scanned on a host that
  cannot read them, reported "Incomplete" and refused Apply — with a blocker
  naming a host limitation the user cannot change. The only thing a user could
  learn from the word was to ignore it, and a genuinely partial scan then read as
  a clean document. That is precisely the failure spec §9 and §27 gate 12 exist to
  prevent, produced by the mechanism that was supposed to prevent it.

  The two are genuinely different facts. "We looked and there is nothing wrong"
  and "we could not look" must not share a verdict, and neither must "you asked
  for this" and "you insisted on this".

- **Decision**:
  1. `ScopePolicySchema` gains `mandatoryScopes`, a closed `ScopeKind` list
     defaulting to `["body", "headings"]`. It is a closed list rather than free
     strings because an unrecognised entry would silently never match a scope —
     the §11 "a setting that changes nothing" failure in a new place.
  2. `complete` is "no mandatory scope is missing, and this run saw the whole
     document": a mandatory blocker, a narrowed node set, or a caller-declared
     incremental run each make it false, for a reason the blocker list states in
     the user's terms. It is **not** "every requested scope was examined".
  3. Every requested-but-unexamined scope is still recorded — as a blocker when
     mandatory, and in `excludedScopes` when not. A limitation the report names is
     a limitation the reader can act on; a limitation that silently failed to
     affect the verdict is the false-compliance claim.
  4. `body` is mandatory unconditionally and `coverage.ts` adds it itself. A run
     that examined part of the body cannot speak for the document, and a policy
     that chose otherwise would be a setting that disables the one guarantee the
     coverage report exists to make.
  5. `CoverageBanner` reads the deterministic projection rather than the shared
     `CoverageReport`, because the latter answers "did acquisition read
     everything" and the question the reader asks is "did the review examine
     everything". A body-only scan with a perfect acquisition read as `Complete`
     before. It reports **"Unknown"** when only the shared report arrived, rather
     than picking one of the two answers it cannot support.
  6. The remedy a blocker offers is a **re-scan**, not a filter to the findings.
     The plan calls this action "Review in findings"; a mandatory scope that was
     not examined has, by definition, no findings behind it, so a button that
     navigated there would do nothing and leave the blocker in place.
- **Consequences**:
  - `GovernancePolicySection` gains a "Must be checked before Apply" group, and
    a checkbox for a scope the policy has excluded is disabled rather than
    silently accepted — it would be asking for an examination of content the same
    policy says to ignore.
  - Apply no longer refuses on a host capability gap unless the author asked for
    that scope. That is a real reduction in gate strength, and it is the
    deliberate trade: a gate that fires on something the user cannot fix is a gate
    users learn to route around.
  - `includeTables` and `includeSections` still default to `true` while the
    capabilities default to `false`, so a default profile **does** request scopes a
    default host cannot serve. That combination is safe under this ADR precisely
    because those scopes are not mandatory by default — and it would not be safe
    if they were.
- **Evidence**: `src/analysis/deterministic/coverage.ts`,
  `src/core/domain/GovernanceProfile.ts`,
  `src/taskpane/components/CoverageBanner.tsx`,
  `tests/unit/analysis/deterministic/coverageTruthfulness.test.ts`,
  `tests/unit/taskpane/components/CoverageBanner.test.tsx`.

## ADR-0088: A post-apply report is per-change and counts, and its remaining findings are a fresh review

- Status: Accepted (2026-10-01)
- **Context**: The post-apply report was one sentence on success ("Applied and
  verified 4 change(s)") and one error string on failure. `verifyPlanReadback`
  returned on the **first** mismatch, so a four-change plan with one failure
  reported one error and said nothing about the three that landed.

  That is the wrong shape for the one case Track Changes exists to make
  recoverable. A partly-applied plan leaves several revisions in the document, and
  the user has to decide per revision whether to keep it — so they need to know
  which ones. And the report said nothing about whether the document now matches
  the profile, which is the question a user asks after an apply.

- **Decision**:
  1. `verifyPlanReadback` confirms **every** change against the same readback and
     returns one `ChangeVerification` per change, in plan order. The counts are
     derived from those entries rather than counted separately, so "3 of 4"
     cannot disagree with the list beside it.
  2. A change type the readback has no rule for is reported **verified**. The
     alternative — unverified — would report "unverified" on every change type
     this pass has not been taught to check, which is a report nobody can act on.
  3. `remainingFindings` is a **fresh review** of the document, not a subtraction
     from the list that was acted on. A correction can produce a finding the
     original did not have: applying a style to a paragraph can leave it out of
     compliance with a paragraph standard the style was not configured for.
     Subtracting would have reported a clean document.
  4. `remainingFindings: null` means "we could not look" and is reported with the
     reason; an empty finding list means "we looked and there is nothing left".
     Only the second renders a reassurance, and the component never renders one
     for the first.
  5. Every path produces an `ApplyOutcome`, including the ones that wrote nothing,
     and the two kinds are distinguished: a refused apply _failed_ its changes
     (`noAttemptOutcome` vs `refusedOutcome`). Rendering both as four failures
     would blame the adapter for a decision made before reaching it.
  6. `applyReviewedPlan` takes `profile` and `capabilities` so the refresh runs
     the **same** review under the **same** policy the plan was built from. A
     report produced under different conditions than the fix is not evidence about
     this document.
- **Consequences**:
  - The result is a block rather than a toast, held in Dashboard state rather
    than attached to the plan. The plan is cleared on success so Pending Changes
    empties — and the user still has to decide what to do with the revisions, so
    a result that disappeared at the moment it became useful would be worse than
    useless.
  - `semanticApply` returns the same block with zero counts on its refusal path:
    a semantic rewrite that cannot be applied is a _refusal_, and rendering it as
    a failed change would blame the adapter for a decision `applySemanticRewrite`
    made before reaching it.
  - The refresh costs one extra acquisition and one extra review per apply. That
    is a second full read of the document, and it is the price of the report being
    about the document rather than about the plan.
- **Evidence**: `src/reformat/orchestrator.ts`,
  `src/reformat/semanticApply.ts`,
  `src/taskpane/components/ApplyResultBlock.tsx`,
  `tests/integration/reformatOrchestrator.test.ts`,
  `tests/unit/taskpane/components/ApplyResultBlock.test.tsx`.

## ADR-0089: A profile section the host cannot read stays editable and is marked as unchecked

- Status: Accepted (2026-10-01)
- **Context**: Spec §21 asks the profile editor to present the deterministic
  sections with progressive disclosure and to mark the unsupported ones. Both
  halves of that need a decision, and the second one is not obvious.

  Marking a section unsupported and disabling it is the safer-looking option and
  the wrong one. The host may be replaced — most of these families are
  desktop-only and a user on Word on the web today may not be on it tomorrow — and
  the profile is the durable record of the house standard. Disabling the edit
  would leave a user permanently stuck with whatever default shipped, and the
  standard would be wrong the moment they moved.

- **Decision**:
  1. A section the host cannot read stays **fully editable**. What is not allowed
     is the edit looking effective: the section carries a "Not checked in this
     Word version" marking, in its **summary**, because a collapsed section is
     exactly the case where a note in the body would go unread.
  2. `capabilities: WordCapabilities | null` has three states. `null` is "the
     probe has not answered yet" and is **not** a synonym for unsupported;
     marking a section before the probe has run would be a claim about the host
     nobody made.
  3. The sections are native `<details>` elements, so the open state, the keyboard
     behaviour and the screen-reader semantics are the browser's rather than a
     hand-rolled approximation.
  4. The four sections carry what has **no editor anywhere else**. An earlier
     version of this carried its own "Preferred terminology" box, duplicating the
     one in the House style panel: two controls with the same accessible name,
     editing one record through two parse paths, and the duplicate silently won on
     save. A second editor for a setting that has one is a defect, not a feature.
- **Consequences**:
  - `DeterministicStyleSections` and the flat Typography/House style panels are
    **two views of one record**, not two records. A term typed in either place is
    in the same object, because `patchDeterministicSections` writes `baseProfile`
    and re-projects through `profileToValues`. Patching the form state directly
    would have left the two views able to disagree, with whichever was saved
    silently winning.
  - The two views present overlapping sections, which is a real cost. It is
    accepted because the flat panels are what the existing tests and the muscle
    memory of this pane both address, and the sections are the normative view of
    the same profile.
  - The review header counts open findings by review group as well as by severity.
    Severity answers "how bad" and the group answers "where to start", and a
    document with four hundred spacing findings and twenty structural ones cannot
    be triaged from the first number. Both are counted over the same filtered
    list, so the two lines cannot disagree about what is open.
- **Evidence**: `src/taskpane/components/DeterministicStyleSections.tsx`,
  `src/taskpane/components/ProfileSection.tsx`,
  `src/taskpane/findingsSummary.ts`,
  `tests/unit/taskpane/components/DeterministicStyleSections.test.tsx`,
  `tests/unit/taskpane/findingsSummary.test.ts`.

## ADR-0090: A DTO default says "not read", and the schema is where that is enforced

- Amends: ADR-0086 — its `null`-for-unreadable rule was documented but not
  enforced for the string-typed members
- Status: Accepted (2026-10-01)
- **Context**: `formattingSnapshot.ts` sat at 16% function coverage with its Zod
  `.default()` callbacks as essentially the whole uncovered surface, so the
  defaults — which are the difference between "the host did not read this" and
  "the property is zero" — had no tests of their own. Writing them surfaced a
  real gap.

  `HeaderFooterSnapshotSchema.font.name` was `z.string().trim().nullable()`. An
  empty string survived it as `""`, and `checkHeaderFooterFormatting` tests
  `actual === null || actual === undefined` before comparing — so a `""` would
  have been compared against the profile's font name and produced a "header
  carries '' but should be Calibri" finding on a header whose font was never
  read. Acquisition never supplied one (`fontValue` maps anything else to `null`),
  so there was no production path; the schema is where a DTO's own contract
  belongs, and the fix is here rather than at every consumer.

- **Decision**:
  1. Every unreadable property in the formatting DTOs defaults to `null`, and the
     tests assert both directions: a `0` survives as a value, and an absent
     property reads as "not read". Coercing either would make the analyzer report
     a deviation on a document it never inspected.
  2. `font.name` maps `""` to `null` rather than accepting it.
  3. `provenance` and `styleFormatting` are **absent** by default, not defaulted to
     an all-`unknown` object. The analyzer reads
     `paragraph.provenance?.[property]`, so an absent field skips the
     direct-formatting check entirely, while a defaulted all-`unknown` object would
     look like a comparison that ran and found nothing — a different claim.
     Their _members_ still default to `"unknown"`, so a partial provenance is
     filled rather than left with `undefined`s.
  4. The counts a document cannot have are bounded — a table with five thousand
     rows, a section with a zero width, a header with forty header rows. A bound
     is what makes the count meaningful; an unchecked number lets a malformed read
     become a finding.
- **Consequences**:
  - `formattingSnapshot.test.ts` and this file overlap deliberately: the first
    pins the shapes a caller may construct, the second pins what each default
    _means_. A default that is only shape-correct is exactly the failure.
  - The bounds are a small compatibility surface. A document with more than a
    thousand rows in a single table would fail acquisition rather than report a
    count, which is the failure direction this repository prefers: a loud refusal
    rather than a quiet wrong number.
- **Evidence**: `src/formatting/formattingSnapshot.ts`,
  `tests/unit/formatting/formattingSnapshotCoverage.test.ts`.

## ADR-0091: A standard the user cannot set is not wired, and the §11 audit cannot see it

- **Status**: Accepted (2026-10-01)
- **Context**: The §11 audit asserts that every declared profile field is either
  read by a registered rule or listed as metadata-only, and it is the check this
  repository relies on to catch "a setting the user can change that changes
  nothing". Auditing T19, T20 and T23 against their requirements found that
  `formatting.lists`, `formatting.tables`, `formatting.headersFooters` and
  `formatting.page` were all declared in the profile schema, all read by the
  analyzer, and all wired to registered rules — so the audit reported every one
  of them as covered, and passed.

  In the running product, however, none of the four could be set. No control
  anywhere in the task pane wrote them, so at runtime they sat at their schema
  defaults: `supported: false`, no style name, no margins. The analyzer returns
  nothing for any of those standards unless `supported` is true, so the table,
  header/footer and page-setup checks could never produce a finding regardless of
  what a user did. The rules existed, the acquisition existed, the coverage
  counting existed, and the feature did nothing.

  The audit is structurally unable to catch this. It checks that a rule _reads_ a
  field; it cannot check that the field is _reachable_. Both halves were
  individually green — the analyzer unit test built its profile by hand, and the
  registry test saw a wired path — while nothing connected "the user can set
  this" to "this produces a finding".

  The section marking was wrong in both directions at once. `Document
formatting` governed the body style, the list standard, the table standard,
  the header standard and page setup, and was marked wholly unsupported from
  `supportsTables` alone. On a host with no tables the body-style editor was
  labelled "Not checked in this Word version" — when the body style is the one
  thing every Word host serves. On a host with tables but no page setup, the
  section said nothing at all about the page-setup editor that could never be
  checked.

- **Decision**: The four structural standards get real editors, grouped as
  `fieldset`/`legend` blocks in the section that governs them. Each carries an
  explicit "compare this against the document" switch, because `supported` is
  the analyzer's floor and a standard that is merely stored produces nothing —
  the switch is what makes the distinction visible rather than a schema detail.
  The switches name what they compare, so four of them are not one control to a
  screen reader.

  `ProfileSection` gains `uncheckedStandards`, and a section that is partly
  readable is marked "Partly checked — N standards not read here" with each
  named in the body, instead of a whole-section boolean that is wrong about the
  editors that do work. Blank remains "not specified" rather than `0`, because
  every one of these fields is `optional()` and the analyzer skips an unset field
  rather than comparing it against zero.

  The gate that would have caught this is added as a test: the deterministic
  review engine is driven with exactly the profile shape
  `DeterministicStyleSections` writes, and the findings are asserted. That joins
  "the user can set this" to "this produces a finding" in one place, which the
  registry audit cannot do.

- **Consequences**: The table, list, header/footer and page-setup checks are now
  reachable, and a user who configures one on a host that cannot read it is told
  which specific standard went unchecked rather than being given one blanket
  claim about the whole section. The `supported: false` default is kept, because
  a profile parsed from a record written before these fields existed must not
  begin firing findings nobody chose — so the switch is part of the field rather
  than an implementation detail of it.

  The residual limitation is unchanged and still external: whether the property
  names acquisition requests are correct is host-unverified (ADR-0086,
  ADR-0084). An editor that sets a standard this host cannot serve is now
  explicitly marked, but it still cannot prove the names are right.

- **Evidence**: `src/taskpane/components/DeterministicStyleSections.tsx`,
  `src/taskpane/components/ProfileSection.tsx`,
  `tests/unit/taskpane/components/DeterministicStyleSections.test.tsx`,
  `tests/unit/analysis/deterministic/deterministicReviewEngine.test.ts`.

## ADR-0092: A stored shape is upgraded where it is read, not in the migration keyed to its state version

- **Status**: Accepted (2026-10-01)
- **Context**: Semantic Style V2 replaces V1's eight flat fields on
  `StyleProfile.semantic` with sixteen grouped dimensions, and V1's eight flat
  editorial-policy fields on `GovernanceProfile.editorial` with the same sixteen
  as partials. The implementation plan put the conversion in
  `migrateV13ToV14`, keyed to state version 13 — the version whose store carries
  the old shape.

  Writing it there would have been correct for a v13 store and wrong for every
  other one. Every migration step in `migration.ts`, from `case 0` to
  `case CURRENT_STATE_VERSION`, ends by calling `readCurrentState`, which parses
  profiles through `ProfileRecordSchema` and governance through
  `GovernanceProfileSchema`. A v7 store's profile carries a V1 semantic block
  exactly as a v13 store's does; only its `version` field differs. So a conversion
  keyed on the state version would have to be duplicated across fourteen cases to
  cover a change in the _profile_ shape, and any one of them forgotten fails
  silently: `ProfileRecordSchema.safeParse` rejects an unrecognised block,
  `readProfileRecords` skips it without complaint, and the user's profiles are
  gone with no error, no log line, and — because ADR-0010's "never crash on
  corrupt state" is working exactly as designed — no visible symptom at all.

  The plan's own exit criterion for this phase was "no UI change and zero rendered
  pixels differ", which was already false: the V2 schema is a breaking change to
  every reader of `profile.semantic`, so the consumer migration had to be pulled
  into this phase regardless. The user confirmed there are no users to migrate.

- **Decision**: The conversion lives in the persisted schema, as a
  `z.preprocess` that maps a V1 block forward wherever one is found:
  `StoredSemanticStyleSchema` on `StyleProfile.semantic` and
  `StoredEditorialPolicySchema` on `GovernanceProfile.editorial`. The pure V2
  schemas stay exported for callers that genuinely hold V2.

  Detection is structural rather than version-stamped, for two reasons. A v13
  block predates `schemaVersion` and arrives with no stamp at all, so "absent" has
  to mean V1 for exactly that case; and a block that was stamped and then
  hand-edited is still recognised. For the editorial block the primary witness is
  the _absence_ of `explicitFields`, which is exact — the field was introduced in
  v12, so its presence means the block was authored against V2 — with value-type
  witnesses as a fallback for the one genuinely ambiguous case, a V1 block whose
  only pinned field is `rhetoricalStyle`, where `"forensic"` is a valid value in
  both schemas and no shape test can tell them apart.

  `migrateV13ToV14` now adds only what is genuinely new — `semanticSampleEvidence`
  and `semanticReviewOutcomes`, both starting empty — and states in its own
  documentation that the semantic blocks are already upgraded by the time it runs.

- **Consequences**: One implementation, reached by every read path: the state
  migration, `loadState`, governance snapshots, and the revision trail. One place
  to delete in state v15. The cost is that the domain schema is no longer a pure
  description of V2, which is stated at the declaration rather than hidden.

  A V1 free string is only carried into a V2 `description` when the block actually
  contained one. `LegacySemanticProfileV1Schema` defaults `tone` to `"neutral"`,
  so parsing an absent block yields `"neutral"` — and copying that through would
  render a description the author never wrote, on a profile that says nothing at
  all. A schema default is not an author's voice.

  `migrateSemanticStyleFromV1` is shared with `profiler.ts`, which still receives
  V1 from the learning prompt until P2. One implementation means a profile
  migrated from a store and one learned today reach V2 by identical rules; two
  implementations would be two answers to "what did V1 mean", and they would
  drift.

- **Evidence**: `src/core/domain/SemanticStyleProfile.ts`
  (`StoredSemanticStyleSchema`, `migrateSemanticStyleFromV1`),
  `src/core/domain/GovernanceProfile.ts` (`StoredEditorialPolicySchema`),
  `src/core/domain/StyleProfile.ts`,
  `tests/unit/core/domain/SemanticStyleProfile.test.ts`,
  `tests/unit/core/state/migration-v14.test.ts`.

## ADR-0093: The semantic profile namespace is read by every version, and emptied only by the v11 split

- **Status**: Accepted (2026-10-01)
- **Context**: `readCurrentState` returned `semanticProfileRecords: {}` and
  `activeSemanticProfileId: null` unconditionally, with a comment explaining why:
  a record predating the v11 split is by definition deterministic, so "the
  semantic namespace starts empty" and "there is nothing to recover from a legacy
  blob".

  The reasoning is correct for a v10 store and has no bearing on any later one,
  because the function was the shared reader for every version. A user who ran
  Learn Style, closed the add-in, and reopened it found an empty Semantic tab
  again: the profile had been written, `saveSemanticProfileRecord` had persisted
  it, and `readCurrentState` had discarded it. No error, no warning, and no UI
  explaining why a profile the user had just created was no longer there. The
  `migrateV10ToV11` test asserting the opposite — "does not extract the semantic
  block into a profile the user never made" — passed, because it fed a v10 blob;
  no test fed a v13 blob carrying a semantic record, because none existed.

- **Decision**: `readCurrentState` reads the namespace, normalised the same way as
  the deterministic map — entry by entry, a record dropped individually, and the
  active id resolved against the records that actually survived, so a dropped
  record cannot leave the tab pointing at nothing. `migrateV10ToV11` is now the
  single place that empties it, which is where the split is the whole point of the
  step.

  This was found by writing the v14 migration test, not by reading the code: the
  test asserted that a V1 semantic block on a v13 record is upgraded, and there
  was no record to upgrade.

- **Consequences**: A learned semantic profile survives a reload, which is the
  ordinary expectation and was not the behaviour. The v11 step's documented
  behaviour is unchanged and is now enforced deliberately rather than by an
  accident of the shared reader.

  A store written by a build between v11 and this fix contains semantic records
  that were discarded on every read; they are recovered on the next read, because
  the discard happened at read time rather than at write time. The storage key
  bump to `ToneForge.State.v14` makes the transition itself a separate question,
  and one with no data at stake — ToneForge has no users.

- **Evidence**: `src/core/state/migration.ts` (`readCurrentState`,
  `migrateV10ToV11`, `normalizeSemanticRecords`, `normalizeActiveSemanticProfileId`),
  `tests/unit/core/state/semanticRecords.test.ts`,
  `tests/unit/core/state/migration-v11.test.ts`,
  `tests/unit/core/state/migration-v14.test.ts`.

## ADR-0094: Selection awareness is measured, not declared, and the explicit read ships

- **Status**: Accepted (2026-10-01)
- **Context**: Specification §19 asks for "local selection-state tracking **where
  Word APIs support it**", and conditions the requirement on host support rather
  than demanding an event. An earlier draft of the plan read the absence of a
  selection-changed event from [`src/types/office.d.ts`](../src/types/office.d.ts)
  and concluded that live selection awareness was unavailable in Word.

  That conclusion rested on our own type declarations, which are a loose subset
  and not an authority — ADR-0084 records exactly this, and its own lesson is
  that a property name missing from our declarations costs nothing and proves
  nothing. Declaring a host limitation from a file we wrote is the same class of
  error as the ones ADR-0034 and ADR-0044 exist to stop.

- **Decision**: Answer the question from the published requirement sets, record
  the answer, and ship the fallback either way.

  What the requirement sets actually say, checked 2026-10-01:

  1. `WordApi` and `WordApiDesktop` expose **no** document-level
     selection-changed event. The Word `Document` events are `onParagraphAdded`,
     `onParagraphChanged`, `onParagraphDeleted`, the annotation events, and the
     comment events; the only `onSelectionChanged` in the Word surface is on
     `ContentControl` (WordApi 1.5), which reports focus entering a content
     control — not the document's selection.
  2. The **Office** surface does expose it:
     `Office.context.document.addHandlerAsync("documentSelectionChanged", …)`,
     equivalently `Office.EventType.DocumentSelectionChanged`, documented under
     "Read and write data to the active selection in a document or spreadsheet".
     Microsoft's own host note is "In Word, selection events are text or content
     focused. Test event handlers in the hosts your add-in supports."

  So the API is documented, its availability is a host fact, and neither our
  declarations nor any runtime probe of `addHandlerAsync`'s presence can settle
  the second half. A `supportsSelectionEvents` capability built on that probe
  would report a weaker fact than its name claims — precisely the defect
  `supportsContextMenuApi` already has to explain in its own doc comment — so
  none is added. The question stays open and is verified by a person.

  Shipped now: `src/word/selectionScope.ts` reads the selection explicitly, at
  the size of the selection. The read is the fallback; a subscription would be
  additive to it, not a replacement. No poller, in either direction — a
  `setInterval` is a second thing to keep running and to stop, which is the
  reasoning ADR-0079 already applied to navigation.

- **Verification procedure** (a person, in a real host, per
  [`manual-verification.md`](manual-verification.md)):

  1. Sideload the add-in in Word for Windows, desktop Word on the web, and Word
     on the web.
  2. From the console, call
     `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler)`
     and confirm it resolves.
  3. Move the selection across a paragraph boundary, and confirm the handler
     fires with a `DocumentSelectionChangedEventArgs`.
  4. Record per host whether it fired. A host that does not fire is a host whose
     pane keeps the explicit "Use current selection" read and says so.
  5. Do not record "Word has no selection events" from a host that declined —
     record the host and its version, which is a narrower and actionable fact.

- **Consequences**: The semantic pane reads the selection on an explicit click,
  which is what ships. A user's selection can change between the read and the
  Apply, and that is covered where it already was: the revision adapter compares
  the captured text against the live document as a precondition, and a changed
  selection fails that comparison rather than writing over the wrong text. The
  anchor also carries a `selectionHash`, so the pane can say "the selection has
  changed since the last review" before overwriting a paid-for review.

  If step 3 fires on some host, P7 adds a subscription that re-reads and
  invalidates; the read stays as the control that works everywhere.

- **Evidence**: `src/word/selectionScope.ts`, `tests/unit/word/selectionScope.test.ts`,
  plan §2 D11, `docs/manual-verification.md`.

## ADR-0095: The merge point's two checks read the Change, and a paragraph write is verified against its node

- **Status**: Accepted (2026-10-01)
- **Context**: `validatePlanBeforeApply` implements two safety checks on the sole
  mutation path, and both read `Finding` fields through `change.findingId`.
  Protection resolved `finding.nodeIds`; preservation was guarded by
  `if (finding?.actual && finding.expected)`.

  Both were **fail-open**. A change with no `findingId` produced an empty target
  set; a finding with no `nodeIds` or no `actual` skipped its check; and the write
  proceeded with nothing reported. A check that can be switched off by leaving a
  field out is not a check — and the semantic apply path, which has no `Finding` by
  design, would have had both of its guards silently switched off.

  Writing the new apply path then surfaced a second, older problem.
  `validateChangePreconditions` required a paragraph-unit change to carry a `node`
  precondition _and_ a `replaceText` to carry a `text` precondition. Read together
  those two rules make a paragraph-unit `replaceText` impossible to plan: one
  precondition cannot be both. Nothing in the repository produced that shape, so
  the contradiction was invisible — until the semantic path needed it, because the
  paragraph unit is the only text write available on every Word host
  (`Paragraph.getRange("Whole")`, WordApi 1.1; `Range.set` is WordApiDesktop 1.4
  and absent on Word on the web).

- **Decision**:

  1. **Protection and preservation read the `Change`.** Protection resolves target
     nodes from `range.target.nodeId`, then `range.target.structuralPath`, then the
     `findingId` provenance, then the span against the nodes' source ranges — most
     specific first, with the span fallback last so a change that names nothing at
     all is still checked. Preservation compares `precondition.expectedText`
     against `payload.text`; `expectedText` is read from a `text` precondition or a
     `node` precondition, because both state what the document should hold.
     `findingId` survives as provenance, and the deterministic path is unchanged.
  2. **The text-precondition rule is scoped to character units.** A character range
     is verified against the text at those offsets; a paragraph is verified against
     the paragraph itself — its id, text and formatting — which
     `verifyLivePrecondition` already reads. The demand is narrowed in _where_ it
     applies, never in _whether_.
  3. **A refusal keeps its own cause.** `applyReviewedPlan` replaced every
     per-change error with "Managed Track Changes is required" whenever the adapter
     returned `tracking.managed === false`, which also covers a plan the adapter
     refused on its own merits. A protection refusal was therefore reported as a
     host problem. The adapter's own sentence is now kept when it has one
     (ADR-0069).

- **Consequences**: The two checks can no longer be disabled by omitting a
  `Finding`, and the semantic apply path is covered by them. A paragraph-unit
  write is now plannable for the first time, with a live precondition that names
  the node.

  The span fallback is the one place where the check's behaviour changes for a
  change that named nothing: it can now produce a problem where none was produced
  before. That is the intended direction — it fires on an offset the document does
  not back — and it is bounded by `nodes` being supplied, which every production
  apply path does.

- **Evidence**: `src/word/revisionAdapter.ts` (`resolveTargetNodeIds`, the
  preservation loop), `src/changes/preconditions.ts`,
  `src/reformat/orchestrator.ts`, `src/reformat/semanticApply.ts`,
  `tests/unit/word/revisionAdapter.test.ts`,
  `tests/unit/changes/preconditions.test.ts`,
  `tests/unit/reformat/semanticRevisionApply.test.ts`,
  `tests/integration/semanticReviewApply.test.ts`,
  `tests/integration/safeApply.test.ts`.

## ADR-0096: The sanctioned non-deterministic set is `consistency/` plus `semantic/`

- Amends: ADR-0052 (content consistency is a separate, opt-in, non-deterministic
  engine), which described a set of one
- Status: Accepted (2026-10-02)
- **Context**: ADR-0052 named `src/analysis/consistency/` "the **single sanctioned
  exception** to deterministic-first", and the governance rule says a second
  exception "needs its own ADR saying so". The description had drifted from the
  code in two directions. `deviationEngine.ts` and `rewriteEngine.ts` were already
  LLM-calling modules living directly in `src/analysis/` — outside `consistency/`,
  outside any exception. Then the semantic review added
  `src/analysis/semantic/`, a second genuinely non-deterministic engine in a
  second directory. So the rule said "one" while the code held two, and neither was
  inside the one it named.
- **Decision**: the sanctioned set is `src/analysis/consistency/` **and**
  `src/analysis/semantic/`, and the rule is restated as a shape rather than a
  count. `src/analysis/`'s general ESLint scope — which already permits
  `ai/providers` and forbids `taskpane`, `commands`, `word/revisionAdapter` — is
  what authorises both; a **narrower** block now mirrors the consistency block for
  `analysis/semantic/**`, additionally forbidding `reformat` and `changes`, so
  neither engine can reach the mutation path. `deviationEngine.ts` and
  `rewriteEngine.ts` were deleted in P7, so the two stray engines the description
  was wrong about no longer exist.
- **Consequences**:
  - A third non-deterministic engine is a change to this ADR, not an addition to a
    list. That is the property worth keeping: the question a future change has to
    answer is "is this the sanctioned shape?", and there is a named document to
    amend.
  - `semantic/` is forbidden from importing `reformat` and `changes`, so the
    semantic review's engine cannot build a `ChangePlan`. It does not need to: P6
    put the apply path in `reformat/semanticApply.ts`, below the UI, and the engine
    returns a value rather than a write. The boundary is the reason that split is
    the right way round.
  - `moduleBoundaries.test.ts` carries a case per engine, including the bare
    directory forms, because the flat config lists both a directory and its
    subpaths and a rule that only matches the subpath form is not a rule.
- **Evidence**: `eslint.config.mjs`; `src/analysis/semantic/`;
  `tests/unit/architecture/moduleBoundaries.test.ts`; `src/reformat/semanticApply.ts`.

## ADR-0097: A semantic revision is approved as a value, and the merge point reads the change

- Amends: ADR-0064 (semantic findings are anchored to a verified span, or refused)
  and ADR-0078 (the semantic rewrite is applied on its own path, sharing only the
  writer)
- Status: Accepted (2026-10-02)
- **Context**: ADR-0064 anchored a semantic finding to a verified span so a rewrite
  could not land on a stale offset. ADR-0078 then put the rewrite on its own apply
  path — but the path still took a `Finding`, because that was the only thing the
  page had. Writing the new path exposed two things nobody could hit before, because
  the old writer never produced the shape that triggers them:
  1. `validatePlanBeforeApply` read the protection and preservation checks from
     `Finding` fields reached through `change.findingId`. A change with no
     finding — which is what a semantic revision is, by design — skipped **both**.
     The two guards on the sole mutation path failed open by omission.
  2. `validateChangePreconditions` demanded a `node` precondition for a
     paragraph-unit change **and** a `text` precondition for any `replaceText`. No
     change satisfied both, and the paragraph unit is the only text write available
     on every Word host, so the shape was unplannable rather than merely unused.
- **Decision** (ADR-0095 records the code; this records the standing rule):
  `ApprovedSemanticRevision` is what the page produces and what the apply path
  takes. The protection and preservation checks read the `Change` — its target's
  node ids and its precondition's `expectedText`, from either precondition kind —
  with the `Finding` read only as the deterministic path's additional input. The
  precondition rule is scoped to character units, so a paragraph-unit write is
  verified against its own node text.
- **Consequences**:
  - A semantic revision cannot bypass a guard by arriving without a finding, which
    is the whole of the defect. The finding is now an enrichment of the
    deterministic path rather than the merge point's evidence.
  - `src/reformat/semanticApply.ts` no longer imports `Finding`. There is one
    contract, and it is the one that cannot omit its way past a check.
  - The anchoring requirement is unchanged and still strict: the anchor is captured
    with the selection, re-checked against the live document before the write, and
    the write is a whole paragraph wherever the host allows it — because a partial
    range needs `Range.set`, which Word on the web does not have. That host fact is
    now probed (`supportsRangedReplacement`) rather than discovered at apply time,
    so the refusal is stated before the user spends a model call.
- **Evidence**: `src/reformat/semanticApply.ts`; `src/changes/preconditions.ts`;
  `src/word/rangeResolution.ts`; `src/word/revisionAdapter.ts`;
  `tests/integration/safeApply.test.ts`; `tests/unit/reformat/semanticRevisionApply.test.ts`.

## ADR-0098: A style is learned into a draft, and activation is a second press

- Amends: ADR-0081 (a style can be learned from pasted text, attributed as pasted)
  and ADR-0076 (the semantic tab owns the semantic profile and its measured context)
- Status: Accepted (2026-10-02)
- **Context**: `createSemanticProfileRecord` activated whatever it learned, in the
  same call that produced it. The review pipeline therefore switched to a voice the
  user had not looked at yet, and the evidence — where the sample came from, how
  many words it held, when — was written only if the profile was later activated. A
  user who learned, reviewed, and then discarded had learned from something the
  product had no record of, and the sample itself is never stored, so the metadata
  was the only trace.
- **Decision**: learning produces a **draft**. `activate: false` is passed to
  `createSemanticProfileRecord`, the evidence is recorded as the style is learned
  rather than when it is activated, and "Make this active" is a separate, explicit
  control. The page states that an unactivated draft is not steering any review.
- **Consequences**:
  - A user can learn a style, read it, edit it, and publish it as a version without
    ever switching the live voice. `ProfileRecordSection` is wired on this page for
    the first time, which is what makes that possible: a learned profile previously
    had no publish, activate or recall controls reachable anywhere.
  - The evidence is metadata only, by construction of its schema, and a test asserts
    that no sample text is present in it. `sampleHash` lets two samples be compared
    without keeping either.
  - The ribbon's semantic control is enabled by an **active** profile, which is
    what it always meant; the split made the distinction visible, so the comment in
    `ribbonState.ts` that said so was true but had no UI behind it.
- **Evidence**: `src/taskpane/pages/SemanticStyle.tsx`;
  `src/core/state/persistence.ts`; `src/commands/ribbonState.ts`;
  `tests/unit/taskpane/pages/SemanticStyle.test.tsx`.

## ADR-0099: Sample eligibility and sample confidence are two axes

- Amends: ADR-0081 (a style can be learned from pasted text, attributed as pasted)
- Status: Accepted (2026-10-02)
- **Context**: `evaluateSampleQuality` returned one verdict. Below 40 words it
  refused; above it, it said nothing — so a 45-word sample and a 5 000-word sample
  were equally endorsed, and the profile learned from the first is a confident-
  sounding artefact built on almost nothing. Rendering the difference as a warning
  beside a button trains users to dismiss it, and the one signal that would matter
  is the one they have learned to clear.
- **Decision**: two axes. `eligible` (is it mechanically usable) is the only thing
  that ever blocks, and keeps the name `pass` `learnStyleDraft` throws on.
  `level` is a four-band statement of confidence, from
  `SAMPLE_QUALITY_BANDS`, and never blocks. The band is a **persistent badge**
  carrying the word count, the level and the consequence, and only the two thin
  bands ask for an explicit acknowledgement. The bands are exported so the badge,
  the gate and the tests cannot quote different numbers.
- **Consequences**:
  - `insufficient` is reachable twice, and the two are different facts: a sample
    under 40 words is not eligible, and a sample of 60 is eligible at the lowest
    band. The badge says which, and the acknowledgement is asked only for the
    second.
  - A band never reads as a refusal. The only sentence that says "cannot be learned"
    is for an ineligible sample, and a test asserts the badge is absent for one.
  - The 1 MB `.txt` cap and the extension check are in a DOM-free module
    (`textFileImport.ts`) and the component owns the `File.text()` read, so the
    rule is testable without a browser and the only place a `File` may be named is
    where the DOM is.
- **Evidence**: `src/style/sampleQuality.ts`; `src/style/textFileImport.ts`;
  `src/taskpane/components/semantic/LearnSemanticStyle.tsx`;
  `tests/unit/style/sampleQuality.test.ts`; `tests/unit/style/textFileImport.test.ts`.

## ADR-0100: A declaration widened to accommodate a call is the same lie as a property that does not exist

- Amends: ADR-0084 (a property name the host does not have is a compile error, and
  the flow controls are left unread)
- Status: Accepted (2026-10-02)
- **Context**: `Range.load` was declared `(...props: Array<string>) => Range` in
  `src/types/office.d.ts`, so that `range.load("text", "start", "end")` would
  typecheck. Office.js takes **one** argument — `load(propertyNames: string | string[])`
  — so the host loaded `"text"` and **silently ignored the rest**, and the
  following read of `.start` threw _"The property 'start' is not available"_. Two
  call sites did this: `word/documentReader.ts` (pre-existing) and
  `word/selectionScope.ts` (written in P5).
- The whole suite was green. It was green because both mocks involved were **more
  permissive than the host**: one declared `load(...properties: string[])` and
  honoured all three names, so the log showed the load the code _asked for_; the
  other was `load: vi.fn()`, which accepts anything and records nothing. A mock
  more permissive than the host cannot catch a call the host will not honour,
  which makes it worse than no mock: it is the thing that was supposed to catch
  the bug, and it was the reason the bug was invisible.
- **Decision**:
  1. `load` is declared as the host declares it, on `Range`, `Font`, and every
     local view of a proxy. A declaration is not widened to make a call compile;
     if the call does not fit the API, the **call** is wrong.
  2. `tests/fixtures/officeLoad.ts` is the one `load` double, and it **throws** on
     extra positional arguments. A double that fails loudly on a call the host
     would tolerate — by dropping it — is the property that matters, because the
     host's own failure mode is silence.
  3. `tests/unit/architecture/variadicLoadGuard.test.ts` rules over the source, so
     the call is refused on any path, including those whose mock is still a bare
     `vi.fn()`.
- **Consequences**:
  - A rule over the source beats a rule over the mocks here. The two permissive
    mocks were fixed, but the tree holds more than eighty `load: vi.fn()`
    doubles; rewriting them all would have changed a green suite extensively to
    defend against a defect that no longer exists anywhere in it. The source rule
    closes the hole for every path at once, and the audit that established
    "no other variadic call exists" is now an assertion rather than a note.
  - ADR-0084's rule generalises from a **missing** property to a **widened**
    signature. Both make the type system agree with something the host does not
    do, and both are invisible until a host says otherwise.
  - The cost of the false negative was one unusable route in a shipped build,
    found by hand, after thirteen green stages. That is the boundary ADR-0051
    draws, observed from the other side.
- **Evidence**: `src/types/office.d.ts`; `src/word/selectionScope.ts`;
  `src/word/documentReader.ts`; `tests/fixtures/officeLoad.ts`;
  `tests/unit/word/officeLoadContract.test.ts`;
  `tests/unit/architecture/variadicLoadGuard.test.ts`; `docs/manual-verification.md`.

## ADR-0101: One add-in, one task pane, and one way to name it

- Extends: ADR-0079 (a ribbon command is delivered whenever it is pressed)
- Amends: ADR-0070 (a manifest change requires re-registration, and the two
  manifests must agree)
- Status: Accepted (2026-10-02)
- **Context**: Word keys a task pane on the `TaskpaneId` a `ShowTaskpane` action
  names. A control that reaches the pane by function — the context menu, or a
  ribbon button that calls `openPage` itself — lands on whatever identity the
  runtime's own `openPage` action created. Those are two identities, and the host
  runs both.
- `manifest.xml` declared eight ribbon controls with `ShowTaskpane` and
  `TaskpaneId` `ButtonId1`, and the context menu with `ExecuteFunction`. Choosing
  Semantic Review from the context menu therefore produced a **second, blank add-in
  window beside the live one**. The original pane held the correct selection on the
  correct page throughout, which is what made it read as a rendering fault rather
  than a manifest fork: the pane that worked was working, and the pane that was
  broken was not the one already on screen.
- `manifest.json` already used `executeFunction` for every control, so the fork was
  XML-only — which means ADR-0070's "the two manifests must agree" check could
  not see it. The XML used `ShowTaskpane` because the global function aliases
  existed only for `ToneForgeSemantic`; the other seven commands had no exported
  function for an `ExecuteFunction` action to name, so `ShowTaskpane` was the only
  thing that would have worked.
- The repository's own check asked **every command control** for `TaskpaneId`
  `ButtonId1`. That question cannot distinguish "this control opens the pane" from
  "this control mentions one", so it passed on the manifest that carried the defect
  and would have failed on the correct one. A check written about the commands
  rather than about the pane is a check on the wrong subject.
- **Decision** (rule 1 amended by ADR-0104, which removed the `TaskpaneId`):
  1. Exactly one ToneForge control may declare `ShowTaskpane`: `ToneForgeTaskpane`,
     with `SourceLocation` `resid="Taskpane.Url"`. It is the identity every other route
     resolves to. A `TaskpaneId` was named here and is now forbidden; see ADR-0104 for
     why naming the pane is itself what forked it.
  2. Every other ToneForge control — ribbon and context menu alike — runs a
     function, and names neither a pane nor a source. Every command id therefore has
     an exported global alias.
  3. `validateSingleTaskPane` asserts the whole ribbon surface in **both**
     directions: one opener, named and identified correctly; no other control
     carrying a `TaskpaneId` or a `SourceLocation`. The per-command destination rule
     is now conditional on the action being `ShowTaskpane`, because asking a
     function control where its pane lives asks a question that no longer has an
     answer.
- **Consequences**:
  - The manifest could not be converted on its own. An `ExecuteFunction` control
    naming no exported function registers nothing and fails **silently**, which is
    ADR-0080's failure mode exactly; the seven aliases had to exist before the XML
    could change. A manifest change that removes an action is only safe once the
    replacement is known to resolve.
  - `validateSingleTaskPane` scans the whole document rather than
    `toneForgeTabBounds`. The one pane-opening control sits on the Home tab and the
    commands sit on the ToneForge tab, so a scan bounded to either tab alone sees
    half the ribbon. This check was first written against the ToneForge tab and
    reported **zero** panes — not a manifest defect, but a rule that could only
    ever see half the thing it governs. It also strips XML comments first, because
    this repository documents its own decisions inline and a check that can be
    fooled by prose about itself is not a check.
  - ADR-0070 held that a manifest change requires the two manifests to agree. They
    did agree here, both were checked against each other, and the host still ran
    two panes. Internal agreement is not host agreement; ADR-0080 said so before
    this happened, and this is the second time it has cost something.
  - ADR-0079's "delivered whenever it is pressed" now applies to all eight controls
    rather than one. Pressing a ToneForge ribbon button delivers a command that
    navigates the **existing** pane instead of opening another one.
- **Evidence**: `manifest.xml`; `manifest.json`; `src/commands/commandHandlers.ts`;
  `src/commands/commandDefinitions.json`; `scripts/validate-manifest.mjs`;
  `tests/unit/architecture/oneTaskpane.test.ts`;
  `tests/unit/commands/commandContracts.test.ts`; `docs/manual-verification.md`.

## ADR-0102: A destination with no branch falls through to Home, so every destination is asserted

- Extends: ADR-0071 (the first run reports; it does not lock), whose own
  component comment states the rule this makes testable
- Status: Accepted (2026-10-02)
- **Context**: `DashboardWithoutProfile` renders one branch per destination and
  falls through to `Home` for anything it has no branch for. Two destinations had
  none: `review` and `semantic-review`.
- The consequence was reported from a real Word as the Deterministic Review page
  and the Semantic Review page being "stuck showing what the home page shows and
  not their pages". That is exactly what a fall-through looks like: the checklist
  renders perfectly, so the press appears to do nothing. The report guessed the
  cause was an unconfigured AI provider. It is not — the deterministic engine
  calls no model — it is an absent **deterministic style profile**, which is
  the one thing that page genuinely needs and the one thing that switches the app
  to the other dashboard.
- A second lie sat in the same area. The Semantic Review breadcrumb reads **"Back
  to Deterministic Review"** and was handed `back`, which in this dashboard is
  `navigate("landing")`. The profiled dashboard uses `navigate("review")` there and
  this one did not, so the label and the destination disagreed for exactly the
  users least able to notice — those still setting the app up.
- Neither defect is visible to a test that asserts a _named_ destination. The
  routing guard for the no-profile dashboard asserted "a destination that does
  need a profile is reachable" — which passed, truthfully, about the one
  destination it named.
- **Decision**:
  1. **Every** destination renders its own page in both dashboards. Semantic
     Review needs no deterministic profile and renders the real page;
     Deterministic Review has nothing to render without one, so
     `ReviewWithoutProfile` states that once and names the control that resolves it
     (ADR-0069) rather than presenting an empty findings list as a clean document.
  2. A labelled control's destination is its label. "Back to Deterministic
     Review" navigates to Deterministic Review in both dashboards.
  3. `TASKPANE_DESTINATIONS` is exported, and the no-profile routing test
     enumerates it. A hand-written list in a test would have gone stale exactly
     as the routing did; one that reads the drawer's own list fails on the day a
     destination is added without a branch.
- **Consequences**:
  - The guard is now exhaustive by construction rather than by recall, which is
    the only way a fall-through default stays safe as the destination list grows.
  - It does **not** catch a branch that renders the wrong page. That would need a
    per-destination assertion of the rendered heading, and the exhaustive test is
    the cheaper half that covers the class of defect actually observed.
  - The empty findings state is now stated rather than shown. "No findings,
    because no scan has run against a profile" and "no findings, because the
    document is clean" are different facts, and only the first of them is true
    here.
- **Evidence**: `src/taskpane/pages/Dashboard.tsx`;
  `src/taskpane/pages/ReviewWithoutProfile.tsx`;
  `src/taskpane/components/TaskPaneHeader.tsx`;
  `tests/unit/taskpane/pages/DashboardNoProfile.test.tsx`.

## ADR-0103: A caret reviews its paragraph, and the pane says so

- Closes: ADR-0094 (selection awareness is measured, not declared), on the
  repository side. The host-side question stays open and keeps its procedure.
- Status: Accepted (2026-10-02)
- **Context**: "Paragraph identification based on cursor location does not work,
  but selecting text does" — reported from a real Word, and accurate.
- The capture returned `no-selection` for any collapsed selection. That was a
  decision, not an oversight: the module's own doc comment said so, and a test
  asserted it and passed for two years. What made it shippable was that the
  message was **true of the code and false of the world**. A user clicks into a
  paragraph, presses the command, and is told nothing is selected — while the
  same click followed by a drag works perfectly. The code had a path for the drag
  and no path for the click, and the sentence about it was accurate enough that
  nobody read it as a symptom.
- **Decision**:
  1. **A collapsed or whitespace-only selection expands to its containing
     paragraph.** The scope carries `source: "caret-paragraph"` rather than
     pretending the user selected it. Two corrections to this record, both from
     ADR-0105: `Paragraph.getRange` is **WordApi 1.3**, not 1.1 as stated here and
     in the declaration in `types/office.d.ts`, and this path did not run on any
     host until then, because a validity guard written for the drag case returned
     `no-selection` first.
  2. **A caret in an empty paragraph is still `no-selection`.** There is nothing
     there, and padding it out would be a fabrication.
  3. **The pane states both facts.** The text is labelled as "the paragraph the
     cursor is in, not a selection you made", and the pane says whether it is
     following the cursor or waiting to be told.
  4. **Live tracking is attempted, and optional.**
     `word/selectionWatcher.ts` subscribes to `documentSelectionChanged` through
     `Office.context.addHandlerAsync`, debounced 250 ms, and **stops the moment a
     review is on screen** so a caret move cannot discard a proposal the user is
     reading. It returns whether it could subscribe, and a host that says no
     keeps the manual control it always had.
- **Consequences**:
  - ADR-0094's open question is now **two** questions. "Does a Word host fire
    `documentSelectionChanged`?" is still unanswered and still needs a person in a
    real Word; "what does this repository do either way" is settled and tested.
    Merging them into one would repeat the mistake ADR-0094 warned about —
    treating absence from our own type declarations as absence from the API.
  - The declaration of `addHandlerAsync` is **optional and narrow**. Optional
    because absence has to stay expressible, or every caller needs a cast for a
    host that may not have it; narrow because modelling an `Office.EventType` we
    never construct would be the ADR-0100 pattern again.
  - A caret review costs a provider call on a paragraph the user never
    highlighted. It is visible before the call — the text is on screen with its
    word count and its provenance — and it never happens without Review being
    pressed, but it is a judgement, and saying "48 words" alone would hide it.
  - The debounce is a correctness requirement, not a nicety: the host fires on
    every keystroke and each read is a `context.sync()`.
  - The watcher test found a real gap while being written — a host exposing
    `addHandlerAsync` without `removeHandlerAsync` left a handler outliving the
    page, silently. It now warns, because a leak nobody can see is what every
    refusal category in this codebase exists to prevent.
- **Evidence**: `src/word/selectionScope.ts`; `src/word/selectionWatcher.ts`;
  `src/types/office.d.ts`; `src/taskpane/components/semantic/SemanticReviewScope.tsx`;
  `tests/unit/word/selectionScope.test.ts`; `tests/unit/word/selectionWatcher.test.ts`;
  `tests/unit/taskpane/pages/SemanticReview.test.tsx`; `docs/manual-verification.md`.

## ADR-0106: A command that cannot deliver its instruction does not open a pane

- Amends: ADR-0104 (the pane identity is fixed; the delivery channel is a
  separate question, and this is its answer).
- Status: Accepted (2026-10-02)
- **Context**: the context menu still opened a second pane after the `TaskpaneId`
  was removed, and the trace carried the line that explains it: **"Tracking
  Prevention blocked access to storage for \<URL\>"**.
- `localStorage` is unavailable in this Word host. The bridge writes its
  instruction there and the task pane reads it back, so the write went nowhere
  \u2014 and `setItem` **returned normally**. The commands runtime believed it had
  queued a navigation; nothing was queued.
- `Office.addin.showAsTaskpane()` was then called anyway, and that call opens a
  pane whether or not there is anything to tell it where to go. So the sequence
  was: user right-clicks a paragraph, a blank second window opens beside the
  live one, and the selection is nowhere. The two symptoms the user reported as
  separate \u2014 a new pane, and no selection used \u2014 are one cause.
- **Decision**:
  1. **A function command never opens a task pane.** `showAsTaskpane()` was
     called by every command, on the assumption that it reveals the pane the user
     already has. It does not: the host opened a **second window running
     `/commands.html`**, the shared runtime's own function file, which is blank
     and has no page in it. That window identified itself \u2014 it logged
     `syncSemanticRibbon` with `ControlIdNotFound`, and that message is emitted
     only by `commands.ts`, never by the task pane \u2014 and it is the same
     fingerprint ADR-0101 recorded, which is why ADR-0101's diagnosis was right
     and this one was wrong twice before it landed.
     Only the Home-tab control opens the pane. A command delivers and returns; if
     no pane is open the instruction waits in the bridge and is consumed on the
     next mount, so the user opens the pane and lands where they asked.
  2. **A successful `setItem` is not a delivery receipt.** The value is read
     straight back and compared. A silent discard is the failure a real host
     produced, and a test asserting only that the call did not throw would pass on
     exactly that host.
  3. **The instruction does not depend on storage.** It goes out over three
     routes, and any one carrying it is enough: a **module variable** (free and
     instant when a shared runtime gives both sides one JavaScript context, which
     is what a shared runtime is _for_), then **`BroadcastChannel`** (same-origin,
     and unlike storage not something a privacy setting switches off), then
     `localStorage`.
     The first two are not redundant, and the reason is worth recording: a
     `BroadcastChannel` does not deliver to the channel that posted. Separate
     documents \u2014 which is when the channel is needed \u2014 hold separate channel
     objects, so it delivers; a shared runtime \u2014 when the variable is needed \u2014 does
     not.
  4. **Every route is cleared on every consume.** An intermediate version returned
     as soon as the in-memory copy was found and left the storage copy behind, so
     the same instruction was handed out twice: once live, and again on the next
     mount, long after the user acted on it. Single consumption has to hold across
     every route or it does not hold at all, and the test that asserted it is what
     found this.
  5. **The in-memory route is not counted as a delivery.** A later version added
     `sharesJavaScriptContext()`, reasoning that `Office.addin` existing meant the
     commands and the pane shared one context. It does not: `showAsTaskpane` being
     available says the runtime is long-lived, not that this module instance is
     shared. So it reported a delivery the module variable could not make, and the
     symptom was a pane that opened and received nothing \u2014 which is the regression
     the user reported between two otherwise identical builds. `announced` and
     `stored` are facts; the in-memory route is a possibility, and a caller cannot
     check it.
  6. **The manifest is unchanged, and ADR-0101 is vindicated.** ADR-0101's
     diagnosis was right: the context menu reached a different pane from the one
     the live pane was on. The failure was never that `TaskpaneId` existed \u2014 it is
     that a _function command_ called `showAsTaskpane()` at all. Removing the id was
     attempted on the strength of a documentation rule untested in this host, and it
     removed the pane's identity without giving the shared runtime one to use, which
     made the fallback worse rather than better.
- **Consequences**:
  - `localStorage` remains blocked on the host that reported it. Nothing here
    changes that; it is simply no longer load-bearing.
  - `ADR-0079`'s "delivered whenever it is pressed" no longer depends on the pane
    being closed. It is **still unverified in a real Word**, and the host gate says
    so.
  - A command with no pane open now does nothing visible, and the instruction waits
    for the next mount. That is a real limitation and the correct one: opening a
    blank window is not a way of delivering a command.
  - The `consumeTaskpaneTarget` single-consume race noted in ADR-0104 is still
    unmeasured. Two mounted panes are still a second consumer.
  - **Two diagnoses in a row were wrong, and both were defended with evidence.** The
    first blamed the storage channel when storage was blocked but was not what
    opened the window; the second blamed the `TaskpaneId` on a documentation rule
    nobody had run in this host. What actually identified it was a console message
    in the offending window \u2014 `syncSemanticRibbon`, which only `commands.ts` emits.
    A symptom reported by a user in the _other_ window is evidence, and reading it
    is cheaper than another build-and-sideload cycle.
- **Evidence**: `src/shared/office/taskpaneNavigation.ts`;
  `src/commands/commandHandlers.ts`; `tests/unit/commands/commands.test.ts`;
  `docs/manual-verification.md`.

## ADR-0107: The context menu is a task pane command, not a function command

- Amends: ADR-0106 (a function command never opens a pane \u2014 now it also does not
  need to), ADR-0101 (more than one control may open the pane; one _pane_ is the
  rule).
- Status: Accepted (2026-10-02)
- **Context**: "Context menu currently opens its own pane which works, and the
  ribbon button runs its own instance." Reported from a real Word, and it is the
  most useful sentence in this stretch: the context menu stopped producing a
  blank window, and what remained was that **the two routes are two panes**.
- Microsoft documents two kinds of add-in command, and the distinction is the
  whole defect:

  | Kind                  | What it does         | Who provides the code |
  | --------------------- | -------------------- | --------------------- |
  | **Task pane command** | Opens the pane       | **Office**            |
  | **Function command**  | Runs your JavaScript | Your runtime          |

  A task pane command is declared entirely in markup, and the host resolves the
  pane itself. Our context menu was a **function command** that called
  `Office.addin.showAsTaskpane()` \u2014 which takes no pane id and only promises to
  show "the task pane associated with the add-in". When the host could not
  resolve one it opened the shared runtime's **function file** instead: a blank
  window running `/commands.html`, which identified itself by logging
  `syncSemanticRibbon` with `ControlIdNotFound`, a message only `commands.ts`
  emits.

- **Decision**:
  1. **The context menu becomes a task pane command** (`ShowTaskpane` in the XML,
     `openPage` in the JSON), pointing at the same source location the Home-tab
     entry point uses. Office resolves the pane; no runtime sits in the path able
     to open the wrong page.
  2. **The rule becomes "one pane", not "one opener".** Two controls may open the
     pane; they must name the **same** source. The previous check counted openers
     and would have rejected this change \u2014 a check that fails on the fix is a
     check guarding the defect, which this repository has now done twice.
  3. **No control may declare a `TaskpaneId`** \u2014 **reverted by ADR-0108.** This
     was wrong. A named id is not inherently a _separate_ pane: sharing one is
     precisely how several controls address one pane, and its absence here made
     every pane command its own pane.
  4. **`showAsTaskpane()` leaves the function commands permanently**, so no
     runtime can reintroduce the fallback.
  5. **`Office.addin` is declared in `types/office.d.ts`** \u2014 optional, narrow, as
     the host declares it. It was entirely absent, which is why every call for
     five attempts was a hand-rolled cast and no compiler ever checked the shape.
- **Consequences**:
  - **The context menu no longer names a destination.** A task pane command runs
    no JavaScript, so it cannot write a navigation instruction, and the pane it
    opens will mount on whatever page it last had. Telling an **already-open**
    pane which page to show remains unsolved and is deferred to a second phase:
    the pane would have to announce itself, and that mechanism is unproven in a
    real Word, exactly as `BroadcastChannel` was. It is deliberately not bundled
    with this change so a failure has one cause.
  - **"Review in Editor" is not a model for this.** It is Microsoft's first-party
    pane, with no manifest and no public API to open it. The transferable idea is
    the table above, not the feature.
  - **A repository check must be read against the fix.** Three guards here
    asserted the old shape, and one of them \u2014 "exactly one ShowTaskpane control"
    \u2014 would have failed the correct manifest. They now assert one _destination_.
  - The host gate stays open. A green build and two panes is the failure this
    guards against, so it closes only by a person in a real Word after a full
    sideload cycle.
- **Evidence**: `manifest.xml` (`ToneForgeSemanticContextControl`);
  `manifest.json` (context menu `actionId`); `scripts/validate-manifest.mjs`
  (`validateSingleTaskPane`); `src/commands/commandHandlers.ts`
  (`routeToTaskpane`); `src/types/office.d.ts` (`Office.Addin`);
  `tests/unit/architecture/oneTaskpane.test.ts`;
  `tests/unit/commands/commandContracts.test.ts`;
  `plans/context-menu-pane-routing.md`; Microsoft: _Add-in commands_, _Show or
  hide the task pane of your Office Add-in_. **Decision 3 is reverted by ADR-0108,
  which restores the `TaskpaneId` and corrects what this record claims about it.**

## ADR-0104: The pane belongs to the shared runtime, and is therefore not named

- Amends: ADR-0101 (rule 1 named the pane `ButtonId1`; the name was the second identity).
- Status: **REVERTED by ADR-0108 (2026-10-02).** Kept because the reasoning
  below is the clearest example in this log of a documented rule read past its
  scope: it is not wrong that a shared runtime supports one pane, and it is wrong
  that this follows by removing the id. It did \u2014 and with no id every pane command
  became its own pane.
- **Context**: ADR-0101 converted all eight ribbon controls to `ExecuteFunction`
  because Word keys a task pane on the `TaskpaneId` a `ShowTaskpane` action names.
  It left that name in place on the one control that opens the pane, and the fork
  survived: choosing Semantic Review from the right-click menu still opened a
  second add-in window beside the live one. Reported from a real Word.
- A `TaskpaneId` names a **separate** task pane. This manifest declares a
  long-lifetime shared runtime on the same `<Host>`, and a shared runtime supports
  exactly one task pane, so the name was a second identity for the same add-in. The
  consequence is specific and was measured in the host: with nothing else to show,
  `Office.addin.showAsTaskpane()` — which every command calls — was resolved by the
  host opening **the shared runtime's own function file** as a pane. The extra
  window's console reported its page as `/commands.html`. The user saw a blank
  ToneForge window; the code called a method that resolved successfully.
- **Decision**:
  1. The one `ShowTaskpane` action declares **no** `TaskpaneId`. The pane belongs
     to the shared runtime, and every route — the entry point, the seven commands,
     the context menu — resolves to it.
  2. The rule is **conditional on the manifest**, not hard-coded: a manifest that
     declares a long-lifetime `<Runtime>` may not name a pane; one that does not may.
     Read from the file, because a rule about manifests should follow the manifest.
  3. Both guards that required the defect are inverted. `oneTaskpane.test.ts`
     _asserted_ that `<TaskpaneId>ButtonId1</TaskpaneId>` was present, and
     `validateSingleTaskPane` required the same id — the repository's check
     demanded the element that caused the fault. It now forbids it, and asserts the
     shared runtime whose presence makes the prohibition true rather than arbitrary.
  4. The manifest's prose no longer describes the pane by an id it does not have.
- **Consequences**:
  - **A check can demand the defect.** This is the third time a green repository has
    passed on a manifest the host rejected, and the first time the check was not
    merely blind but _positive_ about the wrong thing. A test that asserts a
    specific value is not a weaker version of one that asserts its absence; it is a
    different claim, and it is falsifiable only by the defect.
  - A `<Control>` is no longer uniquely identified by its pane. Word's own uniqueness
    rule is about UI element ids, and the entry point keeps its `id`, so nothing else
    moves.
  - The unified manifest is unaffected and stays the primary: its `openPage` action
    already addressed one pane, which is why the fork was XML-only (ADR-0070).
  - **The host gate stays open.** A build that passes and two panes is the failure
    this guards against, so it is closed only by a person in a real Word, after a full
    sideload cycle — Word caches the manifest at registration.
  - One question is still open and is not this ADR's to answer: whether the
    `storage` event carries a command from the shared runtime to an open pane at
    all. The pane identity is fixed; the delivery channel is measured separately, and
    the bridge now logs who wrote and who consumed each instruction.
- **Evidence**: `manifest.xml` (`ToneForgeTaskpane` action, `Runtimes`);
  `scripts/validate-manifest.mjs` (`validateSingleTaskPane`, `declaresSharedRuntime`);
  `tests/unit/architecture/oneTaskpane.test.ts`;
  `tests/unit/commands/commandContracts.test.ts`;
  `src/shared/office/taskpaneNavigation.ts`; `docs/manual-verification.md`.

## ADR-0105: A caret is a caret because its text is empty, not because its offsets agree

- Amends: ADR-0103 (the caret path could not be reached; `Paragraph.getRange` is
  WordApi 1.3, not 1.1).
- Status: Accepted (2026-10-02)
- **Context**: "Paragraph identification based on cursor location does not work,
  but selecting text does" — reported from a real Word, and accurate. ADR-0103 had
  shipped a caret path an hour earlier.
- It had never run. The capture checked its offsets first: `if (start < 0 || end <
start) return no-selection`. A real Word reports a bare caret as `start: 1193,
end: 1192`, so that guard returned nine lines **above** the caret branch and the
  user was told "There is nothing to review here. Click inside a paragraph, or
  select the text you want checked" — the exact sentence describing the feature
  that was sitting unreachable below it. The guard was written for the drag case,
  predates the caret feature, and silently ate it.
- No test could see it, because every fixture supplied an ordered pair. That is
  ADR-0100's shape for the third time: the double was the thing that was supposed to
  catch this, and it modelled a tidier host than the one that failed.
- **Decision**:
  1. **Order the offsets; do not refuse them.** A pair is unusable only when one of
     the two is missing. `min`/`max` also makes a right-to-left drag produce an
     anchor the revision adapter can hold, since its precondition compares `text`
     against an ordered span.
  2. **Empty text is the caret test.** `text.trim().length === 0` is what
     distinguishes a caret, and it is the fact the user can see. `end === start` was
     a second way of asking, and one the host can answer "no" to while the text is
     plainly empty.
  3. **Every refusal names itself.** The caret path returned bare `null` at five
     points, which reaches the page as "nothing is selected" and is the same
     conflation `SelectionScopeResult` was split to remove, re-entered one layer
     down. Each now carries a `refusalCategory`, and the branch decision logs the
     offsets that produced it.
  4. **The `WordApi 1.1` claim was wrong and is corrected.** `Word.Paragraph.getRange`
     is **WordApi 1.3**; ADR-0103, the declaration in `types/office.d.ts` and the
     comment in `capabilityProbe.ts` all said 1.1 and "is everywhere", while
     `manifest.xml` requires only 1.1. The method is still checked at runtime and
     still optional, which is the correct shape — the claim behind it was the part
     that was wrong, and it is corrected rather than relied on.
- **Consequences**:
  - A feature can ship, pass a review, and be dead on arrival when a guard written
    before it can reach it. The generalisable rule is the one ADR-0100 states: a
    check is only as good as the host it models, and a fixture supplied with a
    fixture-friendly shape is a hole in the suite dressed as its opposite.
  - Two new tests carry the pair that would have caught it: an inverted caret pair
    must still expand, and an inverted drag must arrive ordered.
  - The diagnostic fields are named to survive `redactDiagnosticContext`. `keyPresent`
    and `documentPath` were both redacted to `[REDACTED]` and `[REDACTED_CONTENT]`
    by the `/key/` and `/document/` rules, which would have made the logs useless in
    the one place they were needed.
  - Still unverified in a real Word: whether this host's caret paragraph has
    `getRange` at all, and whether a caret inside a table cell or a text box
    resolves to the paragraph the user is looking at. The refusal categories now
    distinguish those answers.
- **Evidence**: `src/word/selectionScope.ts`; `tests/unit/word/selectionScope.test.ts`;
  `src/types/office.d.ts`; `src/word/capabilityProbe.ts`; `docs/manual-verification.md`.

## ADR-0108: One pane is a shared TaskpaneId, not the absence of one

- **Reverts**: ADR-0104, which removed the `TaskpaneId` and forbade it in checks.
- Amends: ADR-0101 (one control opens the pane, and now so does the context menu,
  sharing that pane's identity), ADR-0107 (its decision 3 was wrong).
- Status: Accepted (2026-10-02)
- **Context**: ADR-0107 made the context menu a task pane command, and a real Word
  reported the result plainly: _"the context menu currently opens its own pane
  which works and the ribbon button runs its own instance."_ A blank window had
  become a second **working** window.
- The _Action element_ reference states the rule this had been reading backwards:
  _"When you have multiple `ShowTaskpane` actions, use a different `<TaskpaneId>`
  if you want an **independent** pane for each. **Use the same `<TaskpaneId>` for
  different actions that share the same pane.** When users choose commands that
  share the same `<TaskpaneId>`, **the pane container will remain open** but the
  contents of the pane will be replaced with the corresponding Action
  `SourceLocation`."_
- **What ADR-0104 got wrong.** It removed the id on the reasoning that a shared
  runtime must carry no `TaskpaneID`. That guidance concerns the **auto-open**
  convention (`Office.AutoShowTaskpaneWithDocument`), not a prohibition on naming
  a pane — and the authoritative element reference shows sharing an id as the
  normal pattern for several controls addressing one pane. Removing it was not
  neutral: with no id, **two `ShowTaskpane` actions are two independent panes**,
  which is exactly what the host then showed.
- **Decision**:
  1. **Restore `<TaskpaneId>ButtonId1</TaskpaneId>` on every pane command**, so the
     context menu and the ribbon entry point raise the same container. This is
     Microsoft's documented meaning of one pane.
  2. **The guard is one IDENTITY.** Every pane-opening control must carry **the
     same** id — neither "no id" (ADR-0104, wrong) nor "one opener" (ADR-0107,
     also wrong, and it would have rejected the correct manifest).
  3. **The pane reads the selection when it is summoned**, with no channel. A fresh
     pane reads on mount; a pane already open re-reads on
     `onVisibilityModeChanged`. `readSelectionScope()` already handles a dragged
     selection and a caret expanded to its paragraph (ADR-0105, verified in a real
     Word), so this is working code invoked at the right moment rather than new
     capability. **No cross-document channel is involved**, which matters because
     `localStorage` is blocked on the host that reported the original bug
     (ADR-0106).
  4. **`Office.addin` is declared** in `types/office.d.ts` (optional, narrow) and
     reached through `shared/office/taskpaneVisibility.ts`. It was absent
     entirely, which is why every call was a hand-rolled cast.
- **Consequences**:
  - **Four diagnoses in this area were wrong**, and three of them changed the
    manifest. What finally identified each was evidence from the host — a console
    line in the offending window, then a report of which window opened which.
    **A repository check must be read against the fix**: three guards here
    asserted a shape, and each was wrong in the direction that made the defect
    look correct.
  - **"No id" and "one opener" are both wrong answers to one question.** The
    question is how many _identities_ exist, and one shared id answers it.
  - `onVisibilityModeChanged` firing when an **already-open** pane is raised is
    documented but **unverified in this host**, and no claim is made that it is.
    If it does not fire, the pane still reads on mount and the manual control
    remains — a smaller gap, not a regression.
  - The context menu still cannot _name_ a destination: a task pane command runs
    no JavaScript, so there is no instruction to carry. The pane decides for
    itself by reading, which is why it lands on Semantic Review's scope rather
    than being told to.
  - The host gate stays open. Only a person in a real Word, after a full sideload
    cycle, can close it.
- **Evidence**: `manifest.xml` (both `ShowTaskpane` actions);
  `scripts/validate-manifest.mjs` (`validateSingleTaskPane`);
  `src/types/office.d.ts` (`Office.Addin`, `VisibilityMode`);
  `src/shared/office/taskpaneVisibility.ts`; `src/taskpane/pages/SemanticReview.tsx`;
  `tests/unit/shared/office/taskpaneVisibility.test.ts`;
  `tests/unit/architecture/oneTaskpane.test.ts`; `plans/context-menu-pane-routing.md`;
  Microsoft: _Action element_ (`TaskpaneId`), _Show or hide the task pane of your
  Office Add-in_.

## ADR-0109: The page a command loads is the instruction it carries

- Amends: ADR-0108 (decision 3's consequence that the context menu "cannot _name_ a
  destination" is resolved by this ADR), ADR-0107, ADR-0101.
- Status: Accepted (2026-10-02)
- **Context**: ADR-0108 restored one pane, and left a consequence standing: a task
  pane command is _"code provided by Office"_, so it runs no JavaScript of ours and
  has no channel on which to tell an open pane where to go. It opens the pane, and
  the pane then reads the selection for itself. That satisfies "review what I
  selected" but not "land on Semantic Review": both routes loaded the same page.
- The same Microsoft sentence that settles the identity also settles the page.
  Commands sharing a `TaskpaneId` keep the container open and have _"the contents of
  the pane [...] replaced with the corresponding Action `SourceLocation`"_. The
  source location is therefore not merely a destination — it is **the one thing such
  a command can say**, and the only supported way to address a page.
- **Decision**:
  1. **One pane, two pages.** `taskpane.html` is the landing page;
     `semantic.html` is the Semantic Review page. Both are emitted from one entry
     chain — `bootstrap.tsx` holds the mount, `index.tsx` calls `start()`, and
     `semantic.tsx` calls `start("semantic-review")` — so the two pages cannot drift
     in the error boundary, the icon registration, or the root element.
  2. **`Dashboard` takes an `initialPage`**, threaded to the first page the pane
     renders. This is a page of the existing pane, not a second pane and not a
     second runtime with its own identity.
  3. **The context menu keeps `<TaskpaneId>ButtonId1</TaskpaneId>` and points at
     `Taskpane.Semantic.Url`.** The pane reads the selection on mount as before
     (ADR-0108 decision 3), so the deep link composes with the read rather than
     replacing it.
  4. **A check that restated the arrangement was replaced by one that states the
     rule.** Four places named pages or commands literally and all four broke on the
     addition: the manifest validator exempted one hard-coded pane id, the release
     checker exempted two hard-coded page names, and the build checker asserted a
     hard-coded entry list. Each now reads the page list **from `manifest.json`**,
     and the registry exemption is **by kind** (`openPage` is a task pane command,
     so it is not a function command and cannot be in `commandDefinitions.json`).
  5. **The guard is still one pane.** Differing `SourceLocation`s are now
     explicitly allowed and asserted as the deep link; what must be unique is the
     `TaskpaneId`. Every pane opener's source must still **resolve** — a `resid`
     with no resource opens nothing and reports nothing (ADR-0082).
- **Consequences**:
  - **A task pane command cannot read, only load.** The selection read stays in the
    page. That is a real division of labour, not a workaround: the command chooses
    the page, the page chooses the text.
  - The repository's page and entry lists were **couples to the manifest**. Three of
    them failed the moment a second page was added, and one of those failures was in
    the _fixture_, not the product. Data-driven lists remove the class.
  - `semantic.html` is bundle-checked like every other page, so a second page that
    shipped no JavaScript — a blank pane, the exact ADR-0101 symptom — fails the
    build rather than the user.
  - **Host evidence: one host reported working (2026-10-02).** After a full
    registration cycle in Windows desktop Word, the maintainer reports one pane,
    on Semantic Review, with the selection read, and the ribbon button still on the
    landing page. It was **not** a per-step record: whether the container is raised
    or replaced, and whether `onVisibilityModeChanged` fires on a raise
    (ADR-0108), were not observed in isolation and remain untested paths. Mac and
    Word on the web are open, so `word-host-evidence` stays **pending** overall.
    See `docs/manual-verification.md`.
- **Evidence**: `manifest.xml` (`Taskpane.Semantic.Url`, shared `TaskpaneId`);
  `manifest.json` (`taskpaneSemantic` runtime, `openPage` action);
  `src/taskpane/semantic.html`, `src/taskpane/semantic.tsx`, `src/taskpane/bootstrap.tsx`,
  `src/taskpane/index.tsx`; `src/taskpane/pages/Dashboard.tsx` (`initialPage`);
  `webpack.common.js`, `webpack.prod.js`, `webpack.dev.js`;
  `scripts/validate-manifest.mjs` (`validateSingleTaskPane`, registry exemption);
  `scripts/check-release-package.mjs` (`manifestPages`), `scripts/check-build-artifacts.mjs`;
  `tests/unit/architecture/oneTaskpane.test.ts`, `tests/unit/commands/commandContracts.test.ts`;
  Microsoft: _Action element_ (`TaskpaneId`, `SourceLocation`).

## ADR-0110: Wording belongs to the profile, protection belongs to the governance policy

- Amends: ADR-0061 (governance policy is authorable, and takes precedence over
  learned evidence)
- Status: Accepted (2026-10-03)
- **Context**: the governance policy page carried three wording editors —
  preferred terms, banned terms and required terms — under a `terminology` key on
  `GovernanceProfileSchema`. Two problems, and they were not the same problem.
  First, governance governs **protection and editability**: which regions may be
  changed, how severely a finding is treated, who may override what. A house's
  preferred spelling is none of those, so the placement was wrong on its own terms.
  Second, and worse, **two of the three fields were read by nothing at all**.
  `resolveHouseStyle` and `resolveLanguage` merged governance wording into the
  resolved policy, but no rule, no planner branch and no `src/ai/` module read a
  terminology value — so the page persisted three vocabularies, validated them on
  save, and none of them could affect a single finding. `requiredTerms` was the
  worst case: it was editable, it was type-checked, it round-tripped through
  storage, and it was inert.
- **Decision**: split the record along what each half governs.
  - **The style profile owns wording.** `language.terminology`,
    `language.bannedTerms` and `language.requiredTerms` live on
    `LanguageConventionProfileSchema`, are authored in the deterministic style
    editor beside the rules that consume them, and are read by
    `findTerminologyIssues`. `TerminologyPolicySchema` and the `terminology` key
    are **deleted** from the governance profile.
  - **The governance policy keeps protection, scope, editorial pinning and rules**,
    unchanged.
  - **`requiredTerms` becomes enforced rather than stored.** A required term is a
    house word that must appear somewhere in the document. When it is absent the
    rule emits `language.terminology.missing` — a **report-only** finding, declared
    in `DETERMINISTIC_REPORTED_ONLY_CATEGORIES`, carrying a zero-length range at
    offset 0 and **no** `safeBatchKey`. Nothing is ever inserted into the author's
    document automatically; there is no correct place to put a word the author did
    not choose to write, so the honest output is the observation and a "Go to
    item" affordance.
  - **A row per rule, not a `term: replacement` line format.** Each rule exposes
    source, replacement, `wholeWord`, `caseSensitive` and `severity`. A flat text
    format can express a substitution and nothing else, so writing it back would
    have silently dropped the other four fields — a user who set a mandatory term
    would reopen the page and find it reset to advisory.
  - **Zod strips the retired key on load.** A governance record written before this
    change still parses; its `terminology` is discarded rather than honoured. That
    is the desired outcome, and it is asserted rather than assumed.
- **Consequences**:
  - There is now **one** place a wording value is stored and one place it is read.
    The prior arrangement could not drift, because neither copy was ever read —
    but it also could not work, and a user editing one saw no effect from the other.
  - The removal was safe here because there are no users to migrate: no stored
    governance record can hold a value anyone depended on. If that changes, the
    migration belongs at the version boundary and not in a read path (ADR-0092).
  - `resolveHouseStyle`/`resolveLanguage` lost their governance parameter. A merge
    that copied protection settings into wording would have re-blurred the same
    line this ADR draws.
  - `resolveResolvedPolicy` no longer imports `TerminologyRuleSchema` at all,
    which is what makes the separation checkable rather than documentary.
  - **Known residue, deliberately not hidden**: the preferred-term finding still
    carries the category `houseStyle.terminology` while its `profilePath` is
    `language.terminology.<id>`, and `houseStyle.terminology` is also a
    `GOVERNANCE_RULE_SOURCES` binding. The category name now contradicts the field
    that produced it. Renaming it is a taxonomy change with a planner and registry
    blast radius, so it is recorded as its own follow-up rather than smuggled in
    here — but it is a **real inconsistency**, not a naming preference.
  - **ND-13 — a second set of terminology fields was inert, and is now gone.**
    `HouseStyleSchema.preferredTerminology` (a flat `Record<string, string>`) and
    `HouseStyleSchema.bannedTerms` looked authoritative: authored in the House
    style panel, validated on save, persisted through a round trip. They produced
    **no findings at all**, because `ruleRegistry.ts` calls
    `findHouseStyleIssues` through
    `selectCategories(..., ["houseStyle.capitalization.titleCase"])` — the
    terminology checks were filtered out of every report in favour of the
    `language` rules. This is the "it saved but ignored my entry" failure, and it is
    why `PROFILE_FIELD_PATHS` now declares `houseStyle.capitalization.titleCaseWords`
    at all: the list named no `houseStyle` field, so the mechanism meant to catch
    an unreachable field was not looking at that section.
    Both fields, and both checks, are **deleted**. `findTerminologyIssues` is the one
    terminology engine and is strictly more capable than the flat record it
    replaces — a `TerminologyRule` carries `wholeWord`, `caseSensitive`, `severity`
    and a scope, where `Record<string, string>` carried a term and a replacement and
    nothing else. The House style form still exists and now writes the live record,
    through a merge that preserves a matched rule's severity and scope.
    The construction-report fixture is the other half of the evidence: it passed
    over this defect for months because `findTerminologyIssues` also reads
    `language.legacyPreferredTerminology`, so the corpus satisfied the engine
    through a neighbouring field while the field under test did nothing.
- **Evidence**: `src/core/domain/GovernanceProfile.ts` (`TerminologyPolicySchema`
  deleted); `src/core/domain/StyleProfile.ts` (`LanguageConventionProfileSchema.requiredTerms`);
  `src/core/domain/ResolvedPolicy.ts`; `src/rules/language.ts`
  (`findTerminologyIssues`);
  `src/changes/deterministicChanges.ts` (`DETERMINISTIC_REPORTED_ONLY_CATEGORIES`);
  `src/taskpane/components/GovernancePolicySection.tsx`,
  `src/taskpane/components/DeterministicStyleSections.tsx`;
  `tests/unit/core/state/terminologyPersistence.test.ts`,
  `tests/unit/rules/requiredTerms.test.ts`,
  `tests/unit/core/domain/GovernanceProfile.test.ts`.

## ADR-0111: A profile setting is either enforced or absent — there is no third state

- Amends: ADR-0091 (a standard the user cannot set is not wired, and the §11 audit
  cannot see it)
- Status: Accepted (2026-10-03)
- **Context**: three separate fields looked authoritative, were editable, and
  governed nothing. `units.symbols`'s _keys_ were read only to word a casing
  message, so a house saying `kilogram → kg` got no finding for a document writing
  "5 kilogram". `language.locale` was a free-text box labelled "recorded, not
  enforced" and was excused in `METADATA_ONLY_PROFILE_PATHS`. And the term map behind
  `houseStyle.preferredTerminology` (ND-13) validated and persisted without ever
  reaching a report.

  The excuse list is what makes this an ADR rather than three fixes. It worked as
  intended — it stopped the audit flagging a deliberate omission — and in doing so it
  **laundered three settings into looking deliberate**. A reviewer reading
  `METADATA_ONLY_PROFILE_PATHS` would conclude someone had considered the field and
  decided; in each case nobody had.

- **Decision**: a profile field is either read by a rule with a body, or it does not
  exist. There is no list of excused-but-unwired settings.
  - **`METADATA_ONLY_PROFILE_PATHS` is now empty**, and stays in the codebase
    because an empty list is a _claim_ — every field is read — and is checkable.
  - **`language.locale` supplies the default numeric date shape** when the profile
    declares no preferred format of its own. An explicit format always wins, so a
    house writing `31/05/2026` under an `en-GB` locale keeps its own convention.
    It is a closed enum, because a free string accepts a typo that parses cleanly and
    then matches nothing.
  - **`describeDateShape` now separates `dmy` from `mdy`** when the first field
    exceeds 12, and returns `numeric` when both readings are valid. This is the
    boundary that keeps the locale honest: it silences the _unambiguous_ wrong-order
    case and leaves the ambiguous one to the existing `requireUnambiguous` refusal. A
    locale that resolved `05/03/2026` by convention would be the tool deciding which
    day a date names.
  - **`units.symbols` reads its keys.** A named unit written where the house prefers
    its symbol is now a `language.unit.preferredSymbol` finding — a named
    substitution, correctable because a name and its symbol denote the same
    quantity. That is a stronger claim than the spacing rule beside it makes, and the
    difference is deliberate: swapping `kilogram` for `kg` restates a measurement,
    whereas inserting a space changes the written form.
- **Consequences**:
  - **A behaviour change a user can see.** A profile with no declared date format now
    reports day-first dates under the default `en-US`, where it previously reported
    nothing. That is the point — the silence is what made the setting decorative —
    but it is a behaviour change and is recorded as one rather than shipped quietly.
  - **The registry guard caught the omission.** `unwiredProfilePaths()` failed until
    `language.locale` was added to a rule's `profilePaths`, even though
    `findDateIssues` already read it. A field counts as wired only when a rule with a
    body _claims_ it, which is stricter than "something reads it" and is the right
    strictness: it stops a real reader excusing itself by accident.
  - **The locale is still not a spelling dictionary.** It drives one convention
    because that is the one where a wrong guess would misreport a date. Inferring
    spelling from it would reintroduce the US/UK variant table spec §4.3 removed,
    which existed only to duplicate Word's spellchecker.
- **Evidence**: `src/core/domain/StyleProfile.ts` (`LOCALE_OPTIONS`,
  `LOCALE_DATE_SHAPES`, `LocaleSchema`); `src/rules/language.ts`
  (`describeDateShape`, `findDateIssues`, `findUnitIssues`);
  `src/analysis/deterministic/ruleRegistry.ts`
  (`METADATA_ONLY_PROFILE_PATHS`, `language/dates`); `unwiredProfilePaths()`;
  `tests/unit/rules/localeEnforcement.test.ts`,
  `tests/unit/rules/unitPreferredSymbol.test.ts`.

## ADR-0112: A rule may read only a field a control can write

- Amends: ADR-0111 (a field is either read by a rule or it does not exist), and
  ADR-0091 (the §11 audit cannot see an unreachable setting)
- Status: Accepted (2026-10-03)
- **Context**: implementing `language.abbreviations.preferredExpanded` required
  asking where a user sets it. The answer was nowhere.

  Abbreviations, numbers, dates, currency and units were all declared in the
  profile schema, read by registered rules, and named in a rule's `profilePaths`.
  `unwiredProfilePaths()` therefore reported every one of them as covered, and the
  §11 audit reported none of them as a defect. But **no control anywhere in the
  product could write them**. The House style panel holds terminology, banned
  terms, title-case words and one sentence-case toggle; a sentence in the Language
  section pointed users at it for the rest. In the running product every one of
  those subsections sat at its schema defaults, and no rule in them could fire —
  including the units-symbol and locale behaviour ADR-0111 had just added.

  The registry audit is structurally blind to this. It reads `profilePaths`, which
  is a declaration by the rule about what it reads. It has no view of the editor at
  all, so "a rule reads a field" is indistinguishable from "a user can set a
  field".

- **Decision**: the two halves are joined at the editor, and the claim is tested.

  - **Every field the language rules read now has a control** in the Language
    section: the proper-noun, prohibited-capitalisation and heading-case settings;
    the four abbreviation vocabularies; the four number conventions; the date
    format list and the ambiguity switch; the five currency conventions; and the
    three unit conventions including `units.symbols`.
  - **`headingCase` is enforced rather than merely declared.** It was named in
    `language/capitalisation`'s `profilePaths` while nothing read it — the last
    false claim of the ND-3 family, missed by the registry for the same reason it
    missed `preferredExpanded`. A heading is identified by its paragraph style, and
    the three conventions are correctable to different degrees: `upper` and `title`
    raise or cap one letter inside a word and are correctable; `sentence` is
    reported without a correction, because lower-casing a word the profile has not
    listed as a proper noun may destroy one. Acronyms are never reported — flagging
    `IBM` in a heading would make the rule cry wolf on every document that names a
    product. The rule is silent on a non-English Word, where the style is named
    "Überschrift" rather than "Heading"; that is stated in the code rather than left
    for a user to discover.
  - **`preferredExpanded` is enforced.** A long form written where the house prefers
    the short one is a `language.abbreviation.preferredExpanded` finding. It is read
    _together with_ `requireFirstUseExpansion`, because a house may legitimately
    want the long form once and the short form after: a long form preceding the
    first short form is the expansion the profile demanded, and reporting it would
    ask the user to delete what the other rule just told them to add. Where a form
    is also in `prohibitedVariants`, the prohibited rule wins the claim — two owners
    for one character is ND-2, and the stricter of the two is the one to keep.
  - **The tri-state settings get a tri-state control.** `requireFirstUseExpansion`
    is `optional()` because "the house has not said" differs from "the house said
    no", and a dropdown over `Not set / Required / Not required` is the only control
    that can say it. "Not set" _removes_ the key rather than writing `undefined`,
    because `exactOptionalPropertyTypes` treats the two as different values.
  - **The date shape is a closed vocabulary.** `DATE_SHAPE_IDS` and
    `DATE_SHAPE_LABELS` are shared by the rule and the editor, so an author cannot
    type an id no rule will match. `unrecognised` is not authorable: it is what the
    rule says when it could not read a shape, and a profile must not be able to
    prefer it. Exactly one date format may be `preferred`, because the rule takes
    the first — two would make the answer depend on the order of an array the user
    never sees ordered.
  - **The sentence that pointed at the wrong panel is gone**, replaced by one that
    says where each convention is set and is true of every control on the page.

- **Consequences**:
  - **A defect the registry cannot catch is now caught by the component tests.**
    `tests/unit/taskpane/components/DeterministicStyleSections.test.tsx` drives
    each control and asserts the field the rule reads changed. A rule added without
    a control is still possible — the registry will not object — and that gap is
    recorded here rather than claimed closed.
  - **A second editor of one record is now visible and deliberate.** "Banned terms"
    in this section and "Banned terms (one per line)" in the House style form both
    write `language.bannedTerms` (ADR-0110). Making the two accessible names exact
    surfaced a `ProfileEditor` test that had been matching both by prefix and by
    display value, and asserting on whichever the DOM happened to list last.
  - **The banned-terms control had no accessible name at all.** A heading above it
    is a visual grouping, not a label. It is now wired with `aria-labelledby`, and
    every field in the section names its hint through `aria-describedby` rather
    than folding the hint into the accessible name.
  - **The shared line parser now takes the vocabulary it reports in.**
    `parseTerminology` accepts a `TermNouns` argument, so an abbreviation field
    says `Preferred short form line 1 must use "long form: short form"` instead of
    telling a user their approved abbreviation must use `term: replacement`. The
    default wording is unchanged, so every existing message is byte-for-byte the
    same.

- **Evidence**: `src/rules/language.ts` (`findAbbreviationIssues`,
  `describeShape`); `src/analysis/deterministic/ruleRegistry.ts`
  (`language/abbreviations`); `src/changes/deterministicChanges.ts`;
  `src/core/domain/StyleProfile.ts` (`DATE_SHAPE_IDS`, `DATE_SHAPE_LABELS`);
  `src/taskpane/components/DeterministicStyleSections.tsx`;
  `src/taskpane/settings/terminologyText.ts` (`TermNouns`);
  `tests/unit/rules/preferredExpanded.test.ts`;
  `tests/unit/taskpane/components/DeterministicStyleSections.test.tsx`.

## ADR-0113 — The em dash has two representations and no spacing setting

- **Status**: Accepted
- **Date**: 2026-10-03
- **Owner decision**: D3

### Context

`TypographyRulesSchema` carried two dash settings that turned out to be one
setting and one hazard.

`emDash` was `z.enum(["em", "hyphen", "space"])`. The `"space"` member made
`checkEmDash` report **every** dash — em or double hyphen — under
`category: "typography.emDash"`, with the message `Use a plain space instead of
em dash (—) or double hyphen (--)`. `typographyReplacement` then answered that
message with `" "`. The result was a correctable finding whose correction deletes
a punctuation mark the author put there, and it was reachable from the _Em dash_
dropdown itself, not from a control that looked like it was about spacing.

`emDashSpacing` was `z.enum(["spaced", "tight"])`. Its check reported the dash
together with a character it did not own: `range` covered only the dash, while
`evidence` and the `precondition` covered `text.slice(start - 1, end + 1)` — the
dash plus one character on each side. `typographyReplacement` answered `tight`
with the dash alone and `spaced` with `" — "`, so accepting the correction under
`tight` rewrote a range whose precondition did not match the text it was
replacing, and accepting one under `spaced` removed two spaces that were not
themselves reported as findings.

Neither setting could be justified on its own terms. Whether a dash _takes
surrounding spaces_ is a question about the author's spacing, not about how the
dash is _encoded_; and no correction the product can build should ever reduce a
punctuation mark to whitespace.

### Decision

1. `emDash` is `z.enum(["em", "hyphen"])`. The `"space"` member is removed from
   the schema, so no profile — authored fresh or loaded from storage — can ask
   for it.
2. `emDashSpacing` is removed: from `TypographyRulesSchema`, from
   `PROFILE_FIELD_PATHS`, from `DASH_CATEGORIES` and the rule's `emits` /
   `profilePaths`, from `DETERMINISTIC_CORRECTABLE_CATEGORIES` and the planner's
   `case` list, from `typographyReplacement`, from `ProfileFormValues` /
   `profileToValues` / `buildCandidate` and its dropdown, and from the
   `diffProfiles` field table in `src/style/versioning.ts`.
3. `typography.enDashSpacing` is retained. It is a separate setting, it is not
   implicated in either defect, and removing it would be an unrelated withdrawal.
4. `checkEmDash` is now two symmetric branches: whichever representation the
   house did _not_ pick is the one deviation, and each finding's range is exactly
   the mark it names. A document carrying both an em dash and a double hyphen
   under `emDash: "em"` yields one finding, for the double hyphen.
5. No data migration is written. Per the product-owner direction there are no
   users, so no stored profile can hold either value. `loadState` still falls back
   to defaults on a parse failure (ADR-0010); this ADR adds no code path to rely
   on that.

### Consequences

- **A correction can no longer delete punctuation.** There is no authored
  profile for which `planDeterministicChange` returns a change whose replacement
  is `" "` for a dash, because no schema value can produce that finding.
- **The audit's §16 hazard is closed at the source.** Removing only the spacing
  setting would have left `"space"` reachable from the Em dash dropdown. Both
  halves had to go; the schema is where the hazard was, so that is where it was
  removed.
- **The planner's `typography.emDash` case is now two-valued.**
  `typographyReplacement` reads `/double hyphen \(--\) instead/i` and returns
  `"--"` or the em dash; an unrecognised message gets the em dash rather than a
  guess about a third form. The rule only ever emits those two messages.
- **A profile authored with `"space"` would fail to parse** rather than being
  silently reinterpreted. With no users this cannot happen; if users are
  introduced later, a migration step must map `"space"` to `"em"` before the
  storage key is bumped (ADR-0015).
- **The em dash is no longer checked for spacing, so a house that cared about
  `— word —` cannot express it.** That is the intended direction: the check was
  unsafe to correct, and a report-only variant would be the way to restore it.

### Evidence

`src/core/domain/StyleProfile.ts` (`TypographyRulesSchema`);
`src/rules/typography.ts` (`checkEmDash`, `CATEGORY_PROFILE_PATHS`);
`src/analysis/deterministic/ruleRegistry.ts` (`DASH_CATEGORIES`,
`PROFILE_FIELD_PATHS`, `typography/dashes`);
`src/changes/deterministicChanges.ts` (`typographyReplacement`,
`DETERMINISTIC_CORRECTABLE_CATEGORIES`, `planDeterministicChange`);
`src/taskpane/components/ProfileEditor.tsx` (`ProfileFormValues`, the Em dash
dropdown); `src/style/versioning.ts` (`diffProfiles` field table);
`tests/unit/rules/typography.test.ts`;
`tests/unit/changes/planner.test.ts`.

## ADR-0114 — A profile says what the house asked for; the host says what it can read

- **Status**: Accepted
- **Date**: 2026-10-03
- **Plan item**: Phase 4, item 15

### Context

`ListFormattingStandardSchema`, `TableFormattingStandardSchema`,
`HeaderFooterStandardSchema` and `PageStandardSchema` each carried a
`supported: z.boolean().default(false)`. A user set it from the profile editor,
and the analyzer gated on it _and_ on a probed capability:

```ts
if (!standard || !standard.supported || capabilities.supportsTables !== true) return [];
```

Two facts were being mixed under one name.

1. **The flag asserted something about the host that no user can know.** Ticking
   "check tables" read as "this Word can read tables". It cannot: the capability
   probe answers that, and the probe's answer is right beside the flag. The flag
   added no capability and removed the need to look at one.
2. **It duplicated the gate.** The conjunction was already `user flag AND
capability`, so the same question — can this host read tables? — had two
   answers in two places, and the user-editable one was the one a reader of the
   profile schema would take as authoritative.

The name also inverted the direction of responsibility in the editor. A house
deciding "we do check table styles" is stating its own standard; a house
asserting "this Word supports tables" is stating a fact about somebody else's
software. `DeterministicStyleSections` had already derived the honest version of
the second half, per-section, from the probed capabilities — so the product
already contained the right answer and simply also exposed a wrong one as an
editable field.

### Decision

1. The four profile schemas carry **`requested`**, not `supported`. It is the
   house's decision, it keeps the `false` default (a record written before the
   field existed must not start firing a check nobody asked for), and it is
   renamed rather than aliased so no reader can mistake it for a host fact.
2. The derived half lives in one pure module, `src/formatting/structuralStandards.ts`:
   `standardIsRequested`, `standardIsEnabled`, `standardIsChecked`,
   `familiesNotEnabled`, plus the `STRUCTURAL_STANDARD_CAPABILITY` map and the
   reader-facing `STRUCTURAL_STANDARD_LABELS`.
3. The analyzer gates on `standardIsChecked(family, standard, capabilities)`.
4. `DeterministicStyleSections` derives its per-standard "not read here" note
   from `familiesNotEnabled(capabilities)` instead of carrying its own list of
   capability flags and its own copy of the four reason strings.
5. `HeaderFooterStandardSchema.required` is unchanged. "A header must exist" is a
   statement about the house, not about Word.
6. No migration is written. Per the standing product-owner constraint there are
   no users. A stored `supported: true` is stripped by Zod and the standard
   arrives not-requested and silent — the safe direction, and asserted by test
   rather than assumed.

### Consequences

- **A profile can no longer assert anything about a Word host.** Setting
  `requested: true` on every structural standard on a host that serves nothing
  produces no findings, and the test file proves it for all four families.
- **The editor's note and the analyzer's gate can no longer drift.** They read
  one derivation. The four reason strings moved with the map, so renaming a
  capability is a single edit.
- **`supportsTables` and friends remain optional and are read as `false` when
  absent.** A host that never claimed a capability is not a host that supports
  it; the probe already defaults every Office.js-dependent family to `false` for
  this reason, and the derivation now matches it.
- **The label vocabulary is now pinned by a test.** "Tables" is what the toggle
  says and what the note says; a future edit that makes one "Table formatting"
  fails rather than shipping two names for one thing.
- **`src/formatting` gains a module but takes no new import.** The capability
  shape is declared structurally, so `FormattingCapabilities` and
  `WordCapabilities` both satisfy it without either module importing the other.
  The deterministic boundary (no imports from `analysis` or `word`) is intact.
- **`unwiredProfilePaths()` is unaffected.** `PROFILE_FIELD_PATHS` names the four
  sections as whole objects, so a field rename inside one does not change the
  registry's declared paths.

### Evidence

`src/formatting/structuralStandards.ts` (new);
`src/core/domain/StyleProfile.ts` (`ListFormattingStandardSchema`,
`TableFormattingStandardSchema`, `HeaderFooterStandardSchema`,
`PageStandardSchema`); `src/formatting/analyzer.ts` (`checkListFormatting`,
`checkTableFormatting`, `checkHeaderFooterFormatting`, `checkPageSetup`);
`src/taskpane/components/DeterministicStyleSections.tsx` (`uncheckedStandards`
and the four compare toggles);
`tests/unit/formatting/structuralStandards.test.ts` (new);
`tests/unit/formatting/analyzer.test.ts`;
`tests/unit/analysis/deterministic/deterministicReviewEngine.test.ts`.

## ADR-0115 — A finding names the structure it is about

- **Status**: Accepted
- **Date**: 2026-10-03
- **Plan items**: Phase 4, items 16 and 17

### Context

`checkTableFormatting`, `checkHeaderFooterFormatting` and `checkPageSetup` all
built their finding ranges with one helper:

```ts
function sectionRange(index: number): Range {
  return { start: index, end: index + 1, unit: "section" };
}
```

So a table styling deviation produced `{ start: tableIndex, end: tableIndex + 1,
unit: "section" }`, a header styling deviation produced the same shape from the
_section's_ index, and only a page-setup deviation was telling the truth. Three
structures, one unit name.

That was not cosmetic. `FindingDetail` printed
`Location: {start}–{end} ({unit})` verbatim, so a user was shown "Location: 2–3
(section)" on a table. And `toChangeRange` in both the planner and the
deterministic change builder maps `range.unit === "section"` to a
`ChangeTargetSchema` section target — so had any of these findings ever been
planned, the plan would have addressed a section. They are all
`correctable: false` and never were, which is why nothing wrote to the wrong
place; the mislabel was still a false statement the product made about itself.

`Range` also had no way to say _which_ header, or which table, as distinct from
_how many_ of them. A consumer that wanted to take a reviewer to the thing could
not.

### Decision

1. **`RangeSchema.unit` gains `table`, `header` and `footer`.** A range's unit
   is what its two numbers count, so the fix is to make the count honest.
   `section` retains exactly its own meaning.
2. **`FindingTargetSchema` is added**, a `kind`-keyed discriminated union with
   `text`, `paragraph`, `list`, `table`, `header`, `footer` and `section`. It
   mirrors `ChangeTargetSchema` in `Change.ts` deliberately — same shape, same
   optional `nodeId` / `structuralPath` spelling — rather than introducing a
   second dialect for the same question.
3. **`header` and `footer` targets carry `sectionIndex`.** That is the fact the
   analyzer had to re-derive from a `sourcePath` regex and the one a reader needs
   to find the right section; a range carries exactly one meaning, so the second
   fact belongs on the target.
4. **`makeFinding` derives a paragraph target from the paragraph it was handed**,
   so a paragraph finding cannot point at a different paragraph than the one it
   was raised for. Structural checks pass their own target explicitly.
5. **`src/taskpane/findingLocation.ts` renders the location in words**
   ("Table 3", "Header 6 in section 2", "Characters 11–14"), preferring the
   target and falling back to the range only for a text finding. `FindingDetail`
   uses it. This is the user-visible half of items 16 and 17; the wider card
   redesign is Phase 5 UX-3 and is not attempted here.
6. **`markDirtyNodes` treats any non-character range as a whole-document
   change.** The original three-branch form fell through silently for the three
   new units, which would have meant a structural edit marking nothing dirty and
   leaving stale findings on screen as if the document were clean.

### Consequences

- **A table finding no longer claims to be about a section.** It counts in
  tables, and its target carries the table's own `nodeId` and `structuralPath`,
  so `Go to item` has something resolvable to work from.
- **A header finding names the header and its section.** The section index is no
  longer recoverable only by re-parsing a `sourcePath` string downstream.
- **`Range` is wider, so every consumer of `range.unit` had to be considered.**
  `toChangeRange` treats an unrecognised unit as characters, which is the safe
  fallback for a `Change` (no structural change is ever planned from these
  findings). `markDirtyNodes` now over-marks rather than under-marks.
  `pendingChangeCards.describeRange` reads `ChangeRange`, whose own unit enum is
  unchanged, so a change can never carry a structural unit.
- **The location string is 1-based.** A reader counts tables from one; "Table 0"
  reads as a broken tool. `describeFindingLocation` is a separate pure module so
  the wording is testable without rendering, and so the count-from-one decision is
  in one place.
- **`target` is optional on `FindingSchema`.** Most findings are about text and
  the range already says so; requiring a target on every finding would add noise
  to the common case for no gain.

### Evidence

`src/core/domain/Finding.ts` (`RangeSchema`, `FindingTargetSchema`,
`FindingSchema.target`); `src/formatting/analyzer.ts` (`tableRange`,
`headerFooterRange`, `sectionTarget`, `paragraphTarget`, `makeFinding`);
`src/analysis/incrementalCoordinator.ts` (`markDirtyNodes`);
`src/taskpane/findingLocation.ts` (new); `src/taskpane/components/FindingDetail.tsx`;
`tests/unit/taskpane/findingLocation.test.ts` (new);
`tests/unit/formatting/analyzer.test.ts`;
`tests/unit/analysis/incrementalCoordinator.test.ts`.

## ADR-0116 — A heading level is part of the outline, not a paragraph style

- **Status**: Accepted
- **Date**: 2026-10-03
- **Plan item**: Phase 4, item 19

### Context

`planDeterministicChange` had this case:

```ts
case "formatting.headingHierarchy": {
  return single(styleChange(finding, finding.expected ?? headingStyle(finding.message)));
}
```

and `headingStyle` recovered the style to apply by re-parsing the finding's own
message:

```ts
const previous = /follows\s+[”"']?Heading\s+(\d+)/i.exec(message);
// ...previousLevel + 1 -> "Heading N"
```

Two problems, one visible and one latent.

**Latent, and the reason the audit flagged it.** For a `Heading 3` following a
`Heading 1`, the regex captures the level that was _followed_ (`1`) and adds one,
answering `Heading 2` — a level the message never proposed and the author never
considered. Both analyzer findings do set `expected`, so the fallback never fired in
production; but it was a second, divergent answer to a question the rule had
already answered, kept alive only by an `??` no one expected to reach. That is the
shape that becomes a live defect the moment a third caller appears.

**Visible, and the reason the category should never have been correctable.**
Neither `expected` value is a safe single-paragraph edit:

- a heading deeper than `structure.maxHeadingLevel` proposed applying
  `Heading 3` to a `Heading 5`, silently promoting it and severing whatever
  `Heading 4` structure sat between them;
- a skipped level proposed applying the intermediate level (`Heading 2` to the
  `Heading 3`), which is one of at least three legitimate repairs — insert the
  missing heading, renumber everything below it, or accept the gap.

Applying a Word style rewrites the document outline. That is a structural decision,
and the tool does not have standing to make it.

### Decision

1. `headingStyle()` is deleted. A finding's `message` is prose for a reader; a
   planner that parses it is deriving a value from a string nobody promised to keep
   in that shape.
2. `formatting.headingHierarchy` moves from `DETERMINISTIC_CORRECTABLE_CATEGORIES`
   to `DETERMINISTIC_REPORTED_ONLY_CATEGORIES`, and its planner case returns no
   changes. The case is kept, with the reason inline, rather than deleted — the
   registry audit asserts that a rule calling itself non-correctable has said so
   where the planner can see it.
3. `checkHeadingHierarchy` sets `correctable: false` and a
   `correctionReason` on both findings, so the UI states why rather than showing a
   missing button with no explanation.
4. `structure/headingHierarchy` in the rule registry is declared `correctable:
false`. The rule is not removed: it still reports a real deviation.
5. `expected` stays on both findings. It is the level the gap _suggests_, useful
   information to show; it is no longer a correction, and the tests pin that the
   planner produces nothing whether or not it is present.

### Consequences

- **No style change can be planned from a heading-hierarchy finding**, so the
  outline is never rewritten by an Approve.
- **The regex is gone rather than fixed.** Making it read the heading's own level
  would still leave the structural problem, and a parser kept alive only by a
  fallback is a parser nobody maintains.
- **`DETERMINISTIC_REPORTED_ONLY_CATEGORIES` is the honest home.** The registry
  audit already cross-checks it against the planner, so this category is now
  checked in both directions rather than only as "a planner case exists".
- **A user sees the finding and must act in Word.** That is the intended cost of
  not letting the tool choose the author's outline.
- **`structure.allowSkippedHeadingLevels` and `structure.maxHeadingLevel` are
  unaffected** — both still produce findings; only their correctability changed.

### Evidence

`src/changes/deterministicChanges.ts` (`DETERMINISTIC_CORRECTABLE_CATEGORIES`,
`DETERMINISTIC_REPORTED_ONLY_CATEGORIES`, `planDeterministicChange`; `headingStyle`
removed); `src/formatting/analyzer.ts` (`HEADING_HIERARCHY_REASON`,
`checkHeadingHierarchy`); `src/analysis/deterministic/ruleRegistry.ts`
(`structure/headingHierarchy`); `tests/unit/changes/planner.test.ts`;
`tests/unit/formatting/analyzer.test.ts`.

## ADR-0117 — A precondition names every property the rule read

- **Status**: Accepted
- **Date**: 2026-10-03
- **Plan item**: Phase 4, item 18

### Context

The paragraph rule compares fourteen properties:
alignment, line spacing, space after, space before, left indent, right indent,
first-line indent, keep-with-next, keep-lines-together, page-break-before, list
level, style name, and the six character properties.

`paragraphPrecondition` built its `expectedFormatting` from nine of them. Line
spacing, spacing before and after, and all three indents were read by the rule and
silently absent from the precondition.

`matchesFormatting` compares every key the precondition names and skips keys it
does not. So a finding raised about `spaceAfter` carried a precondition that could
not see `spaceAfter`: the plan could be approved, applied, and read back as
verified while the spacing the finding was about had moved. That is a false
confirmation of a write that may no longer correspond to the document — the exact
failure a precondition exists to prevent, produced by a precondition that was
structurally valid and semantically incomplete.

### Decision

1. `FormattingStateSchema` gains `leftIndent`, `rightIndent` and
   `firstLineIndent` (nullable numbers) and `keepNext`, `keepLines` and
   `pageBreakBefore` (nullable booleans). Every field stays optional, so an absent
   key still means "not known".
2. `paragraphPrecondition` now names **everything the rule compares that
   acquisition actually reads**: the three previously-missing spacing and
   indentation properties join the nine it already carried.
3. `paragraphPrecondition` **deliberately omits** the three flow controls. They
   are `null` on every host today — no host reads them — so naming `null` would
   assert "this paragraph has no keep-with-next", which nobody observed. An absent
   key says "not known", which `matchesFormatting` skips.
4. `matchesFormatting` is **not** changed. Treating a `null` expectation as
   "skip" would weaken the gate for properties that genuinely are read, and a
   precondition that refuses for a reason it cannot justify is its own defect.

### Consequences

- **A moved indent or spacing now refuses the plan**, with the property named in
  the reason. This is the behaviour a precondition claims and did not have.
- **Widening the schema cannot introduce a false refusal**, because the caller
  only ever writes keys it read. That is why the flow controls are left out rather
  than written as `null`.
- **`ExpectedFormatting` widens automatically.** It is `z.infer<typeof
FormattingStateSchema>` in `preconditions.ts`, so `matchesFormatting` compares
  the new keys without a second list to keep in step.
- **A host that starts serving a flow control needs no change here**: the field is
  on the schema and acquisition already reports `null` for the unread case, so a
  future `paragraphPrecondition` can name it the day it is real.
- **This is repository-side evidence only.** Whether the live precondition and
  readback paths populate these keys from a real Word host is still the
  human-verified host gate (`docs/manual-verification.md`), and is not closed by
  this.

### Evidence

`src/core/domain/Change.ts` (`FormattingStateSchema`);
`src/formatting/analyzer.ts` (`paragraphPrecondition`);
`src/changes/preconditions.ts` (`ExpectedFormatting`, `matchesFormatting`);
`tests/unit/formatting/preconditionCoverage.test.ts` (new, 14 tests).

## ADR-0118 — A finding's category names the profile section that produced it

- **Status**: Accepted
- **Date**: 2026-10-03
- **Plan item**: Phase 4, item 21 (closes ND-12)

### Context

`findTerminologyIssues` emitted findings under `category:
"houseStyle.terminology"` while the very same finding carried
`deterministic.profilePath: "language.terminology.<id>"`. The category said the
finding came from the house-style section; the profile path said it came from the
language section. Both were on one object, and they disagreed.

Two fields of one finding answering the same question differently is not a naming
tidy-up. The category is what the review UI groups by, what the planner switches
on, what `DETERMINISTIC_CORRECTABLE_CATEGORIES` lists, and what a governance rule
binds to through `ruleForSource`. The `profilePath` is what makes a finding
explainable and groupable. A category pointing at a section the rule does not read
means the review is filed under a chapter of the profile that has nothing to do
with it, and every lookup keyed on the category is a lookup in the wrong place.

The category was also the last of its kind: its two siblings from the same rule —
`language.terminology.missing` and `language.bannedTerm` — were already under
`language.`.

### Decision

1. The category is `language.terminology.preferred`, beside
   `language.terminology.missing` and `language.bannedTerm`.
2. `GOVERNANCE_RULE_SOURCES` moves with it. A governance rule binds to a finding
   _category_; renaming the category without renaming the source would leave every
   terminology governance rule bound to nothing — the same defect pointed the other
   way, and one no test of the rule alone would catch.
3. `GovernancePolicySection`'s label for that source is now "Preferred
   terminology". "House terminology" named the section the category used to lie
   about.
4. No alias and no migration. A category is not persisted by a schema, and the
   standing constraint is that there are no users. A stored _governance profile_
   whose rule names the old source would fail `GovernanceProfileSchema.parse`,
   which `loadState` answers with defaults (ADR-0010) — acceptable here, and
   recorded rather than left implicit.
5. A new test asserts the **general** form: for every finding the terminology
   scanner produces, the family of its category and the family of its profile path
   are the same. A rule that emits across two families fails it, whatever the
   strings happen to be called.

### Consequences

- **The category and the profile path now answer one question the same way**, and
  a test checks it for the findings rather than for the string.
- **A governance rule can still bind to terminology findings**, proven by a test
  that writes a rule against the renamed source and resolves it.
- **`ruleByCategory("houseStyle.terminology")` now returns `undefined`**, asserted
  explicitly so the old name cannot creep back in unnoticed.
- **The rename touched 34 occurrences across 17 files**, all mechanical. The
  registry, planner, fixtures and tests were updated together; nothing was left
  pointing at a category no rule emits.
- **`findTerminologyIssues` is shared** by `language/terminology` and
  `language/bannedTerm`, each filtering to the categories it owns. The new test
  therefore asserts that every produced finding is claimed by exactly one registry
  rule, rather than by one named rule — which is the stronger claim and the one
  that catches an unfiltered category reaching a report with no owner.

### Evidence

`src/rules/language.ts` (`findTerminologyIssues`);
`src/analysis/deterministic/ruleRegistry.ts` (`language/terminology`);
`src/changes/deterministicChanges.ts`
(`DETERMINISTIC_CORRECTABLE_CATEGORIES`, `planDeterministicChange`);
`src/core/domain/GovernanceProfile.ts` (`GOVERNANCE_RULE_SOURCES`);
`src/taskpane/components/GovernancePolicySection.tsx`;
`tests/unit/analysis/deterministic/taxonomyConvergence.test.ts` (new, 14 tests).

## ADR-0119 — A group is decided only by the run that produced its findings

### Context

The engine has always grouped equivalent occurrences and put a batch-safety
verdict on each group (`safeBatchApproval`, `batchRefusalReason`). Nothing read
either: the whole `batchApproval` module was unreachable (ND-7) and
`DetermisticReviewReport.groups` was computed and dropped (ND-9).

The audit's instruction was "render `report.groups` in the Dashboard". Taken
literally that is wrong, and following it would have produced a broken feature
that looked finished.

The Dashboard's findings list reads the **observer's** scan. The only `groups`
the Dashboard could have reached without a new field belonged to the **preview**
run — a different `runDeterministicReview` call with its own acquisition and its
own rule pass, which issues separate uuids for the same problem. The two runs
therefore never share an occurrence id. Joining them by id would report every
occurrence as missing and refuse every group for the wrong reason.

That is not a hypothetical. It is the same class of defect the review gate and
the reviewed-only projection were both repaired for earlier: two places assuming
a finding id means the same thing across runs.

### Decision

`DocumentObserverStatus` carries `groups` from **its own** `runDeterministicReview`
call, replaced on every accepted scan alongside `findings`. Since both come out of
one call, `group.occurrenceIds` addresses `status.findings` exactly.

A new pure module, `taskpane/findingGroups`, joins those groups to the findings
the pane is actually showing, under three rules:

- **A finding is never dropped.** A group that cannot be fully resolved is
  rendered with a `missing` count and its surviving occurrences, and a group that
  resolves to nothing is reported as stale. Filtering the list to what a group
  names — the obvious implementation — silently deletes a real finding because a
  bookkeeping field moved out of step.
- **A group of one renders as a plain occurrence.** Keyed on the _declared_ size,
  not the resolved one, so a group of two with one missing keeps the warning it
  carries.
- **Units are ordered by document position.** The findings toolbar steps an index
  into this list; ordering by group would make "Finding 3 of 12" land somewhere
  else while the counts stayed unchanged.

The Dashboard's new `approveGroupAll`/`skipGroupAll` hand the group to
`batchApproval`, which stays the only implementation of the all-or-nothing rule,
and record nothing when it refuses. Occurrence identity is read through
`reviewIdentity`, not a local derivation — this codebase has already shipped two
defects from a second, near-identical identity key.

`FindingGroupCard` renders the engine's verdict rather than re-deriving it:
"Approve all" is **disabled carrying `batchRefusalReason`**, never hidden, and
nothing is approved without a press (D6).

### Consequences

- ND-7 and ND-9 are closed. The batch module is reachable and `groups` is read.
- The pane cannot approve text it is not showing: a group whose ids do not resolve
  refuses in `batchApproval`, and the header states how many are unaccounted for.
- Two runs' reports still exist and still differ; the pane now reads one of them
  consistently rather than mixing them.
- The host gate is untouched. Nothing here has been exercised in Word.

### Evidence

`src/word/documentObserver.ts`; `src/taskpane/findingGroups.ts`;
`src/taskpane/components/FindingGroupCard.tsx`;
`src/taskpane/components/FindingsList.tsx`; `src/taskpane/pages/Dashboard.tsx`;
`tests/unit/taskpane/findingGroups.test.ts` (15);
`tests/unit/taskpane/components/findingGroupCard.test.tsx` (12).

## ADR-0120 — The compliance verdict needs the findings, not just the coverage

### Context

The audit (§17) noted that three verdicts rendered and that "Compliant within
checked scope" was not expressible. It recorded this as a vocabulary gap. Reading
the code, it was a correctness gap wearing a vocabulary costume.

`CoverageBanner` derived its verdict from `DeterministicCoverage.complete` alone
and printed `Complete` when it was true. `complete` means "every scope the author
requested was examined". It says nothing about whether anything was found — the
coverage record does not carry findings at all.

So a run that examined every requested scope and produced two hundred open
findings printed `Complete`, and the word a reader takes from `Complete` is
"nothing to do". That is precisely the false-compliance claim the coverage model
exists to prevent (ADR-0066), reached by the one route the model was not guarding:
not by lying about coverage, but by reporting coverage and letting it be read as
compliance.

### Decision

A pure module, `taskpane/coverageVerdict`, derives four verdicts from the
coverage **and** the open-finding count:

- `unknown` — only the shared report arrived. It has no
  requested-versus-examined list, so no claim is available at all.
- `incomplete` — something the author made mandatory was not examined.
- `compliant` — everything requested was examined and nothing is open.
- `findings-open` — everything requested was examined, and there is work to do.

The compliant label is the full phrase **"Compliant within checked scope"**, not a
bare "Compliant". A document checked only for body text says nothing about the
tables it never looked at, and the qualifier is the difference between a bounded
claim and an over-claim.

`CoverageBanner` takes `openFindings` as a prop and the Dashboard passes
`openSummary.total` — the same ignore-filtered number the findings header prints,
so the banner and the list cannot disagree about what is left to do.

The verdict's detail sentence moved into the same module, replacing a hand-written
`Unknown` explanation that left the other three branches with none. Every branch
now names its own limit.

### Consequences

- A clean, fully-examined document and a fully-examined document with open work
  now read differently. That is the whole point.
- `incomplete` takes precedence over `findings-open`. A missing mandatory scope
  is the more important fact, and leading with a count would bury the reason the
  run cannot speak for the document.
- Three existing tests asserted the literal string `Coverage Complete`. Their
  claims were kept and the wording updated; one of them — "a host limitation is
  not a blocker" — is now asserted as _not_ `Incomplete` rather than as a
  particular positive label, which is what it was actually protecting.
- The pane still cannot claim more than it checked, and now says so in the
  verdict itself rather than only in the collapsed detail.

### Evidence

`src/taskpane/coverageVerdict.ts`; `src/taskpane/components/CoverageBanner.tsx`;
`src/taskpane/pages/Dashboard.tsx`;
`tests/unit/taskpane/coverageVerdict.test.ts` (15);
`tests/unit/taskpane/components/CoverageBanner.test.tsx`;
`tests/unit/taskpane/components/findingsListIntegrity.test.tsx`.

## ADR-0121 — A stylesheet scopes by the controls it owns, not by what it excludes

### Context

The reported defect (UX-4a): Dropdowns and TextFields on the profile pages
rendered light-on-dark while the surface around them followed the theme.

`taskpane.css` styled bare `input, select, textarea`. Every Fluent component
renders a real `<input>` underneath, so the rule landed on Fluent's own fields as
well. It was then scoped with `:not([class*="ms-"])` — excluding anything whose
class contains Fluent's internal prefix.

That second guard fails twice over, and the audit's own diagnosis is correct on
both counts:

1. **`ms-` is not a public contract.** It changes between Fluent versions, and a
   rename silently _widens_ the rule back onto every Fluent field — re-creating
   the original defect with no code change on our side.
2. **It cannot cover a Fluent component whose root is not an `<input>`.** A
   Dropdown's button, a Switch's internals and a SpinButton's buttons are never
   excluded, because the guard only ever asks about three element names.

### Decision

A deny-list is the wrong shape. The question is not "is this one of ours?" but
"is this ours?", and only the author of a control can answer that. So:

- Our own controls carry `.tf-native` (`src/taskpane/nativeField.ts`).
- The stylesheet rules are scoped to `.tf-native`.

A Fluent component is then excluded by construction — whatever it renders, and
whatever it names its classes — rather than by coincidence.

The marker is what makes the eventual Fluent migration (UX-4) safe: migration
removes controls from this set, and any control it forgets to migrate simply
stops being styled rather than starting to fight the theme.

### What is enforced, and where

`theme.test.ts` keeps the claim it always had — no bare-element rule may return,
Fluent's fields are never touched — but asserts it against the _selectors_
rather than the mechanism, with comments stripped. It previously pinned
`:not([class*="ms-"])` itself, so replacing the guard with something better
would have failed the test that was supposed to approve it.

`nativeFieldMarkers.test.ts` covers the half that test cannot: that every native
control in the task pane carries the marker, and that the rule's content is
theme-token-only. Between them, a control added without the marker fails, and a
hard-coded colour in the rule fails.

The marker was applied to 32 controls across three files by a script that parses
tag boundaries rather than matching attribute lines — a regex that cannot see
where a tag ends cannot distinguish a control from the `<input` inside a comment
or a string.

### Consequences

- A Fluent rename can no longer reach our controls, and our rules can no longer
  reach a Fluent component.
- A new native control that forgets the marker falls outside the rules: visibly
  unstyled rather than subtly wrong, and caught by a test.
- **The visual outcome is still unverified.** jsdom computes no styles, so
  `getComputedStyle` returns an empty background for a `.tf-native` input in the
  light and dark theme alike; a test written that way passes unconditionally and
  proves nothing. The manual check in `docs/manual-verification.md` has been
  rewritten to say so explicitly, and no green run may be reported as closing it.

### Evidence

`src/taskpane/nativeField.ts`; `src/taskpane/taskpane.css`;
`src/taskpane/components/DeterministicStyleSections.tsx` (32 controls);
`tests/unit/taskpane/nativeFieldMarkers.test.ts` (8);
`tests/unit/taskpane/theme.test.ts`; `docs/manual-verification.md` §4.

## ADR-0122 — Owned-control markers, and the selector-list assertion that keeps them honest

**Status:** Accepted. Supersedes nothing; amends ADR-0121, which was correct in
its principle and incomplete in its application.

**Context.** ADR-0121 replaced the stylesheet's `:not([class*="ms-"])` deny-list with
.tf-native, a marker on the controls we render. An independent audit of that work
(Phase 6a verification, 2026-10-03) found the principle right and the application

incomplete in two ways, neither of which any test could see:

1. **The selector list was never checked.** The edit deleted three
   `:not([class*="ms-"])` selectors out of the _middle_ of a four-entry list,
   leaving a dangling `button,` in front of `.tf-native`. The comment-stripped CSS
   read `button, .tf-native { font: inherit; background-color: ...; color: ... }`.
   Every test passed, because the assertions were `toContain(".tf-native {")` —
   and that text really was present. The rule still reached every `<button>` in the
   add-in, Fluent's `DefaultButton` and `IconButton` included. That is the
   reported symptom under a different selector.

2. **The same defect existed one element over, and was never addressed.** The four
   `button` rules were bare element selectors. Fluent v8 (8.125.7, verified
   installed) renders a real `<button>` for `DefaultButton`, `PrimaryButton`,
   `IconButton` and `Toggle`, so those rules were reaching into components this
   codebase does not own. Eighty buttons are rendered in the task pane.

On current Fluent, the bare rules _lose_ on specificity to Fluent's own class-based
rules, so nothing looked wrong. That is accidental safety, and it inverts the
moment stylesheet load order changes — the same accidental dependence ADR-0121
was written to remove.

**Decision.**

- Every control this codebase renders carries a marker it owns:
  `.tf-native` for fields, `.tf-native-button` for buttons. Separate classes,
  because a field is a surface with text on it and a button is a control with a
  border and a hover state; one class for both would force one to be styled as
  the other.
- The button rules are scoped to `button.tf-native-button`.
  `button:focus-visible` stays unscoped deliberately: a keyboard focus outline is
  correct on every focusable element in the pane, and removing it from a
  third-party component would be an accessibility regression.
- `nativeFieldMarkers.test.ts` asserts the **selector list**, not the presence of a
  fragment. It reads backwards from the opening brace to the nearest preceding
  `}` or `{`, which is what sees a whole list rather than the nearest fragment.
- It also asserts that no rule anywhere in the stylesheet paints a bare form
  element — scoped to rules declaring a colour, so a legitimate
  `input:focus-visible` outline is not flagged.
- It asserts every button carries the marker, and that the marker is _additive_: a
  control's own class (`tf-link-button`, `tf-collapsible-header`) survives beside it.

**Why presence assertions were not enough.** `toContain(".tf-native {")` tests
that a string appears somewhere in a file. It cannot distinguish a correct rule from a
correct rule with a stray selector welded to the front of it. This is recorded
because it is a general trap in stylesheet testing, not a one-off.

**Consequences.**

- Positive: the marker is now the single mechanism, and the failure mode it guards
  against is asserted in the shape that actually failed.
- Positive: the eventual Fluent migration (UX-4) removes controls from the marked set;
  a control it forgets simply stops being styled rather than fighting the theme.
- Cost: 80 buttons gained a class attribute. This is a one-time mechanical change
  with a regression test pinning it, and it is the cost of not styling components
  we do not own.
- **Still open:** jsdom computes no styles. These tests assert the rule, never the
  painted result. The visual confirmation remains a manual item in
  `docs/manual-verification.md`, and no green run closes the Word-host gate.

## ADR-0123 — Bulk-add for terminology, so the lossy second editor can go

**Status:** Accepted.

**Context.** The profile page carried **two editors for
`language.terminology`**: a row per rule in Language → Terminology, and a
`term: replacement` textarea in a separate House style panel. Two owners for one
field is the ND-2 defect in the UI rather than the schema — and the textarea is
the lossy one, because a line can express a substitution and none of `severity`,
`caseSensitive`, `wholeWord` or `scope`. `foldTerminology()` reconstructs what the
format cannot carry.

Removing the textarea is the correct fix and was authorised. It is only safe if
the row editor can accept a paste first, which is what this records.

**Decision.**

- **New module [`terminologyRows.ts`](../src/taskpane/terminologyRows.ts)** owns
  `newTerminologyRule`, `nextTermIds`/`nextTermId`, `planBulkTerms` and
  `buildBulkRules`. The local `nextTermId` in `DeterministicStyleSections` is
  deleted and the single-add button now calls the shared factory.

  The factory exists so the button and the paste _cannot_ drift. Written
  separately they would have spelled out the same defaults twice and eventually
  disagreed — and the symptom would have been findings the user did not expect
  from a term they added one way but not the other.

- **`planBulkTerms` is pure and separate from the mutation**, so the UI can
  state what a paste _would_ do before anything is written. A paste of two
  hundred lines is something a user should agree to.

- **Additive only.** A term already in the list is reported as skipped, never
  overwritten. A user pasting twenty lines who has already tuned three of them
  must not lose those three to a default the paste carries.

- **Matching is case-sensitive on the trimmed source.** "colour" and "Colour"
  stay distinct, because `caseSensitive` is a per-rule flag and a house may
  legitimately want both. Collapsing them is a product decision this function
  has no standing to make.

- **Reuses the existing shared parser**
  ([`terminologyText.ts`](../src/taskpane/settings/terminologyText.ts)), which was
  extracted precisely so a second implementation could not appear. No third
  format ships.

**Consequences.**

- Positive: S4 can delete the House style textarea without losing bulk editing.
- Positive: the pure module is tested directly — no jsdom, no Office, no React.
- Cost: a new product surface, so it carries its own tests and this record.
- **Not claimed:** jsdom cannot see the disclosure's appearance or the
  announcement's timing. The count text and the disabled state are asserted; how
  it looks in a 329px pane is a manual item.

## ADR-0124 — One owner per profile field, and coverage derived from the schema

**Status:** Accepted.

**Context.** D-1 (two Typography headings, one meaning) and D-2 (two editors for
one field) were found by reading the page, and S1–S11 fixed what that reading
found. What the reading could not do was answer the question that produced them:
_which fields have no control at all?_ That is not a question a human reading a
page can answer reliably, and it was not asked by any existing check.

The registry's orphan-setting assertion (ADR-0091) asks whether a **rule reads** a
field. It cannot ask whether a **control writes** one, because the rules live in
`src/rules/` and the controls in `src/taskpane/` — the architecture boundary keeps
them apart, correctly, and that boundary is also why the gap is invisible from
either side.

The cost was measurable. `TypographyRulesSchema` carries sixteen fields. Eight had
a control. The other eight — `normaliseWhitespace`, `flagTabs`,
`nonBreakingSpace`, `slashSpacing`, `currencySpacing`, `spaceBeforeParenthesis`,
`spaceAfterHyphen` — are each read by `typography.ts` and each produces a finding,
so they were settings a user could not reach: a house could not turn off the tab
check it was being flagged under. The section's own summary had promised them
("dashes, quotes, ellipses, and the whitespace and spacing conventions this house
prints in") since before the audit.

**Decision.**

- **One owner per field, and that owner is where the label is.** Where a field
  genuinely has two homes, one is normative and the other defers to it in
  language the page shows. `typography.percentageSpacing` is declared in both
  schemas; `numbers.percentageSpacing` is normative and the rule prefers it, so
  Language → Numbers owns the control and the Typography group **names where it
  lives** rather than staying silent. A second control would be ND-2 in the UI:
  two findings over one offset, which the planner then refuses.

- **Coverage is asserted from `TypographyRulesSchema.shape`, not from a list
  someone wrote.** The test compares its own field→label map against the schema's
  own keys, so a field added to the schema fails the test and is named, rather
  than silently widening the surface. This is the load-bearing part: the previous
  tests all named the controls they expected, which is why a new field was
  invisible to all of them.

- **The exemption list is itself tested.** An exemption that quietly grows is how
  a "no control exists" defect gets reclassified as intentional, so every exempt
  field must be reachable somewhere on the page _and_ named there.

- **The lint guard extends past colour to type and layout**
  ([`eslint.config.mjs`](../eslint.config.mjs)), and
  [`inlineType.test.ts`](../tests/unit/taskpane/inlineType.test.ts) asserts the same
  property independently of lint. Two rules would otherwise be one point of
  failure, and relaxing one would quietly reopen D-5.

**Consequences.**

- Positive: the "which fields are unreachable" question now has an answer that
  updates itself.
- Positive: `.tf-detail` and `.tf-inline-row` replaced eleven repeated inline
  style objects, three of which were byte-identical to each other.
- Cost: a schema change now fails a UI test. That is the intended coupling, but it
  means the exemption list is a place where a reviewer must look.
- Cost: the type ramp moves type from per-component data to the stylesheet, so a
  new control is a `className` and a CSS rule, not a value.
- **Still open:** migrating the page to Fluent's own controls (`Dropdown`,
  `TextField`, `Toggle`) is deliberately **not** done. Every other dropdown on the
  page is a native `EnumSelect`; converting one section would make Typography the
  odd one out, which is the complaint that started this work. It has to move
  everything at once, and it is a separate pass.
- **Not claimed:** jsdom computes no styles. Every assertion here is about a rule,
  a label or a written value. How the page looks at 329px in both themes is a
  human item in `docs/manual-verification.md`, and no green run closes the
  Word-host gate (ADR-0051).

## ADR-0125 — The house-style sentence-case toggle is deleted, not re-scoped

**Status:** Accepted.

**Context.** Phase 7 wrote a test that walks the profile schemas rather than
trusting `PROFILE_FIELD_PATHS`, and it found `houseStyle.capitalization.sentenceCase`
absent from every list. That prompted a check of what the field actually did, and
the answer was worse than an unreachable field:

- `ProfileEditor.tsx` rendered a toggle for it, labelled "House-style rule: flag a
  sentence that does not open with a capital letter".
- `houseStyle.ts` read it and built findings.
- **The registry discarded those findings.** `language/legacyTitleCase` calls
  `findHouseStyleIssues(...)` and then `selectCategories(..., ["houseStyle.capitalization.titleCase"])`.
  Sentence case is not in that list, so nothing it produced was ever emitted.
- The field was also missing from `PROFILE_FIELD_PATHS`, so §11 could not see it —
  not as wired, and not as orphaned. Both are the same silence.

So the toggle validated, persisted, displayed as authoritative, and produced
nothing a user could observe. That is ND-13, at the one place the audit had
previously declared itself clean.

**The S3 comment was wrong.** It said the two sentence-case fields were "live and
both are registered, so neither control can be deleted". That was verified from
the fact that a rule _read_ the field, which is not the same as anything emitting
it. The owner decision to keep both controls was taken on that incomplete premise
and is superseded here.

**Decision.**

- **The field, the rule and the toggle are deleted.** Sentence case is a house
  style enforced in headings; `language.capitalisation.headingCase` already
  enforces it there, and `language.capitalisation.sentenceCase` governs body
  prose. There is no third owner.
- **Re-scoping the rule to headings was rejected**, because that is precisely what
  `headingCase` does. Keeping both would put two findings on the same character,
  which is the conflict that made the planner refuse whole plans.
- **`houseStyle.spellingVariant` is now listed in both
  `PROFILE_FIELD_PATHS` and `METADATA_ONLY_PROFILE_PATHS`.** It was in neither.
  Its own comment said `METADATA_ONLY_PROFILE_PATHS` was "the place a field with
  no rule says so", while the list was empty — the decision existed as prose and
  nowhere a test could read.

**Consequences.**

- Positive: the profile no longer carries a sentence-case setting that governs
  nothing, and the Capital case defaults panel has one control that genuinely owns
  its field.
- Positive: `PROFILE_FIELD_PATHS` and `METADATA_ONLY_PROFILE_PATHS` are now
  checked against the schemas, so a field absent from both fails
  `profileBehaviour.test.ts` rather than passing unnoticed.
- Cost: a stored profile with `houseStyle.capitalization.sentenceCase` loses it on
  load. There are no users to migrate (owner decision), and Zod strips unknown
  keys, so no stored record can become unreadable.
- **Not claimed:** this removes a check that never ran. Nothing that worked
  before stops working; what is removed is a promise the product was not keeping.

## ADR-0126 — One owner per behaviour, enforced by guards rather than comments

**Status:** Accepted.

**Context.** The end-to-end review of the deterministic review process
(`plans/deterministic-review-end-to-end-review-findings.md`) found the same
defect class in four places: a behaviour with two owners, or a declaration that
over-claimed what the running engine did, kept honest only by a comment that
asserted a reconciliation the code did not perform.

- **F1 — currency symbol spacing.** `typography.currencySpacing` and
  `language.currency.symbolSpacing` both measured the gap between a currency
  symbol and its amount, both were correctable, and nothing reconciled them. The
  schema comment claimed `none` "defers to the currency profile, which is the
  normative source for money" — no such deference existed.
- **F2 — percentage spacing.** `typography.percentageSpacing` and
  `language.numbers.percentageSpacing` both targeted the same `50%` gap. Two
  comments stated the rules "are reconciled by the rule, which prefers the number
  profile's value when the two differ" — again, no such code.
- **F4 — registry declaration drift.** `language/currency`'s `analyze` filter
  listed a category no rule emitted; `emits` carried bare base categories no
  filter selected; and the registry's own comment claimed "the registry's own
  audit asserts that they do" — the audit asserted uniqueness and headline
  inclusion, never `emits`-equals-filter.
- **F3 — rule-read fields with no control.** `structure.maxHeadingLevel` and the
  named-style fields (`formatting.titleStyle`, `subtitleStyle`, `captions`,
  `headings.1–9`) were read by the analyzer and promised by section summaries,
  but had no editor control. `unwiredProfilePaths()` could not see them because
  it counts a rule's claim, not a control's reachability.

**Decision.**

- **The two-owner pairs are resolved by deletion, not by reconciliation.** The
  `typography.currencySpacing` and `typography.percentageSpacing` fields, their
  checks, their registry declarations and their controls are removed.
  `language.currency.symbolSpacing` and `language.numbers.percentageSpacing` are
  the single owners. This is the same resolution already applied to the decimal
  and thousands separators (ADR-0124), and it is preferred over implementing the
  claimed deference because a deference rule is a second code path that can
  itself drift; one owner cannot.
- **The false comments are deleted with the fields.** A comment that asserts a
  safety property the code does not provide is worse than no comment.
- **The registry's `emits` must equal the categories its `analyze` filter can
  return.** The four drifted declarations are corrected, and
  `ruleRegistry.test.ts` now asserts the equality rather than trusting the
  comment. A rule that emits a category its filter discards, or declares a
  category it cannot produce, fails the test.
- **The editor-coverage guard is the root-cause fix for F3.** Controls are added
  for `structure.maxHeadingLevel` and the named-style/heading fields, and the
  component test walks the profile's writable field set against the rendered
  controls — the same shape as `profileBehaviour.test.ts`, extended past the
  registry to the editor. A new rule-read field with no control now fails a test
  instead of surviving as a promise.
- **Dead modules are deleted.** `src/rules/registry.ts` (superseded by
  `src/analysis/deterministic/ruleRegistry.ts`) and `src/shared/utils/result.ts`
  (speculative, zero importers) are removed with their barrel re-exports and
  tests. `undoGroup` (production-dead; the Dashboard's `undoOne` bypasses it) and
  the `WORD_STYLE_MAPPING` re-export (no external importer) are removed too.

**Consequences.**

- Positive: the currency and percentage gaps have exactly one owner each, so the
  planner can no longer be handed two conflicting changes over one character —
  the ND-2 refusal that motivated the review.
- Positive: `emits`-equals-filter and editor-coverage are now assertions, not
  prose. The two guards close the class rather than the four instances.
- Positive: the exported surface no longer carries modules with no consumer.
- Cost: a stored profile with `typography.currencySpacing` or
  `typography.percentageSpacing` loses those keys on load. Zod strips unknown
  keys, so no stored record becomes unreadable, and the language-side fields
  remain the normative source.
- **Not claimed:** every finding is repository-side evidence (static analysis
  plus the jsdom/mocked suite). Nothing here ran in a real Word host;
  `word-host-evidence` stays `pending`.

## ADR-0127 — Dual-role LLM with gateway-routed credentials

- **Status**: Accepted (2026-10-08)
- **Context**: The LLM connector review found that the existing single-role
  provider model could not cleanly separate semantic/consistency operations
  from decision operations. The consistency engine needs a bounded-ambiguity
  adjudication model that is independent from the general semantic review
  model. A single shared connection forced a trade-off: either the decision
  model inherited the general model's provider (coupling two different
  responsibilities to one credential), or the user configured a separate
  provider (adding complexity for the common case where one provider serves
  both roles well).
- **Decision**: Implement a dual-role LLM architecture with gateway-routed
  connections. Two roles — `general` and `consistency_decision` — are bound
  separately in `llmRoleBindings` (state v15). Each role resolves to its own
  `ProviderConnection` through `llmRoles.ts`. A `reuseGeneral` toggle lets the
  decision role reuse the general connection's credential with a different
  model from the same provider. All remote requests are routed through the
  external gateway (`gatewayClient.ts`); no adapter holds a credential. The
  gateway client supports four auth modes: `oauth`, `deploymentManaged`,
  `brokerApiKey`, and `none`.
- **Consequences**:
  - Positive: the two roles are independent. The user can bind different
    providers, or reuse one provider with different models.
  - Positive: the reuse toggle works for any auth mode because the model is
    a per-request parameter, not a connection-level setting.
  - Positive: no credential is stored in persisted state. The
    `assertRoleSchemasAreSecretFree` reflection test enforces this.
  - Positive: the gateway is the single point of credential custody. The
    browser never sees a key.
  - Cost: two registries are built per session (one per role). This is a
    trivial overhead.
  - Cost: the `providerConnections` map is keyed by `connectionId`, requiring
    a migration from the old array-based storage (handled in v15 migration).
  - **Not claimed:** the OAuth flow is not exercised against a real provider.
    The development gateway stubs the callback. Live provider verification
    remains a human step.
- **Evidence**: `src/core/domain/LlmRole.ts`,
  `src/taskpane/settings/llmRoles.ts`,
  `src/taskpane/settings/providerComposition.ts`,
  `src/ai/gateway/gatewayClient.ts`, `src/ai/providers/registry.ts`,
  `scripts/dev-gateway.mjs`, `scripts/llm-smoke.mjs`.

## ADR-0128 — The developer toolchain moves to Node 26 LTS

- **Status**: Accepted (2026-10-09)
- **Context**: The repository pinned Node 20.18.1 via `.nvmrc`,
  `package.json` engines, and CI/release workflows. Node 20 entered
  maintenance-only in April 2026 and exits maintenance entirely in
  April 2027. The user asked whether the toolchain could move to a newer
  Node line, and specifically whether 26.x would be the better long-term
  choice over 24.x.
- **Decision**: Migrate the developer/CI/toolchain baseline to Node 26.
  A spike on the already-active Node 26.7.0 / npm 12.0.2 runtime proved
  the full verification graph passes (13/13 stages: typecheck, lint,
  format, secret-scan, docs, skills, test, coverage, build-artifacts,
  built-secret-scan, manifest, package, package-check), the sideload
  smoke test passes (the add-in loads in WebView2, serves all chunks,
  and navigates every page), and stderr shows zero EBADENGINE, zero
  DEP0040, zero DEP0169, zero ExperimentalWarning, and zero removed-API
  failures. The bare `localStorage` access in `src/core/state/persistence.ts`
  and `tests/setup.ts` was already guarded (getSafeStorage checks
  `typeof window !== "undefined"` and falls back to an in-memory Map;
  tests/setup.ts installs a polyfill when no browser storage is available),
  so the Node 22+ ExperimentalWarning is resolved at the source rather
  than suppressed. The clean-install check initially failed at the docs
  stage due to pre-existing dead links in `plans/*.md` referencing
  non-existent `plans/systematic review/` files (Node-version-independent,
  and would have failed identically on Node 20 or 24). Those links are now
  rewritten as code spans/prose, and the typecheck stage's
  `Array.prototype.at` usage (ES2022) is satisfied by raising
  `tsconfig.json` `target`/`lib` from ES2020 to ES2022; the clean-install
  check now passes.
- **Consequences**:
  - Positive: Node 26 is planned to become Active LTS in October 2026 and will receive
    security fixes through April 2031, giving a longer support runway
    than Node 24 (Active LTS October 2025, maintenance April 2028).
  - Positive: the full graph passes with zero warnings on Node 26,
    proving no toolchain regression.
  - Positive: the add-in runtime is Word's WebView2 (browser), not Node —
    this migration affects only the developer/CI toolchain.
  - Cost: developers must have Node 26 installed; `.nvmrc` and engines
    now enforce this.
  - **Not claimed**: the Word-host gate remains open; a green automated
    clean-install run is not a release (ADR-0051).
- **Evidence**: `.nvmrc` → `26.7.0`; `package.json` engines →
  `>=26.0.0`; `@types/node` → `^26.0.0`; `.github/workflows/ci.yml`
  matrix → `[26.x]`; `.github/workflows/release.yml` → `26.x`;
  `docs/onboarding.md` prerequisites updated; `tsconfig.json`
  `target`/`lib` → ES2022; dead links removed from
  `plans/indexed-consistency-authoritative-plan.md`,
  `plans/llm-connector-revised-implementation-plan.md`,
  `plans/llm-settings-due-diligence-plan.md`, and
  `plans/semantic-review-systematic-implementation-plan.md`; spike run
  2026-10-09.
