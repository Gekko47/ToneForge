import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const artifactCheck = readFileSync(
  resolve(process.cwd(), "scripts/check-build-artifacts.mjs"),
  "utf8",
);
const secretCheck = readFileSync(resolve(process.cwd(), "scripts/check-secrets.mjs"), "utf8");

describe("generated-artifact sentinel scanning", () => {
  it("uses a sentinel value that both artifact scanners actually detect", () => {
    const sentinel = `${["TONE", "FORGE", "SENTINEL"].join("_")}_ABCDEFGHIJKL`;
    const artifactPattern = new RegExp(
      `${["TONE", "FORGE", "SENTINEL"].join("_")}_[A-Za-z0-9_-]{12,}`,
    );
    const sourcePattern = new RegExp(
      `${["TONE", "FORGE", "SENTINEL"].join("_")}_[A-Za-z0-9_-]{12,}`,
    );
    expect(artifactCheck).toContain('["TONE", "FORGE", "SENTINEL"]');
    expect(secretCheck).toContain('["TONE", "FORGE", "SENTINEL"]');
    expect(artifactPattern.test(sentinel)).toBe(true);
    expect(sourcePattern.test(sentinel)).toBe(true);
  });

  it("keeps the sentinel build script using the detected sentinel", () => {
    const buildCheck = readFileSync(
      resolve(process.cwd(), "scripts/verify-bundle-secrets.mjs"),
      "utf8",
    );
    expect(buildCheck).toContain('["TONE", "FORGE", "SENTINEL"]');
    expect(buildCheck).toContain("check-secrets.mjs");
  });
});
