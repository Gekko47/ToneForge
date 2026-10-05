---
name: toneforge-officejs
description: Work with Word documents via Office.js in ToneForge. Use when reading document content, probing Word capabilities, implementing the revision adapter, or debugging host compatibility through the runInWord wrapper. Apply Ponytail first — YAGNI, reuse existing code, minimal diff.
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
- The production chain is `prepareTrackedEditing()` in `src/reformat/trackedEditing.ts` — a fresh non-destructive probe that arms the adapter only when the **complete** plan is supported — then `applyReviewedPlan()` in `src/reformat/orchestrator.ts`, which re-checks freshness, refuses conflicts and protected ranges, establishes managed Track Changes, applies in reverse offset order, and reports mutation and verification separately.
- **Do not reintroduce a mutation bypass.** The Stage 18 smoke helpers (`SmokePanel`, `smokePlan`, `smokeApply`, `enableSmokeMutations`) were deleted because they made the user-facing claim "Track Changes can never be bypassed" untrue (ADR-0058). `setStage01Passed()` is called from `prepareTrackedEditing` only, and stays false until a real host has been probed.
- Always call `context.sync()` after loading properties.
- Wrap host calls in try/catch and record failures as capability flags (see `src/word/capabilityProbe.ts` — non-destructive).

## Reading

- `src/word/analysisAcquisition.ts` — the production single-pass analysis read, producing identity, structured nodes, formatting provenance, and explicit unsupported scope.
- `src/word/documentReader.ts` — the compatibility text and structured reader.
- `src/word/sourceLocator.ts` — selection and paragraph location.

## Testing

`tests/setup.ts` provides a minimal `Office` mock (`run`, `roamingSettings`,
`InsertBreakBehavior`). Use it to test `word/` modules without a live Word
instance. Fixtures live in `tests/fixtures/`.

Live Word verification is a **human** gate: `npm run host:matrix` currently
reports 0 fully passing hosts, and the evidence is recorded in
`docs/manual-verification.md`. A mock never closes it.

## Tools and permissions

This skill is an instruction package — it registers no new executable tools.
Live Word verification requires sideloading (`npm run sideload`) and cannot run
headless; unit tests use the `tests/setup.ts` mock instead.

## Referenced resources

- `src/word/capabilityProbe.ts` — non-destructive probe
- `src/word/analysisAcquisition.ts` — production acquisition
- `src/word/documentReader.ts` — compatibility reader
- `src/word/revisionAdapter.ts` — sole mutation path
- `src/reformat/trackedEditing.ts` — `prepareTrackedEditing`
- `src/shared/office/officeHelpers.ts` — `runInWord`, readiness checks
- `src/types/office.d.ts` — local Office.js declarations
- `docs/manual-verification.md` — the human host gate
- `docs/decision-log.md` — ADR-0005, ADR-0012, ADR-0058
- `.cline/skills/toneforge-officejs/SKILL.md` — the Cline equivalent of this skill
