import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("validates both the Cline and the Roo skill roots", async () => {
    // Both sets exist and are governed, so the `skills` stage of the graph has
    // to cover both. Checking one would let the other drift silently, which is
    // exactly how the old rules came to describe a state schema six versions
    // behind and a credential model that had been removed (ADR-0083).
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(process.execPath, [repositoryPath("scripts/validate-skills.mjs")], {
      encoding: "utf8",
    });

    expect(output).toContain(".cline/skills/");
    expect(output).toContain(".roo/skills/");
    expect(output).toContain("2 skill root(s) validated");

    // Every expected skill of each root is actually present, rather than the
    // validator reporting success over a directory that lost a skill.
    for (const skill of [
      "toneforge-scaffold",
      "toneforge-architecture",
      "toneforge-officejs",
      "toneforge-llm",
      "toneforge-testing",
      "toneforge-consistency",
    ]) {
      expect(existsSync(repositoryPath(`.cline/skills/${skill}/SKILL.md`))).toBe(true);
    }
  });

  it("records XML as navigation-only with a shared default task-pane destination", async () => {
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
      await validateManifests({
        manifestPath: repositoryPath("manifest.json"),
        xmlManifestPath: repositoryPath("manifest.xml"),
        runOfficialValidator: false,
      }),
    ).toEqual([]);
  });

  it("validates equivalent JSON/XML command identity, labels, and destinations", async () => {
    const errors = await validateManifests({
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
      await validateManifests({
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
      await validateManifests({
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
      await validateManifests({
        manifest,
        xml: missingResource,
        runOfficialValidator: false,
      }),
    ).toContain("manifest.xml is missing destination resource Taskpane.Url for ToneForgeScan");
  });

  it("rejects a resource id the host would refuse, which fails registration silently", async () => {
    /*
     * Microsoft caps a `resid` and its resource `id` at 32 characters. Over that
     * the host rejects the manifest outright: the add-in never registers and Word
     * reports only "This add-in is no longer available", naming nothing. The
     * published-schema check below does not catch it, because the unified JSON
     * manifest is schema-validated and the XML fallback — the file every sideload
     * script actually reads — is not. A 39-character group label shipped in
     * commit c240784 and passed every check in this repository.
     */
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as unknown;
    const overLength = readFileSync(repositoryPath("manifest.xml"), "utf8").replace(
      /resid="ToneForge\.DetReviewGroupLabel"/g,
      'resid="ToneForge.DeterministicReviewGroupLabel"',
    );
    expect(overLength).not.toBe(readFileSync(repositoryPath("manifest.xml"), "utf8"));

    const errors = await validateManifests({
      manifest,
      xml: overLength,
      runOfficialValidator: false,
    });
    expect(errors).toContain(
      'manifest.xml resource id "ToneForge.DeterministicReviewGroupLabel" is 39 characters; the host limit is 32 and an over-length id prevents the add-in from registering',
    );
  });

  it("rejects a Control without the required xsi:type, which voids the whole manifest", async () => {
    /*
     * `xsi:type` is required on Control. Word does not fail that one control — it
     * fails to parse the manifest and refuses the entire add-in, so every ribbon
     * entry disappears together. The context-menu Control added in commit
     * 8a4878f omitted it; Word's own runtime log recorded
     * "Add-in manifest parsing encountered an unexpected child node, Line=266"
     * and the user saw only "This add-in is no longer available".
     */
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as unknown;
    const broken = readFileSync(repositoryPath("manifest.xml"), "utf8").replace(
      '<Control xsi:type="Button" id="ToneForgeSemanticContextControl">',
      '<Control id="ToneForgeSemanticContextControl">',
    );
    const errors = await validateManifests({ manifest, xml: broken, runOfficialValidator: false });
    expect(errors).toContain(
      "manifest.xml Control ToneForgeSemanticContextControl is missing the required xsi:type attribute (Button, Menu, or MobileButton); Word rejects the entire manifest without it, not just this control",
    );
  });

  it("rejects a UI element id used twice, which voids the whole manifest", async () => {
    /*
     * Word requires every tab, group, and control id on a ribbon surface to be
     * unique, and a repeat makes it refuse the entire manifest. The Profile
     * group and the Profile control inside it both carried `ToneForgeProfile`,
     * introduced when the group was renamed to match its label; every other
     * group in the file ends in `Group` and that one did not.
     *
     * Word's own log named it precisely — "Duplicate UI element id specified ...
     * id:ToneForgeProfile" — while Word itself showed only "This add-in is no
     * longer available". Nothing in this repository caught it: the parity check
     * compares the two manifests against each other, and both were edited
     * together, so they agreed on a manifest the host would not load.
     */
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as unknown;
    const broken = readFileSync(repositoryPath("manifest.xml"), "utf8").replace(
      '<Group id="ToneForgeProfileGroup">',
      '<Group id="ToneForgeProfile">',
    );
    expect(broken).not.toBe(readFileSync(repositoryPath("manifest.xml"), "utf8"));

    const errors = await validateManifests({ manifest, xml: broken, runOfficialValidator: false });
    expect(errors).toContain(
      'manifest.xml UI element id "ToneForgeProfile" is used by both a <Group> and a <Control> on the ToneForge ribbon; Word requires these ids to be unique and rejects the entire manifest, which presents as "This add-in is no longer available"',
    );
  });

  it("keeps every real ribbon UI element id unique", async () => {
    // The assertion that would have failed before the rename. It reads the
    // manifest rather than trusting the validator, so a future edit that
    // reuses a group or control id is caught with the pair named.
    const xml = readFileSync(repositoryPath("manifest.xml"), "utf8");
    const tabStart = xml.indexOf('<OfficeTab id="ToneForge">');
    const tab = xml.slice(tabStart, xml.indexOf("</OfficeTab>", tabStart));
    const owners = new Map<string, string>();
    const collisions: string[] = [];
    for (const match of tab.matchAll(/<(Tab|Group|Control)\b[^>]*\bid="([^"]*)"/g)) {
      const kind = match[1] ?? "";
      const id = match[2] ?? "";
      const previous = owners.get(id);
      if (previous !== undefined) collisions.push(`${id} (<${previous}> and <${kind}>)`);
      else owners.set(id, kind);
    }
    expect(owners.size).toBeGreaterThan(0);
    expect(collisions).toEqual([]);
  });

  it("keeps every real resource id within the host limit", async () => {
    // The assertion that would have failed before the rename. It reads the
    // manifest rather than trusting the validator, so a future edit that
    // lengthens an id cannot quietly reintroduce the defect.
    const xml = readFileSync(repositoryPath("manifest.xml"), "utf8");
    const ids = [
      ...xml.matchAll(/\bresid="([^"]*)"/g),
      ...xml.matchAll(/<bt:(?:Image|Url|String)\b[^>]*\bid="([^"]*)"/g),
    ].map((match) => match[1] ?? "");
    expect(ids.length).toBeGreaterThan(0);
    // Named in the failure so a regression says which id, and how long.
    const overLength = ids.filter((id) => id.length > 32).map((id) => `${id} (${id.length})`);
    expect(overLength).toEqual([]);
  });

  it("passes the published v1.30 schema check, which the manifest stage runs in CI", async () => {
    // The stage is skipped on Windows, where the official validator is not run.
    // Asserting it here keeps the manifest from silently losing schema
    // conformance on a platform that only ever verifies it on Linux.
    const errors = await validateManifests({
      manifestPath: repositoryPath("manifest.json"),
      xmlManifestPath: repositoryPath("manifest.xml"),
      runOfficialValidator: true,
    });
    expect(errors).toEqual([]);
  });

  it("rejects a manifest whose ribbon control drops a schema-required field", async () => {
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as {
      extensions: Array<{
        ribbons: Array<{ tabs: Array<{ groups: Array<{ controls: unknown[] }> }> }>;
      }>;
    };
    const withoutSupertip = structuredClone(manifest);
    const control = withoutSupertip.extensions[0]?.ribbons[0]?.tabs[0]?.groups[0]?.controls[0] as
      Record<string, unknown> | undefined;
    if (control) delete control.supertip;
    const errors = await validateManifests({
      manifest: withoutSupertip,
      xml: readFileSync(repositoryPath("manifest.xml"), "utf8"),
      runOfficialValidator: true,
    });
    expect(errors.join("\n")).toContain("must have required property 'supertip'");
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
