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

## ADR-0033 — Release remains blocked on coverage and host evidence

- **Status**: Accepted (2026-09-24)
- **Context**: Automated checks cannot prove real Word behavior, and the global
  coverage threshold currently fails.
- **Decision**: Keep Stage 27 partial and Stage 28 blocked until the host matrix
  is complete. Keep Stage 26 blocked until global coverage passes or an explicit
  governance decision changes the gate. Unsupported capabilities use safe
  no-ops, disabled states, or documented limitations.
- **Consequences**: The repository may contain a release candidate, but it is
  not release-ready. Phase H remains reserved and separate.
- **Evidence**: `npm run test`, `npm run test:coverage`,
  `docs/manual-verification.md`, `scripts/release-check.mjs`, and
  `docs/project-state.md`.
