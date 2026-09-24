# Stage 18 — Revision adapter

**Canonical status:** see the Stage 18 row in [`ROADMAP.md`](../../ROADMAP.md).

## Objective

Maintain the single native Word mutation path for validated `ChangePlan` objects.

## Implemented

- `runInWord()`-based adapter with the Stage 01 capability gate.
- Whole-body range plus `range.set({ start, end })` absolute offset resolution.
- Per-kind capability enforcement and per-change isolation.
- Stale hash, range, payload, conflict, dependency, protection, and
  preservation validation.
- Reverse-offset application with tracking management, live structured-node
  protection checks, post-apply hash verification, and honest fallback
  reporting.
- Live desktop smoke evidence for gate refusal and tracked text insert/replace.

## Verification

- [x] Unit and integration tests pass.
- [x] Desktop Word smoke results are recorded in
      [`docs/manual-verification.md`](../manual-verification.md).
- [x] The adapter is the only module permitted to mutate Word.
- [ ] Fresh-document live check for insert-versus-replace range semantics.
- [ ] Live break, style, list, and formatting path verification.
- [ ] Complete host matrix in Stage 27.

## Status

**PASS WITH DOCUMENTED LIMITATION** for the live text path. Break/style/list/
format paths and the complete host matrix remain qualified; the canonical
status and release consequences are in [`ROADMAP.md`](../../ROADMAP.md).
