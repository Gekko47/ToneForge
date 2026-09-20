# Stage 01 — Office.js capability spike

**Gate**: **Hard**

## Objective

Verify Word revision and document capabilities BEFORE building the reformatter.

## Scope

- Implement `src/word/capabilityProbe.ts` with `probeWordCapabilities()`.
- Probe: insert text, replace text, insert paragraph, insert break, styles, revisions.
- Record host name and version.
- Run the probe inside Word on the web (Chrome/Edge) and Word desktop.
- Document results in `docs/manual-verification.md`.

## Critical ordering rule

**Do not build the full reformatter before proving native Word revision behavior.**

If `supportsRevisions` is false, the stage is PASS WITH DOCUMENTED LIMITATION and Stages 15-21 must use tracked-change insertion with explicit documentation.

## Verification

- [x] `probeWordCapabilities()` returns a complete `WordCapabilities` object
- [x] `npm run typecheck` passes
- [x] `npm run test` passes (probe structure + failure injection)
- [x] Task pane loads via webpack-dev-server on https://localhost:3000
- [x] "Probe Word capabilities" button renders and is clickable in the pane
- [x] "Diagnose Office runtime" button added for non-destructive host inspection
- [ ] Probe runs inside Word without unhandled exceptions
- [ ] Results recorded in `docs/manual-verification.md`

## Status

PARTIAL — code, tests, and ADR are in place; the probe is non-destructive and
truthful in mocked environments. **In-Word execution on web/desktop remains
required for PASS** and is human-only (see `docs/manual-verification.md`).

## Runtime findings

- The task pane renders correctly when served from `https://localhost:3000/taskpane.html`.
- The `Office` global is `undefined` when loaded directly in a browser (outside
  Word), which is expected — Word injects `Office.js` into the taskpane iframe.
- `probeOfficeRuntime()` (in `src/shared/office/diagnostics.ts`) reports this
  state without throwing, and `officeInit.ts` resolves immediately when `Office`
  is absent so the UI never blocks.
- The favicon 404 from the dev server has been silenced with an inline SVG
  data-URI in `src/taskpane/taskpane.html`.
- A "Diagnose Office runtime" button on the Dashboard triggers
  `probeOfficeRuntime()` and renders the formatted output, enabling quick
  verification of host globals during sideload testing.
- `probeWordCapabilities()` is wired to the "Probe Word capabilities" button;
  it calls `Word.run` and is only meaningful when the add-in is loaded inside
  Word (where `Office` and `Word` globals are present).
