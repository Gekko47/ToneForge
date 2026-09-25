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
