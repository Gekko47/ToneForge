# Stage 04 — Domain model

**Gate**: Yes

## Objective

Define the canonical domain types: `StyleProfile`, `Finding`, `ChangePlan`, `Change`.

## Scope

- `src/core/domain/StyleProfile.ts` — measured, semantic, typography, house style, version.
- `src/core/domain/Finding.ts` — unified finding model.
- `src/core/domain/ChangePlan.ts` — change plan with conflict/stale checks.
- `src/core/domain/Change.ts` — atomic change request.
- `src/core/domain/index.ts` — barrel export.
- Tests under `tests/unit/core/domain/`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes
- [x] `docs/project-state.md` updated
- [x] `docs/decision-log.md` updated

## Status

PASS — payload/adapter mismatch closed: `SetCharacterFormatPayloadSchema` now
allows `name`/`size`/`color` plus `bold`/`italic`/`underline`, matching the
revision adapter. Barrel re-exports `ChangePayloadSchema`.
