---
paths:
  - "ROADMAP.md"
  - "docs/decision-log.md"
  - "docs/project-state.md"
  - "docs/stages/**"
  - "docs/CHANGELOG.md"
  - "commitlint.config.cjs"
  - ".husky/**"
---

# Commits and Documentation

## Rules

### 1. Conventional commits with roadmap-aligned scopes

Type must be one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `spike`, `style`, `test`, `security`. Scope matches the
stage or phase:

```text
feat(word): add native revision adapter              # Stage 18
feat(style): add deterministic style metrics         # Stage 09
feat(ai): add resilient provider adapters             # Stage 06
spike: verify Word revision and document capabilities # Stage 01
chore: scaffold ToneForge Office add-in              # Stage 02
test: complete regression and review pass            # Stage 26
```

The body explains the **why**, and references the stage file and any ADR.

### 2. Update the status where it actually lives

[`ROADMAP.md`](../../ROADMAP.md) is the **canonical** roadmap, status ledger, and
release-gate record. [`docs/project-state.md`](../../docs/project-state.md) is a
compatibility and evidence index that cross-references it, not a second plan.
When they disagree, ROADMAP wins. Do not duplicate a status table in
project-state.

State a stage as **PASS**, **PASS WITH DOCUMENTED LIMITATION**, **IMPLEMENTED**,
**PARTIAL**, **BLOCKED**, or **NOT STARTED**, and say which gates were checked and
what remains open.

### 3. Record architectural decisions as ADRs

Any new module boundary, schema change, dependency, or API contract gets an ADR
in [`docs/decision-log.md`](../../docs/decision-log.md) with Context, Decision,
Consequences, and Status. Update an existing ADR when a decision is revisited —
do not append a contradictory entry. Take the next ADR number; do not reuse one.

Record an **exception as an exception**. ADR-0052 authorizes one non-deterministic
engine. A second one contradicts it and needs its own ADR saying so.

### 4. Never claim verification you did not perform

A mocked host is a typed contract, not an integration. A green automated graph is
not a release. When something has never run against a real document, a real
model, or a real Word host, say so in the status — a limitation written down is
fine, a limitation reported as working is not.

### 5. Never commit secrets

Keys live only in the gitignored `.env` (read by the Node-side development
broker) or in the local gateway's memory. `.env.example` is the committable
template. `npm run secrets:scan` and `secrets:verify-build` run in the graph.

## Referenced resources

- [ROADMAP.md](../../ROADMAP.md) — canonical status
- [docs/project-state.md](../../docs/project-state.md) — evidence index
- [docs/decision-log.md](../../docs/decision-log.md) — ADRs
- [commitlint.config.cjs](../../commitlint.config.cjs) — message rules
