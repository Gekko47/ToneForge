# ToneForge — Zoo Rules Design

> Synthesized from repository audit (2026-09-19) and skill review.
> Each rule is scoped, actionable, and justified by evidence in the codebase.

## Scope

These rules govern AI coding assistants (Zoo/Roo Code/Cline) working in
`c:/repos/ToneForge`. They complement the four existing `.roo/skills/`
packages and the `.cline/rules/toneforge.md` governance file.

## Existing coverage (do not duplicate)

| Concern                 | Covered by                                                           |
| ----------------------- | -------------------------------------------------------------------- |
| Module boundaries       | `eslint.config.mjs` `no-restricted-imports` + `docs/architecture.md` |
| LLM provider contract   | `toneforge-llm` skill                                                |
| Office.js patterns      | `toneforge-officejs` skill                                           |
| Testing patterns        | `toneforge-testing` skill                                            |
| Scaffold/stage protocol | `toneforge-scaffold` skill + `.cline/rules/toneforge.md`             |

## Gaps addressed

| Gap                                                                       | Rule                   |
| ------------------------------------------------------------------------- | ---------------------- |
| No rule enforces TypeScript strict-mode discipline at the agent level     | `typescript-contracts` |
| No rule prevents Office/LLM imports in deterministic engines              | `deterministic-purity` |
| No rule mandates `runInWord` wrapper over raw `Office.run`                | `officejs-boundary`    |
| No rule mandates `includeRawText` opt-in before prompt builders emit text | `llm-privacy`          |
| No rule mandates graceful state-load fallback and versioned migrations    | `persistence-state`    |
| No rule mandates per-module coverage expectations beyond global 80%       | `test-coverage`        |
| No rule mandates manifest/build verification before commit                | `build-manifest`       |
| No rule mandates conventional-commit scope alignment with ROADMAP stages  | `commit-docs`          |

## Rule list

1. `.roo/rules/zoo-rules-typescript-contracts.md`
2. `.roo/rules/zoo-rules-deterministic-purity.md`
3. `.roo/rules/zoo-rules-officejs-boundary.md`
4. `.roo/rules/zoo-rules-llm-privacy.md`
5. `.roo/rules/zoo-rules-persistence-state.md`
6. `.roo/rules/zoo-rules-test-coverage.md`
7. `.roo/rules/zoo-rules-build-manifest.md`
8. `.roo/rules/zoo-rules-commit-docs.md`

## Verification

```bash
npm run skills:validate   # skill frontmatter + refs
npm run verify            # typecheck + lint + format + test + build + validate
npm run stage:verify       # stage-gate checks
```
