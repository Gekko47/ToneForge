# ToneForge — Master Cline Roadmap

## Mission

Build ToneForge as a production-quality Microsoft Word Web Add-in with:

- editable style learning from writing samples;
- deterministic micro-consistency checks;
- deterministic Word formatting analysis/normalization;
- semantic AI style analysis;
- AI-assisted rewriting only where interpretation is required;
- unified findings and change planning;
- safe native Word revision application where supported;
- provider-agnostic LLM integration;
- strong privacy, security, accessibility, testing, and host-compatibility discipline.

## Critical ordering rule

**Do not build the full reformatter before proving native Word revision behavior.**

## Stage map

| #   | Stage                      | Suggested commit                                                 | Gate     |
| --- | -------------------------- | ---------------------------------------------------------------- | -------- |
| 00  | Repository discovery       | `docs: establish ToneForge implementation baseline`              | Yes      |
| 01  | Office.js capability spike | `spike: verify Word revision and document capabilities`          | **Hard** |
| 02  | Scaffold                   | `chore: scaffold ToneForge Office add-in`                        | Yes      |
| 03  | Cline governance           | `chore: add ToneForge Cline rules and skills`                    | Yes      |
| 04  | Domain model               | `feat(core): define StyleProfile and analysis domain`            | Yes      |
| 05  | Storage/state              | `feat(core): add persistence and application state`              | Yes      |
| 06  | LLM provider layer         | `feat(ai): add resilient provider adapters`                      | Yes      |
| 07  | Settings UI                | `feat(settings): add provider configuration`                     | Yes      |
| 08  | Style sample               | `feat(style): add writing sample capture`                        | Yes      |
| 09  | Deterministic metrics      | `feat(style): add deterministic style metrics`                   | Yes      |
| 10  | Style profiler             | `feat(style): add semantic style profiling`                      | Yes      |
| 11  | Editable Style Profile     | `feat(style): add editable Style Profile UI`                     | Yes      |
| 12  | Profile versioning         | `feat(style): add profile versioning and diffs`                  | Yes      |
| 13  | Typography rules           | `feat(rules): add typography and punctuation engine`             | Yes      |
| 14  | House style rules          | `feat(rules): add spelling terminology and house style`          | Yes      |
| 15  | Formatting engine          | `feat(formatting): add Word formatting analyzer`                 | Yes      |
| 16  | Unified findings           | `feat(analysis): add unified finding model`                      | Yes      |
| 17  | Change planning            | `feat(changes): add change planning and conflict detection`      | Yes      |
| 18  | Revision adapter           | `feat(word): add native revision adapter`                        | **Hard** |
| 19  | Semantic deviation         | `feat(ai): add semantic style deviation engine`                  | Yes      |
| 20  | Consistency checker        | `feat(checker): add hybrid consistency checker`                  | Yes      |
| 21  | Reformat orchestrator      | `feat(reformat): add hybrid document reformatter`                | Yes      |
| 22  | Safe application           | `feat(safety): add stale-result protection and safe application` | Yes      |
| 23  | Accessibility/UX           | `feat(ui): harden accessibility and task pane UX`                | Yes      |
| 24  | Performance                | `perf: harden analysis for large documents`                      | Yes      |
| 25  | Security/privacy           | `security: harden AI and document data handling`                 | Yes      |
| 26  | Test/review                | `test: complete regression and review pass`                      | Yes      |
| 27  | Manual Word verification   | `test: record Word host verification results`                    | **Hard** |
| 28  | Release candidate          | `chore: prepare ToneForge release candidate`                     | **Hard** |

## Stage protocol

For every stage:

1. Read its stage file.
2. Load only the relevant skills.
3. Inspect before modifying.
4. Implement only the stage scope.
5. Run targeted tests.
6. Run stage verification commands.
7. Update `docs/project-state.md`.
8. Record architectural decisions in `docs/decision-log.md`.
9. State status as PASS / PASS WITH DOCUMENTED LIMITATION / BLOCKED / FAIL.
10. Commit the stage only after its gate passes.

## Product architecture

```text
Style Sample
    |
    v
Sample Quality
    |
    +-----------------------------+
    |                             |
    v                             v
Measured Analysis           Semantic Analysis
    |                             |
    +-------------+---------------+
                  v
            Style Profile
          (user editable)
                  |
        +---------+---------+
        |                   |
        v                   v
Rule/Formatting Engine   LLM Semantic Engine
        |                   |
        +---------+---------+
                  v
             Findings[]
                  |
             ChangePlan
                  |
        conflict/stale checks
                  |
         Word Mutation Adapter
                  |
            Word revisions
```

## Rules of the system

### Deterministic first

Use code for things that can be measured or safely normalized:

- em dash style and spacing;
- en dash/hyphen usage;
- quotes/apostrophes;
- whitespace;
- spelling variants;
- terminology;
- capitalization;
- punctuation frequency;
- sentence/paragraph metrics;
- Word styles and formatting.

### AI only where interpretation is necessary

Use the LLM for:

- tone;
- voice;
- rhetorical style;
- semantic flow;
- nuanced vocabulary/register;
- meaning-preserving rewrites.

### One canonical profile

The same `StyleProfile` drives both Reformat and Consistency Check.

### One mutation path

Rules and UI never mutate Word directly. Everything flows through `ChangePlan` → revision/change adapter.
