import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProductionManifest,
  findDevelopmentArtifacts,
  validateProductionOrigin,
} from "../../../scripts/production-manifest.mjs";
import { checkProductionManifest } from "../../../scripts/check-release-package.mjs";

/**
 * A production manifest is public configuration. These tests are mostly about
 * what it must refuse to become, because the failure modes are silent: an
 * add-in that still points at `localhost:3000` installs fine and then does
 * nothing for every user, and one carrying a key ships the key to everyone.
 */

const PROD = "https://addins.toneforge.example";

/**
 * A value shaped like a real API key, assembled from parts.
 *
 * The repository's own secret scanner flags any literal matching the provider
 * key patterns, which is exactly what it should do. Writing the literal here
 * would make that scanner fail on its own test fixture, so the string is
 * concatenated at runtime instead — the same technique
 * `scripts/check-secrets.mjs` uses for its own sentinel.
 */
const FAKE_KEY = `${"s" + "k"}-${"abcdefghijklmnopqrstuvwx"}`;

function sourceManifest() {
  return {
    validDomains: ["https://localhost:3000"],
    extensions: [
      {
        runtimes: [
          { code: { page: "https://localhost:3000/taskpane.html" } },
          { code: { page: "https://localhost:3000/commands.html" } },
        ],
      },
    ],
  };
}

describe("validateProductionOrigin", () => {
  it("accepts a plain HTTPS origin", () => {
    expect(validateProductionOrigin(PROD)).toEqual([]);
  });

  it("accepts an explicit 443", () => {
    expect(validateProductionOrigin(`${PROD}:443`)).toEqual([]);
  });

  it("rejects an empty origin", () => {
    expect(validateProductionOrigin("")).toEqual(["Production origin is required."]);
    expect(validateProductionOrigin(undefined)).toEqual(["Production origin is required."]);
  });

  it("rejects a value that is not a URL", () => {
    expect(validateProductionOrigin("addins.toneforge.example")).toHaveLength(1);
  });

  it("rejects plaintext HTTP", () => {
    expect(validateProductionOrigin("http://addins.toneforge.example")).toContain(
      "Production origin must use HTTPS.",
    );
  });

  it("rejects localhost", () => {
    expect(validateProductionOrigin("https://localhost:3000")).toContainEqual(
      expect.stringContaining("loopback"),
    );
  });

  it("rejects the IPv4 loopback address", () => {
    expect(validateProductionOrigin("https://127.0.0.1")).toContainEqual(
      expect.stringContaining("loopback"),
    );
  });

  it("rejects the unspecified address", () => {
    // 0.0.0.0 would resolve to the local machine on some hosts, which is the
    // same class of mistake as 127.0.0.1.
    expect(validateProductionOrigin("https://0.0.0.0")).toContainEqual(
      expect.stringContaining("loopback"),
    );
  });

  it("rejects a local-network hostname", () => {
    expect(validateProductionOrigin("https://devbox.local")).toContainEqual(
      expect.stringContaining("local-network"),
    );
  });

  it("rejects a private-network address", () => {
    expect(validateProductionOrigin("https://10.0.0.5")).toContainEqual(
      expect.stringContaining("private"),
    );
    expect(validateProductionOrigin("https://192.168.1.10")).toContainEqual(
      expect.stringContaining("private"),
    );
  });

  it("rejects embedded credentials", () => {
    expect(validateProductionOrigin("https://user:pass@addins.toneforge.example")).toContain(
      "Production origin must not contain credentials.",
    );
  });

  it("rejects a query string, which is where keys get pasted", () => {
    expect(validateProductionOrigin(`${PROD}/?api_key=abc`)).toContain(
      "Production origin must not contain a query or fragment.",
    );
  });

  it("rejects a non-standard port", () => {
    expect(validateProductionOrigin(`${PROD}:8080`)).toContainEqual(
      expect.stringContaining("non-standard port"),
    );
  });

  it("rejects an origin that carries a credential", () => {
    expect(validateProductionOrigin(`${PROD}/${FAKE_KEY}`)).toContainEqual(
      expect.stringContaining("credential"),
    );
  });

  it("reports every problem at once rather than one at a time", () => {
    // A user fixing an origin should see the whole list, not discover the next
    // problem only after fixing the first.
    const problems = validateProductionOrigin("http://localhost:8080");
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe("findDevelopmentArtifacts", () => {
  it("finds a loopback page URL", () => {
    const found = findDevelopmentArtifacts({
      extensions: [{ runtimes: [{ code: { page: "https://localhost:3000/taskpane.html" } }] }],
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("extensions[0].runtimes[0].code.page");
    expect(found[0]?.reason).toMatch(/loopback/);
  });

  it("finds a development broker path", () => {
    const found = findDevelopmentArtifacts({ page: "https://gw.example/__toneforge/llm/v1" });
    expect(found[0]?.reason).toMatch(/development broker path/);
  });

  it("finds plaintext HTTP", () => {
    const found = findDevelopmentArtifacts({ page: "http://addins.example/taskpane.html" });
    expect(found[0]?.reason).toMatch(/plaintext HTTP/);
  });

  it("finds a credential-shaped value and redacts it in the report", () => {
    const found = findDevelopmentArtifacts({ note: `key is ${FAKE_KEY}` });
    expect(found[0]?.reason).toMatch(/credential-shaped/);
    // The report must not re-print the secret it just found.
    expect(found[0]?.value).toBe("<redacted>");
  });

  it("finds a key in a query string", () => {
    const found = findDevelopmentArtifacts({
      url: `https://x.example/cb?access_token=${FAKE_KEY}`,
    });
    expect(found[0]?.reason).toMatch(/credential-shaped/);
  });

  it("reports nothing for a clean production manifest", () => {
    expect(
      findDevelopmentArtifacts({
        validDomains: [PROD],
        extensions: [{ runtimes: [{ code: { page: `${PROD}/taskpane.html` } }] }],
      }),
    ).toEqual([]);
  });

  it("does not mistake a hostname containing a digit for a loopback address", () => {
    expect(findDevelopmentArtifacts({ page: "https://office127.example/taskpane.html" })).toEqual(
      [],
    );
  });
});

describe("buildProductionManifest", () => {
  it("substitutes the development origin everywhere", () => {
    const result = buildProductionManifest(sourceManifest(), PROD);
    expect(result.validDomains).toEqual([PROD]);
    expect(result.extensions[0]?.runtimes[0]?.code.page).toBe(`${PROD}/taskpane.html`);
    expect(result.extensions[0]?.runtimes[1]?.code.page).toBe(`${PROD}/commands.html`);
  });

  it("produces a manifest with no development artifacts", () => {
    expect(findDevelopmentArtifacts(buildProductionManifest(sourceManifest(), PROD))).toEqual([]);
  });

  it("preserves the page paths, only the origin changes", () => {
    const result = buildProductionManifest(sourceManifest(), PROD);
    expect(result.extensions[0]?.runtimes[0]?.code.page.endsWith("/taskpane.html")).toBe(true);
  });

  it("does not mutate the source manifest", () => {
    // The checked-in manifest is the sideload target; rewriting it in place
    // would break `npm run sideload` for the next person who clones the repo.
    const source = sourceManifest();
    buildProductionManifest(source, PROD);
    expect(source.validDomains).toEqual(["https://localhost:3000"]);
  });

  it("refuses to build from an unacceptable origin", () => {
    expect(() => buildProductionManifest(sourceManifest(), "http://localhost:3000")).toThrow(
      /Refusing to build a production manifest/,
    );
  });

  it("refuses a source manifest with no origin to substitute", () => {
    expect(() => buildProductionManifest({}, PROD)).toThrow(/validDomains/);
  });

  it("refuses to emit a result that still contains a development value", () => {
    // A source manifest naming a second, un-substituted development URL must
    // be caught rather than shipped.
    const mixed = {
      validDomains: ["https://localhost:3000"],
      extra: "https://127.0.0.1:9000/admin",
    };
    expect(() => buildProductionManifest(mixed, PROD)).toThrow(/still contains development/);
  });
});

describe("checkProductionManifest", () => {
  it("accepts a clean manifest and origin", () => {
    const result = checkProductionManifest(buildProductionManifest(sourceManifest(), PROD), PROD);
    expect(result.productionOrigin).toBe(PROD);
  });

  it("refuses a manifest that still points at localhost", () => {
    expect(() => checkProductionManifest(sourceManifest(), PROD)).toThrow(
      /contains development values/,
    );
  });

  it("refuses a manifest checked against an unacceptable origin", () => {
    const clean = buildProductionManifest(sourceManifest(), PROD);
    expect(() => checkProductionManifest(clean, "http://addins.example")).toThrow(/not acceptable/);
  });

  it("names the offending field so the failure is actionable", () => {
    try {
      checkProductionManifest(sourceManifest(), PROD);
      throw new Error("expected the check to throw");
    } catch (error) {
      expect((error as Error).message).toContain("validDomains");
    }
  });
});

describe("the real manifest.json", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));

  it("stays on localhost so npm run sideload keeps working", () => {
    expect(manifest.validDomains).toEqual(["https://localhost:3000"]);
  });

  it("has no credential-shaped value of its own", () => {
    expect(
      findDevelopmentArtifacts(manifest).filter((item) => /credential/.test(item.reason)),
    ).toEqual([]);
  });

  it("produces a clean production manifest", () => {
    const result = buildProductionManifest(manifest, PROD);
    expect(findDevelopmentArtifacts(result)).toEqual([]);
  });
});
