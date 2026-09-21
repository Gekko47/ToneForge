import { describe, expect, it, afterEach } from "vitest";
import { getFormattingSnapshot } from "../../../src/word/formattingReader";

function setOffice(office: unknown): void {
  (globalThis as unknown as { Office?: unknown }).Office = office;
}

// Restore the default Office mock from tests/setup.ts after each test.
afterEach(() => {
  setOffice({
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body: {
            text: "",
            load: () => undefined,
            paragraphs: { load: () => undefined, items: [] },
          },
        },
        sync: () => Promise.resolve(),
      }),
  });
});

describe("getFormattingSnapshot", () => {
  it("returns an empty snapshot when Office is unavailable", async () => {
    setOffice(undefined);
    const snapshot = await getFormattingSnapshot();
    expect(snapshot).toMatchObject({
      id: "unavailable",
      text: "",
      paragraphs: [],
    });
    expect(snapshot.paragraphs).toEqual([]);
  });

  it("returns a snapshot with paragraph DTOs when the host provides them", async () => {
    let paragraphsLoadCalled = false;
    const run = async (func: (context: unknown) => Promise<unknown>): Promise<unknown> =>
      func({
        document: {
          id: "doc-1",
          body: {
            text: "Hello world.\n\nSecond paragraph.",
            load: () => undefined,
            paragraphs: {
              load: (property: string) => {
                if (property === "items") paragraphsLoadCalled = true;
                return undefined;
              },
              items: [
                {
                  text: "Hello world.",
                  style: { name: "Normal" },
                  format: { alignment: "left" },
                  font: { name: "Calibri", size: 11, color: "#000000" },
                  load: () => undefined,
                },
                {
                  text: "Second paragraph.",
                  style: { name: "Heading 1" },
                  format: { alignment: "center" },
                  font: { name: "Calibri", size: 24, color: "#000000", bold: true },
                  load: () => undefined,
                },
              ],
            },
          },
        },
        sync: () => Promise.resolve(),
      });
    setOffice({ run });
    const snapshot = await getFormattingSnapshot();
    expect(snapshot.id).toBe("doc-1");
    expect(paragraphsLoadCalled).toBe(true);
    expect(snapshot.paragraphs).toHaveLength(2);
    expect(snapshot.paragraphs[0]).toMatchObject({
      index: 0,
      text: "Hello world.",
      styleName: "Normal",
      alignment: "left",
      fontName: "Calibri",
      fontSize: 11,
      fontColor: "#000000",
      bold: null,
    });
    expect(snapshot.paragraphs[1]).toMatchObject({
      index: 1,
      text: "Second paragraph.",
      styleName: "Heading 1",
      alignment: "center",
      fontSize: 24,
      bold: true,
    });
    expect(snapshot.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("falls back to Normal style and null fields when host data is missing", async () => {
    const run = async (func: (context: unknown) => Promise<unknown>): Promise<unknown> =>
      func({
        document: {
          body: {
            text: "Only text.",
            load: () => undefined,
            paragraphs: {
              load: () => undefined,
              items: [{ text: "Only text.", load: () => undefined }],
            },
          },
        },
        sync: () => Promise.resolve(),
      });
    setOffice({ run });
    const snapshot = await getFormattingSnapshot();
    expect(snapshot.paragraphs).toHaveLength(1);
    expect(snapshot.paragraphs[0]).toMatchObject({
      index: 0,
      text: "Only text.",
      styleName: "Normal",
      alignment: null,
      fontName: null,
      fontSize: null,
      bold: null,
    });
  });

  it("is read-only and never calls insertText or insertBreak", async () => {
    let insertTextCalled = false;
    let insertBreakCalled = false;
    const run = async (func: (context: unknown) => Promise<unknown>): Promise<unknown> =>
      func({
        document: {
          body: {
            text: "Safe text.",
            load: () => undefined,
            paragraphs: {
              load: () => undefined,
              items: [
                {
                  text: "Safe text.",
                  style: { name: "Normal" },
                  font: {},
                  load: () => undefined,
                  insertText: () => {
                    insertTextCalled = true;
                  },
                  insertBreak: () => {
                    insertBreakCalled = true;
                  },
                },
              ],
            },
          },
        },
        sync: () => Promise.resolve(),
      });
    setOffice({ run });
    await getFormattingSnapshot();
    expect(insertTextCalled).toBe(false);
    expect(insertBreakCalled).toBe(false);
  });

  it("respects maxChars and truncates text", async () => {
    const run = async (func: (context: unknown) => Promise<unknown>): Promise<unknown> =>
      func({
        document: {
          body: {
            text: "x".repeat(100),
            load: () => undefined,
            paragraphs: {
              load: () => undefined,
              items: [
                {
                  text: "x".repeat(100),
                  style: { name: "Normal" },
                  font: {},
                  load: () => undefined,
                },
              ],
            },
          },
        },
        sync: () => Promise.resolve(),
      });
    setOffice({ run });
    const snapshot = await getFormattingSnapshot({ maxChars: 10 });
    expect(snapshot.text.length).toBe(10);
    const firstPara = snapshot.paragraphs[0];
    expect(firstPara).toBeDefined();
    expect(firstPara?.text.length).toBe(100);
  });
});
