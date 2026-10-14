import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashDocument,
  getDocumentSnapshot,
  getLiveSelection,
  getParagraphRange,
  readBodyTextIn,
  readReviewedText,
} from "../../../src/word/documentReader";

describe("hashDocument", () => {
  it("is deterministic", () => {
    const text = "The quick brown fox.";
    expect(hashDocument(text)).toBe(hashDocument(text));
  });

  it("differs for different text", () => {
    expect(hashDocument("alpha")).not.toBe(hashDocument("beta"));
  });

  it("returns a non-empty hex string", () => {
    const h = hashDocument("hello");
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const h = hashDocument("");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
  });
});

function setOffice(office: unknown) {
  (globalThis as unknown as { Office?: unknown }).Office = office;
}

describe("getDocumentSnapshot", () => {
  afterEach(() => {
    // Restore the default Office mock from tests/setup.ts.
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
        func({
          document: {
            body: {
              text: "",
              load: vi.fn(),
              paragraphs: { load: vi.fn(), items: [] },
              getRange: vi.fn(() => ({
                text: "",
                insertText: vi.fn(),
                insertBreak: vi.fn(),
                insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
                paragraphs: { load: vi.fn(), items: [] },
                font: { name: "", size: 0, color: "", load: vi.fn() },
                load: vi.fn(),
              })),
            },
            selection: {
              text: "",
              insertText: vi.fn(),
              insertBreak: vi.fn(),
              insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
              paragraphs: { load: vi.fn(), items: [] },
              font: { name: "", size: 0, color: "", load: vi.fn() },
              load: vi.fn(),
            },
            getSelection: vi.fn(() => ({
              text: "",
              insertText: vi.fn(),
              insertBreak: vi.fn(),
              insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
              paragraphs: { load: vi.fn(), items: [] },
              font: { name: "", size: 0, color: "", load: vi.fn() },
              load: vi.fn(),
            })),
            styles: { name: "", load: vi.fn(), items: [] },
          },
          host: { name: "Word", version: "16.0" },
          sync: vi.fn(),
        }),
      roamingSettings: {
        get: vi.fn(),
        set: vi.fn(),
        saveAsync: vi.fn((cb?: (result: unknown) => void) => {
          if (cb) cb(undefined);
        }),
      },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    });
  });

  it("truncates text beyond maxChars", async () => {
    const longText = "x".repeat(100);
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: { body: { text: longText, load: vi.fn() } },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getDocumentSnapshot({ maxChars: 10 });
    expect(snapshot.text).toBe("x".repeat(10));
    expect(snapshot.wordCount).toBe(1);
    expect(snapshot.paragraphs).toEqual(["x".repeat(10)]);
    expect(snapshot.hash).toBe(hashDocument("x".repeat(10)));
  });

  it("uses a stable document id from context when available", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: { text: "hello world", load: vi.fn() },
            id: "doc-id-123",
          },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getDocumentSnapshot();
    expect(snapshot.id).toBe("doc-id-123");
    expect(snapshot.capturedAt).toBeTruthy();
  });

  it("falls back to a text hash when no document id is available", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: { body: { text: "some text", load: vi.fn() } },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getDocumentSnapshot();
    expect(snapshot.id).toBe(hashDocument("some text"));
  });
});

describe("live selection", () => {
  afterEach(() => {
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>) =>
        func({
          document: {
            getSelection: () => ({ text: "", start: 0, end: 0, load: vi.fn() }),
          },
          sync: vi.fn(),
        }),
    });
  });

  it("returns current start and end identity on every read", async () => {
    const selections = [
      { text: "first", start: 3, end: 8 },
      { text: "second", start: 11, end: 17 },
    ];
    const getSelection = vi.fn(() => {
      const selection = selections.shift();
      if (!selection) throw new Error("Selection read was not expected");
      return { ...selection, load: vi.fn() };
    });
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>) =>
        func({ document: { getSelection }, sync: vi.fn() }),
    });

    await expect(getLiveSelection()).resolves.toEqual({
      text: "first",
      start: 3,
      end: 8,
    });
    await expect(getLiveSelection()).resolves.toEqual({
      text: "second",
      start: 11,
      end: 17,
    });
    expect(getSelection).toHaveBeenCalledTimes(2);
  });

  it("fails closed when live selection identity is unavailable", async () => {
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>) =>
        func({
          document: {
            getSelection: () => ({ text: "selected", load: vi.fn() }),
          },
          sync: vi.fn(),
        }),
    });

    await expect(getLiveSelection()).resolves.toBeNull();
  });
});

describe("getParagraphRange", () => {
  it("returns paragraph text after a second context.sync", async () => {
    const sync = vi.fn();
    const para1 = {
      text: "",
      load: vi.fn(function (this: { text: string }) {
        this.text = "first paragraph";
      }),
    };
    const para2 = {
      text: "",
      load: vi.fn(function (this: { text: string }) {
        this.text = "second paragraph";
      }),
    };
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              paragraphs: { load: vi.fn(), items: [para1, para2] },
            },
          },
          sync,
        }),
    });

    const result = await getParagraphRange(0, 2);
    expect(result).toEqual(["first paragraph", "second paragraph"]);
    // The first sync loads `items`; the second sync loads `text`.
    expect(sync).toHaveBeenCalledTimes(2);
    expect(para1.load).toHaveBeenCalledWith("text");
    expect(para2.load).toHaveBeenCalledWith("text");
  });

  it("returns an empty array when paragraphs are unavailable", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: { body: {} },
          sync: vi.fn(),
        }),
    });

    const result = await getParagraphRange(0, 5);
    expect(result).toEqual([]);
  });

  it("slices by startIndex and count", async () => {
    const sync = vi.fn();
    const paras = ["zero", "one", "two", "three", "four"].map((t) => ({
      text: "",
      load: vi.fn(function (this: { text: string }) {
        this.text = t;
      }),
    }));
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: { paragraphs: { load: vi.fn(), items: paras } },
          },
          sync,
        }),
    });

    const result = await getParagraphRange(1, 2);
    expect(result).toEqual(["one", "two"]);
  });
});

/**
 * The red-line regression.
 *
 * `body.text` keeps text marked for deletion by a tracked revision until that
 * revision is accepted. A scan reading it re-reports a finding whose correction
 * ToneForge already applied. These tests pin the accept-all read that fixes it.
 */
describe("readBodyTextIn", () => {
  /** Build a minimal host context exposing `body`, as `runInWord` would. */
  function contextWithBody(body: {
    text: string;
    load: ReturnType<typeof vi.fn>;
    getReviewedText?: ReturnType<typeof vi.fn>;
  }): unknown {
    return { document: { body }, sync: vi.fn() };
  }

  it("returns the accept-all text, excluding a red-line deletion", async () => {
    // body.text still holds the deleted span; the accept-all view does not.
    const context = contextWithBody({
      text: "The quick brown fox jumps over the lazy dog",
      load: vi.fn(),
      getReviewedText: vi.fn(() => ({
        value: "The quick fox jumps over the lazy dog",
        load: vi.fn(),
      })),
    });

    const text = await readBodyTextIn(context as never);
    expect(text).toBe("The quick fox jumps over the lazy dog");
    expect(text).not.toContain("brown");
  });

  it("invokes getReviewedText on the body, so the host receives its `this`", async () => {
    /*
     * The host-only regression. Office.js client-object methods read their
     * request context from `this`. Extracting `body.getReviewedText` into a local
     * and calling it detached makes `this` undefined, and the real method then
     * throws inside Word (`Cannot read properties of undefined (reading
     * '_nextId')`). A mock built from an arrow function ignores `this` and hides
     * the defect — so this double records the receiver it was called with.
     */
    const receivers: unknown[] = [];
    const body = {
      text: "raw body text",
      load: vi.fn(),
      getReviewedText(this: unknown, version?: string) {
        receivers.push(this);
        return { value: version === "Current" ? "accept-all" : "", load: vi.fn() };
      },
    };
    const context = { document: { body }, sync: vi.fn() };

    await expect(readBodyTextIn(context as never)).resolves.toBe("accept-all");
    // A detached call would push `undefined` here and the test would fail.
    expect(receivers).toEqual([body]);
  });

  it("loads value on the returned range before reading it", async () => {
    /*
     * Regression for ValueNotLoaded on a real host. `getReviewedText` returns
     * a Range client object whose `value` property must be loaded independently.
     * The mock verifies that `load("value")` was called before `.value` was read.
     */
    const load = vi.fn();
    const context = contextWithBody({
      text: "raw",
      load: vi.fn(),
      getReviewedText: vi.fn(() => ({ value: "accept-all", load })),
    });

    await readBodyTextIn(context as never);
    expect(load).toHaveBeenCalledWith("value");
  });

  it("falls back to body.text when the host has no getReviewedText", async () => {
    const context = contextWithBody({
      text: "literal body text",
      load: vi.fn(),
    });

    const text = await readBodyTextIn(context as never);
    expect(text).toBe("literal body text");
  });

  it("treats an empty accept-all view as a real result, not a failure", async () => {
    const reviewedRange = { value: "", load: vi.fn() };
    const context = contextWithBody({
      text: "everything is pending deletion",
      load: vi.fn(),
      getReviewedText: vi.fn().mockReturnValue(reviewedRange),
    });

    const text = await readBodyTextIn(context as never);
    expect(text).toBe("");
  });
});

describe("readReviewedText", () => {
  afterEach(() => {
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
        func({ document: { body: { text: "", load: vi.fn() } }, sync: vi.fn() }),
    });
  });

  it("reports reviewed: true when the host serves the accept-all view", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              text: "with deletion",
              load: vi.fn(),
              getReviewedText: vi.fn(() => ({ value: "accepted" })),
            },
          },
          sync: vi.fn(),
        }),
    });

    const result = await readReviewedText();
    expect(result).toEqual({ text: "accepted", reviewed: true });
  });

  it("reports reviewed: false on a host without getReviewedText", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: { body: { text: "literal", load: vi.fn() } },
          sync: vi.fn(),
        }),
    });

    const result = await readReviewedText();
    expect(result).toEqual({ text: "literal", reviewed: false });
  });
});
