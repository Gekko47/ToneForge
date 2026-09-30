---
paths:
  - "package.json"
  - "webpack.*.js"
  - "manifest.json"
  - "manifest.xml"
  - "scripts/validate-manifest.mjs"
  - "scripts/verification-graph.mjs"
  - ".prettierrc.json"
  - ".lintstagedrc.cjs"
  - ".github/workflows/**"
---

# Build, Manifest, and Verification

## Rules

### 1. Run the full graph before committing

`npm run verify` runs the `toneforge-repository-v1` graph from
[`scripts/verification-graph.mjs`](../../scripts/verification-graph.mjs), in order:

```text
typecheck -> lint -> format -> secret-scan -> docs -> skills
           -> test -> coverage -> build-artifacts -> built-secret-scan
           -> manifest -> package -> package-check
```

A failing stage blocks the commit. Never commit on a partial run. When a stage
fails, the summary names the **owner** — `repository-code` is ours to fix,
`dependency-install` usually means the registry or lockfile moved, and
`build-package` points at `dist/` or the staged release.

### 2. Lint with zero warnings

`--max-warnings 0`. See
[typescript-contracts.md](typescript-contracts.md) for the rules that shape code.

### 3. Format with Prettier

`npm run format` checks, `npm run format:write` fixes. `printWidth` is 100, LF
endings, `trailingComma: "all"`. `lint-staged` runs `eslint --fix` and
`prettier --write` on staged TypeScript before commit.

### 4. Keep both manifests in sync

`npm run validate` checks the unified JSON manifest (v1.30) against the schema
and verifies referenced files exist. `manifest.xml` (v1.10) is a validated
fallback and must stay in sync.

The manifest must declare `extensions[].requirements` with nested
`runtimes[]` carrying an `openPage` action and `code.page` only — no `script`,
since the build emits content-hashed bundles.

A `resid` or resource id longer than **32 characters**, or a `<Control>` with no
`xsi:type`, makes Word refuse to parse the manifest and drops the **entire**
add-in with "This add-in is no longer available". `npm run validate` checks both.

### 5. A green automated run is never a release

`word-host-evidence` is recorded in the summary and always reported `pending`.
It is satisfied only by a person in a real Word host and is never automated. Do
not describe a passing graph as released or verified (ADR-0051).

## Referenced resources

- [scripts/verification-graph.mjs](../../scripts/verification-graph.mjs) — the graph
- [scripts/validate-manifest.mjs](../../scripts/validate-manifest.mjs) — manifest check
- [docs/onboarding.md](../../docs/onboarding.md) — troubleshooting
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0001, ADR-0051
