---
name: toneforge-scaffold
description: Scaffold and extend the ToneForge Word add-in repository. Use when creating modules, adding tests or configs, setting up the dev environment, or aligning work to ROADMAP stages and architecture boundaries.
---

# ToneForge Scaffold

Use this skill when scaffolding or extending the ToneForge repository.

## When to use

- Creating new modules or features aligned to the roadmap.
- Adding tests, configs, or CI for a new stage.
- Setting up the development environment.
- Verifying stage gates before committing.

Trigger phrases: "scaffold a new module", "add a new stage", "set up ToneForge", "where do I put this file", "run stage verification".

## Steps

1. Confirm the current stage from [`docs/project-state.md`](../../../docs/project-state.md).
2. Read `ROADMAP.md` for stage ordering, gates, and hard rules.
3. Read the relevant stage file in `docs/stages/`.
4. Inspect existing module boundaries in [`docs/architecture.md`](../../../docs/architecture.md).
5. Create files under the correct `src/` subfolder (see placement guide below).
6. Add tests under `tests/` mirroring the source structure.
7. Update `docs/project-state.md` and `docs/decision-log.md`.
8. Run `npm run verify` before committing.
9. Commit with a conventional commit message matching the roadmap stage.

## Module placement guide

Current `src/` tree (verified):

| Concern         | Location                                               |
| --------------- | ------------------------------------------------------ |
| Canonical types | `src/core/domain/`                                     |
| Env config      | `src/core/config/`                                     |
| Persistence     | `src/core/state/`                                      |
| LLM providers   | `src/ai/providers/`                                    |
| Prompt builders | `src/ai/prompts/`                                      |
| Word boundary   | `src/word/`                                            |
| Office helpers  | `src/shared/office/`                                   |
| Shared utils    | `src/shared/utils/`                                    |
| UI taskpane     | `src/taskpane/`                                        |
| Ribbon commands | `src/commands/`                                        |
| Office.js types | `src/types/office.d.ts`                                |
| Tests           | `tests/unit/`, `tests/integration/`, `tests/fixtures/` |

Planned modules per [`docs/architecture.md`](../../../docs/architecture.md) (do not create early — follow `ROADMAP.md` stage scope):

| Concern             | Planned location                              |
| ------------------- | --------------------------------------------- |
| Deterministic rules | `src/rules/`, `src/formatting/`, `src/style/` |
| Semantic analysis   | `src/analysis/`                               |
| Change planning     | `src/changes/`                                |

> UI lives in `src/taskpane/` (not `src/ui/`). Do not create `src/ui/` — use `src/taskpane/` and `src/taskpane/pages/`.

## Verification

```bash
npm run typecheck
npm run lint
npm run format
npm run test
npm run build
npm run validate
npm run verify        # all of the above in order
npm run stage:verify  # stage-gate checks
```

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
It uses standard agent file-edit, search, and terminal tools plus the
`filesystem` and `git` MCP servers declared in `.roo/mcp.json`.

## Referenced resources

- `ROADMAP.md` — stage ordering and gates
- `docs/project-state.md` — per-stage PASS/BLOCKED status
- `docs/architecture.md` — module boundaries and data flow
- `docs/decision-log.md` — ADRs; update when making architectural choices
- `docs/onboarding.md` — setup and stage protocol
- `.cline/rules/toneforge.md` — governance hard rules
- `scripts/stage-verify.mjs`, `scripts/validate-manifest.mjs`, `scripts/release-check.mjs`
