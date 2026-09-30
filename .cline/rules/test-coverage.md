---
paths:
  - "tests/**"
  - "vitest.config.ts"
  - "src/**/*.test.ts"
  - "src/**/*.test.tsx"
---

# Test Coverage

Tests mirror the source tree, use the right double per engine type, and meet the
coverage floor.

## Rules

### 1. Mirror the source tree

`src/word/documentReader.ts` becomes `tests/unit/word/documentReader.test.ts`.
Pure functions go in `tests/unit/`, cross-module tests in `tests/integration/`,
shared data in `tests/fixtures/`.

### 2. Mock per engine type

- **Deterministic** (`rules`, `formatting`, `style`) — test directly. If a purity
  test needs the Office mock, the function is not pure.
- **Semantic and consistency** — `MockAdapter` with `{ provider: "mock" }`. Never
  hit the live network.
- **Word boundary** — the `Office` mock in
  [`tests/setup.ts`](../../tests/setup.ts).

`mockReset`, `clearMocks`, and `restoreMocks` are all true. Re-establish
`vi.fn()` behaviour per test.

### 3. Meet the threshold, or document the gap

80% lines, statements, functions, and branches across the configured `src/`
include list. There are no per-directory overrides, and you should not add one.
If a module legitimately cannot reach 80%, record **PASS WITH DOCUMENTED
LIMITATION** in [`docs/project-state.md`](../../docs/project-state.md) — do not
lower the threshold.

Coverage collapsed unexpectedly? Check for case-duplicated paths first; that
defect previously halved the global figure (ADR-0034).

### 4. Reuse fixtures

Import from [`tests/fixtures/`](../../tests/fixtures/) rather than duplicating data
inline.

### 5. Tests do not close the host gate

A green suite is a typed contract, not an integration or a host verification. The
Word-host gate is human, in
[`docs/manual-verification.md`](../../docs/manual-verification.md), and remains open.
Do not write a test or comment implying otherwise — and do not report a mocked
result as a verified one.

## Referenced resources

- [vitest.config.ts](../../vitest.config.ts) — runner, coverage, aliases
- [tests/setup.ts](../../tests/setup.ts) — global mocks
- [tests/fixtures/](../../tests/fixtures/) — shared data
- [docs/project-state.md](../../docs/project-state.md) — gate evidence
- [.cline/skills/toneforge-testing/SKILL.md](../skills/toneforge-testing/SKILL.md)
