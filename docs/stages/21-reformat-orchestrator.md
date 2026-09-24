# Stage 21 — Reformat orchestrator

**Canonical status:** see the Stage 21 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Provide the production taskpane-safe composition point for snapshot → analysis →
planning → preview or tracked apply.

## Implemented

- [`src/reformat/orchestrator.ts`](../../src/reformat/orchestrator.ts) delegates
  analysis and planning and never mutates Word directly.
- Preview/no-change, empty-text, stale, gate, abort, semantic opt-in, formatting
  snapshot reuse, tracking fallback, and live re-hash/conflict flows are tested.
- [`src/word/revisionAdapter.ts`](../../src/word/revisionAdapter.ts) remains the
  sole mutation path.
- Deprecated smoke helpers remain only for reproducible historical verification.

## Verification

- [x] Typecheck, lint, format, tests, build, manifest validation, and stage
      verification pass in the audit run.
- [x] Stage 21 integration tests pass.
- [x] Stage 22 live re-hash and conflict refusal are integrated.
- [ ] Confirm the final release decision for the deprecated smoke panel.

## Status

**PASS** for the original orchestrator. The authoritative current status and
open work are in [`ROADMAP.md`](../../ROADMAP.md).
