---
name: toneforge-officejs
description: Work with Word documents via Office.js in ToneForge. Use when reading document content, probing Word capabilities, implementing the revision adapter, or debugging host compatibility through the runInWord wrapper.
---

# Office.js for ToneForge

Use this skill when working with Word-specific code in `src/word/`.

## When to use

- Reading or writing document content via Office.js.
- Probing Word capabilities (Stage 01 via `src/word/capabilityProbe.ts`).
- Reading text via `src/word/documentReader.ts`.
- Implementing the revision adapter (Stage 18 via `src/word/revisionAdapter.ts`).
- Debugging host compatibility issues.

Trigger phrases: "read the Word document", "probe Word capabilities", "apply ChangePlan", "revision adapter blocked", "Office.js sync error".

## Entry point — always use the wrapper

Do not call `Office.run` directly. Route all host access through
`runInWord` from `src/shared/office/officeHelpers.ts`:

```ts
import { runInWord } from "../shared/office/officeHelpers";

await runInWord(async (context: Office.Context) => {
  const body = context.document.body;
  body.load("text");
  await context.sync();
  return body.text;
});
```

Helpers in `src/shared/office/officeHelpers.ts`:

- `isOfficeReady()` / `ensureOfficeReady()` — runtime detection.
- `runInWord(func)` — typed against `Office.Context`; narrows to `Word.RequestContext` inside the callback when needed.
- `context()` — returns `Office.Context | null`.

## Key APIs

- `context.document.body` — document body; call `load("text")` then `await context.sync()` before reading `text`.
- `context.document.getSelection()` — current selection.
- `range.insertText(text, "Replace")` — replace selection text.
- `range.insertBreak(Office.InsertBreakBehavior.Paragraph)` — insert paragraph break.
- `context.sync()` — flush queued commands to the host; required after every `load()`.

## Type declarations

Office.js types live in `src/types/office.d.ts`. Import nothing from
`@types/office.js` — use the local declaration. `tsconfig.json` already
includes it.

## Safety — one mutation path

- Never mutate Word directly from rules or UI. Route all mutations through `src/word/revisionAdapter.ts` (`applyChangePlan`).
- `applyChangePlan()` refuses to mutate until `setStage01Passed(true)` (Stage 01 gate). Before the gate it returns `applied: false` with a "Stage 01 … not passed" error per change.
- It also validates the plan and refuses stale plans on `docHash` mismatch.
- Always call `context.sync()` after loading properties.
- Wrap host calls in try/catch and record failures as capability flags (see `src/word/capabilityProbe.ts` — non-destructive, `dryRun: true` default).

## Testing

`tests/setup.ts` provides a minimal `Office` mock (`run`, `roamingSettings`,
`InsertBreakBehavior`). Use it to test `word/` modules without a live Word
instance. Fixtures live in `tests/fixtures/sampleDocs.ts`.

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
Live Word verification requires sideloading (`npm run dev` + `npm run sideload`)
and cannot run headless; unit tests use the `tests/setup.ts` mock instead.

## Referenced resources

- `src/word/capabilityProbe.ts` — Stage 01 probe (`probeWordCapabilities`)
- `src/word/documentReader.ts` — chunked read with stable doc ID + FNV hash fallback
- `src/word/revisionAdapter.ts` — sole mutation path, `STAGE_01_PASSED` gate
- `src/shared/office/officeHelpers.ts` — `runInWord`, readiness checks
- `src/types/office.d.ts` — local Office.js declarations
- `tests/setup.ts` — Office mock for tests
- `docs/stages/01-officejs-spike.md`, `docs/stages/18-revision-adapter.md`
