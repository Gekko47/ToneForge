# Stage 09 — Deterministic metrics

**Gate**: Yes

## Objective

Add deterministic style metrics from captured samples.

## Scope

- `src/style/metrics.ts` — sentence length, dash frequency, quote frequency, paragraph metrics.
- Pure functions, no Office or LLM imports.
- Tests under `tests/unit/style/`.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (11 unit tests added)
- [x] `npm run verify` passes (typecheck → lint → format → test → build → manifest validate)
- [x] `docs/project-state.md` updated

## Status

PASS — `src/style/metrics.ts` derives a `MeasuredProfile` from a sample string: sentence length mean/stddev, em/en dash and curly-quote frequencies per 100 words, paragraph length average, capitalization consistency, and sample word count. Pure functions reusing `shared/utils/text` helpers; no `Office`/`ai`/`ui` imports. 11 unit tests under `tests/unit/style/` cover empty, single-sentence, dash/quote frequencies, paragraph metrics, stddev, capitalization, and determinism. `@vitest/coverage-v8` added to `devDependencies`; `metrics.ts`, `sampleCapture.ts`, and `sampleQuality.ts` each report 100% lines/statements/functions/branches, exceeding the 80% stage-gate threshold for `style/`.
