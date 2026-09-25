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
