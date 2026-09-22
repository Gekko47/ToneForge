import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { logger } from "../../../src/shared/utils/logger";
import {
  applyChangePlan,
  applyChangePlanWithTracking,
  validatePlanBeforeApply,
  setStage01Passed,
} from "../../../src/word/revisionAdapter";
import type { WordCapabilities } from "../../../src/word/capabilityProbe";

const FULL_CAPABILITIES: WordCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsRevisions: false,
  hostName: "Word",
  hostVersion: "16.0",
};

describe("applyChangePlan gate", () => {
  beforeEach(() => {
    setStage01Passed(false);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  it("blocks all changes when Stage 01 has not passed", async () => {
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "hello" },
        rationale: "test",
        reversible: true,
      },
    ]);
    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("Stage 01");
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 01 gate not passed; refusing to apply ChangePlan",
      { planId: plan.id },
    );
  });

  it("flags empty plan via validatePlanBeforeApply", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = createChangePlan("hash-123", "doc-1", []);
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toContain("ChangePlan has no changes");
    // applyChangePlan on an empty plan produces no results (vacuous), so the
    // meaningful assertion is the validation message above.
    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "ChangePlan validation failed",
      expect.objectContaining({ planId: plan.id }),
    );
  });

  it("flags empty docHash in validation", () => {
    const plan = {
      id: "00000000-0000-0000-0000-000000000000",
      docHash: "",
      baseDocId: "doc-1",
      createdAt: new Date().toISOString(),
      changes: [],
      conflicts: [],
      stale: false,
    };
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toContain("ChangePlan.docHash is required");
  });

  it("blocks when plan is stale", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = createChangePlan("hash", "doc", []);
    (plan as { stale: boolean }).stale = true;
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toContain("ChangePlan is stale; re-plan before applying");
    await applyChangePlan(plan, "hash");
    expect(logger.warn).toHaveBeenCalledWith(
      "ChangePlan validation failed",
      expect.objectContaining({ planId: plan.id }),
    );
  });

  it("passes validation for a well-formed plan", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "hello" },
        rationale: "test",
        reversible: true,
      },
    ]);
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toHaveLength(0);
  });

  it("requires capabilities when enabling the gate", () => {
    expect(() => setStage01Passed(true)).toThrow("requires a verified WordCapabilities snapshot");
  });
});

describe("applyChangePlan apply path", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    setStage01Passed(false);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

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

  function installApplyMock() {
    const rangeMock = makeRangeMock();
    const getRange = vi.fn(() => rangeMock);
    const body = {
      text: "hello world",
      load: vi.fn(),
      getRange,
      paragraphs: { load: vi.fn(), items: [] },
    };
    const context = {
      document: {
        body,
        getSelection: vi.fn(() => ({ getRange })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: {
        get: vi.fn(),
        set: vi.fn(),
        saveAsync: vi.fn(),
      },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    return { rangeMock, getRange };
  }

  it("applies insertText via body.getRange(Whole) plus range.set", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock, getRange } = installApplyMock();
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "REPLACED" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(true);
    expect(getRange).toHaveBeenCalledWith("Whole");
    expect(rangeMock.set).toHaveBeenCalledWith({ start: 0, end: 5 });
    expect(rangeMock.insertText).toHaveBeenCalledWith("REPLACED", "Replace");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("applies changes in reverse offset order", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const seen: Array<{ start: number; end: number }> = [];
    const rangeMock = makeRangeMock();
    (
      rangeMock.set as unknown as {
        mockImplementation: (fn: (props: { start: number; end: number }) => unknown) => void;
      }
    ).mockImplementation((props: { start: number; end: number }) => {
      seen.push({ ...props });
      return rangeMock;
    });
    const getRange = vi.fn(() => rangeMock);
    const context = {
      document: {
        body: { text: "hello world, hello world", load: vi.fn(), getRange },
        getSelection: vi.fn(() => ({ getRange })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    };

    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "A" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "insertText",
        range: { start: 13, end: 18 },
        payload: { text: "B" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.applied)).toBe(true);
    expect(seen).toEqual([
      { start: 13, end: 18 },
      { start: 0, end: 5 },
    ]);
  });

  it("applies all eight change kinds", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 0 },
        payload: { text: "A" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "replaceText",
        range: { start: 0, end: 5 },
        payload: { text: "B" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174002",
        type: "deleteRange",
        range: { start: 0, end: 5 },
        payload: {},
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174003",
        type: "setParagraphFormat",
        range: { start: 0, end: 5 },
        payload: { alignment: "center" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174004",
        type: "setCharacterFormat",
        range: { start: 0, end: 5 },
        payload: { bold: true },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174005",
        type: "applyStyle",
        range: { start: 0, end: 5 },
        payload: { styleName: "Heading 1" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174006",
        type: "insertBreak",
        range: { start: 5, end: 5 },
        payload: { breakType: "nextParagraph" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174007",
        type: "setListLevel",
        range: { start: 0, end: 5 },
        payload: { level: 1 },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.applied)).toBe(true);
    expect(rangeMock.insertText).toHaveBeenCalled();
    expect(rangeMock.paragraphFormat.set).toHaveBeenCalled();
    expect(rangeMock.font.set).toHaveBeenCalled();
    expect(rangeMock.insertBreak).toHaveBeenCalled();
    expect(rangeMock.listFormat.set).toHaveBeenCalled();
  });

  it("resolves break enums from the Word global when Office values are absent", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const previousWord = (globalThis as { Word?: unknown }).Word;
    const previousOffice = (globalThis as { Office?: unknown }).Office;
    // Simulate the live host: Word global carries the enums, Office does not.
    const officeWithoutEnums = {
      ...(previousOffice as Record<string, unknown>),
    };
    delete officeWithoutEnums.BreakType;
    delete officeWithoutEnums.InsertLocation;
    delete officeWithoutEnums.InsertBreakBehavior;
    (globalThis as { Office?: unknown }).Office = officeWithoutEnums;
    (globalThis as { Word?: unknown }).Word = {
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    try {
      const plan = createChangePlan("hash-123", "doc-1", [
        {
          id: "123e4567-e89b-12d3-a456-426614174006",
          type: "insertBreak",
          range: { start: 5, end: 5 },
          payload: { breakType: "page" },
          rationale: "test",
          reversible: true,
        },
      ]);
      const results = await applyChangePlan(plan, "hash-123");
      expect(results[0]?.applied).toBe(true);
      expect(rangeMock.insertBreak).toHaveBeenCalledWith(2, 1);
    } finally {
      (globalThis as { Word?: unknown }).Word = previousWord;
      (globalThis as { Office?: unknown }).Office = previousOffice;
    }
  });

  it("reports applied:false when break enums are unavailable in the host", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const previousWord = (globalThis as { Word?: unknown }).Word;
    const previousOffice = (globalThis as { Office?: unknown }).Office;
    const officeWithoutEnums = {
      ...(previousOffice as Record<string, unknown>),
    };
    delete officeWithoutEnums.BreakType;
    delete officeWithoutEnums.InsertLocation;
    delete officeWithoutEnums.InsertBreakBehavior;
    (globalThis as { Office?: unknown }).Office = officeWithoutEnums;
    (globalThis as { Word?: unknown }).Word = undefined;
    try {
      const plan = createChangePlan("hash-123", "doc-1", [
        {
          id: "123e4567-e89b-12d3-a456-426614174006",
          type: "insertBreak",
          range: { start: 5, end: 5 },
          payload: { breakType: "line" },
          rationale: "test",
          reversible: true,
        },
      ]);
      const results = await applyChangePlan(plan, "hash-123");
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("unavailable in this host");
    } finally {
      (globalThis as { Word?: unknown }).Word = previousWord;
      (globalThis as { Office?: unknown }).Office = previousOffice;
    }
  });

  it("manages revision tracking around the plan when the API is available", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const docMock: Record<string, unknown> = {
      load: vi.fn(),
      changeTrackingMode: "Off",
    };
    const getTrackedChanges = vi.fn(() => ({
      load: vi.fn(),
      items: [{}, {}, {}],
    }));
    const context = {
      document: {
        body: {
          text: "hello world",
          load: vi.fn(),
          getRange: vi.fn(() => rangeMock),
          getTrackedChanges,
        },
        getSelection: vi.fn(),
        styles: { load: vi.fn(), items: [] },
        ...docMock,
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    // Share one mutable document object across runInWord sessions so mode
    // transitions are observable.
    const sharedDoc = context.document as Record<string, unknown>;
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> =>
        func({ ...context, document: sharedDoc }),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(true);
    expect(tracking.managed).toBe(true);
    expect(tracking.modeBefore).toBe("Off");
    expect(tracking.modeAfter).toBe("Off");
    expect(tracking.recordedCount).toBe(3);
    // Tracking was enabled for the mutations, then restored.
    expect(sharedDoc["changeTrackingMode"]).toBe("Off");
    expect(rangeMock.insertText).toHaveBeenCalledWith("X", "Replace");
  });

  it("leaves an already-tracking document untouched", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const docMock: Record<string, unknown> = {
      load: vi.fn(),
      changeTrackingMode: "TrackAll",
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> =>
        func({
          document: {
            body: {
              text: "hello world",
              load: vi.fn(),
              getRange: vi.fn(() => ({
                insertText: vi.fn(),
                load: vi.fn(),
                set: vi.fn(),
              })),
            },
            getSelection: vi.fn(),
            styles: { load: vi.fn(), items: [] },
            ...docMock,
          },
          host: { name: "Word", version: "16.0" },
          sync: vi.fn(),
        }),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    expect(results[0]?.applied).toBe(true);
    expect(tracking.managed).toBe(true);
    expect(tracking.modeBefore).toBe("TrackAll");
    expect(tracking.modeAfter).toBe("TrackAll");
    expect(docMock["changeTrackingMode"]).toBe("TrackAll");
  });

  it("applies unmanaged with a clear report when tracking control is missing", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    // installApplyMock's document has no load/changeTrackingMode, so tracking
    // is unmanaged — but the edit itself still applies.
    expect(results[0]?.applied).toBe(true);
    expect(tracking.managed).toBe(false);
    expect(tracking.modeBefore).toBeUndefined();
    expect(tracking.recordedCount).toBeUndefined();
  });

  it("reports applied:false and error for unsupported applyStyle", async () => {
    setStage01Passed(true, { ...FULL_CAPABILITIES, supportsStyles: false });
    installApplyMock();
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "applyStyle",
        range: { start: 0, end: 5 },
        payload: { styleName: "Nonexistent" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("not supported");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to apply change",
      expect.objectContaining({ changeId: plan.changes[0]?.id }),
    );
  });

  it("isolates per-change failures", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const goodRange = makeRangeMock();
    let calls = 0;
    const getRange = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error("first range failed");
      return goodRange;
    });
    const context = {
      document: {
        body: { text: "hello world, hello world", load: vi.fn(), getRange },
        getSelection: vi.fn(() => ({ getRange })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
    };

    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "A" },
        rationale: "test",
        reversible: true,
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "insertText",
        range: { start: 13, end: 18 },
        payload: { text: "B" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(2);
    // Reverse order: the later offset is attempted first and fails.
    expect(results[0]?.applied).toBe(false);
    expect(results[1]?.applied).toBe(true);
  });

  it("refuses to apply when currentDocHash mismatches", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174002",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
      },
    ]);

    const results = await applyChangePlan(plan, "different-hash");
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("hash mismatch");
    expect(logger.warn).toHaveBeenCalledWith(
      "Document hash mismatch; refusing to apply ChangePlan",
      expect.objectContaining({
        planId: plan.id,
        expected: "hash-123",
        actual: "different-hash",
      }),
    );
  });
});
