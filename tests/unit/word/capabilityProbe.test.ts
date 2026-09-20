import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { probeWordCapabilities } from "../../../src/word/capabilityProbe";

function setOffice(office: unknown) {
  (globalThis as unknown as { Office?: unknown }).Office = office;
}

function fullOffice(overrides: Record<string, unknown> = {}) {
  const getRange = vi.fn(() => ({
    text: "",
    insertText: vi.fn(),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(),
    load: vi.fn(),
  }));
  return {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body: { text: "", load: vi.fn(), getRange },
          getSelection: vi.fn(() => ({ getRange })),
          styles: { name: "", load: vi.fn(), items: [{ name: "Normal" }] },
          trackedChanges: { load: vi.fn(), items: [] },
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
        ...overrides,
      }),
    roamingSettings: {
      get: vi.fn(),
      set: vi.fn(),
      saveAsync: vi.fn(),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  };
}

describe("probeWordCapabilities", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
  });

  afterEach(() => {
    setOffice(originalOffice);
  });

  it("returns a capability object with all keys", async () => {
    setOffice(fullOffice());
    const caps = await probeWordCapabilities();
    expect(caps).toHaveProperty("supportsInsertText");
    expect(caps).toHaveProperty("supportsReplaceText");
    expect(caps).toHaveProperty("supportsInsertParagraph");
    expect(caps).toHaveProperty("supportsInsertBreak");
    expect(caps).toHaveProperty("supportsStyles");
    expect(caps).toHaveProperty("supportsRevisions");
    expect(caps).toHaveProperty("hostName");
    expect(caps).toHaveProperty("hostVersion");
    expect(["Word", "Excel", "PowerPoint", "unknown"]).toContain(caps.hostName);
  });

  it("returns truthful capabilities from a full host", async () => {
    setOffice(fullOffice());
    const caps = await probeWordCapabilities();
    expect(caps.supportsInsertText).toBe(true);
    expect(caps.supportsReplaceText).toBe(true);
    expect(caps.supportsInsertParagraph).toBe(true);
    expect(caps.supportsInsertBreak).toBe(true);
    expect(caps.supportsStyles).toBe(true);
    expect(caps.supportsRevisions).toBe(true);
    expect(caps.hostName).toBe("Word");
  });

  it("reports supportsRevisions:false when trackedChanges is missing", async () => {
    setOffice(
      fullOffice({
        document: {
          body: {
            text: "",
            load: vi.fn(),
            getRange: vi.fn(() => ({ insertText: vi.fn(), load: vi.fn() })),
          },
          getSelection: vi.fn(() => ({
            getRange: vi.fn(() => ({ insertText: vi.fn(), load: vi.fn() })),
          })),
          styles: { name: "", load: vi.fn(), items: [{ name: "Normal" }] },
        },
      }),
    );
    const caps = await probeWordCapabilities();
    expect(caps.supportsRevisions).toBe(false);
  });

  it("reports supportsStyles:false when styles collection is empty", async () => {
    setOffice(
      fullOffice({
        document: {
          body: {
            text: "",
            load: vi.fn(),
            getRange: vi.fn(() => ({ insertText: vi.fn(), load: vi.fn() })),
          },
          getSelection: vi.fn(() => ({
            getRange: vi.fn(() => ({ insertText: vi.fn(), load: vi.fn() })),
          })),
          styles: { name: "", load: vi.fn(), items: [] },
          trackedChanges: { load: vi.fn(), items: [] },
        },
      }),
    );
    const caps = await probeWordCapabilities();
    expect(caps.supportsStyles).toBe(false);
  });

  it("normalizes unknown host to 'unknown'", async () => {
    setOffice(fullOffice({ host: { name: "Bogus", version: "0.0" } }));
    const caps = await probeWordCapabilities();
    expect(caps.hostName).toBe("unknown");
  });

  it("normalizes Excel and PowerPoint host names", async () => {
    setOffice(fullOffice({ host: { name: "Excel", version: "16.0" } }));
    expect((await probeWordCapabilities()).hostName).toBe("Excel");
    setOffice(fullOffice({ host: { name: "PowerPoint", version: "16.0" } }));
    expect((await probeWordCapabilities()).hostName).toBe("PowerPoint");
  });

  it("returns all-false capabilities when Office.run throws", async () => {
    setOffice({
      run: vi.fn().mockRejectedValue(new Error("Office not ready")),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    });
    const caps = await probeWordCapabilities();
    expect(caps.supportsInsertText).toBe(false);
    expect(caps.supportsReplaceText).toBe(false);
    expect(caps.supportsInsertParagraph).toBe(false);
    expect(caps.supportsInsertBreak).toBe(false);
    expect(caps.supportsStyles).toBe(false);
    expect(caps.supportsRevisions).toBe(false);
    expect(caps.hostName).toBe("unknown");
  });

  it("returns all-false capabilities when Office is unavailable", async () => {
    setOffice(undefined);
    const caps = await probeWordCapabilities();
    expect(caps.supportsInsertText).toBe(false);
    expect(caps.supportsReplaceText).toBe(false);
    expect(caps.supportsInsertParagraph).toBe(false);
    expect(caps.supportsInsertBreak).toBe(false);
    expect(caps.supportsStyles).toBe(false);
    expect(caps.supportsRevisions).toBe(false);
    expect(caps.hostName).toBe("unknown");
    expect(caps.hostVersion).toBeNull();
  });

  it("supportsInsertText and supportsReplaceText share the same underlying probe", async () => {
    setOffice(fullOffice());
    const caps = await probeWordCapabilities();
    // The Word JS API has one `insertText` method; replace uses the same
    // method with "Replace" mode, so both flags must agree.
    expect(caps.supportsInsertText).toBe(caps.supportsReplaceText);
  });
});
