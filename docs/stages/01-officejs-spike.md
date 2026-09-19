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

- [ ] `probeWordCapabilities()` returns a complete `WordCapabilities` object
- [ ] Probe runs inside Word without unhandled exceptions
- [ ] Results recorded in `docs/manual-verification.md`
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (unit test for probe structure)

## Status

PENDING — must run inside Word.
