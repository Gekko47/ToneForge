# Stage 02 — Scaffold

**Gate**: Yes

## Objective

Create the production-ready repository scaffold: directory layout, tooling, CI/CD, docs, and governance.

## Scope

- Replace `.gitignore` with Node/Office add-in rules.
- Add `.nvmrc`, `.editorconfig`, `.env.example`.
- Create `package.json` with full script chain.
- Create `tsconfig.json`, `webpack.*.js`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc.json`.
- Create `manifest.json` (unified) + `assets/`.
- Create `src/taskpane`, `src/commands`, `src/core`, `src/word`, `src/ai`, `src/shared`.
- Create `tests/setup.ts` + smoke tests.
- Create `docs/` (project-state, decision-log, architecture, onboarding, privacy, accessibility, manual-verification, CHANGELOG).
- Create `scripts/` (validate-manifest, stage-verify, release-check).
- Create `.github/workflows/` (ci.yml, release.yml).
- Create `.husky/`, `commitlint.config.cjs`, `.lintstagedrc.cjs`.
- Create `.cline/rules/` + `.roo/skills/` stubs.

## Verification

- [x] `npm install` succeeds
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run format` passes
- [x] `npm run test` passes
- [x] `npm run build` succeeds
- [x] `npm run validate` passes
- [x] `npm run stage:verify` passes
- [x] `docs/project-state.md` updated
- [x] `docs/decision-log.md` updated

## Status

PASS
