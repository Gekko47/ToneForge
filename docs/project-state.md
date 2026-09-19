# ToneForge — Project State

Per-stage status per the Stage protocol in `ROADMAP.md`. Updated after each stage gate.

| Stage | Title                      | Status  | Gate     | Notes                                                                |
| ----- | -------------------------- | ------- | -------- | -------------------------------------------------------------------- |
| 00    | Repository discovery       | PASS    | Yes      | Baseline established: README, LICENSE, ROADMAP, .gitignore           |
| 01    | Office.js capability spike | PENDING | **Hard** | `src/word/capabilityProbe.ts` scaffolded; probe must run inside Word |
| 02    | Scaffold                   | PASS    | Yes      | Full scaffold committed: manifest, src tree, tooling, CI, docs       |
| 03    | Cline governance           | PENDING | Yes      | `.cline/rules` + skills stub added                                   |
| 04    | Domain model               | PENDING | Yes      | `src/core/domain` types defined; awaiting tests                      |
| 05    | Storage/state              | PENDING | Yes      | `src/core/state` persistence defined; awaiting tests                 |
| 06    | LLM provider layer         | PENDING | Yes      | `src/ai/providers` interface + OpenAI + mock defined                 |
| 07    | Settings UI                | PENDING | Yes      | —                                                                    |
| 08    | Style sample               | PENDING | Yes      | —                                                                    |
| 09    | Deterministic metrics      | PENDING | Yes      | —                                                                    |
| 10    | Style profiler             | PENDING | Yes      | —                                                                    |
| 11    | Editable Style Profile UI  | PENDING | Yes      | —                                                                    |
| 12    | Profile versioning         | PENDING | Yes      | —                                                                    |
| 13    | Typography rules           | PENDING | Yes      | —                                                                    |
| 14    | House style rules          | PENDING | Yes      | —                                                                    |
| 15    | Formatting engine          | PENDING | Yes      | —                                                                    |
| 16    | Unified findings           | PENDING | Yes      | —                                                                    |
| 17    | Change planning            | PENDING | Yes      | —                                                                    |
| 18    | Revision adapter           | PENDING | **Hard** | —                                                                    |
| 19    | Semantic deviation         | PENDING | Yes      | —                                                                    |
| 20    | Consistency checker        | PENDING | Yes      | —                                                                    |
| 21    | Reformat orchestrator      | PENDING | Yes      | —                                                                    |
| 22    | Safe application           | PENDING | Yes      | —                                                                    |
| 23    | Accessibility/UX           | PENDING | Yes      | —                                                                    |
| 24    | Performance                | PENDING | Yes      | —                                                                    |
| 25    | Security/privacy           | PENDING | Yes      | —                                                                    |
| 26    | Test/review                | PENDING | Yes      | —                                                                    |
| 27    | Manual Word verification   | PENDING | **Hard** | —                                                                    |
| 28    | Release candidate          | PENDING | **Hard** | —                                                                    |

## Legend

- **PASS** — all checks green, committed.
- **PASS WITH DOCUMENTED LIMITATION** — committed with a known, accepted limitation.
- **BLOCKED** — cannot proceed; must resolve before next stage.
- **FAIL** — checks failed; must fix before commit.
