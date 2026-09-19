# ToneForge — Project State

Per-stage status per the Stage protocol in `ROADMAP.md`. Updated after each stage gate.

| Stage | Title                      | Status  | Gate     | Notes                                                                                                               |
| ----- | -------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 00    | Repository discovery       | PASS    | Yes      | Baseline established: README, LICENSE, ROADMAP, .gitignore                                                          |
| 01    | Office.js capability spike | PASS    | **Hard** | `probeWordCapabilities()` rewritten non-destructive; dryRun default. Must still run in Word web/desktop to confirm. |
| 02    | Scaffold                   | PASS    | Yes      | Full scaffold committed: manifest, src tree, tooling, CI, docs                                                      |
| 03    | Cline governance           | PASS    | Yes      | `.cline/rules/toneforge.md` + `.roo/skills/` stubs exist                                                            |
| 04    | Domain model               | PASS    | Yes      | `src/core/domain` types defined, Zod schemas hardened, tests added                                                  |
| 05    | Storage/state              | PASS    | Yes      | `src/core/state` persistence with saveAsync + migration v0→v1                                                       |
| 06    | LLM provider layer         | PASS    | Yes      | `src/ai/providers` interface + OpenAI + mock + registry + retry                                                     |
| 07    | Settings UI                | PENDING | Yes      | —                                                                                                                   |
| 08    | Style sample               | PENDING | Yes      | —                                                                                                                   |
| 09    | Deterministic metrics      | PENDING | Yes      | —                                                                                                                   |
| 10    | Style profiler             | PENDING | Yes      | —                                                                                                                   |
| 11    | Editable Style Profile UI  | PENDING | Yes      | —                                                                                                                   |
| 12    | Profile versioning         | PENDING | Yes      | —                                                                                                                   |
| 13    | Typography rules           | PENDING | Yes      | —                                                                                                                   |
| 14    | House style rules          | PENDING | Yes      | —                                                                                                                   |
| 15    | Formatting engine          | PENDING | Yes      | —                                                                                                                   |
| 16    | Unified findings           | PENDING | Yes      | —                                                                                                                   |
| 17    | Change planning            | PENDING | Yes      | —                                                                                                                   |
| 18    | Revision adapter           | BLOCKED | **Hard** | Gated on Stage 01 in-Word PASS. `applyChangePlan()` refuses until `setStage01Passed(true)`.                         |
| 19    | Semantic deviation         | PENDING | Yes      | —                                                                                                                   |
| 20    | Consistency checker        | PENDING | Yes      | —                                                                                                                   |
| 21    | Reformat orchestrator      | PENDING | Yes      | —                                                                                                                   |
| 22    | Safe application           | PENDING | Yes      | —                                                                                                                   |
| 23    | Accessibility/UX           | PENDING | Yes      | —                                                                                                                   |
| 24    | Performance                | PENDING | Yes      | —                                                                                                                   |
| 25    | Security/privacy           | PENDING | Yes      | —                                                                                                                   |
| 26    | Test/review                | PENDING | Yes      | —                                                                                                                   |
| 27    | Manual Word verification   | PENDING | **Hard** | —                                                                                                                   |
| 28    | Release candidate          | PENDING | **Hard** | —                                                                                                                   |

## Legend

- **PASS** — all checks green, committed.
- **PASS WITH DOCUMENTED LIMITATION** — committed with a known, accepted limitation.
- **BLOCKED** — cannot proceed; must resolve before next stage.
- **FAIL** — checks failed; must fix before commit.

## Remediation notes (Stage 1 audit)

- R1: Probe rewritten non-destructive (`dryRun: true` default); `supportsStyles`/`supportsRevisions` now return truthful values. In-Word execution still required for PASS.
- R2: Revision adapter frozen behind `STAGE_01_PASSED` flag; range-aware apply via `body.getRange`; `applyStyle`/`setListLevel` throw explicit `Unsupported` errors.
- R3: `manifest.json` fixed (URLs as strings, GUID for `webApplicationInfo.id`); `validate-manifest.mjs` updated.
- R4: Domain schemas hardened (`RangeSchema` refine, `ChangeSchema` superRefine for payload requirements, `emDash` enum fixed, `uuid.v4()` used).
- R5: `LlmProvider` extended with `profile()`/`deviations()`/`rewrite()` via `withSemanticHelpers`; OpenAI adapter honors `request.signal`, delegates retry to `withRetry()`, implements real `redact()`.
- R6: Prompt builders throw unless `includeRawText: true` is explicitly passed.
- R7: `persistence.ts` calls `saveAsync` after `set`; `migration.ts` implements v0→v1 with `version` field.
- R8: `documentReader.ts` uses stable doc ID + FNV hash + chunked read; `officeHelpers.ts` typed; `tests/setup.ts` mock shape fixed.
- R9: Traceability restored (this file); ADRs added for domain, persistence, fetch adapter, destructive probe.
- R10: New tests added for Change, Finding, migration, prompts, revision adapter gate; 72 tests passing.
