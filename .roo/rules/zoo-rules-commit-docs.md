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

### 2. Update the status where it actually lives

`ROADMAP.md` is the **canonical** roadmap, status ledger, and release-gate
record. `docs/project-state.md` is a compatibility and evidence index that
cross-references it, not a second plan. When they disagree, ROADMAP wins.

After completing a stage (or determining it is blocked), update the status:

- Set the status to PASS, PASS WITH DOCUMENTED LIMITATION, IMPLEMENTED, PARTIAL,
  BLOCKED, or NOT STARTED.
- Add a concise note describing what was done, which gates were checked, and any
  open limitations.
- If the Word-host gate remains open, say so. Do not report a passing automated
  graph as a release.

**Evidence:** `ROADMAP.md` "Original stages: verified status" and the phase
ledger; `docs/project-state.md` "Canonical status pointer".

### 3. Record architectural decisions in `docs/decision-log.md`

Any architectural choice (new module boundary, schema change, dependency
addition, API contract) must be recorded as an ADR in
`docs/decision-log.md`:

- Context: what problem or constraint motivated the decision.
- Decision: what was chosen.
- Consequences: what follows (positive and negative).
- Status: Accepted / Superseded / Rejected.

- Update an existing ADR if the decision is revisited; do not append
  contradictory entries. Take the next ADR number; do not reuse one.
- Record an **exception as an exception**. ADR-0052 authorizes one
  non-deterministic engine; a second one contradicts it and needs its own ADR
  saying so.
- Never claim verification you did not perform. A mocked host is a typed
  contract, not an integration, and a green automated run is not a release.

**Evidence:** `docs/decision-log.md` (ADR-0001 onward, including ADR-0052);
`ROADMAP.md` "Stage protocol" step 8.

### 4. Never commit secrets

API keys, tokens, and credentials must never be committed, and the add-in
never persists one at all. Keys live in the gitignored `.env` — read only by
the Node-side development broker — or in the local development gateway's memory.
`.env.example` is the safe template to commit.

`npm run secrets:scan` and `npm run secrets:verify-build` run in the
verification graph and will fail the commit.

**Evidence:** `.gitignore`; `.env.example`; `docs/privacy-security.md`;
`src/core/domain/ProviderConnection.ts`; ADR-0049, ADR-0050.

## Referenced resources

- `commitlint.config.cjs` — commit message rules
- `scripts/verification-graph.mjs` — the ordered verification graph
- `ROADMAP.md` — canonical status, sequencing, and release gates
- `docs/project-state.md` — evidence index (not a second status table)
- `docs/decision-log.md` — architectural decision records
- `.gitignore`; `.env.example` — secret exclusion and safe template
- `.cline/rules/toneforge.md` — governance hard rules
