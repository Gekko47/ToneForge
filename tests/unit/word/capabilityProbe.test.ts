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
          load: vi.fn(),
          changeTrackingMode: "Off",
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

  it("reports supportsRevisions:false when change tracking APIs are missing", async () => {
    // The Word JavaScript API exposes tracking control as
    // Document.changeTrackingMode (WordApi 1.4) with a trackRevisions
    // desktop fallback — there is no document.trackedChanges property.
    // A working Track Changes toggle in the Word UI does not imply these
    // APIs exist, so a document without them must report false.
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
          load: vi.fn(),
        },
      }),
    );
    const caps = await probeWordCapabilities();
    expect(caps.supportsRevisions).toBe(false);
  });

  it("reports supportsRevisions:true via the trackRevisions desktop fallback", async () => {
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
          load: vi.fn(),
          trackRevisions: false,
        },
      }),
    );
    const caps = await probeWordCapabilities();
    expect(caps.supportsRevisions).toBe(true);
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

  it("detects break support from the Word global when Office.InsertBreakBehavior is absent", async () => {
    // Reproduces the live Desktop Word (WebView2, 2026-09-22) diagnostics:
    // `Word.InsertLocation: true` but `Office.InsertBreakBehavior: false`.
    const previousWord = (globalThis as { Word?: unknown }).Word;
    const previousOffice = (globalThis as { Office?: unknown }).Office;
    const officeWithoutBreakBehavior = fullOffice();
    delete (officeWithoutBreakBehavior as Record<string, unknown>).InsertBreakBehavior;
    setOffice(officeWithoutBreakBehavior);
    (globalThis as { Word?: unknown }).Word = {
      // Route Word.run through the full mock so the probe range resolves;
      // the setup.ts Office double's getSelection lacks getRange.
      run: officeWithoutBreakBehavior.run,
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    try {
      const caps = await probeWordCapabilities();
      expect(caps.supportsInsertBreak).toBe(true);
    } finally {
      (globalThis as { Word?: unknown }).Word = previousWord;
      setOffice(previousOffice);
    }
  });

  it("reports supportsStyles:true when the styles lookup API exists but items load empty", async () => {
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
          styles: {
            name: "",
            load: vi.fn(),
            items: [],
            getByNameOrNullObject: vi.fn(),
          },
          trackedChanges: { load: vi.fn(), items: [] },
        },
      }),
    );
    const caps = await probeWordCapabilities();
    expect(caps.supportsStyles).toBe(true);
  });

  it("supportsInsertText and supportsReplaceText share the same underlying probe", async () => {
    setOffice(fullOffice());
    const caps = await probeWordCapabilities();
    // The Word JS API has one `insertText` method; replace uses the same
    // method with "Replace" mode, so both flags must agree.
    expect(caps.supportsInsertText).toBe(caps.supportsReplaceText);
  });
});
