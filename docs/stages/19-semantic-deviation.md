# Stage 19 — Semantic deviation

**Gate**: Yes

## Objective

Add the semantic style deviation engine.

## Scope

- `src/analysis/deviationEngine.ts` — `detectSemanticDeviations(targetText, profile, opts)` uses `LlmRegistry` (`registry.deviations`) to detect semantic deviations from the profile.
- Uses `buildDeviationPrompt()` plus `DeviationResponseSchema` from `src/ai/prompts/profilePrompts.ts` with the `includeRawText: true` opt-in gate.
- Retry via `withRetry()`; caller abort non-retryable, `LlmError` retryable honored.
- Maps each validated deviation to an advisory, non-actionable `Finding` with `kind: "semantic"`, category `semantic-deviation`, AI provenance, medium risk, full-text character range, severity mapping, `confidence: 0.7`, evidence, and a fresh ID. It does not invent a precise span or make a vague full-document deviation actionable. Invalid entries are skipped; invalid JSON and non-array responses throw.
- Empty target text short-circuits to `[]` without calling the provider.
- Tests use `MockAdapter` only, never live network.
- `src/analysis/index.ts` barrel re-exports the engine; output feeds `unifyFindings({ semantic })`; Stage 17 planner preserves semantic findings without forced change mapping.

## Verification

- [x] `npm run typecheck` passes
- [x] `npm run test` passes (10 engine tests + full 411-test suite)
- [x] `docs/project-state.md` updated

## Status

PASS for the original mock-only engine and the current repository-side
provenance correction. Full-document deviations remain advisory until a local
source span is verified; the bounded spot/full review path requires exact source
slices. No live provider, network, or Word-selection evidence is claimed. Live
provider and host certification remain external release gates in
[`ROADMAP.md`](../../ROADMAP.md).
