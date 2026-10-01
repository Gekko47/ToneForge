/**
 * The structural acquisition scopes: tables (§8.3), sections (§8.5) and
 * headers/footers (§8.4).
 *
 * These three families are the ones the earlier passes read but never *used*.
 * The host double served `body.tables` and `document.sections`, the plan tracked
 * them, and `buildFormatting` dropped all of it on the floor — so the analyzer's
 * table, header/footer and page-setup checks compared empty arrays and the
 * `unsupported` list named all three scopes on every scan, from a constant,
 * whether or not they had been read. A green suite said nothing about any of it.
 *
 * The doubles below are strict in the same way as
 * `analysisAcquisitionDegradedScope.test.ts`: a `load` of a name the host does
 * not have rejects the whole `sync`, and a read of a property that was never
 * loaded throws. That is what makes "it read a name Word does not have" a
 * failing test here rather than a silent degradation in the add-in.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPageSetupRefusal,
  __resetRefusedCapabilities,
  acquireAnalysisContext,
  LOADABLE_TABLE_PROPERTIES,
  PAGE_SETUP_PROPERTIES,
} from "../../../src/word/analysisAcquisition";
import type { AnalysisCapabilities } from "../../../src/analysis/analysisContext";
import { StyleProfileSchema } from "../../../src/core/domain/StyleProfile";
import {
  createGovernanceProfile,
  type GovernanceProfile,
} from "../../../src/core/domain/GovernanceProfile";
import { SAMPLE_PROFILE } from "../../fixtures/sampleDocs";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

const BASE_CAPABILITIES: AnalysisCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: true,
  supportsSelection: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenuApi: true,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  hostName: "Word",
  hostVersion: "16",
};

const STRUCTURAL_CAPABILITIES: AnalysisCapabilities = {
  ...BASE_CAPABILITIES,
  supportsTables: true,
  supportsHeadersFooters: true,
  supportsSections: true,
};

/**
 * A governance profile whose scope policy says what this case is about.
 *
 * A scope policy that cannot stop a read is not a scope policy, so each case
 * that turns a scope on or off has to say so explicitly — the defaults are not
 * evidence of anything.
 */
function policyWith(scope: Partial<GovernanceProfile["scope"]>): GovernanceProfile {
  const base = createGovernanceProfile(PROFILE, "test");
  return { ...base, scope: { ...base.scope, ...scope } };
}

/**
 * The names a `Word.Table` actually has.
 *
 * Written independently of the module, for the reason
 * `analysisAcquisitionDegradedScope.test.ts` gives: a declared list can only
 * prove a name is *on the list*, not that Word has it.
 * <https://learn.microsoft.com/javascript/api/word/word.interfaces.tableloadoptions>
 *
 * `cellStyleName` and `headerRow` are deliberately absent — that is the finding
 * the acquisition encodes as `null`.
 */
const HOST_TABLE_PROPERTIES: ReadonlySet<string> = new Set([
  "style",
  "styleBuiltIn",
  "values",
  "rowCount",
  "headerRowCount",
]);

/** `Word.PageSetup` load options. WordApiDesktop 1.3. */
const HOST_PAGE_SETUP_PROPERTIES: ReadonlySet<string> = new Set(PAGE_SETUP_PROPERTIES);

/** Every load name the host was asked for, across every transaction. */
let REQUESTED: string[] = [];

/**
 * Load names requested on a `Word.Table`, kept apart from `REQUESTED`.
 *
 * `style` and `styleBuiltIn` are requested on paragraphs, on tables and on
 * headers, so "no table property was requested" cannot be answered from the
 * combined list — it would be satisfied by a paragraph load and prove nothing.
 */
let TABLE_REQUESTS: string[] = [];

/** Load names requested on a `Word.Section`, `pageSetup/*` prefixed. */
let SECTION_REQUESTS: string[] = [];

interface HostOptions {
  /** How many tables `body.tables` serves. */
  tables?: number;
  /** How many sections `document.sections` serves. */
  sections?: number;
  /** Whether `Section.getHeader`/`getFooter` exist. */
  headersFooters?: boolean;
  /** Whether `Section.pageSetup` exists. `false` is Word on the web. */
  pageSetup?: boolean;
  /** Whether the host serves the paragraph formatting family. */
  richScope?: boolean;
}

function hostError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = "RichApi.Error";
  Object.assign(error, { code });
  return error;
}

/**
 * A host object that serves `served` and rejects a `load` of anything else.
 *
 * Three behaviours matter, and the double has all three:
 *
 * - a `load` of a name the host does not have throws, because Office rejects the
 *   whole request rather than the one bad name;
 * - a *read* of a property that was never loaded throws `PropertyNotLoaded`,
 *   which is the failure that made the degraded-scope retry invisible to the
 *   suite for so long;
 * - every requested name is recorded, so a test can assert what the acquisition
 *   asked for as well as what it ended up with.
 */
function createLoadable(
  served: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  record: (property: string) => void,
  loaded: Set<string> = new Set<string>(),
  prefix = "",
): Record<string, unknown> {
  const object: Record<string, unknown> = {
    load(properties: string | string[]) {
      (Array.isArray(properties) ? properties : [properties]).forEach((property) => {
        if (!allowed.has(property)) {
          throw hostError(
            `The property '${property}' does not exist on this host.`,
            "GeneralException",
          );
        }
        loaded.add(property);
        // A request for `font/name` also makes `font` itself readable: reading
        // `body.font.name` walks `font` on the way there, and a bare `font`
        // that was never named is `PropertyNotLoaded` on a real proxy.
        loaded.add(property.split("/")[0] ?? property);
        REQUESTED.push(property);
        record(property);
      });
      return object;
    },
  };
  Object.entries(served).forEach(([property, value]) => {
    Object.defineProperty(object, property, {
      get() {
        // For a nested member the loaded set holds the *prefixed* name
        // (`font/name`), because that is the name a request carries.
        if (!loaded.has(property) && !loaded.has(`${prefix}${property}`)) {
          throw hostError(
            `The property '${prefix}${property}' was read before it was loaded.`,
            "PropertyNotLoaded",
          );
        }
        /*
         * A nested object is itself a loadable, because Office's is: a
         * `Word.Font` throws on a member that was not named, and this is what
         * makes "the acquisition asked for `font/name` and then read
         * `font.size` anyway" a failing test rather than an `undefined`.
         *
         * The `loaded` set is shared, and it has to be: a request names
         * `font/name`, so reading `font.name` is legal and reading
         * `font.color` — which was not named — is not. A fresh set per object
         * would make every nested read throw and the test would pass for the
         * wrong reason.
         */
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          return createLoadable(
            nested,
            new Set(Object.keys(nested).map((key) => `${prefix}${property}/${key}`)),
            () => undefined,
            loaded,
            `${prefix}${property}/`,
          );
        }
        return value;
      },
    });
  });
  return object;
}

/** The `Body` properties a header or footer can serve. §8.4, WordApi 1.1. */
const HOST_HEADER_FOOTER_PROPERTIES: ReadonlySet<string> = new Set([
  "text",
  "style",
  "styleBuiltIn",
  "font/name",
  "font/size",
  "font/color",
]);

function installHost(options: HostOptions = {}): void {
  const tables = options.tables ?? 0;
  const sections = options.sections ?? 1;
  const headersFooters = options.headersFooters ?? true;
  const pageSetup = options.pageSetup ?? true;
  const richScope = options.richScope ?? true;
  REQUESTED = [];
  TABLE_REQUESTS = [];
  SECTION_REQUESTS = [];

  const tableItems = Array.from({ length: tables }, (_unused, index) =>
    createLoadable(
      {
        style: `Table ${index}`,
        styleBuiltIn: `TableGrid${index}`,
        values: [
          ["Header A", "Header B"],
          ["Cell A", "Cell B"],
        ],
        rowCount: 2,
        headerRowCount: 1,
      },
      HOST_TABLE_PROPERTIES,
      (property) => TABLE_REQUESTS.push(property),
    ),
  );

  const sectionItems = Array.from({ length: sections }, (_unused, index) => {
    const body = createLoadable({ text: `Section ${index} body` }, new Set(["text"]), () =>
      SECTION_REQUESTS.push("body/text"),
    );
    const setup = createLoadable(
      {
        orientation: "portrait",
        topMargin: 72,
        bottomMargin: 72,
        leftMargin: 90,
        rightMargin: 90,
        pageWidth: 11906,
        pageHeight: 16838,
      },
      HOST_PAGE_SETUP_PROPERTIES,
      (property) => SECTION_REQUESTS.push(`pageSetup/${property}`),
    );
    const slot = (kind: "Header" | "Footer", name: string) =>
      createLoadable(
        {
          text: `${kind} for ${name}`,
          style: kind,
          styleBuiltIn: kind,
          font: { name: "Calibri", size: 9, color: "#404040" },
        },
        HOST_HEADER_FOOTER_PROPERTIES,
        () => undefined,
      );
    return {
      body,
      setup: pageSetup ? setup : null,
      getHeader: (name: string) => slot("Header", name),
      getFooter: (name: string) => slot("Footer", name),
      servesHeadersFooters: headersFooters,
    };
  });

  const context = {
    document: {
      id: "doc-structural",
      body: {
        text: "A body with a table.",
        load: () => undefined,
        paragraphs: {
          load: () => undefined,
          items: [createParagraph()],
        },
        get tables() {
          return { load: () => undefined, items: tableItems };
        },
      },
      get styles() {
        return { load: () => undefined, items: [] };
      },
      get sections() {
        return {
          load: () => undefined,
          get items() {
            return sectionItems.map((section) => ({
              /*
               * `Word.Section` itself is WordApi 1.1; only `pageSetup` is
               * desktop-only. A `load` naming anything else is a `GeneralException`,
               * which is what makes a web host's refusal of `pageSetup` visible
               * here rather than silently degrading the whole scan.
               */
              load(properties: string | string[]) {
                (Array.isArray(properties) ? properties : [properties]).forEach((property) => {
                  if (property === "body/text") {
                    (section.body["load"] as (names: string[]) => unknown)(["text"]);
                    return;
                  }
                  if (property.startsWith("pageSetup/")) {
                    if (section.setup === null) {
                      throw hostError(
                        "The property 'pageSetup' does not exist on this host.",
                        "GeneralException",
                      );
                    }
                    (section.setup["load"] as (names: string[]) => unknown)([
                      property.slice("pageSetup/".length),
                    ]);
                    return;
                  }
                  throw hostError(
                    `The property '${property}' does not exist on Word.Section.`,
                    "GeneralException",
                  );
                });
                return this;
              },
              get body() {
                return {
                  load: () => undefined,
                  get text() {
                    return section.body["text"];
                  },
                };
              },
              get pageSetup() {
                // `undefined`, not a throwing stub: the acquisition reads this
                // only after asking for it, and a refusal is what sets the
                // remembered `pageSetupRefused` flag.
                return section.setup === null
                  ? undefined
                  : {
                      get orientation() {
                        return section.setup?.["orientation"];
                      },
                      get topMargin() {
                        return section.setup?.["topMargin"];
                      },
                      get bottomMargin() {
                        return section.setup?.["bottomMargin"];
                      },
                      get leftMargin() {
                        return section.setup?.["leftMargin"];
                      },
                      get rightMargin() {
                        return section.setup?.["rightMargin"];
                      },
                      get pageWidth() {
                        return section.setup?.["pageWidth"];
                      },
                      get pageHeight() {
                        return section.setup?.["pageHeight"];
                      },
                    };
              },
              getHeader: (name: string) => section.getHeader(name),
              getFooter: (name: string) => section.getFooter(name),
            }));
          },
        };
      },
    },
    host: { name: "Word", version: "16.0" },
    sync: async () => {
      if (!richScope) {
        throw hostError("The property is not available on this host.", "ItemNotFound");
      }
    },
  };

  (globalThis as { Office?: unknown }).Office = {
    run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
    roamingSettings: {
      get: () => undefined,
      set: () => undefined,
      saveAsync: (cb?: (result: unknown) => void) => cb?.(undefined),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  };
}

/**
 * The one body paragraph every case here shares.
 *
 * A paragraph, not a loadable object: nothing in this file is about paragraphs,
 * and the acquisition only needs `text` and `uniqueLocalId` to build a node.
 */
function createParagraph(): Record<string, unknown> {
  return {
    text: "A body with a table.",
    uniqueLocalId: "p-1",
    style: "Normal",
    styleBuiltIn: "Normal",
    isListItem: false,
    load(properties: string | string[]) {
      (Array.isArray(properties) ? properties : [properties]).forEach((property) => {
        REQUESTED.push(property);
      });
      return this;
    },
  };
}

describe("acquireAnalysisContext structural scopes", () => {
  beforeEach(() => {
    __resetRefusedCapabilities();
    __resetPageSetupRefusal();
    REQUESTED = [];
  });

  describe("tables (spec §8.3)", () => {
    it("carries every table the host served into the formatting DTO", async () => {
      installHost({ tables: 2 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const tables = context.formatting.tables ?? [];
      expect(tables).toHaveLength(2);
      expect(tables[0]?.styleName).toBe("Table 0");
      expect(tables[0]?.rowCount).toBe(2);
      expect(tables[0]?.headerRowCount).toBe(1);
      // Derived from `values`, because `Word.TableLoadOptions` has no column
      // count and the row arrays are the only evidence of width.
      expect(tables[0]?.columnCount).toBe(2);
      expect(tables[1]?.styleName).toBe("Table 1");
    });

    it("reports no table property the host has no member for", async () => {
      installHost({ tables: 1 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const table = context.formatting.tables?.[0];
      // Not on `Word.TableLoadOptions`, so "not read" — which is what makes the
      // analyzer skip those comparisons rather than invent a value.
      expect(table?.headerRow).toBeNull();
      expect(table?.cellStyleName).toBeNull();
    });

    it("gives every table a node, so coverage can count what it read", async () => {
      installHost({ tables: 2 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const tableNodes = context.snapshot.nodes.filter((node) => node.type === "table");
      expect(tableNodes).toHaveLength(2);
      /*
       * `editable: false` is a real answer, not a placeholder: `revisionAdapter`
       * refuses table mutation, and a node claiming to be editable would let a
       * planner target one. `includedInGovernance: true` is the other half — the
       * object is examined, it is simply not something this pass may change.
       */
      tableNodes.forEach((node) => {
        expect(node.editable).toBe(false);
        expect(node.includedInGovernance).toBe(true);
      });
    });

    it("asks for no table at all when the host will not serve tables", async () => {
      installHost({ tables: 1 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: BASE_CAPABILITIES,
      });

      expect(context.formatting.tables).toEqual([]);
      expect(TABLE_REQUESTS).toEqual([]);
      expect(context.acquisition.unsupported).toContain("tables");
    });

    it("requests only the properties `Word.TableLoadOptions` actually has", async () => {
      installHost({ tables: 1 });

      await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      // The declared list and the request are compared here so a name added to
      // one and not the other fails the suite. `cellStyleName` and `headerRow`
      // are absent on purpose: `Word.Table` has no such member, and asking for
      // one refuses the whole request.
      expect([...TABLE_REQUESTS].sort()).toEqual([...LOADABLE_TABLE_PROPERTIES].sort());
      expect(TABLE_REQUESTS).not.toContain("cellStyleName");
      expect(TABLE_REQUESTS).not.toContain("headerRow");
    });

    it("does not name tables as unsupported on a host that served them", async () => {
      // The defect this whole file exists for: a constant `unsupported` list
      // naming all three structural scopes meant a scan that read every table
      // still reported that it had read none.
      installHost({ tables: 1, sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: policyWith({ includeHeadersFooters: true }),
      });

      expect(context.acquisition.unsupported).not.toContain("tables");
      expect(context.acquisition.unsupported).not.toContain("sections");
      expect(context.acquisition.unsupported).not.toContain("headers");
      expect(context.acquisition.unsupported).not.toContain("footers");
    });

    it("still names the scopes this pass never attempts, whatever the host serves", async () => {
      // Spec §8.6: fields, controls and shapes are explicitly *excluded*, not
      // silently unexamined. They are named as `notAttempted` rather than as
      // `unsupported`: no host was asked, so no different Word would serve them.
      installHost({ tables: 1, sections: 1 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      ["fields", "controls", "shapes", "textBoxes"].forEach((scope) => {
        expect(context.acquisition.notAttempted).toContain(scope);
        expect(context.acquisition.unsupported).not.toContain(scope);
      });
    });
  });

  describe("sections and page setup (spec §8.5)", () => {
    it("carries section text and page geometry into the DTO", async () => {
      installHost({ sections: 2 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const sections = context.formatting.sections ?? [];
      expect(sections).toHaveLength(2);
      expect(sections[0]?.text).toBe("Section 0 body");
      expect(sections[0]?.orientation).toBe("portrait");
      expect(sections[0]?.margins?.left).toBe(90);
      expect(sections[0]?.width).toBe(11906);
      expect(sections[0]?.height).toBe(16838);
    });

    it("reads the section text even when the host has no page setup", async () => {
      // Word on the web, exactly: `Section` and `SectionCollection` are
      // WordApi 1.1 and `Section.pageSetup` is WordApiDesktop 1.3. Naming
      // `pageSetup` in the shared load would get the *whole* request refused
      // there, taking the body text and the paragraphs with it.
      installHost({ sections: 1, pageSetup: false });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const section = context.formatting.sections?.[0];
      expect(section?.text).toBe("Section 0 body");
      // `null`, not zero and not a default: "not read" is what makes the page
      // check skip rather than invent a deviation.
      expect(section?.orientation).toBeNull();
      expect(section?.width).toBeNull();
      expect(section?.margins?.top).toBeNull();
    });

    it("asks for the page setup in its own transaction, never in the shared load", async () => {
      installHost({ sections: 1 });

      await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      const pageSetupNames = SECTION_REQUESTS.filter((name) => name.startsWith("pageSetup/"));
      expect([...pageSetupNames].sort()).toEqual(
        PAGE_SETUP_PROPERTIES.map((property) => `pageSetup/${property}`).sort(),
      );
      // The shared body/section load must carry only the 1.1 member, or a web
      // host refuses the whole transaction over one nested desktop-only object.
      expect(SECTION_REQUESTS).toContain("body/text");
      expect(SECTION_REQUESTS.filter((name) => name === "pageSetup")).toEqual([]);
    });

    it("remembers a host that refused the page setup rather than retrying per scan", async () => {
      installHost({ sections: 1, pageSetup: false });

      await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });
      const after = SECTION_REQUESTS.length;
      await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      // The observer rescans on every keystroke; a web host would otherwise pay
      // a failed transaction per edit.
      expect(SECTION_REQUESTS.slice(after).filter((name) => name.startsWith("pageSetup/"))).toEqual(
        [],
      );
    });

    it("gives every section a node, so coverage can count what it read", async () => {
      installHost({ sections: 2 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      expect(context.snapshot.nodes.filter((node) => node.type === "section")).toHaveLength(2);
    });

    it("asks for no section when the host will not serve sections", async () => {
      installHost({ sections: 1 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: BASE_CAPABILITIES,
      });

      expect(context.formatting.sections).toEqual([]);
      expect(context.formatting.headersFooters).toEqual([]);
      expect(context.acquisition.unsupported).toContain("sections");
    });
  });

  describe("headers and footers (spec §8.4)", () => {
    /*
     * Every case in this block states `includeHeadersFooters: true` explicitly.
     *
     * `ScopePolicySchema.includeHeadersFooters` defaults to `false`, so a test
     * that relied on the default would be testing "headers are off" and calling
     * it "headers are read". §8.4 gates this scope behind the policy for the
     * same reason it gates tables: a scan should not read content the governance
     * author did not ask about.
     */
    const HEADERS_IN_SCOPE = policyWith({ includeHeadersFooters: true });

    it("reads all three slots of both kinds for every section", async () => {
      installHost({ sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: HEADERS_IN_SCOPE,
      });

      const entries = context.formatting.headersFooters ?? [];
      // Three slots × two kinds. Reading only `Primary` would leave the
      // first-page and even-page slots permanently unreported, which is the
      // same false-compliance claim as reading none of them.
      expect(entries).toHaveLength(6);
      expect(entries.map((entry) => entry.kind)).toEqual([
        "header",
        "header",
        "header",
        "footer",
        "footer",
        "footer",
      ]);
      expect(entries[0]?.styleName).toBe("Header");
      expect(entries[0]?.font?.name).toBe("Calibri");
      expect(entries[0]?.font?.size).toBe(9);
    });

    it("reports a blank slot as not required, which is the evidence of absence", async () => {
      installHost({ sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: HEADERS_IN_SCOPE,
      });

      // Word serves a blank body for a header the document does not have, so a
      // non-empty text is the only evidence that one is present.
      context.formatting.headersFooters?.forEach((entry) => {
        expect(entry.required).toBe((entry.text ?? "").trim().length > 0);
      });
      expect(context.formatting.headersFooters?.[0]?.required).toBe(true);
    });

    it("gives every header and footer a node, so coverage can count what it read", async () => {
      installHost({ sections: 2, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: HEADERS_IN_SCOPE,
      });

      const nodes = context.snapshot.nodes.filter(
        (node) => node.type === "header" || node.type === "footer",
      );
      // Two sections × three slots × two kinds.
      expect(nodes).toHaveLength(12);
      nodes.forEach((node) => {
        expect(node.editable).toBe(false);
        expect(node.includedInGovernance).toBe(true);
      });
    });

    it("asks for no header or footer when the host will not serve sections", async () => {
      // A header is reachable only through `Section.getHeader`, so the two
      // cannot be gated apart: a host that serves `supportsHeadersFooters` but
      // not `supportsSections` cannot be asked for one.
      installHost({ sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: { ...STRUCTURAL_CAPABILITIES, supportsSections: false },
        policy: HEADERS_IN_SCOPE,
      });

      expect(context.formatting.headersFooters).toEqual([]);
      expect(context.acquisition.unsupported).toContain("headers");
    });

    it("reads no header or footer under the default policy, which excludes them", async () => {
      // `ScopePolicySchema.includeHeadersFooters` defaults to `false`, so a
      // caller with no governance profile of its own gets the conservative
      // scope. Reading all three slots of every section on every scan would be a
      // claim about headers the author never asked about.
      installHost({ sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
      });

      expect(context.formatting.headersFooters).toEqual([]);
    });

    it("reads headers and footers once the policy asks for them", async () => {
      installHost({ sections: 1, headersFooters: true });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: policyWith({ includeHeadersFooters: true }),
      });

      expect(context.formatting.headersFooters).toHaveLength(6);
    });

    it("reads no table under a policy that switched tables off", async () => {
      // A scope policy that cannot stop a read is not a scope policy. The plan
      // is built from `policy.scope` rather than from the capabilities alone, so
      // `includeTables: false` is honoured at the point the request is made.
      installHost({ tables: 1 });

      const context = await acquireAnalysisContext({
        profile: PROFILE,
        capabilities: STRUCTURAL_CAPABILITIES,
        policy: policyWith({ includeTables: false }),
      });

      expect(context.formatting.tables).toEqual([]);
      // Recorded as unattempted rather than unsupported: the host served tables,
      // so `unsupported` here would send the reader to a different Word.
      expect(context.acquisition.notAttempted).toContain("tables");
      expect(context.acquisition.unsupported).not.toContain("tables");
    });
  });
});
