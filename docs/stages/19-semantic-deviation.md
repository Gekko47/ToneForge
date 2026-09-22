# Stage 19 — Semantic deviation

**Gate**: Yes

## Objective

Add the semantic style deviation engine.

## Scope

- `src/analysis/deviationEngine.ts` — `detectSemanticDeviations(targetText, profile, opts)` uses `LlmRegistry` (`registry.deviations`) to detect semantic deviations from the profile.
- Uses `buildDeviationPrompt()` plus `DeviationResponseSchema` from `src/ai/prompts/profilePrompts.ts` with the `includeRawText: true` opt-in gate.
- Retry via `withRetry()`; caller abort non-retryable, `LlmError` retryable honored.
- Maps each validated deviation to a `Finding` with `kind: "semantic"`, `category: "semantic-deviation"`, full-text character range, severity mapping (low→info, medium→warning, high→error), `confidence: 0.7`, `evidence` from deviation text, fresh `uuidv4()` IDs. Invalid entries skipped, never fatal; invalid JSON and non-array responses throw.
- Empty target text short-circuits to `[]` without calling the provider.
- Tests use `MockAdapter` only, never live network.
- `src/analysis/index.ts` barrel re-exports the engine; output feeds `unifyFindings({ semantic })`; Stage 17 planner preserves semantic findings without forced change mapping.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (10 engine tests + full 411-test suite)
- [x] `docs/project-state.md` updated

## Status

PASS — engine implemented with mock-only tests; no live LLM key required for the gate.
