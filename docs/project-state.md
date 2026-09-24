# ToneForge — Project State

This file is the historical stage-gate evidence index. **The canonical roadmap,
sequencing, status ledger, refactor mapping, and release-gate decisions are in
[`ROADMAP.md`](../ROADMAP.md).** Do not treat this file as a competing plan.

The original project protocol remains:

1. inspect the current implementation;
2. implement only the agreed stage scope;
3. run targeted tests and the ordered verification chain;
4. record architectural decisions in [`decision-log.md`](decision-log.md);
5. update the evidence below and cross-reference the canonical status in
   [`ROADMAP.md`](../ROADMAP.md);
6. commit only after the applicable gate passes.

## Canonical status pointer

See the tables and phase ledger in [`ROADMAP.md`](../ROADMAP.md) for the
authoritative status of Stages 00–28 and Refactor Phases A–H. This page records
supporting evidence and known limitations; it intentionally does not duplicate
the status table.

## Evidence index

| Evidence area           | Current evidence                                                                                                                                       | Limitation / follow-up                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Original stages 00–22   | Git history contains the stage implementations through `feat(safety): add stale-result protection and safe application`; source and tests are present. | See the canonical Stage table in [`ROADMAP.md`](../ROADMAP.md) for status and exact qualifications.                               |
| Phase B observer        | Commit `d9a7dbf` adds the observer, coordinator, status hook, and tests.                                                                               | The observer does not yet receive a verified Word change-range event; current fallback can rescan all nodes.                      |
| Phases A, C–F candidate | Domain, state v3, coverage, protection, AI review, UX, export, and tests are present in the uncommitted worktree.                                      | Treat these as worktree implementation until committed and gated; see the Refactor status table in [`ROADMAP.md`](../ROADMAP.md). |
| Phase G/H seam          | [`src/analysis/consistency/README.md`](../src/analysis/consistency/README.md) and the lint boundary exist.                                             | The proposed types stub and CI guard are not present; Phase H is reserved and not started.                                        |
| Automated verification  | `npm run typecheck`, `npm run lint`, `npm run format`, `npm run test`, `npm run build`, and `npm run validate` pass in the audit run.                  | Webpack emits asset-size/runtime warnings.                                                                                        |
| Test suite              | `npm run test` passes 58 files / 593 tests.                                                                                                            | Several tests intentionally exercise warning/refusal paths and emit stderr logs.                                                  |
| Coverage                | `npm run test:coverage` runs but fails the global threshold.                                                                                           | Measured: 43.13% lines/statements, 66.60% functions, 76.95% branches versus 80% each.                                             |
| Host verification       | Desktop Word evidence is recorded in [`manual-verification.md`](manual-verification.md).                                                               | Web Chrome, web Edge, Mac, and new Phase C/E paths remain open.                                                                   |
| Release                 | Version `0.2.0`, JSON manifest, XML fallback, changelog, build, and release workflow exist.                                                            | Stage 27 and coverage gates are open; `npm run release:check` must not pass.                                                      |

## Historical stage notes

The following notes preserve the reasons for earlier decisions. They do not
supersede the canonical status table in [`ROADMAP.md`](../ROADMAP.md).

- Stage 01 is a hard-gate capability spike. The probe is non-destructive; live
  desktop evidence is recorded, while the full host matrix remains open.
- Stage 18 is the single Word mutation boundary. The live smoke exercises text
  insert/replace and tracking; unsupported break/style/list/format paths remain
  mock-verified.
- Stage 21 is the production reformat orchestrator. Deprecated smoke helpers
  remain for historical reproduction only.
- Stage 22 adds live re-hash, conflict refusal, adapter defense-in-depth, and
  preview/confirmation UX.
- Zoo rules under `.roo/rules/` remain governance controls and are not a second
  roadmap.

## Remediation history

- `manifest.xml` is present and validated; the earlier audit claim that it was
  missing was stale.
- `loadState()` invokes migration before schema parsing; the current schema is
  version 3 and preserves legacy keys.
- The Stage 01 probe is non-destructive and no longer mutates the document.
- Fluent UI is v8 in [`package.json`](../package.json); the older v9 references
  in historical plans are superseded by the implementation.
- The refactor strategy is additive evolution, recorded in ADR-0031. The
  incoming refactor proposal is retained as design/history, not as a second
  status ledger.

## Current open gates

1. Complete manual host verification in the matrix in
   [`manual-verification.md`](manual-verification.md).
2. Restore the global coverage gate or obtain an explicit approved policy
   change; do not silently lower [`vitest.config.ts`](../vitest.config.ts).
3. Finish and validate the uncommitted refactor work against the Refactor
   status table in [`ROADMAP.md`](../ROADMAP.md).
4. Complete release acceptance and only then consider the reserved Phase H
   consistency expansion.
