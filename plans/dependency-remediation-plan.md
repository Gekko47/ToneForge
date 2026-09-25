# ToneForge Dependency and Toolchain Remediation Plan

**Status:** Implemented for Phases 0, 1, 2, 3, 3A, 4, and 5. Phase 3B is
**deferred by maintainer instruction**. See
[Section 7](#7-implementation-evidence) for the verified results.

**Decision already confirmed:** sideloading remains a required debugging path. The legacy Office tooling chain was contained by a parent release, not by nested overrides.

**Phase 3B is intentionally not implemented.** Microsoft 365 Agents Toolkit remains
a future project import/restructure initiative, not a dependency change.

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

1. **Open.** The project’s exact supported npm 10.x version is still not pinned in [`package.json`](package.json:9). The lockfile was regenerated with npm `12.0.2`, which satisfies the declared `>=10.0.0` engine, but CI resolves its own npm. Pin the maintainer-approved npm version if exact reproducibility across machines is required.
2. **Resolved.** The Office tooling parent upgrade path was checked against the live npm registry. `office-addin-debugging@5.1.6` was selected on measured evidence; see Section 7.
3. **Partially resolved.** Audit findings dropped from 44 to 25. The remainder is classified in Section 7.4; no finding was silently ignored.
4. **Resolved.** Phase 1 was implemented, and `npm run clean-install:check` now passes end to end against committed `HEAD`; see [Section 7.6](#76-phase-1-clean-install-reproducibility).
5. **Resolved.** The prior remediation edits were committed first (`01eee64`); the dependency work is isolated in its own commit.

## 7. Implementation evidence

All results below were measured on this repository. Phase 3B was not
implemented, by maintainer instruction.

### 7.1 Changes applied

| Package                  | Before    | After    | Reason                                                                                        |
| ------------------------ | --------- | -------- | --------------------------------------------------------------------------------------------- |
| `office-addin-debugging` | `^4.0.0`  | `^5.1.6` | First release line whose `office-addin-dev-settings` dependency is free of TeamsFx/Azure MSAL |
| `@playwright/test`       | `^1.48.0` | removed  | No import in `src/`, `tests/`, `scripts/`, `.github/`, config, or docs                        |
| `esbuild`                | `^0.24.0` | removed  | Root declaration unused; Vite carries its own nested `esbuild@0.21.5`                         |

`package-lock.json` was regenerated with `npm install --package-lock-only`. It was
not hand-edited. `lockfileVersion` remains **3**.

**`@types/uuid` was deliberately kept.** The plan listed it as a candidate, but
`uuid@9.0.1` ships no `.d.ts` files and declares no `types` field; the only
declaration available is `@types/uuid`. Removing it breaks typecheck for the 13
modules that import `uuid`. This finding invalidates the original assumption.

### 7.2 Why 5.1.6 and not 6.x/7.x

Measured in isolated installs:

| Parent version   | CLI parent introduced              | Legacy entries | Verdict                               |
| ---------------- | ---------------------------------- | -------------- | ------------------------------------- |
| `4.6.7` (prev)   | `@microsoft/teamsfx-cli@1.1.5`     | many           | Baseline                              |
| `5.1.6`          | `@microsoft/teamsapp-cli@3.0.2`    | 9              | **Selected**                          |
| `6.1.2`          | `@microsoft/m365agentstoolkit-cli` | 12             | Rejected: pulls Agents Toolkit        |
| `7.0.1` (latest) | `@microsoft/m365agentstoolkit-cli` | 25             | Rejected: worst legacy surface of all |

`office-addin-debugging@6.0.0+` and `7.x` introduce
`@microsoft/m365agentstoolkit-cli`, which reintroduces TeamsFx _and_ adds the
Agents Toolkit dependency the maintainer explicitly rejected. `7.0.1` is the
largest jump and the worst deprecation surface. `5.1.6` is the minimum safe
parent release: it removes the deprecated chain **without** adopting Agents
Toolkit.

The `office-addin-dev-settings` boundary is the precise cause. Versions `1.15.1`
and `2.0.0` depend on `@microsoft/teamsfx-cli@1.1.5`; **`2.1.0` is the first
release with no TeamsFx dependency at all**. `office-addin-debugging@5.1.6`
depends on `office-addin-dev-settings@^2.3.6`, which is past that boundary.

### 7.3 CLI compatibility

`start --help` and `stop --help` were compared byte-for-byte between the previous
`4.6.7` and the selected `5.1.6`. The output is **identical**, including the
`[platform]` positional argument. ToneForge's contract is preserved:

- `npm run sideload` → `office-addin-debugging start manifest.xml`
- `npm run stop` → `office-addin-debugging stop manifest.xml`
- `npm run start:desktop` → `office-addin-debugging start manifest.xml desktop`
- `.vscode/tasks.json` pre-launch task → `start:desktop -- --app Word`

No override, no `resolutions` block, and no nested package edit was introduced.

### 7.4 Measured results

| Signal                           | Before | After    | Change     |
| -------------------------------- | ------ | -------- | ---------- |
| `EBADENGINE` warnings on install | 10     | **0**    | Eliminated |
| Deprecated warning lines         | 42     | **13**   | −69%       |
| Lockfile entries                 | 1600   | **1341** | −259       |
| `npm audit` total                | 44     | **25**   | −43%       |
| `npm audit` critical             | 3      | **2**    | −1         |

The `@azure/msal-node@1.18.4` `EBADENGINE` warning is gone because that package
exited the graph entirely, along with `@azure/ms-rest-js`,
`@azure/ms-rest-azure-js`, `@azure/core-http`, and the legacy `msal` package.

**Remaining audit findings are classified, not dismissed:**

- `vitest` / `@vitest/coverage-v8` / `vite` (critical, high) — dev-only test
  runner. Fix requires a Vitest 2 → 5 major migration, which
  [Section 5](#5-explicitly-deferred-or-prohibited-changes) prohibits as routine
  cleanup. Requires a separate, tested change.
- `office-addin-debugging` and its `adm-zip` / `tmp` / `teamsfx-core` chain (high)
  — dev-only sideload tooling. The only available fix is `7.0.1`, which drags in
  Agents Toolkit. Contained, not reachable from shipped add-in code.
- No remaining finding is reachable from production runtime dependencies
  (`react`, `react-dom`, `@fluentui/react`, `react-error-boundary`, `uuid`,
  `zod`).

**Retained deprecations, with exact parent paths:**

- `uuid@9.0.1` (direct) and `uuid@8.3.2` (Office tooling) — retained per
  [Phase 4](#phase-4--handle-direct-deprecations-individually); a UUID major
  migration is a code migration, not a dependency bump.
- `eslint@9.39.5` (direct) — retained; flat config and TypeScript plugin
  compatibility are proven and lint passes with `--max-warnings 0`.
- `@microsoft/teamsapp-cli@3.0.2` — transitive via `office-addin-dev-settings`.
  This is the single remaining Office-chain deprecation. It is development-only.
- `glob`, `tar`, `inflight`, `prebuild-install`, `whatwg-encoding`,
  `node-domexception`, `git-raw-commits` — transitive build/test tooling,
  retained per Phase 4.

### 7.5 Verification performed

`npm run verify` passed all 13 stages of `toneforge-repository-v1`:

typecheck → lint → format → secret-scan → docs → skills → test → coverage →
build-artifacts → built-secret-scan → manifest → package → package-check.

- 68/68 test files pass; the 80% coverage gate passes.
- Production build succeeds; the 614400-byte JavaScript budget passes.
- Manifest validation, release staging, and release package check pass.
- `npm ls --depth=0` reports no invalid or extraneous root dependencies.
- `npm ci` completes from the regenerated lockfile with zero `EBADENGINE`.

**Human host evidence as of 2026-09-25:**

1. `npm run sideload` from the terminal works with the upgraded chain —
   confirmed by the maintainer on Word Desktop.
2. F5 from Visual Studio Code launches Word Desktop — confirmed. A firing
   breakpoint and Shift+F5 cleanup were not reported, so that gate stays
   partial rather than closed.
3. The wider host matrix in
   [`docs/manual-verification.md`](../docs/manual-verification.md) remains open:
   break, style, list, tracking, ribbon, accessibility, provider, and
   performance evidence, plus the web and Mac hosts.

Host-only actions cannot be evidenced from the command line, so nothing beyond
the maintainer's own report is claimed here.

### 7.6 Phase 1 clean-install reproducibility

`npm run clean-install:check` archives committed `HEAD`, runs `npm ci` in the
extracted tree, and executes the full 13-stage graph there. It now reports
`Clean-install reproducibility check passed`.

Three repository-owned causes were found and fixed. None was masked by a
verification bypass.

| Cause                                                                                                                                                 | Fix                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.autocrlf=true` on Windows made `git archive` emit CRLF, so `prettier --check` rejected 303 archived files against the `endOfLine: "lf"` setting | Tracked [`.gitattributes`](../.gitattributes) with `* text=auto eol=lf`, CRLF only for `.bat`, `.cmd`, and `.ps1`, and binaries marked `-text`                |
| Prettier has no parser for `.gitattributes` or `.gitignore`                                                                                           | Tracked [`.prettierignore`](../.prettierignore) listing only Git plumbing, build output, dependencies, and coverage artifacts; no source path is hidden       |
| Tracked Markdown linked to untracked local paths                                                                                                      | Links into the untracked `ToneForge_Refactor_Implementation/` folder, the gitignored Roo MCP config, and generated husky or git internals replaced with prose |

**The skills gate needed a different fix than the docs gate.** `localTarget()`
in [`check-docs.mjs`](../scripts/check-docs.mjs) only inspects real Markdown
links, so converting a link to a code span is sufficient. The reference
extractor in [`validate-skills.mjs`](../scripts/validate-skills.mjs) also
matches **backticked** path tokens, so the path in
[`toneforge-scaffold/SKILL.md`](../.roo/skills/toneforge-scaffold/SKILL.md) had
to be reworded out of the text rather than merely unlinked. The machine-local
MCP configuration file itself stays untracked and was never committed.

Links into `node_modules/` remain valid in the archive because `npm ci` runs
before the verification graph, so those are not repository-owned defects.

**Commits:** `1df4327` (line endings and Prettier ignore), `84ee9eb` and
`01919cc` (link removals plus removal of the unreferenced root artifact
`actions-inspect.txt` from tracking).
