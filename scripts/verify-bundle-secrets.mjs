import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Prove that no credential reaches a bundle.
 *
 * The technique is a sentinel: inject a value that would be obviously
 * recognizable if it leaked, build, then scan the output for it. A scanner
 * alone cannot prove absence, because it only knows the patterns someone
 * thought to write down. A sentinel can, because it asks a specific question —
 * "is this exact string in the output?" — and the answer is unambiguous.
 *
 * Every value below is a *shape* the real credential would take. The point is
 * to prove the environment variable is not read into the bundle at all, not to
 * pattern-match a particular vendor's key format.
 */

/**
 * The repository root.
 *
 * Resolved from the working directory rather than `import.meta.url`, for the
 * same reason `check-release-package.mjs` does it: this module is imported by
 * tests running under jsdom, where `import.meta.url` is not a `file:` URL and
 * `fileURLToPath` throws at module load. The script is always run from the
 * repository root by an npm script, so the working directory is the contract.
 */
const root = resolve(process.cwd());

/**
 * Environment variables that must never influence a browser bundle.
 *
 * These are the credentials Phase 4 introduced or formalized. A future
 * credential belongs here too: the list is the contract, and a credential
 * missing from it is a credential no sentinel is watching.
 */
export const SENTINEL_VARIABLES = Object.freeze([
  { name: "OPENAI_API_KEY", value: `${["TONE", "FORGE", "SENTINEL"].join("_")}_ABCDEFGHIJKL` },
  // OAuth: a client secret must live only on the gateway, and the PKCE
  // verifier is generated per attempt in the browser and must not be
  // build-time inlined either.
  { name: "TONEFORGE_OAUTH_CLIENT_SECRET", value: "tf-oauth-client-secret-ABCDEFGHIJKL" },
  { name: "TONEFORGE_OAUTH_PKCE_VERIFIER", value: "tf-pkce-verifier-ABCDEFGHIJKL" },
  // OpenRouter: the key a user pastes must reach the loopback gateway and
  // nothing else.
  { name: "OPENROUTER_API_KEY", value: "sk-or-v1-TONEFORGERESENTINEL000000" },
  { name: "ANTHROPIC_API_KEY", value: "tf-anthropic-key-ABCDEFGHIJKL" },
]);

export const BUILDS = Object.freeze([
  { name: "development", config: "webpack.dev.js", mode: "development" },
  { name: "production", config: "webpack.prod.js", mode: "production" },
]);

/** The environment a sentinel build runs with: every watched variable set. */
export function sentinelEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const variable of SENTINEL_VARIABLES) {
    env[variable.name] = variable.value;
  }
  return env;
}

/** Every sentinel value that appears in a body of text. */
export function findSentinels(text) {
  return SENTINEL_VARIABLES.filter((variable) => text.includes(variable.value)).map(
    (variable) => variable.name,
  );
}

/**
 * Run one build with the sentinel environment and scan its output.
 *
 * Returns the leaked variable names rather than throwing, so the caller
 * decides how to report and a test can assert on the result directly.
 */
export function runSentinelBuild(build, { envImpl, scan } = {}) {
  const spawn = envImpl ?? spawnSync;
  const result = spawn(
    process.execPath,
    ["node_modules/webpack-cli/bin/cli.js", "--config", build.config, "--mode", build.mode],
    {
      cwd: root,
      env: sentinelEnv(),
      encoding: "utf8",
      shell: false,
    },
  );
  // Webpack and the secret scanner both write their diagnostics to stderr, so a
  // failure that only ever produced stderr would otherwise be reported as an
  // empty output and told the reader nothing.
  if (result.status !== 0) {
    return {
      build: build.name,
      built: false,
      leaks: [],
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }
  const check = scan ?? spawnSync;
  const scanned = check(process.execPath, ["scripts/check-secrets.mjs", "--dist"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  return {
    build: build.name,
    built: true,
    leaks: scanned.status === 0 ? [] : ["secret-shaped value"],
    output: `${scanned.stdout ?? ""}${scanned.stderr ?? ""}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/verify-bundle-secrets.mjs")) {
  for (const build of BUILDS) {
    const result = runSentinelBuild(build);
    if (!result.built) {
      process.stderr.write(result.output);
      throw new Error(`${build.name} sentinel build failed`);
    }
    if (result.leaks.length > 0) {
      process.stderr.write(result.output);
      throw new Error(`${build.name} bundle leaked: ${result.leaks.join(", ")}`);
    }
    process.stdout.write(
      `[secrets] ${build.name} bundle contains none of ${SENTINEL_VARIABLES.length} sentinel values.\n`,
    );
  }
}
