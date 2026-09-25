# ToneForge

ToneForge is a Microsoft Word Web Add-in for learning an editable style profile,
running deterministic consistency and formatting checks, optionally performing
consent-gated AI editorial review, and applying reviewed changes through a single
Word mutation path.

## Current status

The canonical roadmap, implementation status, refactor mapping, sequencing, and
release gates are in [`ROADMAP.md`](ROADMAP.md). Read that file before making
planning or release decisions.

The repository contains an unreleased refactor candidate. Automated repository
verification includes 80% exercised-core coverage, source and generated-artifact
secret scans, development/production sentinel builds, production bundle budgets,
manifest, and staging checks. Credentials are excluded from ordinary state and
browser bundles; local live-provider testing uses a Node-side development broker.
The complete Word host matrix, production credential-custody threat model, and
release acceptance remain open. See
[`docs/project-state.md`](docs/project-state.md) for
the evidence index and [`docs/manual-verification.md`](docs/manual-verification.md)
for host results.

## Development

```bash
npm install
npm run validate
npm run build
```

For the terminal workflow, start the add-in and its HTTPS development server in
one command:

```bash
npm run sideload
```

On Windows, Visual Studio Code also provides the Microsoft-documented Edge
WebView2 debugger: select **Word Desktop (Edge Chromium)** in **View** | **Run**
and press F5. The repository includes the required
[`launch.json`](.vscode/launch.json) and [`tasks.json`](.vscode/tasks.json)
configuration. Install Microsoft's **Microsoft Debugger for Edge** extension
first. The F5 task runs `start:desktop`, which starts its own development
server; skip the manual `npm run dev` command when using F5.

End each debugging session with `npm run stop`. Microsoft 365 Agents Toolkit is
Microsoft's primary project creation/import environment for Microsoft 365 apps
and agents; it is not a drop-in debugger for ToneForge's existing project
structure. Migrating ToneForge into that structure would require a separately
approved import/restructure project. See
[`docs/onboarding.md`](docs/onboarding.md) for the current setup and
[`plans/dependency-remediation-plan.md`](plans/dependency-remediation-plan.md)
for the future migration option.

## Verification

```bash
npm run verify
```

`npm run verify` delegates to `npm run stage:verify`, which runs the ordered
`toneforge-repository-v1` graph: typecheck, lint, format, source secret scanning,
documentation-link validation, skills validation, tests, the 80% coverage gate,
production build and artifact checks, built-artifact secret scanning, manifest
validation, deterministic release staging, and the release package check. The
separate human-evidence gate is `npm run release:check`; it remains blocked until
the Word host matrix, accessibility and large-document evidence, and production
credential-custody review are complete.

## Architecture and privacy

Provider credentials are not stored in ordinary settings. During local
development, `.env` credentials remain in the Webpack Node process and the
browser uses a same-origin broker without an `Authorization` header. No
production browser-held credential support is claimed without an approved threat
model and deployed credential boundary.

- [`docs/architecture.md`](docs/architecture.md) documents module boundaries and
  the current data flow.
- [`docs/privacy-security.md`](docs/privacy-security.md) documents consent,
  minimization, redaction, and storage limitations.
- [`docs/decision-log.md`](docs/decision-log.md) records architectural decisions.
- `src/analysis/consistency/README.md` reserves the future Content Consistency
  Review seam; no Phase H engine is implemented.
