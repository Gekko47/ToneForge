import { describe, expect, it, vi, afterEach } from "vitest";
import { getStructuredSnapshot, resolveSourceRange } from "../../../src/word/documentReader";

function setOffice(office: unknown) {
  (globalThis as unknown as { Office?: unknown }).Office = office;
}

describe("getStructuredSnapshot", () => {
  afterEach(() => {
    setOffice({
      run: <T>(func: (context: unknown) => Promise<T>) =>
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

  it("returns a DocumentSnapshot with nodes", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              text: "First paragraph.\n\nSecond paragraph.",
              load: vi.fn(),
            },
            sync: vi.fn(),
          },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getStructuredSnapshot();
    expect(snapshot.documentId).toBeTruthy();
    expect(snapshot.nodes.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.structuralHash).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it("creates heading nodes for heading text", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              text: "Heading 1: Introduction\n\nNormal paragraph.",
              load: vi.fn(),
            },
            sync: vi.fn(),
          },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getStructuredSnapshot();
    const headingNodes = snapshot.nodes.filter((n: { type: string }) => n.type === "heading");
    expect(headingNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("includes a body node", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              text: "Some text.",
              load: vi.fn(),
            },
            sync: vi.fn(),
          },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getStructuredSnapshot();
    const bodyNodes = snapshot.nodes.filter((n: { type: string }) => n.type === "body");
    expect(bodyNodes).toHaveLength(1);
  });

  it("all nodes have required fields", async () => {
    setOffice({
      run: async (func: (context: unknown) => Promise<unknown>) =>
        func({
          document: {
            body: {
              text: "Para one.\n\nPara two.",
              load: vi.fn(),
            },
            sync: vi.fn(),
          },
          sync: vi.fn(),
        }),
    });

    const snapshot = await getStructuredSnapshot();
    for (const node of snapshot.nodes) {
      expect(node.nodeId).toBeTruthy();
      expect(node.type).toBeTruthy();
      expect(node.sourcePath).toBeTruthy();
      expect(node.editable).toBe(true);
      expect(node.includedInGovernance).toBe(true);
      expect(node.includedInAIReview).toBe(true);
    }
  });
});

describe("resolveSourceRange", () => {
  it("returns nodeId and structuralPath when provided", () => {
    const result = resolveSourceRange("node-123", "body/paragraph/0", 5, 10);
    expect(result.nodeId).toBe("node-123");
    expect(result.structuralPath).toBe("body/paragraph/0");
    expect(result.start).toBe(5);
    expect(result.end).toBe(10);
  });

  it("returns undefined nodeId and structuralPath when not provided", () => {
    const result = resolveSourceRange(undefined, undefined, 5, 10);
    expect(result.nodeId).toBeUndefined();
    expect(result.structuralPath).toBeUndefined();
    expect(result.start).toBe(5);
    expect(result.end).toBe(10);
  });

  it("returns undefined start and end when not provided", () => {
    const result = resolveSourceRange("node-123", "body/paragraph/0");
    expect(result.nodeId).toBe("node-123");
    expect(result.structuralPath).toBe("body/paragraph/0");
    expect(result.start).toBeUndefined();
    expect(result.end).toBeUndefined();
  });
});
