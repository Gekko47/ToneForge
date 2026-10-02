/**
 * Selection scope capture (spec §18, plan P5).
 *
 * The host double here is strict in the same way
 * `analysisAcquisitionStructuralScopes.test.ts` is: a `load` naming something
 * the host does not have rejects the whole `sync`, and every requested name is
 * recorded. That matters more here than anywhere else, because this module's
 * whole claim is that it reads *only* what the selection needs — a test that
 * cannot see the request names could not tell a selection-sized read from a
 * whole-document one, which is the defect the module replaces.
 *
 * **The `load` double was one thing stricter than it looked, and one thing looser
 * than the host.** It recorded the property names it was given in a way that
 * faithfully reproduced a *variadic* call — so `load("text", "start", "end")`
 * looked correct here while Word, taking one argument, loaded only `"text"` and
 * dropped the rest. The real Word failure arrived as "The property 'start' is
 * not available", in the P12 window, with 2 350 tests green (ADR-0100). The
 * double is now the shared `createOfficeLoad`/`attachOfficeLoad` pair, which
 * takes one argument as the host does and **throws** on a variadic call, so the
 * next one fails here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { attachOfficeLoad } from "../../fixtures/officeLoad";
import {
  anchorMatches,
  coversWholeParagraph,
  readSelectionScope,
  UNIDENTIFIED_DOCUMENT,
  type SelectionScope,
} from "../../../src/word/selectionScope";
import { hashText } from "../../../src/shared/utils/text";
import type { SemanticSelectionAnchor } from "../../../src/core/domain/SemanticReviewSession";

interface HostParagraph {
  text?: string;
  uniqueLocalId?: string;
}

interface HostOptions {
  text?: string;
  start?: number;
  end?: number;
  /** `null` models a host that exposes no document id. */
  documentId?: string | null;
  /** `null` models a host whose selection has no paragraph collection. */
  paragraphs?: HostParagraph[] | null;
  /** Names the selection proxy does not have, so the request is refused whole. */
  missingSelectionProperties?: string[];
  /** Names a paragraph does not have. */
  missingParagraphProperties?: string[];
  /** Models a host with no `document.getSelection` at all. */
  withoutSelection?: boolean;
}

interface HostLog {
  selectionRequests: string[];
  paragraphRequests: string[];
  /** Every load made on `document.body` — the whole-document read, if any. */
  bodyLoads: string[];
}

let log: HostLog;
let refusedSelection: Set<string>;
let refusedParagraph: Set<string>;

function hostError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = "RichApi.Error";
  Object.assign(error, { code });
  return error;
}

function installHost(options: HostOptions = {}): void {
  const text = options.text ?? "The slab was cast on 3 March 2026 and cured for 28 days.";
  const start = options.start ?? 120;
  const end = options.end ?? start + text.length;
  const documentId = options.documentId === undefined ? "doc-7f3a" : options.documentId;
  const paragraphs =
    options.paragraphs === undefined ? [{ text, uniqueLocalId: "p-42" }] : options.paragraphs;
  refusedSelection = new Set(options.missingSelectionProperties ?? []);
  refusedParagraph = new Set(options.missingParagraphProperties ?? []);
  log = { selectionRequests: [], paragraphRequests: [], bodyLoads: [] };

  const paragraphItems = (paragraphs ?? []).map((paragraph) => ({
    get text() {
      return paragraph.text;
    },
    get uniqueLocalId() {
      return paragraph.uniqueLocalId;
    },
    load(properties: string | string[]) {
      (Array.isArray(properties) ? properties : [properties]).forEach((property) => {
        log.paragraphRequests.push(property);
        if (refusedParagraph.has(property)) {
          throw hostError(
            `The property '${property}' does not exist on this host.`,
            "GeneralException",
          );
        }
      });
      return this;
    },
  }));

  const selection = attachOfficeLoad(
    {
      get text() {
        return text;
      },
      get start() {
        return start;
      },
      get end() {
        return end;
      },
      paragraphs: attachOfficeLoad({ items: paragraphItems }, (property) => {
        log.selectionRequests.push(`paragraphs/${property}`);
      }),
    },
    (property) => {
      log.selectionRequests.push(property);
      if (refusedSelection.has(property)) {
        throw hostError(
          `The property '${property}' does not exist on this host.`,
          "GeneralException",
        );
      }
    },
  );

  const document: Record<string, unknown> = {
    body: {
      text: "the whole document body, which this module must not read",
      load(property: string | string[]) {
        (Array.isArray(property) ? property : [property]).forEach((name) =>
          log.bodyLoads.push(name),
        );
        return this;
      },
      paragraphs: {
        load(property: string) {
          log.bodyLoads.push(`paragraphs/${property}`);
          return this;
        },
        items: [],
      },
    },
    styles: { name: "", load: () => undefined, items: [] },
  };
  if (documentId !== null) document["id"] = documentId;
  if (options.withoutSelection !== true) document["getSelection"] = () => selection;

  const context = {
    document,
    host: { name: "Word", version: "16.0" },
    sync: async () => {
      // Office rejects the *whole* request when a name is unknown, so a refused
      // name has to surface here rather than at the `load` call site, or the
      // module's guarded reads would be tested against a wrong model of Word.
      const refused = [...refusedSelection].some((name) => log.selectionRequests.includes(name));
      const refusedParagraphLoad = [...refusedParagraph].some((name) =>
        log.paragraphRequests.includes(name),
      );
      if (refused || refusedParagraphLoad) {
        throw hostError(
          "The requested property is not available on this host.",
          "GeneralException",
        );
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

function removeOffice(): void {
  delete (globalThis as { Office?: unknown }).Office;
}

async function capture(): Promise<SelectionScope> {
  const result = await readSelectionScope();
  if (result.status !== "ok") {
    throw new Error(`expected an anchor, got ${result.status}`);
  }
  return result.scope;
}

const SAMPLE = "The slab was cast on 3 March 2026 and cured for 28 days.";

describe("readSelectionScope", () => {
  beforeEach(() => {
    installHost();
  });

  it("captures the selection as an anchor the model cannot argue with", async () => {
    const scope = await capture();

    expect(scope.anchor.documentId).toBe("doc-7f3a");
    expect(scope.anchor.startOffset).toBe(120);
    expect(scope.anchor.endOffset).toBe(120 + SAMPLE.length);
    expect(scope.anchor.selectedText).toBe(SAMPLE);
    expect(scope.anchor.selectionHash).toBe(hashText(SAMPLE));
    expect(scope.anchor.nodeIds).toEqual(["p-42"]);
    expect(scope.anchor.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(scope.wordCount).toBe(SAMPLE.split(/\s+/).length);
  });

  it("reads the selection and nothing else", async () => {
    await capture();

    // The point of the module. A `body.load` here would mean the capture still
    // pays a whole-document read to answer a selection-sized question.
    expect(log.bodyLoads).toEqual([]);
    // Four requests, all of them selection-scoped: the range's own text and
    // offsets, then the containing paragraphs' items. Anything else here would
    // be a read this module has no reason to make.
    expect(log.selectionRequests).toEqual(["text", "start", "end", "paragraphs/items"]);
    expect(log.paragraphRequests).toEqual(["text", "uniqueLocalId"]);
  });

  it("does not hold a whole-document hash, because producing one needs the whole document", async () => {
    const scope = await capture();

    // Named explicitly rather than by reflection: the anchor's identity is the
    // selected text and the document's own id, and a future field that reintroduced
    // a document hash would fail here.
    expect(Object.keys(scope.anchor).sort()).toEqual([
      "capturedAt",
      "documentId",
      "endOffset",
      "nodeIds",
      "selectedText",
      "selectionHash",
      "startOffset",
    ]);
  });

  it("gives the same anchor twice for the same selection", async () => {
    const first = await capture();
    const second = await capture();

    expect(second.anchor.selectionHash).toBe(first.anchor.selectionHash);
    expect(anchorMatches(first.anchor, second.anchor.selectedText)).toBe(true);
  });

  it("reports a changed selection as a different target", async () => {
    const first = await capture();
    installHost({
      text: "A different paragraph entirely.",
      paragraphs: [{ text: "A different paragraph entirely.", uniqueLocalId: "p-9" }],
    });
    const second = await capture();

    expect(anchorMatches(first.anchor, second.anchor.selectedText)).toBe(false);
  });

  describe("when there is nothing selected", () => {
    it("reports no selection for an empty one", async () => {
      installHost({ text: "", start: 40, end: 40 });

      expect(await readSelectionScope()).toEqual({ status: "no-selection" });
    });

    it("reports no selection for a bare caret, rather than an empty review", async () => {
      installHost({ text: "   ", start: 40, end: 40 });

      const result = await readSelectionScope();
      expect(result.status).toBe("no-selection");
    });

    it("does not read the document to decide that", async () => {
      installHost({ text: "", start: 0, end: 0 });

      await readSelectionScope();

      expect(log.bodyLoads).toEqual([]);
    });
  });

  describe("when the host cannot name the paragraph", () => {
    it("reports an unverified anchor rather than fabricating a node id", async () => {
      installHost({ paragraphs: [{ text: SAMPLE }] });

      const scope = await capture();

      expect(scope.anchor.nodeIds).toEqual([]);
      expect(scope.verification).toBe("offsets-and-text");
      // The paragraph was still enumerated, so the count is a fact even though
      // the identity is missing.
      expect(scope.paragraphCount).toBe(1);
    });

    it("keeps the anchor usable when the whole paragraph load is refused", async () => {
      installHost({ missingParagraphProperties: ["uniqueLocalId"] });

      const scope = await capture();

      expect(scope.anchor.selectedText).toBe(SAMPLE);
      expect(scope.anchor.startOffset).toBe(120);
      expect(scope.anchor.nodeIds).toEqual([]);
      expect(scope.verification).toBe("offsets-and-text");
    });

    it("degrades the same way when the selection has no paragraph collection", async () => {
      installHost({ paragraphs: null });

      const scope = await capture();

      expect(scope.anchor.nodeIds).toEqual([]);
      expect(scope.paragraphCount).toBe(0);
      expect(scope.verification).toBe("offsets-and-text");
    });
  });

  describe("when the host cannot support a safe review", () => {
    it("refuses with a reason when the selection has no offsets", async () => {
      installHost({ missingSelectionProperties: ["start"] });

      const result = await readSelectionScope();

      expect(result.status).toBe("unavailable");
      // ADR-0069: a refusal names the remedy. Asserted on shape rather than on
      // wording, because the wording is a UI decision and the remedy is not.
      expect(result.status === "unavailable" && result.reason).toMatch(/Update Word|copy the text/);
    });

    it("refuses with a reason when the host exposes no selection", async () => {
      installHost({ withoutSelection: true });

      const result = await readSelectionScope();

      expect(result.status).toBe("unavailable");
    });

    it("refuses rather than throwing when the Office runtime is gone", async () => {
      removeOffice();

      const result = await readSelectionScope();

      expect(result.status).toBe("unavailable");
      expect(result.status === "unavailable" && result.reason).toMatch(/ribbon/);
    });
  });

  describe("document identity", () => {
    it("uses the host's document id where there is one", async () => {
      const scope = await capture();

      expect(scope.anchor.documentId).toBe("doc-7f3a");
      expect(scope.documentIdVerified).toBe(true);
    });

    it("falls back to a recognisable placeholder, and says it is unverified", async () => {
      installHost({ documentId: null });

      const scope = await capture();

      expect(scope.anchor.documentId).toBe(UNIDENTIFIED_DOCUMENT);
      expect(scope.documentIdVerified).toBe(false);
    });
  });

  describe("whole-paragraph detection", () => {
    it("matches a whole paragraph selected with its paragraph mark", () => {
      expect(coversWholeParagraph(SAMPLE, [`${SAMPLE}\r`])).toBe(true);
    });

    it("matches a whole paragraph selected without its paragraph mark", () => {
      expect(coversWholeParagraph(SAMPLE, [SAMPLE])).toBe(true);
    });

    it("does not claim a partial selection is a whole paragraph", () => {
      expect(coversWholeParagraph(SAMPLE.slice(0, 12), [SAMPLE])).toBe(false);
    });

    it("does not claim a multi-paragraph selection is one paragraph", () => {
      expect(coversWholeParagraph("First. Second.", ["First.\r", "Second.\r"])).toBe(false);
    });

    it("reports not-established rather than not-the-case when no paragraph was read", () => {
      expect(coversWholeParagraph(SAMPLE, [])).toBe(false);
    });

    it("reports the same fact through the captured scope", async () => {
      installHost({ paragraphs: [{ text: `${SAMPLE}\r`, uniqueLocalId: "p-42" }] });

      expect((await capture()).coversWholeParagraph).toBe(true);
    });
  });
});

describe("anchorMatches", () => {
  const anchor = (text: string): SemanticSelectionAnchor => ({
    documentId: "doc-7f3a",
    nodeIds: ["p-42"],
    startOffset: 0,
    endOffset: text.length,
    selectedText: text,
    selectionHash: hashText(text),
    capturedAt: "2026-10-01T09:00:00.000Z",
  });

  it("is true for the same text and false for different text", () => {
    expect(anchorMatches(anchor(SAMPLE), SAMPLE)).toBe(true);
    expect(anchorMatches(anchor(SAMPLE), `${SAMPLE} `)).toBe(false);
  });
});
