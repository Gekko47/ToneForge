# Stage 26 — Test/review

**Canonical status:** see the Stage 26 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Complete the regression and review pass for the current implementation and the
uncommitted refactor candidate.

## Implemented in the current worktree

- Unit and integration coverage for the observer, structured snapshots, coverage,
  protection, registry, state v3, review pipeline, batcher, consolidator, export,
  safe-apply validation, navigation, and Phase C/F UI states.
- AI tests use `MockAdapter`; no live network is required.
- The full test run passes 58 files and 593 tests.

## Verification

- [x] `npm run test` passes.
- [x] Targeted review, observer, safe-apply, and UI tests pass.
- [ ] `npm run test:coverage` passes the global 80% threshold.
- [ ] Complete final code review of the uncommitted worktree candidate.
- [ ] Complete release acceptance evidence.

## Current blocker

The global coverage command fails at 43.13% lines/statements, 66.60% functions,
and 76.95% branches. This is recorded as a release blocker rather than hidden
by changing the threshold. The canonical status and remediation sequence are in
[`ROADMAP.md`](../../ROADMAP.md).
