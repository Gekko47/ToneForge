---
name: toneforge-testing
description: Write and run tests for ToneForge with Vitest and jsdom. Use when implementing features, debugging failures, adding unit or integration tests, or mocking Office and LLM providers. Apply Ponytail first — YAGNI, reuse existing code, minimal diff.
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

[`vitest.config.ts`](../../../vitest.config.ts) uses the v8 provider and enforces
**80%** lines, statements, functions, and branches. The `include` list is
`src/analysis`, `src/changes`, `src/core`, `src/formatting`, `src/reformat`,
`src/rules`, `src/shared`, `src/style`, `src/word`, `src/ai`, and
`src/commands`.

No per-directory overrides are configured, and you should not add one. If a
module legitimately cannot reach 80%, document the gap in
[`docs/project-state.md`](../../../docs/project-state.md) as "PASS WITH
DOCUMENTED LIMITATION" rather than lowering the threshold. If coverage collapses
unexpectedly, check for case-duplicated paths first (ADR-0034).

## Commands

```bash
npm run test           # run once
npm run test:watch     # watch mode
npm run test:coverage  # with coverage report
```

## Mocking Office

`tests/setup.ts` provides a minimal `Office` mock with `run`,
`roamingSettings`, and `InsertBreakBehavior`. Import shared data from
[`tests/fixtures/`](../../../tests/fixtures/). Note
`vitest.config.ts` sets `mockReset: true, clearMocks: true,
restoreMocks: true` — re-establish `vi.fn()` behavior per test where needed.

## Deterministic vs. semantic

- Deterministic engines (`rules/`, `formatting/`, `style/`) are pure functions —
  test directly.
- Semantic and consistency code depends on `LlmProvider` — always use
  `MockAdapter` in tests (`{ provider: "mock" }`); never hit the live network.
  A mocked result is a typed contract, not an integration.

## Host evidence is not a test

A passing suite never closes the Word-host gate. A real host is verified by a
person, in Word, recorded in
[`docs/manual-verification.md`](../../../docs/manual-verification.md). Do not
write a test, or a comment, that claims it does.

## Referenced resources

- [`vitest.config.ts`](../../../vitest.config.ts) — runner, coverage, aliases
- [`tests/setup.ts`](../../../tests/setup.ts) — Office/fetch/localStorage mocks
- [`tests/fixtures/`](../../../tests/fixtures/) — shared test data
- [`src/ai/providers/mockAdapter.ts`](../../../src/ai/providers/mockAdapter.ts) — deterministic LLM double
- [`docs/manual-verification.md`](../../../docs/manual-verification.md) — the human host gate
- [`.cline/skills/toneforge-testing/SKILL.md`](../../../.cline/skills/toneforge-testing/SKILL.md) — the Cline equivalent of this skill
