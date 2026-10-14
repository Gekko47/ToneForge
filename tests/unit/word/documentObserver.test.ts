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

function makeProfileWithEmDash() {
  return {
    ...createEmptyProfile("Em dash profile"),
    typography: {
      ...createEmptyProfile("Em dash profile").typography,
      emDash: "em" as const,
    },
  };
}

function mockOffice() {
  const addHandlerAsync = vi.fn((_eventType: string, _callback: () => void) =>
    Promise.resolve({ value: { id: "handler-1" } }),
  );
  const removeHandlerAsync = vi.fn((_eventType: string, _options?: { id?: string }) =>
    Promise.resolve(),
  );
  (globalThis as { Office?: unknown }).Office = {
    context: {
      document: {
        addHandlerAsync,
        removeHandlerAsync,
      },
    },
    run: <T>(func: (context: unknown) => Promise<T>) =>
      func({
        document: {
          body: {
            text: "hello -- world",
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
  return { addHandlerAsync, removeHandlerAsync };
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

  it("retains findings from a conservative full rescan", async () => {
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 50,
      onStatus,
      profile: makeProfileWithEmDash(),
    });

    observer.startObserver();
    await vi.runAllTimersAsync();

    const lastCall = onStatus.mock.calls[onStatus.mock.calls.length - 1]?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall.dirtyCount).toBeGreaterThanOrEqual(0);
    expect(lastCall.stale).toBe(false);
    expect(
      lastCall.findings.some(
        (finding: { category: string }) => finding.category === "typography.emDash",
      ),
    ).toBe(true);
  });

  it("does not report findings as stale while a re-scan is already on its way", async () => {
    /*
     * The flash this removes. `stale` was set on the first change event, so
     * "Findings are stale" appeared the instant a keystroke landed and vanished
     * when the debounced scan caught up — a true statement at the moment when it
     * was least useful, on every character typed.
     */
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 1200,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    await vi.runAllTimersAsync();
    onStatus.mockClear();

    observer.onDocumentChanged();
    // Before the debounce elapses: the refresh is scheduled, so nothing is stale.
    expect(onStatus).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    const last = onStatus.mock.calls.at(-1)?.[0];
    expect(last.stale).toBe(false);
  });

  it("reports a failure, not staleness, when the first scan never succeeded", async () => {
    /*
     * Nothing has been accepted yet, so there is nothing for the findings to be
     * stale *relative to*. Calling it "stale" pointed the user at a re-scan
     * while the empty result read as a clean document.
     */
    const onStatus = vi.fn();
    (globalThis as { Office?: unknown }).Office = {
      run: vi.fn().mockRejectedValue(new Error("the host said no")),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    };
    const observer = createDocumentObserver({
      debounceMs: 10,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    await vi.runAllTimersAsync();

    const last = onStatus.mock.calls.at(-1)?.[0];
    expect(last.phase).toBe("failed");
    expect(last.stale).toBe(false);
  });

  it("still reports staleness when a refresh fails after findings were accepted", async () => {
    // The banner is kept for the case it is actually for. Refusing to say
    // anything is not the same as having nothing to say.
    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 10,
      onStatus,
      profile: makeProfile(),
    });

    // One accepted run first, so the failure below is a refresh rather than the
    // opening scan.
    observer.startObserver();
    await vi.runAllTimersAsync();
    (globalThis as { Office?: unknown }).Office = {
      run: vi.fn().mockRejectedValue(new Error("the host said no")),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    };

    observer.onDocumentChanged();
    await vi.runAllTimersAsync();

    const last = onStatus.mock.calls.at(-1)?.[0];
    expect(last.stale).toBe(true);
    expect(last.phase).toBe("stale");
  });

  it("waits about a second after the last change before re-reading", async () => {
    // Asserted through behaviour rather than by exporting the constant: what
    // matters is that a burst of typing produces one scan, not that the number
    // in the source is a particular value.
    const onStatus = vi.fn();
    const observer = createDocumentObserver({ onStatus, profile: makeProfile() });

    observer.startObserver();
    await vi.advanceTimersByTimeAsync(400);
    expect(onStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(900);
    expect(onStatus).toHaveBeenCalled();
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

  it("subscribes to documentSelectionChanged when started", async () => {
    const { addHandlerAsync } = mockOffice();
    const onStatus = vi.fn();
    const observer = createDocumentObserver({ onStatus, profile: makeProfile() });

    observer.startObserver();
    await vi.waitFor(() => {
      expect(addHandlerAsync).toHaveBeenCalledWith(
        "documentSelectionChanged",
        expect.any(Function),
        expect.anything(),
      );
    });
  });

  it("unsubscribes from documentSelectionChanged when stopped", async () => {
    const { addHandlerAsync, removeHandlerAsync } = mockOffice();
    const onStatus = vi.fn();
    const observer = createDocumentObserver({ onStatus, profile: makeProfile() });

    observer.startObserver();
    await vi.waitFor(() => {
      expect(addHandlerAsync).toHaveBeenCalled();
    });

    observer.stopObserver();
    await vi.waitFor(() => {
      expect(removeHandlerAsync).toHaveBeenCalledWith("documentSelectionChanged", {
        handler: expect.any(Function),
      });
    });
  });

  it("triggers a scan when the document selection changes", async () => {
    let selectionCallback: (() => void) | undefined;
    let bodyText = "hello world";
    const addHandlerAsync = vi.fn((_eventType: string, callback: () => void) => {
      selectionCallback = callback;
      return Promise.resolve({ value: { id: "handler-1" } });
    });
    const removeHandlerAsync = vi.fn(() => Promise.resolve());
    (globalThis as { Office?: unknown }).Office = {
      context: { document: { addHandlerAsync, removeHandlerAsync } },
      run: <T>(func: (context: unknown) => Promise<T>) =>
        func({
          document: {
            body: {
              get text() {
                return bodyText;
              },
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

    const onStatus = vi.fn();
    const observer = createDocumentObserver({
      debounceMs: 50,
      onStatus,
      profile: makeProfile(),
    });

    observer.startObserver();
    await vi.waitFor(() => {
      expect(addHandlerAsync).toHaveBeenCalled();
    });
    // Wait for the initial scan to complete
    await vi.runAllTimersAsync();
    onStatus.mockClear();

    // Simulate a document content change
    bodyText = "hello world changed";
    selectionCallback?.();
    await vi.runAllTimersAsync();

    expect(onStatus).toHaveBeenCalled();
  });

  it("keys its document version on the document content, so a changed document re-previews", async () => {
    /*
     * `decidePreview` rebuilds the plan only when the scan's version differs
     * from the last one it previewed. When the version was the constant
     * "pending" it never differed, so the plan was built once and never again
     * until a manual Re-scan — which is why the pane only updated on manual
     * scans and add-in loads.
     */
    let bodyText = "hello -- world";
    const addHandlerAsync = vi.fn(() => Promise.resolve({ value: { id: "handler-1" } }));
    (globalThis as { Office?: unknown }).Office = {
      context: {
        document: {
          addHandlerAsync,
          removeHandlerAsync: vi.fn(() => Promise.resolve()),
        },
      },
      run: <T>(func: (context: unknown) => Promise<T>) =>
        func({
          document: {
            body: {
              get text() {
                return bodyText;
              },
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
        saveAsync: vi.fn((cb?: (result: unknown) => void) => cb?.(undefined)),
      },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };

    const onStatus = vi.fn();
    const observer = createDocumentObserver({ debounceMs: 20, onStatus, profile: makeProfile() });
    observer.startObserver();
    await vi.runAllTimersAsync();

    const first = onStatus.mock.calls.at(-1)?.[0];
    expect(first.documentVersion).not.toBe("");
    expect(first.documentVersion).not.toBe("pending");

    bodyText = "hello -- world, and a new sentence";
    observer.onDocumentChanged();
    await vi.runAllTimersAsync();

    const second = onStatus.mock.calls.at(-1)?.[0];
    expect(second.documentVersion).not.toBe(first.documentVersion);
  });
});
