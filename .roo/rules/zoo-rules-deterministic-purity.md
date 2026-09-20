---
name: toneforge-deterministic-purity
description: Keep deterministic engines pure — no Office, LLM, or UI imports in rules, formatting, metrics, or style modules.
---

# Deterministic Purity

ToneForge's deterministic engines must be pure functions: no Office.js calls,
no LLM calls, no UI imports. This is the "deterministic first" rule from
`ROADMAP.md` and ADR-0006.

## When to use

- Creating or modifying code in `src/rules/`, `src/formatting/`, `src/style/`,
  or any planned deterministic module.
- Deciding whether a function belongs in a deterministic module vs. `src/ai/`
  or `src/word/`.
- Debugging import-boundary lint failures.

## Rules

### 1. Deterministic modules import only `core/domain` and `shared/utils`

Per `docs/architecture.md`, deterministic engines (`rules`, `formatting`,
`style/metrics`) may import from `core/domain` and `shared/utils` only.
They must **not** import from `ai`, `Office`, or `ui`.

- `src/shared/utils/text.ts` is the canonical home for pure text helpers
  (`splitSentences`, `countWords`, `mean`, `stdDev`). If a helper is pure
  and has no Office/LLM dependency, put it there — do not duplicate it in a
  rule module.
- If a deterministic function needs a Word DTO (e.g. paragraph text), it
  must accept the DTO as a parameter — it must not import `word/documentReader`.

**Evidence:** `docs/architecture.md` module boundary table; ADR-0006;
`eslint.config.mjs` `no-restricted-imports` scopes (extend these scopes as
new deterministic modules are scaffolded).

### 2. Never call the LLM from deterministic code

Deterministic engines must never import or call `LlmProvider`, `LlmRegistry`,
or any `src/ai/` module. Semantic analysis lives in `src/analysis/` (planned)
and consumes `ai/providers` — deterministic engines do not.

- If you are tempted to call an LLM inside a rule, stop. The rule is not
  deterministic — move the logic to the semantic engine.

**Evidence:** `ROADMAP.md` "Deterministic first" and "AI only where
interpretation is necessary"; `toneforge-llm` skill rule "Deterministic
engines must never call the LLM directly."

### 3. Test deterministic engines directly

Because they are pure, deterministic functions are unit-testable without
mocking Office or LLM providers. Use `tests/unit/` mirroring `src/` structure.

- Do not mock `Office` for a pure function test — if you need the mock, the
  function is not pure.
- Coverage for deterministic modules must meet the 80% global threshold
  (see `zoo-rules-test-coverage`).

**Evidence:** `tests/unit/shared/utils/text.test.ts` — tests pure helpers
without Office mocks; `vitest.config.ts` coverage thresholds.

## Referenced resources

- `docs/architecture.md` — module boundaries
- `ROADMAP.md` — "Deterministic first" rule
- `docs/decision-log.md` — ADR-0006
- `src/shared/utils/text.ts` — canonical pure text helpers
- `eslint.config.mjs` — `no-restricted-imports` scopes
