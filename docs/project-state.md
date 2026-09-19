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
- R3: `manifest.json` rewritten as unified v1.30 manifest; `manifest.xml` rewritten as valid add-in-only fallback (bt namespace, Document host, Permissions, bt:Urls/ShortStrings/LongStrings); `validate-manifest.mjs` updated to v1.30 with `validateXmlFallback()` structural checks. Both manifests pass the Office validation service.
- R4: Domain schemas hardened: `ChangeRangeSchema` refine, discriminated-union payloads (`ChangePayloadSchema`) enforced via `superRefine`, `emDash`/`emDashSpacing` documented, `uuid.v4()` replaces `crypto.randomUUID()`. 39 domain tests.
- R5: OpenAI adapter uses `AbortSignal.any()`; caller-abort (non-retryable) is now distinguished from timeout (retryable); retry delegates to `withRetry()`; `redact()` strips emails, cards, API keys, and bearer tokens. 10 adapter tests.
- R6: Prompt builders throw unless `includeRawText: true`; `ProfileResponseSchema`/`DeviationResponseSchema` Zod parsers added for LLM outputs. 10 prompt tests.
- R7: `loadState()` falls back to defaults on corrupted/incompatible state instead of throwing; `saveState()` persists via `saveAsync`. 4 Office-path tests added.
- R8: `documentReader.ts` uses stable doc ID (Context.document.id) with FNV hash fallback + chunked read; `officeHelpers.ts` typed to `Office.Context`; 8 reader tests added.
- R9: Traceability restored (this file); ADR-0001 updated for manifest v1.30; ADR-0009 (domain schemas), ADR-0010 (persistence), ADR-0011 (fetch adapter), ADR-0012 (non-destructive probe) added.
- R10: New tests added for Change, ChangePlan, Finding, migration, prompts, revision adapter gate, persistence Office path, documentReader, OpenAI adapter; 124 tests passing (17 files). `npm run stage:verify` passes typecheck/lint/test/build/validate; format passes for all project files (`.roo/mcp.json` is environment-owned tooling config and excluded from this claim).
