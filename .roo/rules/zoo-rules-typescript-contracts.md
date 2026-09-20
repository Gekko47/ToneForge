---
name: toneforge-typescript-contracts
description: Enforce ToneForge's TypeScript strict-mode contracts and Zod schema discipline when writing or refactoring code.
---

# TypeScript Contracts

Enforce the strict TypeScript contracts defined in `tsconfig.json` and the
Zod schema discipline established across `src/core/domain/`.

## When to use

- Writing new `.ts`/`.tsx` files or modifying existing ones.
- Adding or changing Zod schemas (`z.object`, `z.enum`, `z.array`).
- Refactoring types, interfaces, or type imports.
- Debugging `tsc --noEmit` failures.

## Rules

### 1. Honor the strict-mode compiler options

`tsconfig.json` enables: `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitAny`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax: false`, `isolatedModules: true`.

- Never weaken these flags. If a flag causes friction, fix the code, not the config.
- `exactOptionalPropertyTypes: true` means optional properties distinguish
  `undefined` from absence. Do not pass `undefined` for optional fields; use
  the property name explicitly or omit it.
- `noUncheckedIndexedAccess: true` means array indexing returns `T | undefined`.
  Guard before use or use `.at()`, `.find()`, or explicit length checks.

**Evidence:** `tsconfig.json` lines 16-25; ADR-0014 in `docs/decision-log.md`.

### 2. Use `zod` for all runtime-validated contracts

All domain objects, env config, persisted state, and LLM response shapes are
defined with Zod schemas. Never validate with ad-hoc `typeof` checks.

- Schemas live next to their consumers (e.g. `StyleProfileSchema` in
  `src/core/domain/StyleProfile.ts`).
- Parse at boundaries (env load, state load, LLM response) — never trust
  runtime values internally.
- Use `.default()` for fields with safe defaults; use `.nullable()` for
  explicitly absent values.
- Prefer discriminated unions (`z.discriminatedUnion`) for variant payloads
  (see ADR-0009 for `ChangePayloadSchema`).

**Evidence:** `src/core/config/env.ts`, `src/core/state/persistence.ts`,
`src/ai/prompts/profilePrompts.ts`; ADR-0009.

### 3. No `any` — lint forbids it

`eslint.config.mjs` sets `"@typescript-eslint/no-explicit-any": "error"`.

- Replace `any` with `unknown` + narrowing, a precise type, or a generic.
- If a third-party value truly has no shape, type it as `unknown` and parse
  with a Zod schema before use.

**Evidence:** `eslint.config.mjs` line 40.

### 4. Consistent type-only imports

`@typescript-eslint/consistent-type-imports: "error"` requires `import type`
for type-only imports. Use `import { type Foo }` inline or `import type { Foo }`
at the top of the file.

**Evidence:** `eslint.config.mjs` line 45.

## Referenced resources

- `tsconfig.json` — strict compiler options
- `eslint.config.mjs` — lint rules enforcing type discipline
- `docs/decision-log.md` — ADR-0014, ADR-0009
- `src/core/domain/StyleProfile.ts` — canonical Zod schemas
- `src/core/config/env.ts` — env validation pattern
