---
name: toneforge-scaffold
description: Scaffold and extend the ToneForge Word add-in. Use when creating a module, adding tests or config, placing a new file, or running the verification chain before a commit.
---

# ToneForge Scaffold

Use this skill when scaffolding or extending the ToneForge repository.

## When to use

- Creating a new module or feature aligned to the roadmap.
- Deciding where a new file belongs.
- Adding tests, config, or CI.
- Running verification before committing.

Trigger phrases: "scaffold a new module", "where do I put this file", "add a new
stage", "run stage verification", "set up ToneForge".

## Steps

1. Read [`ROADMAP.md`](../../../ROADMAP.md) for stage ordering, gates, and hard
   rules. It is the canonical status ledger.
2. Read the relevant stage file in [`docs/stages/`](../../../docs/stages/).
3. Read [`docs/architecture.md`](../../../docs/architecture.md) for the module
   boundary table before adding any import.
4. Check [`docs/decision-log.md`](../../../docs/decision-log.md) so you do not
   repeat a rejected decision.
5. Inspect the existing implementation before modifying it. Prefer extending a
   real module over adding a parallel one.
6. Create the file under the correct `src/` subfolder (see the placement guide).
7. Add tests under `tests/` mirroring the source structure.
8. Update [`docs/project-state.md`](../../../docs/project-state.md) and record any
   architectural choice as an ADR.
9. Run `npm run verify` before committing.
10. Commit with a conventional message whose scope matches the stage.

## Module placement guide

This is the tree as it exists today. It is not a plan — every row below is
implemented.

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

**There is no `src/ui/`.** UI lives in `src/taskpane/`, with `pages/`,
`components/`, `settings/`, `workflow/`, `state/`, and `troubleshooting/`
subfolders. Do not create `src/ui/`.

A new deterministic module must be pure. If it needs Word, a model, or the
screen, it does not belong in `src/rules/`, `src/formatting/`, or
`src/style/`. See the `toneforge-architecture` skill.

## Verification

`npm run verify` runs the `toneforge-repository-v1` graph via
[`scripts/verification-graph.mjs`](../../../scripts/verification-graph.mjs), in
this order:

```text
typecheck -> lint -> format -> secret-scan -> docs -> skills
           -> test -> coverage -> build-artifacts -> built-secret-scan
           -> manifest -> package -> package-check
```

Useful individually:

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint, --max-warnings 0
npm run format           # prettier --check .
npm run test             # vitest run
npm run test:coverage    # with coverage
npm run skills:validate  # skill frontmatter and references
npm run docs:validate    # documentation link targets
npm run validate         # manifest schema and referenced files
npm run build            # webpack production build
npm run host:matrix      # generate the human Word-host matrix
```

**The graph is not the whole gate.** A green automated run is never a release
claim. The Word-host evidence gate is human, lives in
[`docs/manual-verification.md`](../../../docs/manual-verification.md), and stays
open until a person runs the add-in. Do not describe a passing run as a
released or verified product (ADR-0051).

## Tools and permissions

This skill is an instruction package and registers no new executable tools. It
uses standard file-edit, search, and terminal tools.

Live Word verification requires sideloading (`npm run sideload`) and cannot run
headless. Live LLM calls require a credential in the gitignored `.env` consumed
by the Node-side development broker. Unit tests must stay offline: use
`MockAdapter` and the injected `fetch` doubles.

## Referenced resources

- [`ROADMAP.md`](../../../ROADMAP.md) — canonical stage ordering and status
- [`docs/architecture.md`](../../../docs/architecture.md) — module boundaries
- [`docs/decision-log.md`](../../../docs/decision-log.md) — ADRs
- [`docs/onboarding.md`](../../../docs/onboarding.md) — setup and troubleshooting
- [`docs/privacy-security.md`](../../../docs/privacy-security.md) — privacy posture
- [`docs/manual-verification.md`](../../../docs/manual-verification.md) — human host gate
- [`.cline/rules/toneforge.md`](../../rules/toneforge.md) — governance hard rules
- [`scripts/verification-graph.mjs`](../../../scripts/verification-graph.mjs)
