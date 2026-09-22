import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reformatDocument } from "../../src/reformat";
import * as formattingReader from "../../src/word/formattingReader";
import * as revisionAdapter from "../../src/word/revisionAdapter";
import { setStage01Passed } from "../../src/word/revisionAdapter";
import type { WordCapabilities } from "../../src/word/capabilityProbe";
import { withSemanticHelpers } from "../../src/ai/providers/LlmProvider";
import { MockAdapter } from "../../src/ai/providers/mockAdapter";
import { StyleProfileSchema } from "../../src/core/domain/StyleProfile";
import { SAMPLE_PROFILE } from "../fixtures/sampleDocs";

const PROFILE = StyleProfileSchema.parse(SAMPLE_PROFILE);

const FULL_CAPABILITIES: WordCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsRevisions: true,
  hostName: "Word",
  hostVersion: "16.0",
};

function makeRangeMock() {
  return {
    text: "",
    insertText: vi.fn(function (this: unknown) {
      return this;
    }),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
    paragraphs: { load: vi.fn(), items: [] },
    font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn() },
    paragraphFormat: { set: vi.fn() },
    listFormat: { set: vi.fn() },
    style: "",
    set: vi.fn(function (this: unknown) {
      return this;
    }),
    load: vi.fn(),
  };
}

function makeFormattingSnapshot(text: string) {
  return {
    id: "snapshot-1",
    text,
    paragraphs: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

function installOffice(bodyText: string, trackingMode: unknown = "Off") {
  const rangeMock = makeRangeMock();
  const sharedDoc: Record<string, unknown> = {
    id: "doc-1",
    load: vi.fn(),
    changeTrackingMode: trackingMode,
  };
  const body = {
    text: bodyText,
    load: vi.fn(),
    getRange: vi.fn(() => rangeMock),
    getTrackedChanges: vi.fn(() => ({ load: vi.fn(), items: [{}] })),
    paragraphs: {
      load: vi.fn(),
      items: [
        {
          load: vi.fn(),
          text: bodyText,
          style: { name: "Normal" },
          format: { alignment: null, lineSpacing: null, spaceAfter: null, spaceBefore: null },
          font: { name: null, size: null, color: null, bold: null, italic: null, underline: null },
        },
      ],
    },
  };
  sharedDoc["body"] = body;
  sharedDoc["getSelection"] = vi.fn(() => ({ getRange: vi.fn(() => rangeMock) }));
  sharedDoc["styles"] = { load: vi.fn(), items: [] };

  const context = {
    document: sharedDoc,
    host: { name: "Word", version: "16.0" },
    sync: vi.fn(),
  };
  const wordRun = vi.fn(<T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context));
  const officeRun = vi.fn(<T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context));
  const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
  hostGlobals.Office = {
    run: officeRun,
    roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
  };
  hostGlobals.Word = { run: wordRun };

  return { rangeMock, sharedDoc, wordRun, officeRun };
}

describe("reformatDocument integration", () => {
  let originalOffice: unknown;
  let originalWord: unknown;

  beforeEach(() => {
    const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
    originalOffice = hostGlobals.Office;
    originalWord = hostGlobals.Word;
    setStage01Passed(false);
  });

  afterEach(() => {
    const hostGlobals = globalThis as { Office?: unknown; Word?: unknown };
    hostGlobals.Office = originalOffice;
    hostGlobals.Word = originalWord;
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  it("runs the full pipeline with deterministic findings and tracked apply", async () => {
    const { wordRun, officeRun } = installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
    });

    expect(result.report.profileId).toBe(PROFILE.id);
    expect(result.report.docHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.plan.docHash).toBe(result.report.docHash);
    expect(result.plan.baseDocId).toBe("doc-1");
    expect(result.plan.stale).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => item.applied)).toBe(true);
    expect(result.tracking.managed).toBe(true);
    expect(result.tracking.modeBefore).toBe("Off");
    expect(result.tracking.modeAfter).toBe("Off");
    expect(result.tracking.recordedCount).toBeGreaterThan(0);
    expect(result.applied).toBe(true);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(wordRun.mock.calls.length).toBeGreaterThan(0);
    expect(officeRun).not.toHaveBeenCalled();
  });

  it("skips the apply step when there are no findings", async () => {
    installOffice("Hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
      formattingSnapshot: makeFormattingSnapshot("Hello world"),
    });

    expect(result.plan.changes).toHaveLength(0);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(formattingSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("short-circuits empty documents without formatting or mutation reads", async () => {
    const { wordRun } = installOffice("");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
    });

    expect(result.report.summary.total).toBe(0);
    expect(result.plan.changes).toHaveLength(0);
    expect(result.results).toEqual([]);
    expect(result.applied).toBe(false);
    expect(formattingSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(wordRun.mock.calls.length).toBe(1);
  });

  it("returns a preview plan without entering the mutation adapter", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
      preview: true,
      currentDocHash: "preview-stale-hash",
    });

    expect(result.plan.changes.length).toBeGreaterThan(0);
    expect(result.plan.stale).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("marks a caller-observed hash mismatch stale before apply", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
      currentDocHash: "stale-hash",
    });

    expect(result.plan.stale).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("respects the Stage 01 capability gate", async () => {
    installOffice("hello world");
    setStage01Passed(false);
    const applySpy = vi.spyOn(revisionAdapter, "applyChangePlanWithTracking");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => !item.applied)).toBe(true);
    expect(result.results[0]?.error).toContain("capability probe");
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("propagates caller abort", async () => {
    installOffice("hello world");
    const controller = new AbortController();
    controller.abort();

    await expect(
      reformatDocument({
        profile: PROFILE,
        includeRawText: true,
        signal: controller.signal,
        registry: withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" })),
      }),
    ).rejects.toThrow();
  });

  it("runs semantic analysis when includeRawText is true", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const registry = withSemanticHelpers(
      new MockAdapter({
        defaultResponse: JSON.stringify([
          { deviation: "Too casual", severity: "medium", suggestion: "Use formal tone" },
        ]),
      }),
    );
    const completeSpy = vi.spyOn(registry, "complete");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: true,
      registry,
    });

    expect(result.report.summary.byKind.semantic).toBe(1);
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
  });

  it("skips semantic analysis when raw-text opt-in is false", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const registry = withSemanticHelpers(new MockAdapter({ defaultResponse: "[]" }));
    const completeSpy = vi.spyOn(registry, "complete");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
      registry,
    });

    expect(result.report.summary.byKind.semantic).toBe(0);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(result.applied).toBe(true);
  });

  it("uses a provided formatting snapshot without reading a second snapshot", async () => {
    installOffice("hello world");
    setStage01Passed(true, FULL_CAPABILITIES);
    const formattingSpy = vi.spyOn(formattingReader, "getFormattingSnapshot");

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
      formattingSnapshot: makeFormattingSnapshot("hello world"),
    });

    expect(result.report.summary.byKind.formatting).toBe(0);
    expect(result.applied).toBe(true);
    expect(formattingSpy).not.toHaveBeenCalled();
  });

  it("applies unmanaged when the host exposes no tracking control", async () => {
    installOffice("hello world", null);
    setStage01Passed(true, FULL_CAPABILITIES);

    const result = await reformatDocument({
      profile: PROFILE,
      includeRawText: false,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => item.applied)).toBe(true);
    expect(result.tracking).toEqual({ managed: false });
    expect(result.applied).toBe(true);
  });
});
