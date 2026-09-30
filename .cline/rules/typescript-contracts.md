---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
  - "tsconfig.json"
  - "eslint.config.mjs"
---

# TypeScript and Zod Contracts

## Rules

### 1. Never weaken the strict compiler options

[`tsconfig.json`](../../tsconfig.json) enables `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
`noImplicitAny`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, and
`noUnusedParameters`. If a flag causes friction, fix the code, not the config.

- `exactOptionalPropertyTypes` means optional properties distinguish `undefined`
  from absence. Omit the property; do not pass `undefined`.
- `noUncheckedIndexedAccess` means indexing returns `T | undefined`. Guard, or
  use `.at()`, `.find()`, or an explicit length check.

### 2. Zod for every runtime-validated contract

Domain objects, env config, persisted state, and LLM response shapes are Zod
schemas. Parse at the boundary — env load, state load, LLM response — and never
trust a runtime value internally. Schemas live next to their consumers, use
`.default()` where a safe default exists, and prefer discriminated unions for
variants. Never validate with ad-hoc `typeof` checks.

### 3. No `any`

`@typescript-eslint/no-explicit-any` is an error. Use `unknown` plus narrowing, a
precise type, or a generic. If a third-party value has no shape, parse it with
Zod before use.

### 4. Use `import type` for type-only imports

`@typescript-eslint/consistent-type-imports` is an error. Use `import type { X }`
or inline `import { type X }`.

### 5. Lint rules that shape the code

- `no-console` allows only `warn` and `error`. Use `logger` for anything else.
- `prefer-const`.
- `no-restricted-syntax` forbids `ForStatement` — use array methods or
  `forEach`.
- No colour literals in `src/taskpane/**` except
  [`src/taskpane/fluentTheme.ts`](../../src/taskpane/fluentTheme.ts), which _is_ the
  palette. Use the theme tokens in `taskpane.css` so the UI follows the theme.
- `lint` runs with `--max-warnings 0`. A warning fails the build.

## Referenced resources

- [tsconfig.json](../../tsconfig.json) — strict options
- [eslint.config.mjs](../../eslint.config.mjs) — enforced rules
- [src/core/domain/](../../src/core/domain/) — canonical schemas
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0009, ADR-0014
