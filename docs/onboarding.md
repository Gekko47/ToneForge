# ToneForge — Onboarding Guide

## Prerequisites

- **Node.js** 20.x LTS (see `.nvmrc`). Install via `nvm install` or from nodejs.org.
- **Microsoft 365 developer tenant** with Office desktop/online access. Sign up at aka.ms/m365devprogram if needed.
- **Visual Studio Code** (recommended) or any editor.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env: set OPENAI_API_KEY if you want live LLM calls (optional for dev)

# 3. Trust the development certificate (required for HTTPS dev server)
npx office-addin-dev-certs install --machine

# 4. Validate the manifest
npm run validate

# 5. Build the add-in
npm run build
```

## Development loop

```bash
# Start the dev server (HTTPS on 127.0.0.1:3000)
npm run dev

# In another terminal, sideload the add-in into Word
npm run sideload
```

Open Word on the web (Chrome/Edge) or Word desktop, create/open a document, and select **ToneForge** from the ribbon.

### Hot reload

Edit any `src/**/*.tsx` file — webpack-dev-server will recompile and refresh the taskpane automatically.

### Running tests

```bash
npm run test           # run once
npm run test:watch     # watch mode
npm run test:coverage  # with coverage report
```

### Full verification

```bash
npm run verify   # typecheck + lint + format + test + build + manifest validate
```

## Troubleshooting

| Symptom                                   | Likely cause                                                    | Fix                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server won't start on HTTPS           | Missing dev cert                                                | `npx office-addin-dev-certs install --machine`                                                                                          |
| Add-in not appearing in ribbon            | Manifest not sideloaded                                         | Run `npm run sideload` after `npm run dev`                                                                                              |
| "Script error." / blank pane              | Cross-origin Office.js script conflict or missing runtime chunk | Do not add a manual Office.js CDN tag (Word injects it); ensure `runtime.js` and `taskpane.js` load from `localhost:3000`               |
| Favicon 404 in dev server                 | No favicon in the taskpane template                             | Inline SVG data-URI favicon added to `src/taskpane/taskpane.html`                                                                       |
| `Office` global is `undefined` in browser | Loading the taskpane outside Word (expected)                    | The "Diagnose Office runtime" button on the Dashboard confirms this state; `officeInit.ts` resolves immediately so the UI still renders |
| TypeScript errors about `Office`          | Missing global types                                            | `src/types/office.d.ts` is included via `tsconfig.json`                                                                                 |
| Task pane loads but buttons don't respond | `Word.run` not yet available                                    | Click "Diagnose Office runtime" to check host globals; `probeWordCapabilities()` only works inside Word                                 |

## Project layout

See `docs/architecture.md` for module boundaries and data flow.

## Stage protocol

Each roadmap stage (see `ROADMAP.md`) follows this protocol:

1. Read the stage file in `docs/stages/`.
2. Load only the relevant skills from `.roo/skills/<skill-name>/SKILL.md` (Zoo/Roo Code discovers `SKILL.md` with `name` + `description` frontmatter; `skill` tool loads by name, e.g. `toneforge-llm`):
   - `toneforge-scaffold` (`.roo/skills/toneforge-scaffold/SKILL.md`) — project setup, build, manifest, and verification commands.
   - `toneforge-officejs` (`.roo/skills/toneforge-officejs/SKILL.md`) — Word JavaScript API patterns (`runInWord`, reader, revision adapter).
   - `toneforge-llm` (`.roo/skills/toneforge-llm/SKILL.md`) — LLM provider contract, retry, redaction, and privacy opt-in.
   - `toneforge-testing` (`.roo/skills/toneforge-testing/SKILL.md`) — Vitest patterns, Office mocks, and coverage expectations.
   - Governance rules live in `.cline/rules/toneforge.md`.
   - Validate skills with `npm run skills:validate`.
3. Inspect before modifying.
4. Implement only the stage scope.
5. Run targeted tests.
6. Run stage verification commands (`npm run stage:verify`).
7. Update `docs/project-state.md`.
8. Record architectural decisions in `docs/decision-log.md`.
9. State status as PASS / PASS WITH DOCUMENTED LIMITATION / BLOCKED / FAIL.
10. Commit the stage only after its gate passes.
