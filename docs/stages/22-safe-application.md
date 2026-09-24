# Stage 22 — Safe application

**Canonical status:** see the Stage 22 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Prevent stale or conflicting plans from being applied without explicit review
and confirmation.

## Implemented

- Live re-hash before apply in the orchestrator.
- Conflict refusal unless explicitly acknowledged.
- Adapter defense-in-depth for conflicts, dependencies, protection, and
  preservation.
- Preview/confirm/apply workflow in `ReformatPanel`.
- Integration tests for stale, conflict, and explicit acknowledgment paths.

## Verification

- [x] Typecheck, lint, format, tests, build, and manifest validation pass.
- [x] Stage 22 integration tests pass.
- [x] UI path uses the orchestrator boundary and does not import the adapter.
- [ ] Complete host-specific verification of preview → confirm → apply.

## Status

**PASS** for the original safe-application scope. The canonical release
qualifications are recorded in [`ROADMAP.md`](../../ROADMAP.md).
