# ToneForge — Onboarding Guide

The canonical roadmap and current status are in [`ROADMAP.md`](../ROADMAP.md).
This guide covers setup, development, verification, and troubleshooting.

## Prerequisites

- Node.js 20.x LTS as pinned by `.nvmrc` and `package.json`.
- npm 10.x or newer.
- Microsoft Word desktop or Microsoft 365 web access for host verification.
- Visual Studio Code or another editor.

## Setup

```bash
npm install
Copy-Item .env.example .env
npx office-addin-dev-certs install --machine
npm run validate
npm run build
```

The `.env` file is optional for deterministic development and tests. Do not
commit it or real API keys. `OPENAI_API_KEY` is read only by the local Node-side
development broker; Webpack does not inject it into browser assets.

## Development loop

Start the HTTPS development server:

```bash
npm run dev
```

In another terminal, sideload the add-in for local Word testing:

```bash
npm run sideload
```

Open a Word document and use the ToneForge task pane. This existing
`office-addin-debugging` workflow is the repository's supported local testing
and debugging path. It currently targets [`manifest.xml`](../manifest.xml);
[`manifest.json`](../manifest.json) is the canonical Microsoft 365 manifest and
both are kept in sync by
[`scripts/validate-manifest.mjs`](../scripts/validate-manifest.mjs).

When the session ends, always run the matching cleanup command. Closing the
server window or Word does not reliably unregister the add-in:

```bash
npm run stop
```

### Visual Studio Code debugger (Windows/Edge WebView2)

ToneForge includes Microsoft's documented Visual Studio Code configuration for
debugging a Word add-in against the Edge WebView2 runtime.

Prerequisites:

1. Windows 10/11, Node `20.18.1`, and a Word installation that uses Edge
   WebView2.
2. Install Microsoft's **Microsoft Debugger for Edge** Visual Studio Code
   extension.
3. Trust the localhost certificate as described in [Setup](#setup).
4. Close Word before starting the F5 session so the add-in can be registered
   cleanly.

Usage:

1. Open **View** | **Run** in Visual Studio Code.
2. Select **Word Desktop (Edge Chromium)**.
3. Press F5. The [`Debug: Word Desktop`](.vscode/tasks.json) task runs
   [`start:desktop`](../package.json), which uses `office-addin-debugging` to
   start the [`dev-server`](../package.json) Webpack process and sideload
   [`manifest.xml`](../manifest.xml).
4. When Word opens, accept the **WebView Stop On Load** prompt so Visual Studio
   Code can attach to the webview.
5. Set breakpoints in TypeScript or JavaScript and run the corresponding task
   pane or ribbon action.
6. End the session with Shift+F5 or **Run** | **Stop Debugging**. If Word or the
   sideload registration remains, close Word and run `npm run stop`.

Microsoft documents that breakpoints inside `Office.initialize` and
`Office.onReady` are ignored. Use runtime diagnostics, Edge developer tools, or
the Troubleshooting view for initialization-time failures that cannot be
captured with an ordinary source breakpoint.

This configuration is additive: `npm run dev`, `npm run sideload`, and
`npm run stop` remain the terminal workflow and the supported recovery path.

### Microsoft 365 Agents Toolkit is not the current ToneForge workflow

Microsoft 365 Agents Toolkit is Microsoft's primary environment for **creating
or importing** Microsoft 365 apps, agents, and Office Add-ins. It is not a
drop-in debugger for an existing repository whose project structure, build
configuration, and manifest layout it did not create.

Do not use **View** | **Run** against the current ToneForge repository as if it
were a generated Agents Toolkit project. Microsoft documents a project
import/restructure flow for existing add-ins, including generated
`appPackage` and `src/<runtime>` folders and project-setting adjustments. That
would be a separately approved migration, not routine dependency cleanup.

Agents Toolkit may be evaluated later in an isolated worktree through
Microsoft's **Upgrade an Existing Office Add-in** import flow. It must not
replace the current workflow until the imported project, canonical unified
manifest, build output, host matrix, and rollback have all been proven. See
[`plans/dependency-remediation-plan.md`](../plans/dependency-remediation-plan.md)
for that future option.

### Optional local live-provider test

1. Put an API key in the gitignored `.env` as `OPENAI_API_KEY=...`.
2. Set the Settings broker URL to
   `https://localhost:3000/__toneforge/llm/v1`.
3. Select OpenAI and retain the relevant explicit content-review consent.
4. Start `npm run dev`; the same-origin broker attaches the key only in the
   development-server Node process.

Do not paste the key into Settings. The broker is development-only. The
production broker/authentication architecture and formal threat model remain
open; this repository does not claim a supported production browser-held key.

## Verification

```bash
npm run typecheck
npm run lint
npm run format
npm run test
npm run build:check
npm run validate
npm run stage:verify
npm run verify
```

`npm run verify` delegates to `npm run stage:verify`, which runs the named
`toneforge-repository-v1` graph: typecheck → lint → format → source secret scan
→ documentation links → skills validation → tests → coverage → build/artifact
checks → built-secret scan → manifest validation → release staging → release
package checks. `npm run clean-install:check` is a separate reproducibility
check. The Word host/accessibility/provider/performance matrix and production
credential-custody review remain human evidence gates; see
[`ROADMAP.md`](../ROADMAP.md) before making a release claim.

## Troubleshooting

| Symptom                                   | Likely cause                                                                                   | Fix                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Dev server will not start over HTTPS      | Development certificate is not trusted                                                         | Run `npx office-addin-dev-certs install --machine` and restart Word.                               |
| Add-in is not in the ribbon               | Manifest was not sideloaded or Office cached the old manifest                                  | Run `npm run sideload`; if needed run `npm run stop`, close Word, and retry.                       |
| Add-in remains after closing Word         | The debug session was not explicitly stopped                                                   | Run `npm run stop`; closing Word alone does not reliably unregister the add-in.                    |
| Blank task pane                           | Office.js failed to load, the dev server is unavailable, or the task-pane HTML/bundle is stale | Verify `https://localhost:3000/taskpane.html`, inspect the browser/developer console, and rebuild. |
| `Office` is undefined in a normal browser | Expected outside Word                                                                          | Use the task pane inside Word; use the runtime diagnostics button for evidence.                    |
| Capability probe reports unsupported      | The host does not expose the inspected object model                                            | Treat the result as truthful; use the documented safe no-op/fallback.                              |
| TypeScript errors mention `Office`        | Local Office declarations are missing or not included                                          | Confirm `src/types/office.d.ts` and `tsconfig.json`.                                               |
| Tests emit warnings                       | Tests intentionally exercise refusal, stale, retry, and redaction paths                        | Review the warning and test assertion; do not suppress operational guard evidence globally.        |

## Project layout

See [`docs/architecture.md`](architecture.md) for module boundaries and the
current data flow. Tests mirror `src/` under `tests/`.

## Stage protocol

1. Read the applicable stage file and the canonical roadmap.
2. Load only the relevant skill.
3. Inspect the current implementation before modifying it.
4. Implement only the agreed scope.
5. Run targeted tests and the ordered verification chain.
6. Record architectural decisions in [`docs/decision-log.md`](decision-log.md).
7. Update the evidence index in [`docs/project-state.md`](project-state.md) and
   the authoritative status in [`ROADMAP.md`](../ROADMAP.md).
8. Commit only after the applicable gate passes.
