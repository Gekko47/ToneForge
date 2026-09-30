---
name: toneforge-testing
description: Write and run ToneForge tests with Vitest and jsdom. Use when implementing a feature, adding or debugging tests, mocking Office or the LLM, or resolving a coverage failure.
---

# Testing for ToneForge

Use this skill when writing or running tests.

## When to use

- Implementing a feature and its tests.
- Debugging a failing test.
- Adding integration tests or shared fixtures.
- A coverage gate has failed.

Trigger phrases: "add a test", "failing test", "mock Office", "mock the LLM",
"coverage failed", "run the test suite", "why is this test flaky".

## Stack

- **Runner**: Vitest, ESM, native TypeScript.
- **Environment**: jsdom.
- **Library**: Testing Library (DOM and React).
- **Setup**: [`tests/setup.ts`](../../../tests/setup.ts) mocks the `Office`
  global, `fetch`, and `localStorage`.
- **Config**: [`vitest.config.ts`](../../../vitest.config.ts) — include
  `tests/**/*.test.{ts,tsx}`, aliases `@` to `src` and `@tests` to `tests`.
- `mockReset`, `clearMocks`, and `restoreMocks` are all true, so re-establish
  `vi.fn()` behaviour per test rather than assuming it persists.

## Structure

```text
tests/
  setup.ts        # global mocks: Office, fetch, localStorage
  unit/           # mirrors src/
  integration/    # cross-module tests
  fixtures/       # shared test data
```

Mirror the source path: `src/word/documentReader.ts` becomes
`tests/unit/word/documentReader.test.ts`. A test in the wrong place is a signal
that the boundary it is crossing was not noticed.

## Mock per engine type

- **Deterministic engines** (`rules`, `formatting`, `style`) — test directly. No
  Office mock, no LLM mock. If you need the Office mock, the function is not
  pure.
- **Semantic and consistency code** — always `MockAdapter` with
  `{ provider: "mock" }`. Never hit the live network.
- **Word-boundary modules** — use the `Office` mock from `tests/setup.ts`.

`MockAdapter` scripts responses by prompt substring and is `configured: true`, so
a semantic path exercised in tests proves a contract, not an integration. Say so
rather than implying a real model was involved.

## Coverage

[`vitest.config.ts`](../../../vitest.config.ts) uses the v8 provider, includes
`src/analysis`, `src/changes`, `src/core`, `src/formatting`, `src/reformat`,
`src/rules`, `src/shared`, `src/style`, `src/word`, `src/ai`, and `src/commands`,
and enforces **80%** for lines, statements, functions, and branches with no
per-directory overrides.

If a module legitimately cannot reach the threshold, do not lower the threshold
and do not add an override. Document the gap as **PASS WITH DOCUMENTED
LIMITATION** in [`docs/project-state.md`](../../../docs/project-state.md).

Note that Windows path casing previously produced duplicate coverage records
that halved the global figure (ADR-0034). If coverage collapses unexpectedly,
check for case-duplicated files before touching the threshold.

## Reuse fixtures

Shared data lives in [`tests/fixtures/`](../../../tests/fixtures/) —
`sampleDocs.ts`, `deterministicReview.ts`. Import rather than duplicating inline.

## Host evidence is not a test

A passing suite never closes the Word-host gate. A real host is verified by a
person, in Word, recorded in
[`docs/manual-verification.md`](../../../docs/manual-verification.md). Do not
write a test, or a comment, that claims it does.

## Commands

```bash
npm run test            # once
npm run test:watch      # watch
npm run test:coverage   # with coverage
```

Use `test:watch` for a tight edit loop and `npm run test` before reporting done.

## Referenced resources

- [`vitest.config.ts`](../../../vitest.config.ts) — runner, coverage, aliases
- [`tests/setup.ts`](../../../tests/setup.ts) — global mocks
- [`tests/fixtures/`](../../../tests/fixtures/) — shared data
- [`src/ai/providers/mockAdapter.ts`](../../../src/ai/providers/mockAdapter.ts) — LLM double
- [`docs/project-state.md`](../../../docs/project-state.md) — gate evidence
