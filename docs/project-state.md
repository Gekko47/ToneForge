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

| Evidence area          | Current evidence                                                                                                                                             | Limitation / follow-up                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Original stages 00–22  | Git history contains the stage implementations through `feat(safety): add stale-result protection and safe application`; source and tests are present.       | See the canonical Stage table in [`ROADMAP.md`](../ROADMAP.md) for status and exact qualifications.                                  |
| Phase B observer       | Commit `d9a7dbf` adds the observer, coordinator, status hook, and tests.                                                                                     | The observer does not yet receive a verified Word change-range event; current fallback can rescan all nodes.                         |
| Phases A, C–F          | Domain, state v3, coverage, protection, registered commands, AI review, UX, safe-apply verification, export, and regression tests are committed.             | Live host behavior and structural/perf/security limitations remain qualified in the Refactor table in [`ROADMAP.md`](../ROADMAP.md). |
| Phase G/H seam         | [`src/analysis/consistency/README.md`](../src/analysis/consistency/README.md) and the lint boundary exist.                                                   | The proposed types stub and CI guard are not present; Phase H is reserved and not started.                                           |
| Automated verification | Typecheck, lint, format, secret/docs scans, tests, coverage, build, artifact budgets, manifest validation, and staging verification are release-chain gates. | Webpack emits no performance warnings; release acceptance remains blocked by host evidence.                                          |
| Test suite             | Full Vitest suite and focused regression suites pass.                                                                                                        | Warning/refusal tests intentionally emit diagnostic stderr logs.                                                                     |
| Coverage               | `npm run test:coverage` passes the 80% gate across exercised production modules; taskpane behavior is component-tested and built separately.                 | `all: false` avoids Windows V8 path-case duplicate records; untested entrypoint TSX is not counted as exercised core code.           |
| Host verification      | Desktop Word evidence is recorded in [`manual-verification.md`](manual-verification.md).                                                                     | Web Chrome, web Edge, Mac, and new Phase C/E paths remain open.                                                                      |
| Release                | Version `0.2.0`, JSON manifest, XML fallback, changelog, deterministic staging, release gate, and release workflow exist.                                    | Stage 27 host evidence is open; `npm run release:check` must remain blocked.                                                         |

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
2. Record live 50k-word performance, observer event-range, accessibility, and
   formal security evidence.
3. Complete release acceptance in Word Windows plus web Chrome/Edge; Mac is
   conditional on the supported-host decision.
4. Consider the reserved Phase H consistency expansion only after release
   acceptance.

The deterministic repository chain and 80% exercised-core coverage gate are
green. The release check is intentionally blocked by the open human Word-host
matrix; see [`manual-verification.md`](manual-verification.md).
