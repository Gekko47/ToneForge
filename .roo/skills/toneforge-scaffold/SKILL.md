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

| Concern                     | Location                                               |
| --------------------------- | ------------------------------------------------------ |
| Canonical types and schemas | `src/core/domain/`                                     |
| Env config                  | `src/core/config/`                                     |
| Persistence and migrations  | `src/core/state/`                                      |
| LLM providers and gateway   | `src/ai/providers/`, `src/ai/gateway/`                 |
| Prompt builders             | `src/ai/prompts/`                                      |
| Word access boundary        | `src/word/`                                            |
| Office helpers              | `src/shared/office/`                                   |
| Shared utils                | `src/shared/utils/`                                    |
| Deterministic rules         | `src/rules/`, `src/formatting/`, `src/style/`          |
| Analysis orchestration      | `src/analysis/`, `src/analysis/consistency/`           |
| Change planning             | `src/changes/`                                         |
| Reformat orchestrator       | `src/reformat/`                                        |
| UI task pane                | `src/taskpane/`                                        |
| Ribbon commands             | `src/commands/`                                        |
| Office.js types             | `src/types/office.d.ts`                                |
| Tests                       | `tests/unit/`, `tests/integration/`, `tests/fixtures/` |

> UI lives in `src/taskpane/` (not `src/ui/`), with `pages/`, `components/`,
> `settings/`, `workflow/`, `state/`, and `troubleshooting/` subfolders. Do not
> create `src/ui/`. A new deterministic module must be pure: if it needs Word, a
> model, or the screen, it does not belong in `src/rules/`, `src/formatting/`, or
> `src/style/`.

## Verification

`npm run verify` runs the `toneforge-repository-v1` graph from
`scripts/verification-graph.mjs`, in order:

```text
typecheck -> lint -> format -> secret-scan -> docs -> skills
           -> test -> coverage -> build-artifacts -> built-secret-scan
           -> manifest -> package -> package-check
```

Useful individually: `npm run typecheck`, `lint`, `format`, `test`,
`test:coverage`, `skills:validate`, `docs:validate`, `validate`, `build`, and
`host:matrix`.

**The graph is not the whole gate.** A green automated run is never a release
claim. The Word-host evidence gate is human, recorded in
`docs/manual-verification.md`, and stays open until a person runs the add-in
(ADR-0051).

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
It uses standard agent file-edit, search, and terminal tools. The Roo MCP
configuration is machine-local and gitignored, so it is intentionally untracked
and must never be committed.

Live Word verification requires sideloading (`npm run sideload`) and cannot run
headless. Live LLM calls require a credential in the gitignored `.env` consumed
by the Node-side development broker. Unit tests must stay offline: use
`MockAdapter` and the injected `fetch` doubles.

## Referenced resources

- `ROADMAP.md` — canonical stage ordering and status
- `docs/architecture.md` — module boundaries and data flow
- `docs/decision-log.md` — ADRs; update when making architectural choices
- `docs/onboarding.md` — setup, verification, and troubleshooting
- `docs/privacy-security.md` — privacy posture
- `docs/manual-verification.md` — the human host gate
- `.cline/rules/toneforge.md` — governance hard rules
- `scripts/verification-graph.mjs` — the ordered graph
