import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { logger } from "../../../src/shared/utils/logger";
import {
  applyChangePlan,
  validatePlanBeforeApply,
  setStage01Passed,
} from "../../../src/word/revisionAdapter";

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
    const results = await applyChangePlan(plan);
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("Stage 01");
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 01 gate not passed; refusing to apply ChangePlan",
      { planId: plan.id },
    );
  });

  it("flags empty plan via validatePlanBeforeApply", async () => {
    setStage01Passed(true);
    const plan = createChangePlan("hash-123", "doc-1", []);
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toContain("ChangePlan has no changes");
    // applyChangePlan on an empty plan produces no results (vacuous), so the
    // meaningful assertion is the validation message above.
    const results = await applyChangePlan(plan);
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
    setStage01Passed(true);
    const plan = createChangePlan("hash", "doc", []);
    (plan as { stale: boolean }).stale = true;
    const problems = validatePlanBeforeApply(plan);
    expect(problems).toContain("ChangePlan is stale; re-plan before applying");
    await applyChangePlan(plan);
    expect(logger.warn).toHaveBeenCalledWith(
      "ChangePlan validation failed",
      expect.objectContaining({ planId: plan.id }),
    );
  });

  it("passes validation for a well-formed plan", async () => {
    setStage01Passed(true);
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

  function installApplyMock() {
    const insertText = vi.fn();
    const getRange = vi.fn(() => ({ insertText, load: vi.fn() }));
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
    };
    return { insertText, getRange };
  }

  it("applies insertText to the range returned by body.getRange", async () => {
    setStage01Passed(true);
    const { insertText, getRange } = installApplyMock();
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

    const results = await applyChangePlan(plan);
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(true);
    expect(getRange).toHaveBeenCalledWith(0, 5);
    expect(insertText).toHaveBeenCalledWith("REPLACED", "Replace");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reports applied:false and error for unsupported applyStyle", async () => {
    setStage01Passed(true);
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

    const results = await applyChangePlan(plan);
    expect(results).toHaveLength(1);
    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.error).toContain("Style");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to apply change",
      expect.objectContaining({ changeId: plan.changes[0]?.id }),
    );
  });

  it("refuses to apply when currentDocHash mismatches", async () => {
    setStage01Passed(true);
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
