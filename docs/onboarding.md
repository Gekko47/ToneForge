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

For terminal-based development, start the add-in and its HTTPS development
server in one command:

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
3. Press F5. The [`Debug: Word Desktop`](../.vscode/tasks.json) task runs
   [`start:desktop`](../package.json), which uses `office-addin-debugging` to
   start the [`dev-server`](../package.json) Webpack process and sideload
   [`manifest.xml`](../manifest.xml). Do not run `npm run dev` first for this
   workflow: `start:desktop` starts its own development server.
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
`npm run stop` remain the separate terminal workflow and the supported
recovery path.

### Visual Studio Code debugger (Word on the web, Chrome and Edge)

[`.vscode/launch.json`](../.vscode/launch.json) also provides **Word on the Web
(Chrome)** and **Word on the Web (Edge)** for testing the add-in in Office on
the web. Mac and Word for Mac are deliberately out of scope, so there is no
Safari/WebKit configuration.

#### Why the browser is launched by Visual Studio Code

`office-addin-debugging` v5 cannot drive a web debug session. It exposes no
`--browser` option and no remote-debugging-port option, it enables the CDP port
only for the desktop app type on Windows, and for the web app type it opens
your **default** browser without a debug port. There is therefore nothing to
attach to.

So these configurations work the other way around: Visual Studio Code launches
the browser itself with an explicit `--remote-debugging-port`, and the `url` is
the same Office Online sideload URL that `office-addin-debugging` would have
opened. That URL is assembled in the `variables` block of
[`.vscode/launch.json`](../.vscode/launch.json) from
`wdaddindevserverport`, `wdaddinmanifestfile`, `wdaddinmanifestguid`, and
`wdaddintest`, matching the query string the sideload tooling generates.
`wdaddintest=true` suppresses the Office Online consent dialogs.

The dev server is started by the `Debug: Word Web Dev Server`
[`preLaunchTask`](../.vscode/tasks.json), which runs
[`start:web`](../package.json). That script passes `--no-sideload` on purpose:
sideloading would open a second, un-debuggable browser window in your default
browser. The launch configuration is solely responsible for the browser.

#### Prerequisites

1. A Word document in Office on the web in your tenant. Web sideloading needs a
   real document URL; the sideload tooling fails with "For sideload to web, you
   need to specify a document url" without one.
2. The localhost development certificate trusted, as described in
   [Setup](#setup).
3. Sign-in completed in the dedicated browser profile. Each configuration uses
   its own `userDataDir` under `.vscode/.debug-profile/`, so the first run
   requires a separate sign-in.
4. No other session already listening on the same debug port. Chrome uses 9222
   and Edge uses 9223 so they never collide with the 9229 WebView2 port used by
   **Word Desktop (Edge Chromium)**. Run one web configuration at a time.

#### Usage

1. Open **View** | **Run** in Visual Studio Code.
2. Select **Word on the Web (Chrome)** or **Word on the Web (Edge)**.
3. Press F5. When prompted, paste the absolute URL of your Office on the web
   document. The URL is prompted for rather than stored, so your tenant name is
   never committed to the repository.
4. The `Debug: Word Web Dev Server` task starts the Webpack development server,
   and the browser opens to the document with the add-in registered.
5. Set breakpoints in TypeScript or JavaScript and run the corresponding task
   pane or ribbon action. Breakpoints bind to the task pane iframe once it has
   loaded.
6. End the session with Shift+F5. The dedicated browser profile is reused on
   the next run, so the sign-in is not repeated.

The `Office.initialize` and `Office.onReady` breakpoint limitation documented
for the desktop path applies here as well. Use runtime diagnostics or the host
browser developer tools for initialization-time failures.

#### Manual sideloading without the debugger

`Debug: Word Web Sideload` runs the standard
[`sideload`](../package.json) flow for the web app type and opens the document
in your default browser. Use it to confirm registration independently of the
debugger. It cannot select a browser, and it is not a debug session.

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
