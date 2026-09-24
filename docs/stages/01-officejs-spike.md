# Stage 01 — Office.js capability spike

**Canonical status:** see the Stage 01 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Verify the Word host capabilities required by the product before relying on
mutation and review paths.

## Scope

- Non-destructive `probeWordCapabilities()` in
  [`src/word/capabilityProbe.ts`](../../src/word/capabilityProbe.ts).
- Probe text insertion/replacement, paragraph insertion, breaks, styles,
  tracking manageability, selection, paragraph resolution, highlight, and
  context-menu signals.
- Record host identity/version and results in
  [`docs/manual-verification.md`](../manual-verification.md).

## Verification

- [x] Probe and failure-injection tests pass.
- [x] Task pane loads and diagnostics render.
- [x] Desktop Word probe and tracked text smoke are recorded.
- [ ] Web Chrome host matrix is recorded.
- [ ] Web Edge host matrix is recorded.
- [ ] Mac host matrix is recorded if Mac is a release commitment.
- [ ] Phase C/E capabilities and observer events are re-probed.

## Status

**PASS WITH DOCUMENTED LIMITATION** for the original desktop text path. The
full host matrix and newer refactor capabilities remain open; the canonical
ledger is [`ROADMAP.md`](../../ROADMAP.md).
