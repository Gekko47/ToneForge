/**
 * The degraded acquisition scope must stay degraded all the way to the DTO.
 *
 * These are regression tests for a failure that only appears against a real
 * Word host. When the first `context.sync()` was refused, `acquireAnalysisContext`
 * retried with a text-only plan and logged that it had recovered — but the DTO
 * builders that ran next still read `listItem.level`, which the retry had never
 * loaded. A real Office proxy answers an unloaded read by throwing
 * `PropertyNotLoaded`, so the retry threw on the way out and the scan still
 * failed. The unit mock returns `undefined` for an unloaded read, which is why
 * the suite was green while the add-in was not.
 *
 * The paragraph double below therefore *throws* on any property that was not
 * passed to `load()`, exactly as the host does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRefusedCapabilities,
  acquireAnalysisContext,
  planAcquisitionLoads,
} from "../../../src/word/analysisAcquisition";
import type { AnalysisCapabilities } from "../../../src/analysis/analysisContext";
import { StyleProfileSchema } from "../../../src/core/domain/StyleProfile";
import { SAMPLE_PROFILE } from "../../fixtures/sampleDocs";

const ALL_ON: AnalysisCapabilities = {
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
  hostName: "Word",
  hostVersion: "16",
};

/** Parsed so the fixture satisfies the schema type the acquisition expects. */
const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

/** Every property a host double was asked to read, across every transaction. */
const READS: string[] = [];

/** A property value the host would serve, and the name it is served under. */
const SERVED_VALUES: Record<string, unknown> = {
  text: "A list item",
  uniqueLocalId: "p-1",
  isListItem: true,
  listItem: { level: 2 },
  style: "List Paragraph",
  styleBuiltIn: "ListParagraph",
  alignment: "left",
  lineSpacing: 12,
  spaceAfter: 8,
  spaceBefore: 0,
  font: {
    name: "Calibri",
    size: 11,
    color: "#000000",
    bold: false,
    italic: false,
    underline: false,
  },
};

/**
 * Build a paragraph that throws `PropertyNotLoaded` on any property the request
 * did not load — the behaviour that made this bug invisible to the test suite.
 *
 * A `Proxy` is used rather than a plain object because the whole point is that
 * the throw happens on *property access*, which is where Office does it.
 *
 * `requested` is shared with the request context so `context.sync()` can see
 * what this transaction asked for — a real host rejects the whole `sync`, not
 * the individual `load()` call.
 */
function createHostParagraph(requested: Set<string>): Record<string, unknown> {
  const served = new Set<string>();
  return new Proxy(
    {
      load: (properties: string | string[]) => {
        (Array.isArray(properties) ? properties : [properties]).forEach((property) => {
          served.add(property);
          requested.add(property);
        });
      },
    },
    {
      get(target, property: string | symbol) {
        if (property in target || typeof property === "symbol") {
          return Reflect.get(target, property);
        }
        READS.push(property);
        if (!served.has(property)) throw propertyNotLoaded(property);
        return SERVED_VALUES[property];
      },
      has: () => true,
    },
  );
}

/** A property that is text-only, and so always safe to request. */
function isBaseProperty(property: string): boolean {
  return property === "text" || property === "uniqueLocalId";
}

function propertyNotLoaded(property: string): Error {
  return hostError(
    `The property '${property}' is not available. Before reading the property's value, call the load method on the containing object and call "context.sync()" on the associated request context.`,
    "PropertyNotLoaded",
  );
}

function hostError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = "RichApi.Error";
  Object.assign(error, { code });
  return error;
}

/** Number of `Office.run` transactions the current host has served. */
let TRANSACTIONS = 0;

/**
 * Install a Word host whose body serves paragraphs and, when asked to, refuses
 * the rich scope.
 *
 * `true` refuses the first rich transaction only, which models a host that
 * recovered. `"always"` models a host that genuinely does not serve the family,
 * which is what a re-probe has to keep coping with. `false` never refuses.
 */
function installHost(failRichScope: boolean | "always"): void {
  const failures = {
    remaining: failRichScope === "always" ? Number.POSITIVE_INFINITY : failRichScope ? 1 : 0,
  };
  TRANSACTIONS = 0;
  /*
   * A fresh paragraph proxy per transaction, as Office does. Reusing one would
   * let the first (refused) request's `load()` calls satisfy the second, which
   * is precisely the confusion this test exists to rule out: the retry must
   * start from nothing but the properties its own plan asks for.
   */
  const requested = new Set<string>();
  const context = {
    document: {
      id: "doc-1",
      body: {
        text: "A list item",
        load: () => undefined,
        paragraphs: {
          load: () => undefined,
          get items(): unknown[] {
            return [createHostParagraph(requested)];
          },
        },
      },
      styles: { load: () => undefined, items: [] },
    },
    host: { name: "Word", version: "16.0" },
    /*
     * The request context rejects the whole `sync` when a transaction asked for
     * an optional property family, which is how a host refuses to serve one.
     * A text-only transaction always succeeds.
     */
    sync: async () => {
      const askedOptional = [...requested].some((property) => !isBaseProperty(property));
      requested.clear();
      if (askedOptional && failures.remaining > 0) {
        failures.remaining -= 1;
        throw hostError("The property is not available on this host.", "ItemNotFound");
      }
    },
  };

  (globalThis as { Office?: unknown }).Office = {
    run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => {
      TRANSACTIONS += 1;
      return func(context);
    },
    roamingSettings: {
      get: () => undefined,
      set: () => undefined,
      saveAsync: (cb?: (result: unknown) => void) => cb?.(undefined),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  };
}

describe("acquireAnalysisContext degraded scope", () => {
  beforeEach(() => {
    READS.length = 0;
    __resetRefusedCapabilities();
  });

  it("completes when the host refuses the rich scope, without reading an unloaded property", async () => {
    installHost(true);

    // The precondition: this host throws on any read of a property it did not
    // load. If the builders read one, this test throws exactly as Word did.
    const context = await acquireAnalysisContext({
      profile: PROFILE,
      capabilities: ALL_ON,
    });

    const formatting = context.formatting;
    const paragraph = formatting.paragraphs[0];
    expect(paragraph).toBeDefined();
    // Text survived the degradation, which is the entire point of the retry.
    expect(paragraph?.text).toBe("A list item");
    // `isListItem` is not a base property, so a degraded scope cannot claim to
    // know the node is a list item. Reporting it as a plain paragraph is the
    // honest answer; guessing "listItem" from the host's silence is not.
    expect(context.snapshot.nodes.some((node) => node.type === "listItem")).toBe(false);
    expect(context.snapshot.nodes.some((node) => node.type === "paragraph")).toBe(true);
  });

  it("never reads a property the degraded plan did not request", async () => {
    installHost(true);

    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });

    /*
     * The load plan is what the host was asked for, so anything outside it was
     * never served. Reading it is what threw `PropertyNotLoaded` against a real
     * host; catching the throw afterwards would hide the defect rather than
     * remove it, and would still cost a round trip per paragraph per property.
     */
    const requested = new Set(planAcquisitionLoads(ALL_ON, true).paragraphProperties);
    expect(READS.filter((property) => !requested.has(property))).toEqual([]);
  });

  it("reads a served list level when the host serves the rich scope", async () => {
    installHost(false);

    const context = await acquireAnalysisContext({
      profile: PROFILE,
      capabilities: ALL_ON,
    });

    const paragraph = context.formatting.paragraphs[0];
    expect(paragraph?.listLevel).toBe(2);
    expect(paragraph?.styleName).toBe("List Paragraph");
    expect(paragraph?.alignment).toBe("left");
    expect(paragraph?.fontName).toBe("Calibri");
    expect(paragraph?.unsupportedProperties ?? []).not.toContain("listLevel");
  });

  it("does not blame the host for a list level the degraded scope never requested", async () => {
    installHost(true);

    const context = await acquireAnalysisContext({
      profile: PROFILE,
      capabilities: ALL_ON,
    });

    // In the degraded plan `listItem` is not requested, so a null list level is
    // a scope ToneForge chose, not a host limitation to report as unsupported.
    const paragraph = context.formatting.paragraphs[0];
    expect(paragraph?.listLevel).toBeNull();
    expect(paragraph?.unsupportedProperties ?? []).not.toContain("listLevel");
  });

  it("keeps text as the floor of every scope", () => {
    expect(planAcquisitionLoads(ALL_ON, true).paragraphProperties).toEqual([
      "text",
      "uniqueLocalId",
    ]);
  });

  /*
   * A refusal is remembered, so it costs one failed transaction per session
   * rather than one per scan. The observer rescans on every document change, so
   * without this a user typing in a document whose host refuses one property
   * family paid a full failed Word transaction per edit.
   */
  it("does not re-request a scope the host has already refused", async () => {
    // A host that refuses every rich request, which is the case worth caching:
    // without the memory, every scan pays the failed transaction again.
    installHost("always");

    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    // Rich attempt, then the text-only retry.
    expect(TRANSACTIONS).toBe(2);

    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    // One transaction only: the refusal is remembered, so the rich scope is
    // never requested again for this capability set.
    expect(TRANSACTIONS).toBe(3);

    // And it stays that way for every later scan in the session.
    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    expect(TRANSACTIONS).toBe(4);
  });

  it("re-probes the rich scope when the capabilities change", async () => {
    installHost("always");

    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    expect(TRANSACTIONS).toBe(2);

    // A fresh probe result is new evidence. `prepareReformatHost` re-probes
    // before every Apply, so a host that gains the family must not stay written
    // off for the session.
    const reprobed: AnalysisCapabilities = { ...ALL_ON };
    await acquireAnalysisContext({ profile: PROFILE, capabilities: reprobed });
    // The rich scope is attempted again and refused again: 2 more transactions.
    expect(TRANSACTIONS).toBe(4);
  });

  it("keeps a successful rich scope successful across repeated scans", async () => {
    installHost(false);

    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });
    await acquireAnalysisContext({ profile: PROFILE, capabilities: ALL_ON });

    // A capable host is never remembered as refusing, so no scan degrades.
    expect(TRANSACTIONS).toBe(3);
  });
});
