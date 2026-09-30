---
name: toneforge-officejs-boundary
description: Route all Word access through runInWord and never mutate Word directly from rules or UI.
---

# Office.js Boundary

All Word/Office.js interaction must go through `runInWord` in
`src/shared/office/officeHelpers.ts`. Direct `Office.run` calls and direct
Word mutations from rules or UI are forbidden.

## When to use

- Writing or modifying any code that accesses the Word document.
- Creating new `src/word/` modules or extending existing ones.
- Debugging host-compatibility or "Office is undefined" issues.

## Rules

### 1. Always use `runInWord`, never `Office.run` directly

`runInWord` wraps `Office.run` with readiness checks (`ensureOfficeReady`)
and consistent typing against `Office.Context`. It is the single entry point
for host access.

```ts
import { runInWord } from "../shared/office/officeHelpers";

await runInWord(async (context) => {
  const body = context.document.body;
  body.load("text");
  await context.sync();
  return body.text;
});
```

- If you need `Word.RequestContext` (not just `Office.Context`), narrow the
  parameter inside the callback — do not import `Word` types directly.
- Never call `Office.run` inline in a component, command, or rule module.

**Evidence:** `src/shared/office/officeHelpers.ts` lines 37-42;
`toneforge-officejs` skill "Entry point — always use the wrapper".

### 2. Only `src/word/revisionAdapter.ts` mutates Word

Rules and UI must never call `Office.run` to mutate the document. All changes
flow through `ChangePlan` → `applyChangePlan()` in `revisionAdapter.ts`.

- ESLint enforces this: `ui/*` (`taskpane/`, `commands/`) may not import
  `word/revisionAdapter` directly — mutations go through the orchestrator.
- The production apply chain is `prepareTrackedEditing()` in
  `src/reformat/trackedEditing.ts`, which runs a fresh non-destructive host
  probe and arms the adapter only when the **complete** plan is supported, then
  `applyReviewedPlan()` in `src/reformat/orchestrator.ts`, which re-checks
  freshness, refuses conflicts and protected ranges, establishes managed Track
  Changes, and reports mutation and verification outcomes separately.
- **Do not reintroduce a mutation bypass.** The Stage 18 smoke helpers
  (`SmokePanel`, `smokePlan`, `smokeApply`, `enableSmokeMutations`) were deleted
  because they made the user-facing claim "Track Changes can never be bypassed"
  untrue (ADR-0058). `setStage01Passed()` is called from `prepareTrackedEditing`
  only, and stays false until a real host has been probed.

**Evidence:** `docs/architecture.md` "One mutation path";
`src/word/revisionAdapter.ts`; `src/reformat/trackedEditing.ts`;
`src/reformat/orchestrator.ts`; ADR-0005; ADR-0058.

### 3. Probes are non-destructive by default

`probeWordCapabilities()` takes no arguments and is always non-destructive. It
inspects the host object model only — no `insertText`, `insertParagraph`,
or `insertBreak`. There is no opt-in mutation path in a probe.

**Evidence:** ADR-0012 in `docs/decision-log.md`;
`src/word/capabilityProbe.ts`.

### 4. Use local Office.js types, not `@types/office.js`

Office.js type declarations live in `src/types/office.d.ts` and are included
via `tsconfig.json`. Do not add `@types/office.js` as a dependency.

**Evidence:** `tsconfig.json` `include` array.

### 5. A mocked host never closes the host gate

`npm run host:matrix` currently reports hosts with **0 fully passing**. Real
Word verification is a human step, recorded in
`docs/manual-verification.md`. Unit mocks do not change that, and no comment or
test should imply otherwise.

## Referenced resources

- `src/shared/office/officeHelpers.ts` — `runInWord`, `isOfficeReady`, `context`
- `src/word/analysisAcquisition.ts` — the production analysis read
- `src/word/documentReader.ts` — compatibility text/structured reader
- `src/word/revisionAdapter.ts` — sole mutation path
- `src/reformat/trackedEditing.ts` — `prepareTrackedEditing`
- `src/word/capabilityProbe.ts` — non-destructive probe
- `src/types/office.d.ts` — local Office.js declarations
- `docs/manual-verification.md` — the human host gate
- `docs/architecture.md` — module boundaries
- `docs/decision-log.md` — ADR-0005, ADR-0012, ADR-0058
- `.cline/skills/toneforge-officejs/SKILL.md` — the Cline equivalent of this rule
