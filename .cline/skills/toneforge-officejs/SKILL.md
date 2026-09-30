---
name: toneforge-officejs
description: Read and mutate the Word document correctly in ToneForge. Use when working in src/word, acquiring document content, applying a ChangePlan, or debugging host capability and Office.js sync issues.
---

# Office.js for ToneForge

Use this skill for any code that touches the live Word document.

## When to use

- Reading document content or paragraph structure.
- Acquiring analysis input.
- Applying a plan, or debugging why apply refused.
- Debugging host compatibility, capability probes, or `Office is undefined`.

Trigger phrases: "read the Word document", "probe Word capabilities", "apply
ChangePlan", "revision adapter blocked", "Office.js sync error", "acquisition".

## Entry point — always use the wrapper

Never call `Office.run` directly. Route host access through `runInWord` from
[`src/shared/office/officeHelpers.ts`](../../../src/shared/office/officeHelpers.ts):

```ts
import { runInWord } from "../shared/office/officeHelpers";

await runInWord(async (context) => {
  const body = context.document.body;
  body.load("text");
  await context.sync();
  return body.text;
});
```

Helpers there: `isOfficeReady()`, `ensureOfficeReady()`, `runInWord(func)`, and
`context()`. If you need `Word.RequestContext` rather than `Office.Context`,
narrow inside the callback instead of importing Word types.

Always `await context.sync()` after `load()` before reading a property.

## Reading: which reader

| Need                                  | Use                                                                  |
| ------------------------------------- | -------------------------------------------------------------------- |
| Production analysis input             | [`analysisAcquisition.ts`](../../../src/word/analysisAcquisition.ts) |
| Compatibility text or structured read | [`documentReader.ts`](../../../src/word/documentReader.ts)           |
| Formatting provenance                 | [`formattingReader.ts`](../../../src/word/formattingReader.ts)       |
| Selection text or paragraph location  | [`sourceLocator.ts`](../../../src/word/sourceLocator.ts)             |

`analysisAcquisition` performs the single-pass read and produces identity,
bounded analysis text, structured paragraph and style nodes, formatting
provenance, capability data, and **explicit unsupported scope**. Unsupported
scope must be reported, not silently dropped: a partial read presented as
complete is the defect this design exists to prevent.

Office.js types live in [`src/types/office.d.ts`](../../../src/types/office.d.ts),
which `tsconfig.json` already includes. Do not add `@types/office.js`.

## Mutating: one path, gated

Only [`revisionAdapter.ts`](../../../src/word/revisionAdapter.ts) writes. Rules
and UI never call `Office.run` to change the document. `taskpane` and `commands`
are forbidden by eslint from importing the adapter directly; mutations go
through the orchestrator.

The apply chain, in order:

1. `prepareTrackedEditing()` runs a fresh **non-destructive** host probe, maps
   every planned change to its required Word capability, and arms the adapter
   only when the complete plan is supported.
2. `applyReviewedPlan()` re-checks plan freshness by hash, refuses conflicts and
   protected ranges, establishes managed Track Changes, and applies changes in
   reverse offset order.
3. It performs a post-apply readback and reports mutation and verification
   outcomes **separately** — a change can be written and still fail verification.

It refuses a plan when managed tracking cannot be established. Disabling the
tracked-editing preference disarms mutation immediately while leaving preview
and review available.

**Do not reintroduce a bypass.** The Stage 18 smoke helpers (`SmokePanel`,
`smokePlan`, `smokeApply`, `enableSmokeMutations`) were deleted because they
made the user-facing claim "Track Changes can never be bypassed" untrue
(ADR-0058). `setStage01Passed()` is called from `prepareTrackedEditing` only.
`STAGE_01_PASSED` stays false until a real host has been probed; a UI that
reports "Enabled" before a probe has run is stating something untrue.

Probes are non-destructive by default and stay that way. No opt-in mutation
path in a probe.

## Testing

[`tests/setup.ts`](../../../tests/setup.ts) provides a minimal `Office` mock
(`run`, `roamingSettings`, `InsertBreakBehavior`). Use it instead of a live Word
instance. Fixtures live in
[`tests/fixtures/`](../../../tests/fixtures/).

Live verification is a **human** gate: sideload with `npm run sideload`, run the
add-in, and record the result in
[`docs/manual-verification.md`](../../../docs/manual-verification.md). A mocked
host result never closes it.

## Referenced resources

- [`src/shared/office/officeHelpers.ts`](../../../src/shared/office/officeHelpers.ts) — `runInWord`
- [`src/word/revisionAdapter.ts`](../../../src/word/revisionAdapter.ts) — sole mutation path
- [`src/word/analysisAcquisition.ts`](../../../src/word/analysisAcquisition.ts) — production read
- [`src/word/capabilityProbe.ts`](../../../src/word/capabilityProbe.ts) — non-destructive probe
- [`src/reformat/orchestrator.ts`](../../../src/reformat/orchestrator.ts) — `applyReviewedPlan`
- [`src/reformat/trackedEditing.ts`](../../../src/reformat/trackedEditing.ts) — `prepareTrackedEditing`
- [`docs/manual-verification.md`](../../../docs/manual-verification.md) — human host gate
- [`docs/decision-log.md`](../../../docs/decision-log.md) — ADR-0005, ADR-0012, ADR-0058
