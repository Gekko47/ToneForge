import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashDocument,
  getDocumentSnapshot,
  getLiveSelection,
  getParagraphRange,
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
