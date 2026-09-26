# ToneForge — Changelog

## 0.2.0 — Refactor candidate (unreleased)

- Added additive domain contracts for structured document nodes, governance
  profiles, review requests, and enriched findings/changes/plans.
- Phase 0 adds a first-run profile setup state, conservative observer-rescan
  finding retention, scope-qualified coverage semantics, stable versioned
  ignored-finding fingerprints, user-visible navigation feedback, and safe
  clearing of blank optional broker settings.
- Phase 0 makes ReformatPanel preview-only and leaves one reviewed-plan
  Apply/Reject workflow in Pending Changes; technical coverage diagnostics are
  isolated to Troubleshooting.
- Phase 1 adds `ResolvedPolicy` so learned style evidence and normative governance
  are resolved once for analysis and planning, and always capture a policy
  revision for safe apply.
- Phase 1 adds the Learn Style service and Profile entry point: selection/document
  capture, sample-quality gating, deterministic evidence, optional consented
  semantic interpretation, and an editable persisted draft.
- Phase 2 adds capability evidence tiers, a WordApi 1.6 paragraph
  added/changed/deleted event adapter with deregistration and conservative
  fallback, and the B23 workflow projection store with task-first status and
  finding previous/next navigation.
- Added state schema v5 with v0-v4 fallback migration, initial governance-profile
  seeding, governance-history snapshots, and current-policy revision enforcement.
- Added single-pass Word paragraph/style acquisition, explicit structural
  coverage diagnostics, protection, rule registry, source navigation, and a
  debounced observer with conservative full-rescan fallback.
- Added Word-native ribbon/task-pane governance surfaces, consent-gated spot
  review, bounded full-document review, UI states, and coverage-gated exports.
- Added safe-apply preservation/dependency/protection checks, post-apply hash
  verification, command-action registration, absolute AI ranges, bounded review
  batches with freshness re-checks, release staging, and release gates.
- Phase 4 adds the provider-neutral connection contract. The add-in persists only
  an opaque connection reference; the live session token is held in memory for
  the pane's lifetime and `SessionTokenStore` has no serialization method at all.
  `ProviderConnectionSchema` has no field capable of holding a secret, and a test
  reflects over the schema to keep it that way.
- **Breaking:** the `apiKey` credential mode is removed. Every remote provider is
  routed through `GatewayRoutedAdapter`; OpenAI, Anthropic, and OpenRouter now
  share one connection contract and differ only in request/response shape.
- The gateway client accepts only a same-origin path or a loopback HTTP(S)
  origin, so no Settings field can name an arbitrary host. A production origin is
  build-time configuration.
- Added an OAuth state machine with single-use attempts and per-attempt state,
  nonce, origin, and expiry validation. OpenAI user OAuth is feature-gated rather
  than presented as generally available, because it is not.
- State schema v8 adds a provider-neutral `providerConnections` map and widens the
  persisted provider enum to all four providers. The v7 migration derives
  loopback-only connections, preserves every consent decision, and drops a
  connection filed under the wrong provider.
- Added a dynamic model catalog normalizer that prefers the _enforced_
  `top_provider` context limit over the advertised one, derives capability flags
  from `supported_parameters`, and distinguishes empty, stale, failed, and
  offline catalogs.
- Added OpenRouter as a provider option. The API key is held in component state
  only, submitted once to the local gateway over the existing loopback
  nonce-protected channel, and dropped when the request settles; the base URL is
  prefilled with `https://openrouter.ai/api/v1` and the model dropdown is
  populated from the provider's own model list.
- Automated verification now writes `build/verification/summary.json` on success
  **and** failure, classifying each stage as `repository-code`,
  `dependency-install`, `build-package`, or `external-evidence`. The human
  Word-host gate is recorded as always open and cannot be marked passed by a
  caller, so an all-green run is never reported as a release.
- Added `npm run host:matrix`, which generates a release dashboard from the host
  matrix. It maps an unrecorded cell to `unknown` rather than a pass, flags
  evidence older than 90 days, and reports 4 hosts with 0 fully passing.
- Added production manifest generation that refuses non-HTTPS, loopback,
  private-network, local-hostname, non-standard-port, development-broker, and
  credential-shaped origins. The checked-in manifest stays on localhost so
  `npm run sideload` is unaffected.
- Bundle sentinel builds now cover five credential shapes (OpenAI key, OAuth
  client secret, PKCE verifier, OpenRouter key, Anthropic key) and prove none of
  them reach either the development or production bundle.
- Fixed: a failed disconnect left a usable session credential in memory; the
  registry silently fell back to the offline mock even when given a valid
  connection; state migration accepted a connection filed under the wrong
  provider; and the verification summary would have accepted a caller-supplied
  pass for the human host gate.
- Phase 5 implements the cross-report consistency engine that the ROADMAP had
  reserved as Phase H. Per ADR-0052 it is a **separate** engine with its own
  pipeline, its own third consent, and its own opt-in — never the typing path,
  never the observer. This supersedes both the plan's Phase 5 instruction to
  "keep C1-C10 deterministic" and the ROADMAP's "Phase H reserved until
  release", on the release authority's direction.
- Added ten cross-report checks (C1-C10) over a whole-document snapshot:
  terminology drift, numeric contradiction, temporal conflict, entity attribute
  conflict, definitional conflict, unit inconsistency, status contradiction,
  reference conflict, section promise mismatch, and scope contradiction. Each
  narrows deterministically first; only the residue reaches the model.
- A candidate conflict is a distinct type from a finding. Only a deterministic
  resolution or a `contradiction` verdict promotes it, an unreadable model
  answer is `unclear` at confidence 0, and a run against a document that has
  since changed is discarded rather than reported.
- The engine reports its own coverage. Pairwise comparison is bounded at 400
  statements, the bound appears in the report as a limitation, and a partial
  result is labelled as such in both the panel and the summary line.
- `consistency` was added to `FindingKind`, so a consistency finding is planned,
  gated, and applied through exactly the same path as every other finding. It
  has no privileged route to the document.
- State schema v9 adds `settings.consistencyReviewConsent`, a fourth consent
  flag that is never inherited from the other three. The v8 migration sets it to
  `false` rather than deriving it, and all four consent flags are now re-derived
  from strict booleans on load, so a persisted `"yes"` reads as a refusal.
- Fixed: `compareDates` reported a month-only date as _the same date_ as a
  precise one in that month, a false negative that read as a decision; C4's
  proper-noun entity anchor was being discarded by the generic vocabulary
  threshold before it could run; C8 did not recognise `Smith (2019)`, the most
  common citation form, leaving it inert on most real text; C10 detected
  narrowing only through conjunctions and missed the negation that does the
  actual work in "however three are not yet"; and `normalizeSettings` spread raw
  persisted values over the defaults, so a stored non-boolean in a consent field
  would have read as permission.
- The ten checks are **unvalidated heuristics**. They have not been calibrated
  against a real corpus and will produce false positives on real prose. The
  engine has never been run against a real document or a real model; all
  evidence is unit tests and `MockAdapter`.
- Automated verification uses the shared `toneforge-repository-v1` graph for
  typecheck, lint, format, source/artifact secret scans, documentation links,
  skills validation, tests, 80% exercised-core coverage, build, manifest
  validation, staging, and coherent release-package checks. The current run
  passes 100 files / 1109 tests with 93.8% lines, 93.8% statements, 81.29%
  functions, and 82.95% branches.
- Phase 6 is HELD pending further testing. The dependency-upgrade decision
  recorded in `docs/privacy-security.md` is a prerequisite for resuming it.
- Phase 3 adds the organizational profile record: one editable draft, immutable
  published versions, explicit activation, restore-as-draft, and discard, plus
  an append-only revision audit trail that keeps the newest 20 revisions and
  never drops a published one.
- State schema version 7 makes that record the single source of truth. It
  replaces `profiles`, `profileHistory`, and `profileLifecycles` with one
  `profileRecords` map, so the previously duplicated views can no longer
  disagree. The v6 migration folds the edit trail and the approval trail into
  non-colliding revision numbers, so no approved state is discarded.
- Profile revisions are plain integers rather than semver, and every audit event
  — including publishing — consumes its own number. A `ChangePlan` now cites the
  exact revision it was built from, and restoring an old snapshot can no longer
  forge a revision because the record assigns the number on save.
- Phase 3 splits Settings into independently-saved Styling, Provider and
  privacy, and Telemetry sections over a pure settings model, so a failed save
  in one section cannot discard unsaved edits in another.
- Phase 3 adds side-by-side profile revision comparison with progressive
  disclosure of the technical diff, a reduced-noise announcement hook that
  collapses bursts into one live-region message, and narrow-width and
  reduced-motion styles.
- Hardened planning with complete document identity, unit-aware targets, change
  preconditions, source/approval lineage, exact AI source slices, fail-closed
  Apply readiness, and credential-free ordinary state.
- Kept `manifest.xml` as an explicit `ShowTaskpane` navigation fallback while
  `manifest.json` remains the execute-function manifest; parity validation checks
  their documented command identities, labels, and destinations rather than
  claiming equivalent action mechanisms.
- Hardened production bundling with a separate runtime chunk, vendor/common
  splitting, dependency cleanup, and a 600 KiB asset/initial-page budget enforced
  by `npm run build:check` without suppressing Webpack diagnostics.
- Release acceptance remains blocked by the external Word host matrix and
  live performance/accessibility/security/provider/production-custody evidence; see
  [`ROADMAP.md`](../ROADMAP.md) for canonical status.

## 0.1.0 — 2026-09-19 — Scaffold

- Repository baseline and production-ready scaffold.
- Unified JSON manifest v1.30 and XML fallback.
- Core domain model, state persistence, provider abstraction, Word boundary, and
  task-pane shell.
- TypeScript, Webpack, Vitest, ESLint, Prettier, Husky, commitlint, and CI.
- Architecture, onboarding, privacy, accessibility, project-state, and decision
  records.
