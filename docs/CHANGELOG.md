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
- Automated verification uses the shared `toneforge-repository-v1` graph for
  typecheck, lint, format, source/artifact secret scans, documentation links,
  skills validation, tests, 80% exercised-core coverage, build, manifest
  validation, staging, and coherent release-package checks. The Phase 0 run
  passes 73 files / 693 tests with 92.90% lines, 92.90% statements, 83.75%
  functions, and 81.53% branches.
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
