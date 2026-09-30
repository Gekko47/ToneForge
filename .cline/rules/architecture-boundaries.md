---
paths:
  - "src/core/**/*.ts"
  - "src/rules/**/*.ts"
  - "src/formatting/**/*.ts"
  - "src/style/**/*.ts"
  - "src/changes/**/*.ts"
  - "src/analysis/consistency/**/*.ts"
  - "src/reformat/**/*.ts"
  - "src/word/**/*.ts"
  - "src/ai/**/*.ts"
  - "src/taskpane/**/*.ts"
  - "src/taskpane/**/*.tsx"
  - "src/commands/**/*.ts"
---

# Deterministic Purity and Module Boundaries

ToneForge is deterministic-first. These boundaries are enforced by ESLint
`no-restricted-imports`, not merely documented — a violation fails `npm run lint`.

## Rules

### 1. Deterministic modules import only `core/domain` and `shared/utils`

`src/rules/`, `src/formatting/`, and `src/style/` may not import `ai`, `Office`,
or UI. A function that needs a Word DTO receives it as a **parameter**; it must
not import a Word reader to obtain one.

- Pure helpers belong in
  [`src/shared/utils/text.ts`](../../src/shared/utils/text.ts). Do not duplicate one
  inside a rule module.
- If a purity test needs the Office mock, the function is not pure.

### 2. Deterministic engines never call the LLM

No `LlmProvider`, `LlmRegistry`, or any `src/ai/` import in a rule. If you want
a model inside a rule, the logic is not a rule — move it to
`src/analysis/`.

### 3. `analysis/consistency` is the one exception, and it is bounded

It may import `ai/providers`; nothing else may import **into** it. `word`,
`taskpane`, `commands`, `reformat`, and `changes` are all forbidden. It is never
reached from the typing path. See ADR-0052 — an exception, not a precedent.

### 4. `core/domain` is Office-free, AI-free, and UI-free

It imports only `zod` and `shared/utils`. `ProviderConnection` has no
secret-capable field and a test reflects over the schema to keep it that way.

### 5. `taskpane/troubleshooting` is pure

State in, notes out: no store reads, no Office, no `ai`, no React. So two
surfaces cannot disagree about the same blocker. Gather state at the call site.

### 6. UI never imports the revision adapter directly

`taskpane/` and `commands/` reach Word only through the orchestrator. A component
that needs a mutation calls a service, not `word/revisionAdapter`.

## Referenced resources

- [docs/architecture.md](../../docs/architecture.md) — authoritative boundary table
- [eslint.config.mjs](../../eslint.config.mjs) — the enforced scopes
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0031, ADR-0052
- [.cline/skills/toneforge-architecture/SKILL.md](../skills/toneforge-architecture/SKILL.md)
