# Stage 08 — Style sample

**Gate**: Yes

## Objective

Add writing sample capture from the active Word document or clipboard.

## Scope

- `src/style/sampleCapture.ts` — capture sample text from selection or document.
- `src/style/sampleQuality.ts` — validate sample length and quality.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (15 unit tests added)
- [x] `npm run verify` passes (typecheck → lint → format → test → build → manifest validate)
- [x] `docs/project-state.md` updated

## Status

PASS — `src/style/sampleCapture.ts` captures a sample from a selection string + `DocumentSnapshot` DTO (selection-preferred, `maxChars` bounded) plus a `captureFromText` clipboard fallback; `src/style/sampleQuality.ts` gates on word/sentence counts. Both modules are pure (no `Office`/`ai`/`ui` imports) and accept DTOs only; tests under `tests/unit/style/` run without Word.
