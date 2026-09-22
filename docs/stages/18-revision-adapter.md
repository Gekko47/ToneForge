# Stage 18 — Revision adapter

**Gate**: **Hard**

## Objective

Add the native Word revision adapter — the single mutation path.

## Scope

- `src/word/revisionAdapter.ts` — apply `ChangePlan` to Word via `runInWord()` (`Word.run` in production, legacy `Office.run` test-double fallback).
- Each change is attempted independently; failures are collected, never fatal.
- `validatePlanBeforeApply` — pre-flight validation (docHash, empty changes, stale flag, per-change range bounds, per-kind payload requirements).
- `getRangeByOffset` — offset-to-Range mapping via `body.getRange("Whole")` plus `range.set({ start, end })` (WordApiDesktop 1.4) with bounds validation.
- `setStage01Passed(true)` requires a verified `WordCapabilities` snapshot; per-kind capability enforcement (`supportsInsertText`, `supportsReplaceText`, `supportsInsertBreak`, `supportsStyles`).
- Changes applied in reverse offset order to preserve planner offsets for non-overlapping changes.

## Critical ordering rule

**Do not build the full reformatter before proving native Word revision behavior.**

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [ ] Adapter runs inside Word without unhandled exceptions
- [ ] Live results recorded in `docs/manual-verification.md`
- [x] `docs/project-state.md` updated

## Status

PARTIAL — automated verification is complete (typecheck, lint, 37 mock tests, build, manifest validate), but the live in-Word smoke test remains pending (human-only; cannot pass in CI).
