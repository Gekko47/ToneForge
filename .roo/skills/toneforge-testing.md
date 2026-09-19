# Skill: Testing for ToneForge

Use this skill when writing or running tests for ToneForge.

## When to use

- Implementing a new feature and its tests.
- Debugging failing tests.
- Adding integration tests.

## Stack

- **Runner**: Vitest (ESM, fast, native TypeScript).
- **Environment**: jsdom (DOM simulation).
- **Library**: Testing Library (DOM, React).
- **Setup**: `tests/setup.ts` mocks the `Office` global and `fetch`.

## Test structure

```
tests/
  setup.ts            # global mocks
  unit/               # pure function tests, mirrors src/
  integration/        # cross-module tests
  fixtures/           # shared test data
```

## Coverage thresholds

- Global: 80% lines, statements, functions, branches.
- `rules/`, `formatting/`, `changes/` must hit 80%+ before the stage gate passes.

## Commands

```bash
npm run test           # run once
npm run test:watch     # watch mode
npm run test:coverage  # with coverage report
```

## Mocking Office

`tests/setup.ts` provides a minimal `Office` mock with `run`, `roamingSettings`, and `InsertBreakBehavior`. Import `tests/fixtures/sampleDocs.ts` for shared test data.

## Deterministic vs. semantic

- Deterministic engines (`rules/`, `formatting/`, `style/metrics`) are pure functions — test directly.
- Semantic engines depend on `LlmProvider` — always use `MockAdapter` in tests.
