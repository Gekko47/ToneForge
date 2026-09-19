---
name: toneforge-testing
description: Write and run tests for ToneForge with Vitest and jsdom. Use when implementing features, debugging failures, adding unit or integration tests, or mocking Office and LLM providers.
---

# Testing for ToneForge

Use this skill when writing or running tests for ToneForge.

## When to use

- Implementing a new feature and its tests.
- Debugging failing tests.
- Adding integration tests or shared fixtures.

Trigger phrases: "add a test", "failing test", "mock Office", "mock the LLM", "coverage failed", "run the test suite".

## Stack

- **Runner**: Vitest (ESM, fast, native TypeScript).
- **Environment**: jsdom (DOM simulation).
- **Library**: Testing Library (DOM, React).
- **Setup**: `tests/setup.ts` mocks the `Office` global and `fetch`.
- **Config**: `vitest.config.ts` (`include: tests/**/*.test.{ts,tsx}`, `setupFiles: ./tests/setup.ts`, path aliases `@` → `src`, `@tests` → `tests`).

## Test structure

```text
tests/
  setup.ts            # global mocks (Office + fetch + localStorage)
  unit/               # pure function tests, mirrors src/
  integration/        # cross-module tests (e.g. llm-registry.test.ts)
  fixtures/           # shared test data (e.g. sampleDocs.ts)
```

Mirror the source path: `src/word/documentReader.ts` →
`tests/unit/word/documentReader.test.ts`.

## Coverage thresholds

Global thresholds in `vitest.config.ts` (v8 provider, `src/**/*.ts(x)`):

- 80% lines, statements, functions, branches.

No per-directory overrides are configured today. Future deterministic
engines (`src/rules/`, `src/formatting/`, `src/changes/` per
`docs/architecture.md`) must hold 80%+ before their stage gates pass —
treat that as a stage-gate expectation, not a Vitest config override.

## Commands

```bash
npm run test           # run once
npm run test:watch     # watch mode
npm run test:coverage  # with coverage report
```

## Mocking Office

`tests/setup.ts` provides a minimal `Office` mock with `run`,
`roamingSettings`, and `InsertBreakBehavior`. Import
`tests/fixtures/sampleDocs.ts` for shared test data. Note
`vitest.config.ts` sets `mockReset: true, clearMocks: true,
restoreMocks: true` — re-establish `vi.fn()` behavior per test where needed.

## Deterministic vs. semantic

- Deterministic engines (`rules/`, `formatting/`, `style/metrics` when they
  land per `docs/architecture.md`) are pure functions — test directly.
- Semantic engines depend on `LlmProvider` — always use `MockAdapter` in
  tests (`{ provider: "mock" }`); never hit the live network.

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
It uses the standard terminal/test runner and the `filesystem` MCP server.
No extra dependencies beyond `devDependencies` in `package.json`
(`vitest`, `jsdom`, `@testing-library/*`).

## Referenced resources

- `vitest.config.ts` — runner, coverage, aliases
- `tests/setup.ts` — Office/fetch/localStorage mocks
- `tests/fixtures/sampleDocs.ts` — shared test data
- `src/ai/providers/mockAdapter.ts` — deterministic LLM double
- `docs/architecture.md` — future deterministic module boundaries
