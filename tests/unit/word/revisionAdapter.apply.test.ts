import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestPlan } from "../../fixtures/changePlans";
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
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: false,
  supportsSelection: true,
  supportsRangedReplacement: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenuApi: true,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  supportsRibbonUpdate: true,
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
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "hello" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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
    const plan = createTestPlan("hash-123", "doc-1", []);
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
    const plan = createTestPlan("hash", "doc", []);
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
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "hello" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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
  let originalWord: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    originalWord = (globalThis as { Word?: unknown }).Word;
    setStage01Passed(false);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    (globalThis as { Word?: unknown }).Word = originalWord;
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  function makeRangeMock(bodyText: string) {
    let lastStart = 0;
    let lastEnd = 0;
    return {
      get text() {
        return bodyText.slice(lastStart, lastEnd);
      },
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
      set: vi.fn(function (this: unknown, opts: { start: number; end: number }) {
        lastStart = opts.start;
        lastEnd = opts.end;
        return this;
      }),
      load: vi.fn(),
    };
  }

  function installApplyMock() {
    const bodyText = "hello world";
    const rangeMock = makeRangeMock(bodyText);
    const getRange = vi.fn(() => rangeMock);
    const body = {
      text: bodyText,
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
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "REPLACED" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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

  it("relocates a text change to where the recorded text actually sits in the live body", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    // The plan says the "--" is at [2, 4); the live body holds it at [6, 8),
    // the shape a tracked deletion leaves when it shifts later offsets.
    const rangeMock = makeRangeMock("xxxxxx--yy");
    const getRange = vi.fn(() => rangeMock);
    const context = {
      document: {
        body: {
          text: "xxxxxx--yy",
          load: vi.fn(),
          getRange,
          paragraphs: { load: vi.fn(), items: [] },
        },
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
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "replaceText",
        range: { start: 2, end: 4 },
        payload: { text: "—" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
        precondition: { kind: "text", expectedText: "--" },
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(true);
    expect(rangeMock.set).toHaveBeenCalledWith({ start: 6, end: 8 });
  });

  it("applies changes in reverse offset order", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const rangeMock = makeRangeMock("hello world, hello world");
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

    const plan = createTestPlan(
      "hash-123",
      "doc-1",
      [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          type: "insertText",
          range: { start: 0, end: 5 },
          payload: { text: "A" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
        },
        {
          id: "123e4567-e89b-12d3-a456-426614174001",
          type: "insertText",
          range: { start: 13, end: 18 },
          payload: { text: "B" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
        },
      ],
      "hello world, hello world",
    );

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.applied)).toBe(true);
    // The last 2 set calls (from getRangeByChange during apply) should be in reverse order
    const setCalls = (
      rangeMock.set as unknown as { mock: { calls: Array<Array<{ start: number; end: number }>> } }
    ).mock.calls;
    const applyCalls = setCalls.slice(-2);
    expect(applyCalls).toEqual([[{ start: 13, end: 18 }], [{ start: 0, end: 5 }]]);
  });

  it("applies all eight change kinds", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 0 },
        payload: { text: "A" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "replaceText",
        range: { start: 0, end: 5 },
        payload: { text: "B" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174002",
        type: "deleteRange",
        range: { start: 0, end: 5 },
        payload: {},
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174003",
        type: "setParagraphFormat",
        range: { start: 0, end: 5 },
        payload: { alignment: "center" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174004",
        type: "setCharacterFormat",
        range: { start: 0, end: 5 },
        payload: { bold: true },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174005",
        type: "applyStyle",
        range: { start: 0, end: 5 },
        payload: { styleName: "Heading 1" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174006",
        type: "insertBreak",
        range: { start: 5, end: 5 },
        payload: { breakType: "nextParagraph" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174007",
        type: "setListLevel",
        range: { start: 0, end: 5 },
        payload: { level: 1 },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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
      const plan = createTestPlan("hash-123", "doc-1", [
        {
          id: "123e4567-e89b-12d3-a456-426614174006",
          type: "insertBreak",
          range: { start: 5, end: 5 },
          payload: { breakType: "page" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
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
      const plan = createTestPlan("hash-123", "doc-1", [
        {
          id: "123e4567-e89b-12d3-a456-426614174006",
          type: "insertBreak",
          range: { start: 5, end: 5 },
          payload: { breakType: "line" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
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
    // Share one mutable document object across runInWord sessions so mode
    // transitions are observable. A setter records every assigned mode so the
    // test proves tracking is enabled for "Just Me" before the mutations.
    let currentMode: unknown = "Off";
    const seenModes: unknown[] = [];
    const sharedDoc: Record<string, unknown> = {
      load: vi.fn(),
      body: {
        text: "hello world",
        load: vi.fn(),
        getRange: vi.fn(() => rangeMock),
        getTrackedChanges: vi.fn(() => ({
          load: vi.fn(),
          items: [{ load: vi.fn() }, { load: vi.fn() }, { load: vi.fn() }],
        })),
      },
      getSelection: vi.fn(),
      styles: { load: vi.fn(), items: [] },
    };
    Object.defineProperty(sharedDoc, "changeTrackingMode", {
      configurable: true,
      get: () => currentMode,
      set: (value: unknown) => {
        currentMode = value;
        seenModes.push(value);
      },
    });
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> =>
        func({
          document: sharedDoc,
          host: { name: "Word", version: "16.0" },
          sync: vi.fn(),
        }),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(true);
    expect(tracking.managed).toBe(true);
    expect(tracking.modeBefore).toBe("Off");
    expect(tracking.modeAfter).toBe("Off");
    expect(tracking.recordedCount).toBe(3);
    // Tracking was enabled for "Just Me" for the mutations, then restored.
    expect(seenModes).toEqual(["TrackMineOnly", "Off"]);
    expect(sharedDoc["changeTrackingMode"]).toBe("Off");
    expect(rangeMock.insertText).toHaveBeenCalledWith("X", "Replace");
  });

  it("leaves an already-tracking document untouched", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const rangeMock = makeRangeMock("hello world");
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
              getRange: vi.fn(() => rangeMock),
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
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    expect(results[0]?.applied).toBe(true);
    expect(tracking.managed).toBe(true);
    expect(tracking.modeBefore).toBe("TrackAll");
    expect(tracking.modeAfter).toBe("TrackAll");
    expect(docMock["changeTrackingMode"]).toBe("TrackAll");
  });

  it("refuses without managed tracking when the tracking control is missing", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "X" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const { results, tracking } = await applyChangePlanWithTracking(plan, "hash-123");

    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("Managed Track Changes");
    expect(tracking.managed).toBe(false);
    expect(tracking.modeBefore).toBeUndefined();
    expect(tracking.recordedCount).toBeUndefined();
  });

  it("reports applied:false and error for unsupported applyStyle", async () => {
    setStage01Passed(true, { ...FULL_CAPABILITIES, supportsStyles: false });
    installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        type: "applyStyle",
        range: { start: 0, end: 5 },
        payload: { styleName: "Nonexistent" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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
    const goodRange = makeRangeMock("hello world, hello world");
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

    const plan = createTestPlan(
      "hash-123",
      "doc-1",
      [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          type: "insertText",
          range: { start: 0, end: 5 },
          payload: { text: "A" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
        },
        {
          id: "123e4567-e89b-12d3-a456-426614174001",
          type: "insertText",
          range: { start: 13, end: 18 },
          payload: { text: "B" },
          rationale: "test",
          reversible: true,
          source: "deterministic",
          risk: "none",
          approvalRequired: false,
          dependsOn: [],
        },
      ],
      "hello world, hello world",
    );

    const results = await applyChangePlan(plan, "hash-123");
    expect(results).toHaveLength(2);
    // Reverse order: the later offset is attempted first and fails.
    expect(results[0]?.applied).toBe(false);
    expect(results[1]?.applied).toBe(true);
  });

  it("refuses a schema-v1 plan before preflight or mutation", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const v2 = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174003",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);
    const legacy = { ...v2, schemaVersion: 1 as const };

    const results = await applyChangePlan(legacy, "hash-123");

    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("schemaVersion must be 2");
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("refuses pending approval before live preflight or mutation", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174004",
        type: "replaceText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "ai",
        risk: "medium",
        approvalRequired: true,
        approvalState: "pending",
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");

    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("requires explicit approval");
    expect(logger.warn).toHaveBeenCalledWith(
      "ChangePlan validation failed",
      expect.objectContaining({ refusalCategory: "approval_required" }),
    );
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("fails atomically when one exact precondition is stale", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const { rangeMock } = installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174005",
        type: "replaceText",
        range: { start: 0, end: 5 },
        payload: { text: "A" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174006",
        type: "replaceText",
        range: { start: 6, end: 11 },
        payload: { text: "B" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
        precondition: { kind: "text", expectedText: "stale" },
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");

    expect(results.every((result) => !result.applied)).toBe(true);
    expect(results[0]?.error).toContain("Atomic precondition preflight failed");
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("rejects a multi-paragraph range after its node precondition passes", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    const paragraphRange = makeRangeMock("First\nSecond");
    const context = {
      document: {
        body: {
          text: "First\nSecond",
          load: vi.fn(),
          paragraphs: {
            load: vi.fn(),
            items: [
              {
                text: "First",
                uniqueLocalId: "paragraph-0",
                load: vi.fn(),
                style: "Normal",
              },
            ],
          },
          getRange: vi.fn(() => paragraphRange),
        },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174007",
        type: "setParagraphFormat",
        range: {
          start: 0,
          end: 2,
          unit: "paragraph",
          target: { kind: "paragraph", index: 0 },
        },
        payload: { alignment: "center" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
        precondition: { kind: "node", nodeId: "word-paragraph-paragraph-0" },
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");

    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("Multi-paragraph range");
    expect(paragraphRange.paragraphFormat.set).not.toHaveBeenCalled();
  });

  it("refuses to apply when currentDocHash mismatches", async () => {
    setStage01Passed(true, FULL_CAPABILITIES);
    installApplyMock();
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174002",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
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

  it("refuses when revision inspection is not supported by the host", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsTrackedChangeInspection: true,
    });
    const { rangeMock } = installApplyMock();
    // Mock getTrackedChanges to return supported: false
    const body = {
      text: "hello world",
      load: vi.fn(),
      getRange: vi.fn(() => rangeMock),
      paragraphs: { load: vi.fn(), items: [] },
      getTrackedChanges: vi.fn(() => ({
        load: vi.fn(() => {
          throw new Error("no items");
        }),
        items: [],
      })),
    };
    const context = {
      document: {
        body,
        getSelection: vi.fn(() => ({ getRange: vi.fn(() => rangeMock) })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("not supported");
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("refuses when a change overlaps a foreign tracked revision", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsTrackedChangeInspection: true,
    });
    const { rangeMock } = installApplyMock();
    const body = {
      text: "hello world",
      load: vi.fn(),
      getRange: vi.fn(() => rangeMock),
      paragraphs: { load: vi.fn(), items: [] },
      getTrackedChanges: vi.fn(() => ({
        load: vi.fn(),
        items: [
          {
            author: "John Doe",
            date: "2026-01-01T00:00:00Z",
            text: "hello",
            type: "Added",
            load: vi.fn(),
            getRange: vi.fn(() => ({
              start: 0,
              end: 5,
              load: vi.fn(),
            })),
          },
        ],
      })),
    };
    const context = {
      document: {
        body,
        getSelection: vi.fn(() => ({ getRange: vi.fn(() => rangeMock) })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("overlaps a tracked revision by another author");
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("refuses when a change overlaps a ToneForge revision already applied", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsTrackedChangeInspection: true,
    });
    const { rangeMock } = installApplyMock();
    const body = {
      text: "hello world",
      load: vi.fn(),
      getRange: vi.fn(() => rangeMock),
      paragraphs: { load: vi.fn(), items: [] },
      getTrackedChanges: vi.fn(() => ({
        load: vi.fn(),
        items: [
          {
            author: "ToneForge",
            date: "2026-01-01T00:00:00Z",
            text: "hello",
            type: "Added",
            load: vi.fn(),
            getRange: vi.fn(() => ({
              start: 0,
              end: 5,
              load: vi.fn(),
            })),
          },
        ],
      })),
    };
    const context = {
      document: {
        body,
        getSelection: vi.fn(() => ({ getRange: vi.fn(() => rangeMock) })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("already applied");
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("applies normally when revision inspection finds no overlapping revisions", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsTrackedChangeInspection: true,
    });
    const { rangeMock } = installApplyMock();
    const body = {
      text: "hello world",
      load: vi.fn(),
      getRange: vi.fn(() => rangeMock),
      paragraphs: { load: vi.fn(), items: [] },
      getTrackedChanges: vi.fn(() => ({
        load: vi.fn(),
        items: [
          {
            author: "John Doe",
            date: "2026-01-01T00:00:00Z",
            text: "far away",
            type: "Added",
            load: vi.fn(),
            getRange: vi.fn(() => ({
              start: 100,
              end: 200,
              load: vi.fn(),
            })),
          },
        ],
      })),
    };
    const context = {
      document: {
        body,
        getSelection: vi.fn(() => ({ getRange: vi.fn(() => rangeMock) })),
        styles: { load: vi.fn(), items: [] },
      },
      host: { name: "Word", version: "16.0" },
      sync: vi.fn(),
    };
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(true);
    expect(rangeMock.insertText).toHaveBeenCalledWith("x", "Replace");
  });

  it("uses OOXML route when supportsInsertOoxml is true and range has insertOoxml", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsInsertOoxml: true,
    });
    const rangeMock = makeRangeMock("hello world");
    (rangeMock as unknown as { insertOoxml: ReturnType<typeof vi.fn> }).insertOoxml = vi.fn();
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
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(true);
    expect(
      (rangeMock as unknown as { insertOoxml: ReturnType<typeof vi.fn> }).insertOoxml,
    ).toHaveBeenCalled();
    expect(rangeMock.insertText).not.toHaveBeenCalled();
  });

  it("resolves InsertLocation from the Word global when Office.InsertLocation is absent", async () => {
    /*
     * Real Desktop Word exposes the enum on the `Word` global and does not
     * define `Office.InsertLocation` at runtime. Reading it directly threw
     * `TypeError: Cannot read properties of undefined (reading 'Replace')` on
     * every OOXML text change, so the adapter must resolve it from `Word`.
     */
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsInsertOoxml: true,
    });
    const rangeMock = makeRangeMock("hello world");
    (rangeMock as unknown as { insertOoxml: ReturnType<typeof vi.fn> }).insertOoxml = vi.fn();
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
    // Office carries break enums but NOT InsertLocation, matching Desktop Word.
    (globalThis as { Office?: unknown }).Office = {
      run: <T>(func: (ctx: unknown) => Promise<T>): Promise<T> => func(context),
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
    };
    (globalThis as { Word?: unknown }).Word = {
      InsertLocation: { before: 0, after: 1, start: 2, end: 3, replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(true);
    expect(
      (rangeMock as unknown as { insertOoxml: ReturnType<typeof vi.fn> }).insertOoxml,
    ).toHaveBeenCalledWith(expect.any(String), 4);
    expect(rangeMock.insertText).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to insertText when supportsInsertOoxml is true but range lacks insertOoxml", async () => {
    setStage01Passed(true, {
      ...FULL_CAPABILITIES,
      supportsInsertOoxml: true,
    });
    const { rangeMock } = installApplyMock();
    // rangeMock does NOT have insertOoxml
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
      roamingSettings: { get: vi.fn(), set: vi.fn(), saveAsync: vi.fn() },
      InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      BreakType: { NextParagraph: 0, LineBreak: 1, PageBreak: 2 },
      InsertLocation: { Before: 0, After: 1, Start: 2, End: 3, Replace: 4 },
    };
    const plan = createTestPlan("hash-123", "doc-1", [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        type: "insertText",
        range: { start: 0, end: 5 },
        payload: { text: "x" },
        rationale: "test",
        reversible: true,
        source: "deterministic",
        risk: "none",
        approvalRequired: false,
        dependsOn: [],
      },
    ]);

    const results = await applyChangePlan(plan, "hash-123");
    expect(results[0]?.applied).toBe(true);
    expect(rangeMock.insertText).toHaveBeenCalledWith("x", "Replace");
  });
});
