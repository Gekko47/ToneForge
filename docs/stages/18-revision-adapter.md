# Stage 18 — Revision adapter

**Gate**: **Hard**

## Objective

Add the native Word revision adapter — the single mutation path.

## Scope

- `src/word/revisionAdapter.ts` — apply `ChangePlan` to Word via `Office.run`.
- Each change is attempted independently; failures are collected, never fatal.
- `validatePlanBeforeApply` — pre-flight validation.

## Critical ordering rule

**Do not build the full reformatter before proving native Word revision behavior.**

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [ ] Adapter runs inside Word without unhandled exceptions
- [ ] Live results recorded in `docs/manual-verification.md`
- [x] `docs/project-state.md` updated

## Status

PARTIAL — automated verification is complete, but the live in-Word smoke test remains pending.
