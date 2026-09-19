import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashDocument,
  getDocumentSnapshot,
  getSelectionText,
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

describe("getSelectionText", () => {
  it("returns the selection text", async () => {
    const text = await getSelectionText();
    expect(typeof text).toBe("string");
  });
});
