# ToneForge — Architecture

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

## Module boundaries

| Module                                 | Allowed imports                                                                                   | Forbidden imports                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `core/domain`                          | `zod`, `shared/utils`                                                                             | `word`, `ai`, `ui`, `Office`                                             |
| `rules`, `formatting`, `style/metrics` | `core/domain`, `shared/utils`                                                                     | `ai`, `Office`, `ui`                                                     |
| `analysis`                             | `core/domain`, `rules`, `formatting`, `ai/providers`, `shared/utils`                              | `ui`, `word/revisionAdapter`                                             |
| `changes`                              | `core/domain`, `shared/utils`                                                                     | `analysis`, `rules`, `formatting`, `style`, `ai`, `word`, `ui`, `Office` |
| `reformat`                             | `core/domain`, `analysis`, `changes`, `formatting` DTOs, `word/*`, `ai/providers`, `shared/utils` | `taskpane`, `commands`, direct `Office.run`                              |
| `word`                                 | `shared/office`, `core/domain`                                                                    | `ai`, `ui`                                                               |
| `ai/providers`                         | `core/config`, `shared/utils`                                                                     | `word`, `ui`                                                             |
| `ui/*`                                 | `core/*`, `shared/*`, `ai/providers`, `word/documentReader`                                       | `word/revisionAdapter` directly                                          |

## Data flow

1. **Capture**: `style/sampleCapture` → quality gate → `style/metrics` (deterministic) + `ai/providers` (semantic).
2. **Profile**: `core/domain/StyleProfile` is the canonical, editable, versioned object.
3. **Analyze**: `analysis/consistencyChecker` composes deterministic `rules`/`formatting` findings with optional semantic `ai` deviations and returns a findings-only report.
4. **Orchestrate**: `reformat/orchestrator` snapshots the document, delegates analysis, plans the report, and exposes preview or tracked apply without importing UI or commands.
5. **Plan**: `changes/planner` turns `Findings[]` into `ChangePlan` with conflict/stale metadata.
6. **Apply**: `word/revisionAdapter` is the ONLY module that calls `Office.run` to mutate Word; the legacy Stage 18 smoke helpers are deprecated and retained only for historical live-smoke reproduction.

## Technology stack

- **Language**: TypeScript 5.6 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **UI**: React 18 + Fluent UI v8 + React Error Boundary
- **Build**: Webpack 5 + ts-loader, dev-server HTTPS on 127.0.0.1:3000
- **Manifest**: Unified JSON manifest v1.30, Word host
- **LLM**: Provider-agnostic `LlmProvider` interface; OpenAI (fetch) + Mock adapters; `LlmRegistry` for fallback
- **State**: `Office.roamingSettings` with localStorage fallback; Zod-validated
- **Tests**: Vitest + jsdom + Testing Library; coverage threshold 80%
- **Lint/format**: ESLint flat + typescript-eslint + jsx-a11y + react-hooks; Prettier
- **Hooks**: Husky + lint-staged + commitlint (conventional commits)
- **CI**: GitHub Actions (install → typecheck → lint → format → test → build → manifest validate)

## Configuration

- `.env.example` documents all env vars; `.env` is gitignored
- `src/core/config/env.ts` validates env at startup with Zod and redacts secrets in logs
- `TELEMETRY_DISABLED=1` by default — no telemetry without explicit opt-in

## Security/privacy posture

- API keys enter only through the Settings UI and are stored in `Office.roamingSettings`
- Prompts never include raw document text unless the user explicitly opts in
- `logger` redacts any field matching `/key|token|secret|password|auth/i`
- No telemetry by default
