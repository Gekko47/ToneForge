---
paths:
  - "src/word/**"
  - "src/shared/office/**"
  - "src/taskpane/**/*.ts"
  - "src/taskpane/**/*.tsx"
  - "src/commands/**"
  - "src/reformat/**"
  - "src/types/office.d.ts"
---

# Office.js Boundary and Safe Mutation

All Word access goes through `runInWord`. Only the revision adapter writes.

## Rules

### 1. Always use `runInWord`, never `Office.run` directly

[`src/shared/office/officeHelpers.ts`](../../src/shared/office/officeHelpers.ts) is
the single entry point for host access. It wraps `Office.run` with readiness
checks. Never call `Office.run` inline in a component, command, or rule. If you
need `Word.RequestContext`, narrow inside the callback rather than importing Word
types. Always `await context.sync()` after `load()`.

Use [`analysisAcquisition.ts`](../../src/word/analysisAcquisition.ts) for the
production analysis read; report its unsupported scope explicitly rather than
dropping it silently.

### 2. Only `revisionAdapter.ts` mutates Word

Every change flows through `ChangePlan` to the adapter. `taskpane` and
`commands` are forbidden by ESLint from importing it directly.

The apply chain: `prepareTrackedEditing()` runs a fresh non-destructive probe and
arms the adapter only when the **complete** plan is supported; `applyReviewedPlan()`
re-checks freshness by hash, refuses conflicts and protected ranges, establishes
managed Track Changes, applies in reverse offset order, then reads back — and
reports mutation and verification outcomes separately.

### 3. Do not reintroduce a mutation bypass

The Stage 18 smoke helpers were deleted because they made the user-facing claim
"Track Changes can never be bypassed" untrue (ADR-0058).
`setStage01Passed()` is called from `prepareTrackedEditing` only. It stays false
until a real host has been probed; reporting "Enabled" before a probe has run
states something untrue. Probes are non-destructive and stay that way.

### 4. Use the local Office.js types

Declarations live in [`src/types/office.d.ts`](../../src/types/office.d.ts), already
included by `tsconfig.json`. Do not add `@types/office.js`.

### 5. A mocked host never closes the host gate

The Word-host evidence gate is human, recorded in
[`docs/manual-verification.md`](../../docs/manual-verification.md). `npm run host:matrix`
currently reports hosts with **0 fully passing**. Unit mocks do not change that,
and no comment or test should imply otherwise.

## Referenced resources

- [src/word/revisionAdapter.ts](../../src/word/revisionAdapter.ts) — sole mutation path
- [src/reformat/orchestrator.ts](../../src/reformat/orchestrator.ts) — `applyReviewedPlan`
- [src/reformat/trackedEditing.ts](../../src/reformat/trackedEditing.ts) — `prepareTrackedEditing`
- [docs/decision-log.md](../../docs/decision-log.md) — ADR-0005, ADR-0012, ADR-0058
- [.cline/skills/toneforge-officejs/SKILL.md](../skills/toneforge-officejs/SKILL.md)
