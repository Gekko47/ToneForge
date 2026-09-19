# Skill: ToneForge Scaffold

Use this skill when scaffolding or extending the ToneForge repository.

## When to use

- Creating new modules or features aligned to the roadmap.
- Adding tests, configs, or CI for a new stage.
- Setting up the development environment.

## Steps

1. Confirm the current stage from `docs/project-state.md`.
2. Inspect existing module boundaries in `docs/architecture.md`.
3. Create files under the correct `src/` subfolder.
4. Add tests under `tests/` mirroring the source structure.
5. Update `docs/project-state.md` and `docs/decision-log.md`.
6. Run `npm run verify` before committing.
7. Commit with a conventional commit message matching the roadmap stage.

## Module placement guide

| Concern             | Location                                      |
| ------------------- | --------------------------------------------- |
| Canonical types     | `src/core/domain/`                            |
| Env config          | `src/core/config/`                            |
| Persistence         | `src/core/state/`                             |
| Deterministic rules | `src/rules/`, `src/formatting/`, `src/style/` |
| Semantic analysis   | `src/analysis/`, `src/ai/`                    |
| Change planning     | `src/changes/`                                |
| Word boundary       | `src/word/`                                   |
| UI components       | `src/ui/`, `src/taskpane/`                    |
| Shared utils        | `src/shared/utils/`                           |
| Tests               | `tests/unit/`, `tests/integration/`           |
