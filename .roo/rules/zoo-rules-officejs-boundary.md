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
- `applyChangePlan()` is gated on `STAGE_01_PASSED` (Stage 01 hard gate) and
  refuses stale plans on `docHash` mismatch.

**Evidence:** `docs/architecture.md` "One mutation path"; ADR-0005;
`eslint.config.mjs` lines 110-128; `src/word/revisionAdapter.ts` lines 44-80.

### 3. Probes are non-destructive by default

`probeWordCapabilities()` takes no arguments and is always non-destructive.
It inspects the host object model only — no `insertText`, `insertParagraph`,
or `insertBreak`. There is no opt-in mutation path.

- If you need to test a live write, implement it as a separate, explicitly
  opt-in utility (deferred to Stage 27). Do not relax the probe.

**Evidence:** ADR-0012 in `docs/decision-log.md`;
`src/word/capabilityProbe.ts` lines 43-57.

### 4. Use local Office.js types, not `@types/office.js`

Office.js type declarations live in `src/types/office.d.ts` and are included
via `tsconfig.json`. Do not add `@types/office.js` as a dependency.

**Evidence:** `toneforge-officejs` skill "Type declarations";
`tsconfig.json` `include` array.

## Referenced resources

- `src/shared/office/officeHelpers.ts` — `runInWord`, `isOfficeReady`, `context`
- `src/word/revisionAdapter.ts` — sole mutation path
- `src/word/capabilityProbe.ts` — non-destructive probe
- `src/types/office.d.ts` — local Office.js declarations
- `docs/architecture.md` — module boundaries
- `docs/decision-log.md` — ADR-0005, ADR-0012, ADR-0013
