---
name: toneforge-commit-docs
description: Use conventional commits with roadmap-aligned scopes and keep project-state and decision-log updated after each stage.
---

# Commit & Docs Conventions

Commits follow conventional commits with scopes aligned to ROADMAP stages.
Project state and architectural decisions must be documented after each stage.

## When to use

- Committing code changes.
- Updating `docs/project-state.md` or `docs/decision-log.md`.
- Deciding on a commit message format or scope.

## Rules

### 1. Use conventional commits with roadmap-aligned scopes

Commit type must be one of: `build`, `chore`, `ci`, `docs`, `feat`, `fix`,
`perf`, `refactor`, `revert`, `spike`, `style`, `test`, `security`.

Scope must align with the ROADMAP stage being implemented:

```
feat(word): add native revision adapter          # Stage 18
feat(style): add deterministic style metrics     # Stage 09
feat(ai): add resilient provider adapters         # Stage 06
spike: verify Word revision and document capabilities  # Stage 01
chore: scaffold ToneForge Office add-in           # Stage 02
test: complete regression and review pass         # Stage 26
docs: establish ToneForge implementation baseline # Stage 00
```

- Subject must be sentence-case, lower-case, or upper-case (per
  `commitlint.config.cjs`).
- Body must explain the **why**, not just the **what**. Reference the stage
  file in `docs/stages/` and any ADR created.

**Evidence:** `commitlint.config.cjs` lines 1-51; `.cline/rules/toneforge.md`
"Commit conventions"; `ROADMAP.md` stage map.

### 2. Update `docs/project-state.md` after each stage

After completing a stage (or determining it is BLOCKED/FAIL), update the
status table in `docs/project-state.md`:

- Set the stage status to PASS, PASS WITH DOCUMENTED LIMITATION, BLOCKED, or FAIL.
- Add a concise note describing what was done, what gates were checked, and
  any open limitations.
- If a hard gate remains open (e.g. Stage 01 in-Word execution), mark the
  stage PARTIAL and note the blocker.

**Evidence:** `docs/project-state.md` lines 5-35; `ROADMAP.md` "Stage protocol"
step 7.

### 3. Record architectural decisions in `docs/decision-log.md`

Any architectural choice (new module boundary, schema change, dependency
addition, API contract) must be recorded as an ADR in
`docs/decision-log.md`:

- Context: what problem or constraint motivated the decision.
- Decision: what was chosen.
- Consequences: what follows (positive and negative).
- Status: Accepted / Superseded / Rejected.

- Update an existing ADR if the decision is revisited; do not append
  contradictory entries.

**Evidence:** `docs/decision-log.md` (ADR-0001 through ADR-0015);
`ROADMAP.md` "Stage protocol" step 8.

### 4. Never commit secrets

API keys, tokens, and credentials must never be committed. They live in
`.env` (gitignored) or `Office.roamingSettings`. `.env.example` is the
safe template to commit.

**Evidence:** `.gitignore`; `.env.example`; `docs/privacy-security.md`;
`.cline/rules/toneforge.md` "Hard rules".

## Referenced resources

- `commitlint.config.cjs` — commit message rules
- `docs/project-state.md` — per-stage status table
- `docs/decision-log.md` — architectural decision records
- `ROADMAP.md` — stage map and stage protocol
- `.gitignore` — secret exclusion
- `.env.example` — safe env template
- `.cline/rules/toneforge.md` — governance hard rules
