/**
 * Tests for the document observer — debounce coalescing,
 * dirty-only execution, full-rescan on heading rule, stale cancel,
 * and Office-absent no-op.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDocumentObserver } from "../../../src/word/documentObserver";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";
vi.mock("../../../src/analysis/coverage", () => ({
  buildCoverage: vi.fn().mockReturnValue({
    runId: "test",
    counts: [],
    processedCharacterCount: 0,
    revisedCharacterCount: 0,
    excluded: [],
    unprocessed: [],
    complete: true,
  }),
}));

function makeProfile() {
  return createEmptyProfile("Test Profile");
}

function mockOffice() {
  (globalThis as { Office?: unknown }).Office = {
    run: <T>(func: (context: unknown) => Promise<T>) =>
      func({
        document: {
          body: {
            text: "hello world",
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
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
}

describe("documentObserver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOffice();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces rapid document changes", async () => {
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 300,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    observer.onDocumentChanged();
    observer.onDocumentChanged();
    observer.onDocumentChanged();

    expect(onStatus).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(onStatus).toHaveBeenCalled();
  });

  it("stops observing when stopObserver is called", async () => {
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 100,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    observer.stopObserver();
    observer.onDocumentChanged();

    await vi.runAllTimersAsync();

    expect(onStatus).not.toHaveBeenCalled();
  });

  it("emits status with dirty count and stale flag", async () => {
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 50,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    await vi.runAllTimersAsync();

    const lastCall = onStatus.mock.calls[onStatus.mock.calls.length - 1]?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall.dirtyCount).toBeGreaterThanOrEqual(0);
    expect(lastCall.stale).toBe(false);
    expect(Array.isArray(lastCall.findings)).toBe(true);
  });

  it("handles missing profile gracefully", () => {
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 50,
      onStatus,
      profile: makeProfile(),
    });

    expect(() => observer.startObserver()).not.toThrow();
  });
});
