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
  /**
   * Whether the host serves WordApiDesktop 1.4, which is what `Range.start` and
   * `Range.end` belong to. On by default; off models a host without them.
   */
  withoutRangeOffsets?: boolean;
  /**
   * Whether paragraphs answer `getRange("Whole")`, which is WordApi **1.3** and
   * the only way a collapsed caret gets offsets at all. (1.1, as this comment and
   * ADR-0103 said, was wrong; see ADR-0105.)
   *
   * Off by default so the "this host cannot name the paragraph" cases stay
   * reachable, and on for the caret cases. Modelling both is the point: a fixture
   * that only knows the capable host cannot tell a refusal from a working read.
   */
  withParagraphRange?: boolean;
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
  let offsetsSoFar = 0;
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
    /*
     * The paragraph's own range, with the offsets a caret cannot supply. Recorded
     * as its own requests so a test can see that the caret path loaded `start`
     * and `end` rather than only `text` — the variadic failure (ADR-0100) was
     * exactly a read of `start` that had never been loaded.
     */
    ...(options.withParagraphRange === true
      ? {
          getRange(location: string) {
            log.paragraphRequests.push(`getRange/${location}`);
            const [first, last] = offsetsOf(paragraph.text ?? "");
            return attachOfficeLoad(
              {
                get text() {
                  return paragraph.text ?? "";
                },
                get start() {
                  return first;
                },
                get end() {
                  return last;
                },
              },
              (property) => log.paragraphRequests.push(`whole/${property}`),
            );
          },
        }
      : {}),
  }));

  /**
   * Where a paragraph's own range sits, for the caret path.
   *
   * `offset` places the first paragraph in the document and each later one
   * immediately after it, so two paragraphs in one test never collide on offsets
   * the way a fixed start would.
   */
  function offsetsOf(paragraphText: string): [number, number] {
    const offset = text.length + 2 + offsetsSoFar;
    offsetsSoFar += paragraphText.length + 1;
    return [offset, offset + paragraphText.length];
  }

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
    requirements: {
      isSetSupported: (set: string, asked: string) =>
        options.withoutRangeOffsets !== true || !(set === "WordApiDesktop" && asked === "1.4"),
    },
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

  /*
   * A caret is reviewable now, and the tests below are the pair that says so.
   *
   * The version of this that shipped asserted `no-selection` for a bare caret,
   * and it passed for two years, which is how it could ship: the message it
   * produced was accurate about the code and wrong about the host, and nothing
   * contradicted it. The paragraph double also had no `getRange`, so it went on
   * passing after the caret path was implemented — for the wrong reason. Both
   * hosts are modelled now, because a fixture that only knows the capable host
   * cannot tell a working read from a refusal.
   */
  describe("a bare caret", () => {
    it("expands to the paragraph it is in", async () => {
      installHost({
        text: "",
        start: 40,
        end: 40,
        withParagraphRange: true,
        paragraphs: [{ text: SAMPLE, uniqueLocalId: "p-91" }],
      });

      const result = await readSelectionScope();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.scope.source).toBe("caret-paragraph");
      expect(result.scope.anchor.selectedText).toBe(SAMPLE);
      expect(result.scope.anchor.nodeIds).toEqual(["p-91"]);
      expect(result.scope.verification).toBe("paragraph-identified");
      expect(result.scope.coversWholeParagraph).toBe(true);
      expect(result.scope.anchor.startOffset).toBeGreaterThanOrEqual(0);
      expect(result.scope.anchor.endOffset).toBe(result.scope.anchor.startOffset + SAMPLE.length);
    });

    it("says which text it chose, because a caret review is a decision", async () => {
      installHost({ withParagraphRange: true });
      expect((await capture()).source).toBe("selection");
    });

    it("loads the paragraph range as one array, not as three arguments", async () => {
      installHost({
        text: "",
        start: 40,
        end: 40,
        withParagraphRange: true,
        paragraphs: [{ text: "A paragraph the cursor sits in.", uniqueLocalId: "p-7" }],
      });
      await readSelectionScope();

      expect(log.paragraphRequests).toContain("getRange/Whole");
      expect(log.paragraphRequests).toContain("whole/text");
      expect(log.paragraphRequests).toContain("whole/start");
      expect(log.paragraphRequests).toContain("whole/end");
    });

    /*
     * The pair that would have caught the shipped defect.
     *
     * A real Word reported a bare caret as `start: 1193, end: 1192`. The guard
     * this test defeats read an inverted pair as "there is no range here", so it
     * returned `no-selection` nine lines above the caret branch and the caret
     * review never ran \u2014 on any host, for any document. Every fixture above
     * supplies an ordered pair, so a suite of 2 404 tests could not see it: the
     * fixture was the thing that was supposed to catch this, and it modelled a
     * tidier host than the one that failed.
     */
    it("expands even when the host reports the caret's offsets the other way round", async () => {
      installHost({
        text: "",
        start: 1193,
        end: 1192,
        withParagraphRange: true,
        paragraphs: [{ text: SAMPLE, uniqueLocalId: "p-91" }],
      });

      const result = await readSelectionScope();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.scope.source).toBe("caret-paragraph");
      expect(result.scope.anchor.selectedText).toBe(SAMPLE);
    });

    it("reports no selection when the host cannot hand back the paragraph range", async () => {
      installHost({ text: "", start: 40, end: 40 });
      expect(await readSelectionScope()).toEqual({ status: "no-selection" });
    });

    it("reports no selection for a caret in an empty paragraph", async () => {
      installHost({
        text: "",
        start: 40,
        end: 40,
        withParagraphRange: true,
        paragraphs: [{ text: "\r", uniqueLocalId: "p-empty" }],
      });
      expect(await readSelectionScope()).toEqual({ status: "no-selection" });
    });

    it("treats a drag that caught only whitespace as a caret", async () => {
      installHost({
        text: "   ",
        start: 40,
        end: 43,
        withParagraphRange: true,
        paragraphs: [{ text: "A paragraph with trailing space.   ", uniqueLocalId: "p-8" }],
      });

      const result = await readSelectionScope();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.scope.source).toBe("caret-paragraph");
      expect(result.scope.anchor.selectedText).toBe("A paragraph with trailing space.   ");
    });

    /*
     * The same inverted pair on the drag path, where ordering still matters: the
     * revision adapter's precondition compares `text` against an ordered span, so
     * a right-to-left drag has to arrive as an anchor that can be held.
     */
    it("orders a backwards drag instead of refusing it", async () => {
      installHost({
        text: SAMPLE,
        start: 176,
        end: 120,
        paragraphs: [{ text: SAMPLE, uniqueLocalId: "p-42" }],
      });

      const result = await readSelectionScope();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.scope.source).toBe("selection");
      expect(result.scope.anchor.selectedText).toBe(SAMPLE);
      expect(result.scope.anchor.startOffset).toBe(120);
      expect(result.scope.anchor.endOffset).toBe(176);
    });

    it("reads no more than a selection-sized read", async () => {
      installHost({
        text: "",
        start: 40,
        end: 40,
        withParagraphRange: true,
        paragraphs: [{ text: SAMPLE, uniqueLocalId: "p-91" }],
      });
      await readSelectionScope();

      expect(log.bodyLoads).toEqual([]);
    });
  });

  describe("when there is nothing reviewable", () => {
    it("reports no selection for an empty one", async () => {
      installHost({ text: "", start: 40, end: 40 });

      expect(await readSelectionScope()).toEqual({ status: "no-selection" });
    });

    /*
     * Whitespace with a host that cannot name the paragraph is still nothing. This
     * is the "cannot" half of the pair above: the caret path exists, and it still
     * declines when there is no paragraph to expand into.
     */
    it("reports no selection when a whitespace-only drag has no paragraph to expand", async () => {
      installHost({ text: "   ", start: 40, end: 43 });

      expect(await readSelectionScope()).toEqual({ status: "no-selection" });
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
      // A host that *claims* WordApiDesktop 1.4 and then refuses the load.
      installHost({ missingSelectionProperties: ["start"] });

      const result = await readSelectionScope();

      expect(result.status).toBe("unavailable");
      // ADR-0069: a refusal names the remedy. Asserted on shape rather than on
      // wording, because the wording is a UI decision and the remedy is not.
      expect(result.status === "unavailable" && result.reason).toMatch(/Update Word|copy the text/);
    });

    it("reports unavailable rather than no-selection when the offsets are not a usable pair", async () => {
      /*
       * The distinction `SelectionScopeResult` exists for. A host that serves 1.4
       * and returns an unusable pair is saying it will not say *where* the
       * selection is; it is not saying there is nothing selected. "no-selection"
       * here sent "There is nothing to review here" for a paragraph that was there.
       */
      installHost({ start: -1 });

      const result = await readSelectionScope();

      expect(result.status).toBe("unavailable");
      expect(result.status === "unavailable" && result.reason).toMatch(/Update Word|copy the text/);
    });

    it("does not request offsets from a host that does not serve WordApiDesktop 1.4", async () => {
      // Asking for `start`/`end` on such a host does not yield absent numbers — the
      // host refuses the whole transaction. So the request is not made.
      installHost({ withoutRangeOffsets: true });

      await readSelectionScope();

      expect(log.selectionRequests).not.toContain("start");
      expect(log.selectionRequests).not.toContain("end");
      expect(log.selectionRequests).toContain("text");
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
