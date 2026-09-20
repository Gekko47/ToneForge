---
name: toneforge-build-manifest
description: Verify the build, manifest, and format before committing — run the full verification chain in order.
---

# Build & Manifest

Before committing, the full verification chain must pass in order:
typecheck → lint → format → test → build → manifest validate.

## When to use

- Before committing any change.
- Debugging build, lint, or manifest validation failures.
- Setting up CI or adding new verification steps.

## Rules

### 1. Run the full verification chain before commit

`npm run verify` runs, in order:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src tests --max-warnings 0
npm run format      # prettier --check .
npm run test        # vitest run
npm run build       # webpack --config webpack.prod.js
npm run validate    # node scripts/validate-manifest.mjs
```

- All six must pass. A failing step blocks the commit.
- Never commit with a partial run (e.g. skipping `format` or `validate`).

**Evidence:** `package.json` lines 30-33; `.cline/rules/toneforge.md`
"Before committing" checklist.

### 2. Lint with zero warnings

`npm run lint` uses `--max-warnings 0`. Any warning fails the build.

- `@typescript-eslint/no-explicit-any: "error"` — no `any` types.
- `@typescript-eslint/no-unused-vars: "error"` with `^_` ignore patterns.
- `@typescript-eslint/consistent-type-imports: "error"`.
- `no-restricted-imports` enforces module boundaries (see
  `zoo-rules-deterministic-purity` and `zoo-rules-officejs-boundary`).
- `no-console` allows only `warn` and `error`. Use `logger` for info logs.
- `prefer-const: "error"`.
- `no-restricted-syntax` forbids `ForStatement` — use array methods or
  `forEach`.

**Evidence:** `eslint.config.mjs` lines 39-55.

### 3. Format with Prettier, then verify with `prettier --check`

`.prettierrc.json` defines: `semi: true`, `singleQuote: false`,
`tabWidth: 2`, `trailingComma: "all"`, `printWidth: 100`, `endOfLine: "lf"`,
`bracketSpacing: true`, `arrowParens: "always"`.

- `npm run format` checks; `npm run format:write` fixes.
- `lint-staged` runs `eslint --fix` and `prettier --write` on staged
  `.ts`/`.tsx` files before commit (`.lintstagedrc.cjs`).

**Evidence:** `.prettierrc.json`; `.lintstagedrc.cjs`.

### 4. Validate the manifest

`npm run validate` runs `scripts/validate-manifest.mjs`, which checks the
unified JSON manifest (v1.30) against the schema and verifies referenced
files exist.

- The manifest must declare `extensions[].requirements` + nested
  `extensions[].runtimes[]` with an `openPage` action and `code.page` only
  (no `script`, since the build emits content-hashed bundles).
- Both `manifest.json` (v1.30) and `manifest.xml` (v1.10 fallback) must be
  kept in sync.

**Evidence:** ADR-0001 in `docs/decision-log.md`;
`scripts/validate-manifest.mjs`; `package.json` line 20.

### 5. Build must succeed

`npm run build` runs `webpack --config webpack.prod.js`. The build emits
`dist/` with content-hashed bundles. If the build fails, the add-in cannot
be sideloaded — fix before commit.

**Evidence:** `package.json` line 15; `webpack.prod.js`.

## Referenced resources

- `package.json` — scripts and dependencies
- `eslint.config.mjs` — lint rules
- `.prettierrc.json` — formatting config
- `.lintstagedrc.cjs` — pre-commit hooks
- `scripts/validate-manifest.mjs` — manifest validation
- `docs/decision-log.md` — ADR-0001 (manifest format)
- `.cline/rules/toneforge.md` — "Before committing" checklist
