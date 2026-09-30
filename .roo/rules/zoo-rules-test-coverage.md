---
name: toneforge-test-coverage
description: Meet per-module test coverage expectations and mirror source structure in tests for deterministic and semantic engines.
---

# Test Coverage

Tests must mirror the source tree, use the right mocks per engine type, and
meet coverage expectations beyond the global 80% floor.

## When to use

- Writing tests for a new feature or module.
- Debugging coverage failures or missing tests.
- Adding fixtures or integration tests.

## Rules

### 1. Mirror the source tree

Tests live under `tests/` mirroring `src/`:

```
src/word/documentReader.ts  →  tests/unit/word/documentReader.test.ts
src/ai/providers/registry.ts → tests/unit/ai/providers/registry.test.ts
```

- Unit tests for pure functions go in `tests/unit/`.
- Cross-module tests go in `tests/integration/`.
- Shared fixtures go in `tests/fixtures/`.

**Evidence:** `toneforge-testing` skill "Test structure";
`vitest.config.ts` `include: ["tests/**/*.test.{ts,tsx}"]`.

### 2. Mock per engine type

- **Deterministic engines** (rules, formatting, style/metrics): test directly.
  Do not mock Office or LLM — if you need the mock, the function is not pure.
- **Semantic engines** (analysis, profiling, deviation): always use
  `MockAdapter` (`{ provider: "mock" }` in `LlmRegistry`/`createLlmRegistry`).
  Never hit the live network in tests.
- **Word-boundary modules**: use the `Office` mock from `tests/setup.ts`
  (minimal `run`, `roamingSettings`, `InsertBreakBehavior`).
- `vitest.config.ts` sets `mockReset: true`, `clearMocks: true`,
  `restoreMocks: true` — re-establish `vi.fn()` behavior per test.

**Evidence:** `tests/setup.ts`; `toneforge-testing` skill "Mocking Office" and
"Deterministic vs. semantic"; `vitest.config.ts` lines 24-26.

### 3. Meet coverage thresholds

Global thresholds in `vitest.config.ts` (v8 provider): 80% lines, statements,
functions, and branches, with no per-directory overrides. The `include` list is
`src/analysis`, `src/changes`, `src/core`, `src/formatting`, `src/reformat`,
`src/rules`, `src/shared`, `src/style`, `src/word`, `src/ai`, and
`src/commands`.

- Treat 80% as a stage-gate expectation for new modules, not a Vitest config
  override.
- If a module legitimately cannot reach 80%, do not lower the threshold and do
  not add an override. Document the gap in `docs/project-state.md` as "PASS WITH
  DOCUMENTED LIMITATION".
- If coverage collapses unexpectedly, check for case-duplicated paths first —
  that defect previously halved the global figure (ADR-0034).

**Evidence:** `vitest.config.ts`.

### 4. Use shared fixtures, not inline test data

Reusable test data (sample documents, sample profiles) lives in
`tests/fixtures/sampleDocs.ts`. Import it instead of duplicating data inline.

**Evidence:** `tests/fixtures/sampleDocs.ts`; `toneforge-testing` skill
"Mocking Office".

## Referenced resources

- `vitest.config.ts` — runner, coverage, aliases
- `tests/setup.ts` — Office/fetch/localStorage mocks
- `tests/fixtures/sampleDocs.ts` — shared test data
- `src/ai/providers/mockAdapter.ts` — deterministic LLM double
- `docs/architecture.md` — future deterministic module boundaries
- `docs/project-state.md` — stage-gate coverage expectations
