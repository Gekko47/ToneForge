# Stage 27 — Manual Word verification

**Canonical status:** see the Stage 27 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Record real Word host behavior for the current release candidate and the
refactor candidate.

## Evidence recorded

Desktop Word evidence is recorded in
[`docs/manual-verification.md`](../manual-verification.md), including:

- non-destructive capability probing;
- tracked text insert/replace smoke;
- explicit gate refusal and enablement;
- tracking restore and recorded counts;
- known break/style/host-version limitations.

## Required remaining checks

- [ ] Word on the web, Chrome.
- [ ] Word on the web, Edge.
- [ ] Word on Mac, if Mac is a release commitment.
- [ ] Phase C ribbon, task-pane navigation, findings navigation/highlight, and
      context-menu behavior.
- [ ] Phase D selection/paragraph review consent and failure states.
- [ ] Phase E full-document preflight, bounded batches, cancellation, and result
      handling.
- [ ] Observer event/change-range behavior in each supported host.
- [ ] Breaks, styles, protection, comments, fields, and unsupported paths.

## Current status

The stage is **PARTIAL**. Desktop evidence is present, but the full host matrix
is not. The matrix and interpretation are maintained in
[`docs/manual-verification.md`](../manual-verification.md); this page is only
the stage gate summary.
