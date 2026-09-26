import { describe, expect, it } from "vitest";
import {
  BUILDS,
  findSentinels,
  runSentinelBuild,
  SENTINEL_VARIABLES,
  sentinelEnv,
  type SpawnLike,
} from "../../../scripts/verify-bundle-secrets.mjs";

/**
 * The sentinel contract: every credential-shaped environment variable Phase 4
 * introduces must be watched, and the watcher must be honest about what it
 * found. These tests use injected spawns rather than real builds, so they stay
 * fast and assert the decision logic rather than the webpack output.
 */

describe("SENTINEL_VARIABLES", () => {
  it("watches the OpenAI key", () => {
    expect(SENTINEL_VARIABLES.map((variable) => variable.name)).toContain("OPENAI_API_KEY");
  });

  it("watches the OAuth client secret", () => {
    // A client secret in a browser bundle would let anyone impersonate the
    // add-in at the provider. This is the single most important entry here.
    expect(SENTINEL_VARIABLES.map((variable) => variable.name)).toContain(
      "TONEFORGE_OAUTH_CLIENT_SECRET",
    );
  });

  it("watches the PKCE verifier", () => {
    // A build-time inlined verifier would be the same for every install, which
    // defeats the point of PKCE entirely.
    expect(SENTINEL_VARIABLES.map((variable) => variable.name)).toContain(
      "TONEFORGE_OAUTH_PKCE_VERIFIER",
    );
  });

  it("watches the OpenRouter key", () => {
    expect(SENTINEL_VARIABLES.map((variable) => variable.name)).toContain("OPENROUTER_API_KEY");
  });

  it("watches the Anthropic key", () => {
    expect(SENTINEL_VARIABLES.map((variable) => variable.name)).toContain("ANTHROPIC_API_KEY");
  });

  it("gives every sentinel a distinct, recognizable value", () => {
    const values = SENTINEL_VARIABLES.map((variable) => variable.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every sentinel a long enough value to be unmistakable", () => {
    // A short sentinel could match by accident in a minified bundle and turn
    // every run into a false failure.
    SENTINEL_VARIABLES.forEach((variable) => {
      expect(variable.value.length).toBeGreaterThanOrEqual(20);
    });
  });
});

describe("sentinelEnv", () => {
  it("sets every watched variable", () => {
    const env = sentinelEnv({});
    SENTINEL_VARIABLES.forEach((variable) => {
      expect(env[variable.name]).toBe(variable.value);
    });
  });

  it("preserves the surrounding environment", () => {
    // `npm run verify` runs the whole graph; wiping PATH or NODE_ENV would make
    // the sentinel build fail for reasons unrelated to leaking.
    expect(sentinelEnv({ PATH: "/usr/bin" }).PATH).toBe("/usr/bin");
  });

  it("does not mutate the environment it was given", () => {
    const base = { PATH: "/usr/bin" };
    sentinelEnv(base);
    expect(base).toEqual({ PATH: "/usr/bin" });
  });
});

describe("findSentinels", () => {
  it("finds nothing in clean text", () => {
    expect(findSentinels("const apiKey = undefined;")).toEqual([]);
  });

  it("names the variable whose value leaked", () => {
    const leaked = SENTINEL_VARIABLES.find((variable) => variable.name === "OPENROUTER_API_KEY");
    expect(findSentinels(`key="${leaked?.value}"`)).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("reports every leak, not just the first", () => {
    const text = SENTINEL_VARIABLES.map((variable) => variable.value).join(" ");
    expect(findSentinels(text)).toHaveLength(SENTINEL_VARIABLES.length);
  });
});

describe("runSentinelBuild", () => {
  const build = { name: "production", config: "webpack.prod.js", mode: "production" };

  it("injects the sentinel environment into the build", () => {
    let captured: { env: NodeJS.ProcessEnv } | null = null;
    const envImpl: SpawnLike = (_command, _args, options) => {
      captured = options;
      return { status: 0, stdout: "" };
    };
    runSentinelBuild(build, { envImpl, scan: () => ({ status: 0, stdout: "" }) });

    expect(captured).not.toBeNull();
    const env = (captured as unknown as { env: NodeJS.ProcessEnv } | null)?.env ?? {};
    SENTINEL_VARIABLES.forEach((variable) => {
      expect(env[variable.name]).toBe(variable.value);
    });
  });

  it("reports no leak when the scan passes", () => {
    const result = runSentinelBuild(build, {
      envImpl: () => ({ status: 0, stdout: "" }),
      scan: () => ({ status: 0, stdout: "" }),
    });
    expect(result.built).toBe(true);
    expect(result.leaks).toEqual([]);
  });

  it("reports a leak when the scan fails", () => {
    const result = runSentinelBuild(build, {
      envImpl: () => ({ status: 0, stdout: "" }),
      scan: () => ({ status: 1, stdout: "found a secret" }),
    });
    expect(result.leaks).toHaveLength(1);
  });

  it("does not scan when the build itself failed", () => {
    // Scanning stale artifacts from a previous successful build would let a
    // broken build report clean.
    let scanned = false;
    const result = runSentinelBuild(build, {
      envImpl: () => ({ status: 2, stdout: "build error" }),
      scan: () => {
        scanned = true;
        return { status: 0, stdout: "" };
      },
    });
    expect(result.built).toBe(false);
    expect(scanned).toBe(false);
  });

  it("keeps the build output so a failure can be diagnosed", () => {
    const result = runSentinelBuild(build, {
      envImpl: () => ({ status: 2, stdout: "module not found" }),
      scan: () => ({ status: 0, stdout: "" }),
    });
    expect(result.output).toContain("module not found");
  });
});

describe("BUILDS", () => {
  it("covers both the development and production bundles", () => {
    // A sentinel that only watches the production build misses the case where
    // a value is inlined by a dev-only code path.
    expect(BUILDS.map((entry) => entry.name)).toEqual(["development", "production"]);
  });

  it("uses the matching webpack config for each build", () => {
    expect(BUILDS[0]?.config).toBe("webpack.dev.js");
    expect(BUILDS[1]?.config).toBe("webpack.prod.js");
  });
});
