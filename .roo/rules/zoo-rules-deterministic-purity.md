---
name: toneforge-deterministic-purity
description: Keep deterministic engines pure — no Office, LLM, or UI imports in rules, formatting, metrics, or style modules.
---

# Deterministic Purity

ToneForge's deterministic engines must be pure functions: no Office.js calls,
no LLM calls, no UI imports. This is the "deterministic first" rule from
`ROADMAP.md`.

## When to use

- Creating or modifying code in `src/rules/`, `src/formatting/`, or `src/style/`.
- Deciding whether a function belongs in a deterministic module vs. `src/ai/` or
  `src/word/`.
- Debugging import-boundary lint failures.

## Rules

### 1. Deterministic modules import only `core/domain` and `shared/utils`

Per `docs/architecture.md`, deterministic engines (`rules`, `formatting`,
`style/metrics`) may import from `core/domain` and `shared/utils` only. They must
**not** import from `ai`, `Office`, or `ui`.

- `src/shared/utils/text.ts` is the canonical home for pure text helpers. If a
  helper is pure and has no Office/LLM dependency, put it there — do not
  duplicate it in a rule module.
- If a deterministic function needs a Word DTO, it must accept the DTO as a
  parameter — it must not import `word/documentReader`.

**Evidence:** `docs/architecture.md` module boundary table;
`eslint.config.mjs` `no-restricted-imports` scopes.

### 2. Never call the LLM from deterministic code

Deterministic engines must never import or call `LlmProvider`, `LlmRegistry`, or
any `src/ai/` module. Semantic analysis lives in `src/analysis/`.

- If you are tempted to call an LLM inside a rule, stop. The rule is not
  deterministic — move the logic to the semantic engine.

### 3. The one sanctioned exception

`src/analysis/consistency/` is the **single** exception to deterministic-first
(ADR-0052). It may import `ai/providers`; nothing outside it may import into it,
and `word`, `taskpane`, `commands`, `reformat`, and `changes` are all forbidden.
It is never reached from the typing path, and its output is an ordinary
`Finding` via `bridge.ts`.

ADR-0052 is an exception, **not** a precedent. A second non-deterministic engine
is a change to ADR-0052 and must be recorded as one.

### 4. Test deterministic engines directly

Because they are pure, deterministic functions are unit-testable without
mocking Office or LLM providers. Use `tests/unit/` mirroring `src/`.

- Do not mock `Office` for a pure function test — if you need the mock, the
  function is not pure.
- Coverage for deterministic modules must meet the 80% global threshold
  (see `zoo-rules-test-coverage`).

**Evidence:** `tests/unit/shared/utils/text.test.ts` — tests pure helpers
without Office mocks; `vitest.config.ts` coverage thresholds.

## Referenced resources

- `docs/architecture.md` — module boundaries
- `ROADMAP.md` — "Deterministic first" rule
- `docs/decision-log.md` — ADR-0006, ADR-0052
- `src/shared/utils/text.ts` — canonical pure text helpers
- `eslint.config.mjs` — `no-restricted-imports` scopes
- `.cline/skills/toneforge-architecture/SKILL.md` — the Cline equivalent of this rule
