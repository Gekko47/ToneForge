# ToneForge Dependency and Toolchain Remediation Plan

**Status:** Proposed plan; no dependency changes have been made.

**Decision already confirmed:** sideloading remains a required debugging path. The legacy Office tooling chain is not being removed as part of routine cleanup.

## 1. Current validated baseline

The current checkout was inspected without changing dependencies or the lockfile.

| Area                      | Current evidence                                               | Classification                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                      | Running `v26.7.0`                                              | Outside the repository’s exact `.nvmrc` pin; not a source/build failure                                                                                        |
| Project Node pin          | [` .nvmrc`](.nvmrc:1) = `20.18.1`                              | Authoritative local/CI runtime target                                                                                                                          |
| npm                       | Running `12.0.2`                                               | Meets the broad `>=10` engine, but should be tested with the project’s npm baseline                                                                            |
| Package engines           | [`package.json`](package.json:9)                               | Node `>=20.0.0`, npm `>=10.0.0`                                                                                                                                |
| Lockfile                  | [`package-lock.json`](package-lock.json:1)                     | `lockfileVersion: 3`; preserve this version                                                                                                                    |
| Current-tree verification | [`npm run verify`](package.json:37)                            | Passes typecheck, lint, format, tests, 80% coverage, build/artifact checks, secret scans, manifest validation, staging, and package check                      |
| Current test result       | 68 files / 680 tests                                           | Passes                                                                                                                                                         |
| Clean-install check       | [`clean-install-check.mjs`](scripts/clean-install-check.mjs:1) | Install itself succeeds, but the committed snapshot fails `format`, `docs`, and `skills`; this is a repository-snapshot problem, not a package-install failure |
| Install warnings          | `npm ci --dry-run --ignore-scripts`                            | Two `EBADENGINE` warnings for transitive `@azure/msal-node@1.18.4` under Node 26                                                                               |
| Audit                     | `npm audit --json`                                             | 44 findings: 3 critical, 22 high, 15 moderate, 4 low; no blanket `npm audit fix --force`                                                                       |
| Git state                 | 21 pre-existing modified files from the prior remediation work | Must not be conflated with dependency cleanup changes                                                                                                          |

The clean-install script intentionally archives committed `HEAD` with `git archive`; therefore it does not test the current uncommitted working tree. That behavior is correct for reproducibility and must be tested again from a commit or CI checkout containing the candidate changes.

## 2. Dependency classification

### Production/runtime dependencies

These are directly imported by the task pane or production modules and are not candidates for removal without code migration:

- [`@fluentui/react`](package.json:43): Fluent UI v8 theme and controls.
- [`react`](package.json:44): component runtime.
- [`react-dom`](package.json:45): task-pane mount.
- [`react-error-boundary`](package.json:46): task-pane error containment.
- [`uuid`](package.json:47): IDs across domain, analysis, review, planning, and formatting modules. The direct version is `9.x`; transitive `8.x` and `14.x` copies belong to different tooling packages.
- [`zod`](package.json:48): runtime boundary validation in domain and AI modules.

### Required development/tooling dependencies

These are evidenced by scripts, configuration, CI, or tests and must not be removed casually:

- TypeScript, Webpack, `ts-loader`, `css-loader`, `style-loader`, `html-webpack-plugin`, `terser-webpack-plugin`, `webpack-cli`, `webpack-dev-server`, and `webpack-merge`: build and development server.
- `dotenv`: [`webpack.dev.js`](webpack.dev.js:10) reads the local `.env` file.
- Vitest, `jsdom`, Testing Library, `user-event`, and `@vitest/coverage-v8`: test runner and component tests.
- `eslint`, TypeScript ESLint plugins, `globals`, and `eslint-config-prettier`: [`eslint.config.mjs`](eslint.config.mjs:1).
- Prettier, Husky, lint-staged, Commitlint, and the config files: formatting and commit gates.
- `office-addin-debugging`: [`package.json`](package.json:19) invokes the required sideload/stop workflow.
- `office-addin-dev-certs`: documented certificate installation in [`docs/onboarding.md`](docs/onboarding.md:17) and used by the HTTPS development workflow.
- `office-addin-manifest`: [`scripts/validate-manifest.mjs`](scripts/validate-manifest.mjs:308) optionally invokes the official manifest validator.
- `esbuild`: currently a direct development declaration but the repository’s Webpack path uses `ts-loader`; first determine whether it is intentionally pinned for a script/tool or is only inherited through Vitest/Vite before removal.
- `@playwright/test`: no current test or script import was found. Treat as a removal candidate only after checking the full repository, CI, local documentation, and maintainer workflow.
- `@types/uuid`: no direct source import was found. Treat as a type-package candidate only after confirming the direct `uuid` version’s own declarations and TypeScript resolution.

### Legacy Office sideload chain

The requested Azure and deprecated-package warnings are overwhelmingly in this development-only chain:

```text
office-addin-debugging
  -> office-addin-dev-settings
    -> @microsoft/teamsfx-cli
      -> @microsoft/teamsfx-core
        -> @azure/identity
          -> @azure/msal-node
        -> old Azure REST and archive tooling
```

The current evidence shows:

- `@azure/msal-node`: `1.0.0-beta.6`, `1.18.4`, and `2.16.3` in separate branches.
- `@microsoft/teamsfx-cli`: `1.1.5`, reached through `office-addin-dev-settings`.
- `@azure/ms-rest-azure-js`, `@azure/ms-rest-js`, `@azure/core-http`, and `msal`: reached through the same old TeamsFx/Azure tooling chain.
- `glob`: `7.2.3`, `8.1.0`, and `10.5.0`; `tar`, `rimraf`, `inflight`, `npmlog`, `debuglog`, `prebuild-install`, `fstream`, `node-domexception`, `whatwg-encoding`, `are-we-there-yet`, and `gauge` are also transitive development dependencies.
- These packages are not direct imports in [`src/`](src/) and are not required by the canonical verification graph itself. They matter because the required `sideload` command can execute the parent tool.

This chain must be handled as one migration unit. Removing or overriding one nested package in isolation is prohibited unless a parent release explicitly requires it and the full sideload/debug workflow is proven.

## 3. Error, warning, and risk classification

| Finding                                            | Current status                                                                | Required treatment                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 26 `EBADENGINE` for `@azure/msal-node@1.18.4` | Warning; package declares support only through Node 18                        | Run all baseline/remediation verification under Node `20.18.1`; do not treat Node 26 output as a supported release result                                      |
| Deprecated Azure/TeamsFx packages                  | Transitive development warnings                                               | Investigate a supported `office-addin-debugging`/Office-tooling parent release; do not override nested packages                                                |
| `glob`/`tar`/`inflight` warnings                   | Transitive development dependency warnings; some have security advisories     | Review audit reachability and parent release notes; no blanket force fix                                                                                       |
| `uuid@9` deprecation                               | Direct production dependency                                                  | Keep it while the code uses it; evaluate a separately tested migration to a maintained UUID version or platform `crypto.randomUUID()` only as a code migration |
| `eslint@9.39.5` deprecation                        | Direct development dependency                                                 | Check supported ESLint 9.x release and compatibility with the flat config and TypeScript plugins; no major upgrade in routine cleanup                          |
| `npm outdated` exit code                           | Informational, not a failure                                                  | Use as an inventory signal, not a mandate to upgrade all 31 direct packages                                                                                    |
| Audit severity counts                              | Findings requiring review, not proof of reachable application vulnerabilities | Classify direct runtime, build-time, sideload-only, and unreachable paths before remediation                                                                   |
| Clean-install `format`, `docs`, `skills` failures  | Actual reproducibility failure                                                | Fix committed repository references/config or snapshot behavior before dependency changes are considered complete                                              |

## 4. Phased execution plan

### Phase 0 — Freeze the baseline and stop conditions

**Evidence:** current runtime, lockfile, audit, clean-install output, and dirty working tree are recorded above.

**Actions:**

1. Do not update packages, edit [`package-lock.json`](package-lock.json), add overrides, or change engine constraints while the current dependency worktree is mixed with the previous remediation changes.
2. Use Node `20.18.1` from [`.nvmrc`](.nvmrc:1) and record the npm version used for the baseline.
3. Run the baseline commands separately, not only through the graph:
   - `node --version`
   - `npm --version`
   - `npm ci`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format`
   - `npm run test`
   - `npm run test:coverage`
   - `npm run build:check`
   - `npm run validate`
   - `npm run verify`
   - `node scripts/clean-install-check.mjs`
4. Save audit and `npm explain` output as review artifacts; do not add generated JSON to the repository.

**Stop if:** the clean install cannot be reproduced under Node 20, the lockfile changes without an intentional `package.json` change, or the working tree contains unrelated user changes.

### Phase 1 — Make clean-install verification meaningful

**Evidence:** [`clean-install-check.mjs`](scripts/clean-install-check.mjs:17) archives committed `HEAD`, while current working-tree verification passes. The committed snapshot fails tracked documentation/skill references and formatting in the archive.

**Actions:**

1. Keep the committed-tree archive behavior; it is required to test reproducibility rather than local edits.
2. Audit the exact committed failures and fix only repository-owned causes:
   - Remove or rewrite links to ignored local `.roo/mcp.json`, `ToneForge_Refactor_Implementation`, and `.git/config` paths in tracked documentation, or provide tracked documentation that points to canonical files.
   - Confirm whether formatting failure is caused by archived line endings or a committed file difference; do not generate a substitute `.prettierignore` that hides it.
   - If a real `.prettierignore` is required by the project, add it as a reviewed repository file and test it in both the checkout and archive. Do not manufacture one solely for the clean-install script.
3. Add a regression test for the clean-install script’s committed-tree contract and make CI run it after the candidate commit is present.
4. Run [`npm run verify`](package.json:37) and the clean-install check from a clean CI-like checkout.

**Expected dependency effect:** none; this phase repairs verification inputs rather than changing the graph.

**Rollback:** revert only the documentation/format/snapshot fixes if they cause a valid tracked-link or formatter regression.

**Stop if:** fixing the clean-install failure requires copying ignored local files or changing architecture boundaries; use tracked canonical documentation instead.

### Phase 2 — Remove only proven direct dependency candidates

**Evidence:** all six production dependencies have direct source imports. Direct development imports were found for Testing Library and user-event; configuration/script evidence exists for the build, test, lint, format, Office, and manifest packages. No current test/script import was found for `@playwright/test`; no direct import was found for `esbuild` or `@types/uuid`.

**Actions:**

1. Search the entire repository, including ignored-but-required local workflow files only as read-only evidence, for `@playwright/test`, `esbuild`, and `@types/uuid` usage.
2. Confirm whether maintainers use Playwright manually or externally. If not, remove only `@playwright/test` from [`package.json`](package.json:53) and regenerate the lockfile with npm, never hand-edit it.
3. Determine whether `esbuild` is intentionally direct tooling or only a Vite/Vitest transitive dependency. If it is redundant, remove the direct declaration; do not remove the transitive copy independently.
4. Determine whether `@types/uuid` is still required by the selected UUID version and TypeScript resolution. Remove only if a clean `npm ci`, typecheck, and focused UUID tests prove it is unnecessary.
5. Do not remove any package used by [`sideload`](package.json:19), [`stop`](package.json:20), [`validate-manifest.mjs`](scripts/validate-manifest.mjs:308), Webpack, Vitest, or the verification graph.

**Expected tree effect:** fewer root declarations only; transitive dependencies remain until their owning packages change.

**Validation:** `npm ci`, `npm ls --depth=0`, `npm explain` for removed names, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build:check`, and `npm run verify`.

**Rollback:** restore the exact prior [`package.json`](package.json) declaration and regenerate the lockfile from that state; do not restore stale lockfile fragments by hand.

### Phase 3 — Evaluate supported Office tooling without removing sideloading

**Evidence:** sideloading is explicitly required by the maintainer decision and by [`package.json`](package.json:19). The warnings originate in the `office-addin-debugging` -> TeamsFx chain.

**Actions:**

1. Query the package metadata and release notes for `office-addin-debugging`, `office-addin-dev-certs`, and `office-addin-manifest` under Node 20.18.1. Prefer the smallest parent release that removes or reduces the deprecated chain while preserving the existing CLI and XML sideload behavior.
2. Check whether a supported parent release still depends on TeamsFx `1.1.5`, MSAL `1.18.4`, `@azure/ms-rest-*`, or old archive packages.
3. In an isolated branch, update only the parent Office tooling packages through npm; do not add an `overrides` block for Azure, TeamsFx, `glob`, `tar`, or `rimraf` until a parent release explicitly requires that resolution.
4. Test:
   - `npm ci` under Node 20.18.1;
   - `npm run sideload -- --help` or the package’s supported help path without launching Word;
   - certificate install/help behavior;
   - manifest validation;
   - a manual Word sideload/start/stop smoke on a supported host;
   - the full verification graph.
5. If no parent release removes the deprecated chain without changing CLI behavior, retain the chain as a contained, documented development-only limitation. Do not force nested upgrades.

**Expected tree effect:** one parent dependency may change; transitive duplicates should be allowed to remain until the parent’s constraints change.

**Rollback:** revert the parent package change and regenerate the lockfile. Do not manually delete nested lockfile entries.

**Stop if:** the new package cannot start/stop the XML manifest, changes certificate locations, breaks Word loading, or requires an unsupported Node version. Keep the current pinned toolchain until a replacement is proven.

### Phase 3A — Add the supported Visual Studio Code Edge WebView2 debugger

Microsoft documents a Visual Studio Code / Edge WebView2 debugging workflow for
existing Office Add-ins. This workflow does not require Microsoft 365 Agents
Toolkit and does not change the project structure.

**Evidence:** ToneForge is an existing Node/npm project using
[`webpack.dev.js`](webpack.dev.js:1), `office-addin-debugging`, Node 20.18.1, and
Windows Edge WebView2.

**Safe implementation:**

1. Add tracked [`.vscode/launch.json`](../.vscode/launch.json) with the Microsoft
   `msedge` attach configuration, `useWebView: true`, port `9229`, and the
   `Debug: Word Desktop` pre-launch task.
2. Add tracked [`.vscode/tasks.json`](../.vscode/tasks.json) that invokes
   `npm run start:desktop -- --app Word`.
3. Add [`dev-server`](package.json:15) as the Microsoft-documented alias that
   starts the existing Webpack development server.
4. Add [`start:desktop`](package.json:16) as the Microsoft-documented
   `office-addin-debugging start manifest.xml desktop` entry point.
5. Keep [`dev`](package.json:14), [`sideload`](package.json:19), and
   [`stop`](package.json:20) as the terminal workflow and recovery path.
6. Adjust [`.gitignore`](../.gitignore) so only the two reviewed VS Code
   debugging files are tracked; other local VS Code settings remain ignored.
7. Document installation of Microsoft's **Microsoft Debugger for Edge**
   extension, F5 usage, Shift+F5 cleanup, and the documented limitation that
   breakpoints in `Office.initialize` and `Office.onReady` are ignored.
8. Record F5 evidence in [`docs/manual-verification.md`](docs/manual-verification.md)
   without claiming it as automated or host-matrix evidence.

**Expected dependency effect:** none. The workflow still uses the existing
`office-addin-debugging`; this phase improves developer experience and
diagnostics rather than removing the legacy chain.

**Validation:**

- `npm run dev-server` must resolve to the same HTTPS server as `npm run dev`;
- `npm run start:desktop -- --help` or the supported help path must be inspected
  without launching Word;
- the pre-launch task name in [`launch.json`](../.vscode/launch.json) must match
  [`tasks.json`](../.vscode/tasks.json);
- JSON syntax, Prettier, typecheck, lint, tests, build, and the full verification
  graph must pass;
- a human must run F5 in Word to prove sideload, webview attach, breakpoint, and
  Stop Debugging behavior.

**Rollback:** remove the two VS Code files and the two new package scripts. The
existing terminal workflow is unaffected.

### Phase 3B — Evaluate a future Microsoft 365 Agents Toolkit project migration

**Maintainer decision:** Microsoft 365 Agents Toolkit is a project
creation/import environment, not ToneForge's current debugger. Do not attach it
to the current repository as if ToneForge were a generated Agents Toolkit
project.

If Microsoft 365 Agents Toolkit is evaluated later, it requires a separately
approved **full project import/restructure initiative** in an isolated worktree:

1. Use Microsoft's **Upgrade an Existing Office Add-in** import flow.
2. Accept the generated `appPackage` and runtime-oriented `src` structure only
   after comparing it against the current architecture and Webpack
   configuration.
3. Re-establish the canonical [`manifest.json`](manifest.json:1) and XML fallback
   contract, or explicitly redesign the manifest and deployment strategy.
4. Prove production build, test coverage, release packaging, Word desktop, and
   Word on the web before proposing any changeover.
5. Treat Microsoft's Word unified-manifest preview limitation as an explicit
   maintainer risk.
6. Keep `npm run dev`, `npm run sideload`, `npm run stop`, and the current Office
   tooling as the rollback until the imported project is accepted.

No Agents Toolkit CLI dependency, wrapper, or package script is introduced in
this plan. The future migration is an architecture and project-structure
decision, not routine dependency remediation.

### Phase 4 — Handle direct deprecations individually

#### UUID

`uuid@9.0.1` is used by many production modules and is not removable as a warning-only action. First identify the maintained release line and API compatibility. If a minimum safe upgrade is a major migration, create a separate change with tests for UUID generation, plan IDs, finding IDs, request IDs, and bundled behavior. Only after that migration may the direct dependency be changed. If no safe version is available, retain `9.x` and document the lifecycle warning rather than forcing `14.x` across the graph.

#### ESLint

Keep ESLint 9 unless the maintained release line and plugin compatibility are confirmed. Validate [`eslint.config.mjs`](eslint.config.mjs:1), the TypeScript ESLint plugin, `eslint-config-prettier`, zero-warning lint, and all import-boundary checks. Do not upgrade to a new major as part of Office dependency cleanup.

#### Glob/tar/rimraf/npmlog/inflight and related packages

Do not treat `npm explain` presence as a removal instruction. These packages are transitive or required by Office tooling, build tooling, npm internals, or native-install paths. Review audit reachability and parent release notes. Safe options are parent upgrades, accepting contained development warnings, or a separately approved tooling migration. `npm audit fix --force` is prohibited for this phase.

### Phase 5 — Lockfile regeneration and deterministic dependency policy

**Evidence:** lockfile version is 3 and the current root snapshot matches [`package.json`](package.json:42).

**Actions:**

1. Make the smallest set of approved `package.json` changes.
2. Run `npm install --package-lock-only` under Node 20.18.1 with the project’s approved npm version.
3. Review the lockfile diff for:
   - unexpected major changes;
   - lockfile-version changes;
   - new direct dependencies;
   - changed peer requirements;
   - removal of platform optional packages;
   - unrelated integrity/resolved churn.
4. Run `npm ci` from the regenerated lockfile and verify `npm ls` has no invalid/extraneous root dependencies.
5. Do not introduce `overrides`, `resolutions`, or peer-dependency flags unless a specific parent-package incompatibility is documented and tested in isolation.

**Rollback:** restore the previous `package.json` and lockfile as one unit from Git and rerun `npm ci`.

### Phase 6 — CI and verification adjustments

**Evidence:** CI uses Node `20.x`, `npm ci`, [`npm run verify`](package.json:37), and the clean-install check in both [`.github/workflows/ci.yml`](.github/workflows/ci.yml:27) and [`.github/workflows/release.yml`](.github/workflows/release.yml:23).

**Actions:**

1. Keep the existing canonical graph order in [`verification-graph.mjs`](scripts/verification-graph.mjs:10).
2. Add a dependency-policy check only if it can be deterministic and does not suppress audit findings. Candidate checks:
   - `npm ci --ignore-scripts` dry-run diagnostic;
   - `npm ls --depth=0` consistency;
   - a generated dependency inventory for review, not a hard-coded allowlist.
3. Keep the human release gate separate; do not make `npm run release:check` part of routine dependency cleanup.
4. Ensure CI runs the clean-install check against the candidate commit and uploads dependency/audit output as artifacts if useful.

### Phase 7 — Final verification and rollback criteria

Run, in order:

```text
npm ci
npm run typecheck
npm run lint
npm run format
npm run test
npm run test:coverage
npm run build:check
npm run validate
npm run verify
node scripts/clean-install-check.mjs
```

Then perform:

- `npm ls --all` and `npm explain` for the direct packages and the Office chain;
- `npm audit --json` classification review;
- `git diff --check` and line-ending review;
- a fresh-install developer workflow under Node 20.18.1;
- `npm run sideload`, certificate workflow, and manifest validation in the supported Word environment;
- a manual Word start/stop/reload smoke if the Office toolchain changed.

**Success criteria:**

- Node 20.18.1 and the supported npm version are used for the canonical baseline.
- `npm ci` is reproducible from the lockfile.
- No invalid peer dependencies, unexpected root packages, lockfile-version change, or manual lockfile edits.
- Direct runtime imports, package scripts, CI, build output, tests, coverage, manifest validation, release packaging, and clean install all pass.
- Sideloading remains operational.
- Any retained deprecated transitive chain is documented with exact parent path, scope, and reason.
- Any remaining audit finding is classified as reachable or non-reachable instead of being silently ignored.

## 5. Explicitly deferred or prohibited changes

- No removal of `office-addin-debugging`, `office-addin-dev-certs`, or `office-addin-manifest` while sideloading is required.
- No direct override of `@azure/msal-node`, `@microsoft/teamsfx-cli`, `@azure/ms-rest-*`, `@azure/core-http`, `msal`, `glob`, `tar`, `rimraf`, or `npmlog`.
- No major React, Fluent UI, Zod, Webpack, Vitest, TypeScript, or UUID migration as routine cleanup.
- No manual edits to [`package-lock.json`](package-lock.json).
- No `npm audit fix --force`.
- No weakening of TypeScript strictness, ESLint boundaries, coverage thresholds, manifest validation, or the single Word mutation path.
- No claim that a deprecation warning is a security vulnerability without advisory reachability analysis.

## 6. Unresolved risks and confirmation points

1. The project’s exact supported npm 10.x version is not pinned in [`package.json`](package.json:9); confirm the maintainer-approved npm version before lockfile regeneration.
2. The Office tooling parent upgrade path and current supported release must be checked against the live npm registry under Node 20; do not infer a safe version from the warning text.
3. Audit findings need per-advisory reachability classification. The 44 total findings are a review queue, not a list of 44 independent upgrades.
4. The clean-install failure must be resolved against a committed candidate before dependency changes are considered reproducible.
5. The current working tree already contains unrelated prior remediation edits; dependency work should be isolated in a separate commit or branch.
