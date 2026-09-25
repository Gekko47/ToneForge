import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifests } from "../../../scripts/validate-manifest.mjs";
import {
  VERIFICATION_GRAPH,
  VERIFICATION_GRAPH_NAME,
} from "../../../scripts/verification-graph.mjs";
import { checkReleasePackage } from "../../../scripts/check-release-package.mjs";

function repositoryPath(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

describe("command and manifest contracts", () => {
  it("records XML as navigation-only with a shared default task-pane destination", () => {
    const definitions = JSON.parse(
      readFileSync(repositoryPath("src/commands/commandDefinitions.json"), "utf8"),
    ) as Array<{
      id: string;
      xmlAction: string;
      navigationTarget: string;
      xmlNavigationTarget: string;
    }>;
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.every((definition) => definition.xmlAction === "ShowTaskpane")).toBe(true);
    expect(definitions.every((definition) => definition.xmlNavigationTarget === "default")).toBe(
      true,
    );
    expect(definitions.every((definition) => definition.navigationTarget !== "default")).toBe(true);
    expect(
      validateManifests({
        manifestPath: repositoryPath("manifest.json"),
        xmlManifestPath: repositoryPath("manifest.xml"),
        runOfficialValidator: false,
      }),
    ).toEqual([]);
  });

  it("validates equivalent JSON/XML command identity, labels, and destinations", () => {
    const errors = validateManifests({
      manifestPath: repositoryPath("manifest.json"),
      xmlManifestPath: repositoryPath("manifest.xml"),
      runOfficialValidator: false,
    });
    expect(errors).toEqual([]);
  });

  it("rejects missing runtime actions, mismatched destinations, and missing XML resources", async () => {
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as {
      extensions: Array<{ runtimes: Array<{ actions: Array<{ id: string }> }> }>;
    };
    const xml = readFileSync(repositoryPath("manifest.xml"), "utf8");
    const missingAction = structuredClone(manifest);
    const action = missingAction.extensions[0]?.runtimes[1]?.actions.find(
      ({ id }) => id === "ToneForgeScan",
    );
    if (action) action.id = "UnexpectedAction";
    expect(
      validateManifests({
        manifest: missingAction,
        xml,
        runOfficialValidator: false,
      }),
    ).toContain("manifest.json is missing runtime action for command: ToneForgeScan");

    const mismatchedDestination = xml.replace(
      /<SourceLocation resid="Taskpane.Url" \/>/g,
      '<SourceLocation resid="Missing.Url" />',
    );
    expect(
      validateManifests({
        manifest,
        xml: mismatchedDestination,
        runOfficialValidator: false,
      }),
    ).toContain(
      "manifest.xml destination mismatch for ToneForgeScan: expected Taskpane.Url, got Missing.Url",
    );

    const missingResource = xml.replace(
      '<bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/taskpane.html" />',
      "",
    );
    expect(
      validateManifests({
        manifest,
        xml: missingResource,
        runOfficialValidator: false,
      }),
    ).toContain("manifest.xml is missing destination resource Taskpane.Url for ToneForgeScan");
  });

  it("rejects incoherent dummy release packages", () => {
    const staging = mkdtempSync(join(tmpdir(), "toneforge-release-package-test-"));
    try {
      for (const file of ["manifest.json", "manifest.xml", "taskpane.html", "commands.html"]) {
        writeFileSync(resolve(staging, file), "test");
      }
      cpSync(resolve(process.cwd(), "assets"), resolve(staging, "assets"), { recursive: true });
      writeFileSync(resolve(staging, "commands.js"), "bundle");
      expect(() => checkReleasePackage(staging)).toThrow("staged manifest.json is not valid JSON");
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it("accepts a coherent staged package and validates its bundles", () => {
    const staging = mkdtempSync(join(tmpdir(), "toneforge-release-package-test-"));
    try {
      cpSync(resolve(process.cwd(), "manifest.json"), resolve(staging, "manifest.json"));
      cpSync(resolve(process.cwd(), "manifest.xml"), resolve(staging, "manifest.xml"));
      cpSync(resolve(process.cwd(), "assets"), resolve(staging, "assets"), { recursive: true });
      const bundle = "taskpane.abcdef12.js";
      writeFileSync(resolve(staging, "taskpane.html"), `<script src="${bundle}"></script>`);
      writeFileSync(resolve(staging, "commands.html"), `<script src="${bundle}"></script>`);
      writeFileSync(resolve(staging, bundle), "console.log('bundle')");
      const result = checkReleasePackage(staging);
      expect(result.javascriptCount).toBe(1);
      expect(result.referencedBundles).toEqual([bundle]);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it("uses one named ordered graph including skills, coverage, build, package, and package checks", () => {
    expect(VERIFICATION_GRAPH_NAME).toBe("toneforge-repository-v1");
    expect(VERIFICATION_GRAPH.map(({ name }) => name)).toEqual([
      "typecheck",
      "lint",
      "format",
      "secret-scan",
      "docs",
      "skills",
      "test",
      "coverage",
      "build-artifacts",
      "built-secret-scan",
      "manifest",
      "package",
      "package-check",
    ]);
    expect(VERIFICATION_GRAPH.find(({ name }) => name === "skills")?.command).toBe(
      "npm run skills:validate",
    );
    expect(VERIFICATION_GRAPH.find(({ name }) => name === "package-check")?.command).toBe(
      "npm run release:package:check",
    );
  });
});
