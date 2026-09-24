# ToneForge — Changelog

## 0.2.0 — Refactor candidate (unreleased)

- Added additive domain contracts for structured document nodes, governance
  profiles, review requests, and enriched findings/changes/plans.
- Added state schema v3 with v2/v1 fallback migration and governance profile
  persistence.
- Added coverage, protection, rule registry, source navigation, and incremental
  observer foundations.
- Added Word-native ribbon/task-pane governance surfaces, consent-gated spot
  review, bounded full-document review, UI states, and coverage-gated exports.
- Added safe-apply preservation/dependency/protection checks, post-apply hash
  verification, command-action registration, absolute AI ranges, bounded review
  batches with freshness re-checks, release staging, and release gates.
- Automated verification passes typecheck, lint, format, secret/docs scans,
  tests, 80% core coverage, build, manifest validation, and staging checks.
- Release acceptance remains blocked only by the external Word host matrix and
  live performance/accessibility/security evidence; see
  [`ROADMAP.md`](../ROADMAP.md) for canonical status.

## 0.1.0 — 2026-09-19 — Scaffold

- Repository baseline and production-ready scaffold.
- Unified JSON manifest v1.30 and XML fallback.
- Core domain model, state persistence, provider abstraction, Word boundary, and
  task-pane shell.
- TypeScript, Webpack, Vitest, ESLint, Prettier, Husky, commitlint, and CI.
- Architecture, onboarding, privacy, accessibility, project-state, and decision
  records.
