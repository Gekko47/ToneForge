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
  `src/taskpane/components/ProviderPrivacySettingsSection.tsx`,
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

- `src/analysis/consistency/contracts.ts` — the ten check IDs and the consent gate
- `src/analysis/consistency/checks/` — one pure module per check
- `src/analysis/consistency/engine.ts` — the pipeline
- `eslint.config.mjs` — the documented `ai/providers` exception for this directory
- `tests/unit/analysis/consistency/`

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
  [`ProviderPrivacySettingsSection.tsx`](../src/taskpane/components/ProviderPrivacySettingsSection.tsx),
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
