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

  it("records XML as running the same function as JSON, onto one shared default pane", async () => {
    const definitions = JSON.parse(
      readFileSync(repositoryPath("src/commands/commandDefinitions.json"), "utf8"),
    ) as Array<{
      id: string;
      jsonAction: string;
      xmlAction: string;
      navigationTarget: string;
      xmlNavigationTarget: string;
    }>;
    expect(definitions.length).toBeGreaterThan(0);
    /*
     * `ExecuteFunction` on the XML side, not `ShowTaskpane`.
     *
     * This assertion used to require `ShowTaskpane`, which is what let the XML
     * manifest name a pane of its own (`ButtonId1`) while the JSON manifest
     * reached the default one — two identities, and Word opened a second blank
     * pane beside the live one whenever the context menu was used. The field
     * looked like a description of a difference that was intentional; it was a
     * description of a difference nobody had checked, because nothing failed
     * when it happened. (ADR-0101.)
     */
    expect(definitions.every((definition) => definition.xmlAction === "ExecuteFunction")).toBe(
      true,
    );
    expect(definitions.every((definition) => definition.jsonAction === "executeFunction")).toBe(
      true,
    );
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
      extensions: Array<{ runtimes: Array<{ id: string; actions: Array<{ id: string }> }> }>;
    };
    const xml = readFileSync(repositoryPath("manifest.xml"), "utf8");
    const missingAction = structuredClone(manifest);
    /*
     * The runtime is found BY ID, not by index. It used to be `runtimes[1]`, and
     * the semantic deep-link runtime (ADR-0109) was inserted at index 1 \u2014 so the
     * lookup found nothing, nothing was mutated, and this assertion passed over a
     * manifest that was never altered. A fixture addressed by position silently
     * stops testing the thing it names the moment the file grows an entry.
     */
    const action = missingAction.extensions[0]?.runtimes
      .find((runtime) => runtime.id === "CommandsRuntime")
      ?.actions.find(({ id }) => id === "ToneForgeScan");
    if (action) action.id = "UnexpectedAction";
    expect(
      await validateManifests({
        manifest: missingAction,
        xml,
        runOfficialValidator: false,
      }),
    ).toContain("manifest.json is missing runtime action for command: ToneForgeScan");

    /*
     * The destination belongs to the one control that opens the pane. Before
     * ADR-0101 every ribbon control named it, so a function control that named
     * none looked wrong; now that every command reaches the pane by function,
     * asking a command for a destination would be the wrong question.
     */
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
      "manifest.xml destination mismatch for ToneForgeTaskpane: expected Taskpane.Url, got Missing.Url",
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
    ).toContain("manifest.xml is missing destination resource Taskpane.Url for ToneForgeTaskpane");
  });

  describe("the single task pane (ADR-0101)", () => {
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as object;
    const xml = readFileSync(repositoryPath("manifest.xml"), "utf8");

    const validate = (candidate: string): Promise<string[]> =>
      validateManifests({ manifest, xml: candidate, runOfficialValidator: false });

    it("passes on the published manifest", async () => {
      expect(await validate(xml)).toEqual([]);
    });

    /*
     * Two controls opening DIFFERENT PAGES of one pane is correct, and is the
     * whole mechanism (ADR-0109). Two controls opening DIFFERENT panes is the
     * fork, and that is asserted by IDENTITY below \u2014 `TaskpaneId`, not
     * `SourceLocation`.
     *
     * This assertion once inverted the other way round and rejected a manifest
     * for using a documented Office feature: the context menu points at
     * `semantic.html` while the ribbon points at `taskpane.html`, and Microsoft
     * states the pane container stays open with "the contents of the pane
     * replaced with the corresponding Action SourceLocation".
     */
    it("accepts a second page of the one pane, which is the deep link", async () => {
      const deepLinked = xml.replace(
        '<SourceLocation resid="Taskpane.Semantic.Url" />',
        '<SourceLocation resid="Taskpane.Url" />',
      );
      expect(deepLinked).not.toEqual(xml);
      // Same page twice is not a defect either \u2014 it is merely a redundant route.
      expect(await validate(deepLinked)).toEqual([]);
    });

    it("rejects a pane command whose source names a resource that does not exist", async () => {
      const dangling = xml.replace(
        '<SourceLocation resid="Taskpane.Semantic.Url" />',
        '<SourceLocation resid="Other.Url" />',
      );
      expect(dangling).not.toEqual(xml);
      // A resid with no resource never resolves, and the host opens nothing at
      // all without saying so \u2014 the same shape as an over-length resource id.
      expect(await validate(dangling)).toContain(
        "manifest.xml control ToneForgeSemanticContextControl opens the pane at resource Other.Url, which resolves to no page; the host opens nothing and reports nothing (ADR-0109)",
      );
    });

    it("rejects a second, DIFFERENT pane identity, because that is a second pane", async () => {
      /*
       * Microsoft: "use a different TaskpaneId if you want an independent pane for
       * each" \u2014 so a different id is the thing that creates a second pane, and a
       * *shared* one is how several controls address the same pane.
       *
       * This assertion once forbade the id outright (ADR-0104), which is what made
       * two `ShowTaskpane` actions into two instances in a real Word.
       */
      const forked = xml.replace(/<TaskpaneId>ButtonId1<\/TaskpaneId>/g, "");
      expect(forked).not.toEqual(xml);
      const errors = await validate(forked);
      expect(errors.some((error) => error.includes("must use taskpane ButtonId1"))).toBe(true);
    });

    it("rejects a function control that smuggles a pane source back in", async () => {
      const forked = xml.replace(
        "<FunctionName>ToneForgeScan</FunctionName>",
        '<SourceLocation resid="Taskpane.Url" />\n                  <FunctionName>ToneForgeScan</FunctionName>',
      );
      expect(forked).not.toEqual(xml);
      const errors = await validate(forked);
      expect(errors).toContain(
        "manifest.xml control ToneForgeScan runs a function and must not declare its own source; the one task pane is declared by the ShowTaskpane controls (ADR-0107)",
      );
    });

    /*
     * One pane identity, asserted from both directions.
     *
     * Microsoft: "Use the same TaskpaneId for different actions that share the
     * same pane... use a different TaskpaneId if you want an independent pane for
     * each."
     *
     * These two replace an assertion that forbade the id outright (ADR-0104). That
     * was backwards, and it is what made two panes: with no id, the context menu
     * and the ribbon each became their own instance, confirmed in a real Word.
     */
    it("rejects a pane command whose identity is missing", async () => {
      const forked = xml.replace(/<TaskpaneId>ButtonId1<\/TaskpaneId>\n\s*/g, "");
      expect(forked).not.toEqual(xml);
      const errors = await validate(forked);
      expect(errors.some((error) => error.includes("must use taskpane ButtonId1"))).toBe(true);
    });

    it("rejects a pane command renamed to its own independent pane", async () => {
      const forked = xml.replace(
        /<TaskpaneId>ButtonId1<\/TaskpaneId>/g,
        "<TaskpaneId>Other</TaskpaneId>",
      );
      expect(forked).not.toEqual(xml);
      const errors = await validate(forked);
      expect(errors.some((error) => error.includes("a different id is a second pane"))).toBe(true);
    });

    it("rejects the pane control being pointed at something other than the pane", async () => {
      const wrongPage = xml.replace(
        '<bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/taskpane.html" />',
        '<bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/other.html" />',
      );
      expect(await validate(wrongPage)).toContain(
        "manifest.xml task pane ToneForgeTaskpane must open taskpane.html, got https://localhost:3000/other.html",
      );
    });
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

  it("rejects a group that reuses its enclosing tab's id", async () => {
    /*
     * `OfficeTab` shares the id namespace with `Group` and `Control`, so a group
     * carrying the tab's own id is the same defect as a group colliding with a
     * control — one level up. Word rejects the whole manifest either way, and the
     * check has to name the pair for the failure to be actionable.
     */
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as unknown;
    const broken = readFileSync(repositoryPath("manifest.xml"), "utf8").replace(
      '<Group id="ToneForgeProfileGroup">',
      '<Group id="ToneForge">',
    );
    expect(broken).not.toBe(readFileSync(repositoryPath("manifest.xml"), "utf8"));

    const errors = await validateManifests({ manifest, xml: broken, runOfficialValidator: false });
    expect(errors).toContain(
      'manifest.xml UI element id "ToneForge" is used by both a <OfficeTab> and a <Group> on the ToneForge ribbon; Word requires these ids to be unique and rejects the entire manifest, which presents as "This add-in is no longer available"',
    );
  });

  it("still rejects a duplicate id when the tab tag is spelled differently", async () => {
    /*
     * The scan is bounded to the ToneForge tab, so the locator is load-bearing:
     * had it failed to find a tab written with different whitespace or attribute
     * order, `validateUniqueUiElementIds` would have found nothing, returned no
     * errors, and the manifest would have passed — the exact defect it exists to
     * catch, reintroduced through the spelling of the tag rather than through the
     * id. Both conditions are combined here on purpose: a duplicate that is only
     * caught for the one exact spelling of the enclosing tag is not caught at all.
     */
    const manifest = JSON.parse(readFileSync(repositoryPath("manifest.json"), "utf8")) as unknown;
    const broken = readFileSync(repositoryPath("manifest.xml"), "utf8")
      .replace('<OfficeTab id="ToneForge">', '<OfficeTab\n  id="ToneForge"\n>')
      .replace('<Group id="ToneForgeProfileGroup">', '<Group id="ToneForgeProfile">');
    expect(broken).toContain('<OfficeTab\n  id="ToneForge"\n>');

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
    for (const match of tab.matchAll(/<(OfficeTab|Tab|Group|Control)\b[^>]*\bid="([^"]*)"/g)) {
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
      for (const file of [
        "manifest.json",
        "manifest.xml",
        "taskpane.html",
        "semantic.html",
        "commands.html",
      ]) {
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
      /*
       * One bundle per page, not one for the lot.
       *
       * `checkReleasePackage` bundle-checks every page the manifest names, so a
       * package where all three pages share one bundle passes for the wrong
       * reason -- and a real build emits one content-hashed entry per page. The
       * fixture therefore mirrors the build, and the assertion below is that all
       * three were checked.
       */
      const pages = ["taskpane.html", "semantic.html", "commands.html"];
      for (const page of pages) {
        const pageBundle = `${page.replace(/\.html$/, "")}.abcdef12.js`;
        writeFileSync(resolve(staging, page), `<script src="${pageBundle}"></script>`);
        writeFileSync(resolve(staging, pageBundle), "console.log('bundle')");
      }
      const result = checkReleasePackage(staging);
      expect(result.pages).toEqual(pages);
      expect(result.javascriptCount).toBe(pages.length);
      expect([...result.referencedBundles].sort()).toEqual(
        pages.map((page) => page.replace(/\.html$/, "") + ".abcdef12.js").sort(),
      );
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
