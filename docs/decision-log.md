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
- The engines are untouched: [`spotReview`](../src/ai/review/spotReview.ts) and
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
