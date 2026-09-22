import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyChangePlan,
  setStage01Passed,
  validatePlanBeforeApply,
} from "../../../src/word/revisionAdapter";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import type { Change } from "../../../src/core/domain/Change";
import { logger } from "../../../src/shared/utils/logger";

function setOffice(office: unknown): void {
  (globalThis as { Office?: unknown }).Office = office;
}

function defaultOfficeMock(): unknown {
  return {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
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
  };
}

function makeChange(overrides: Partial<Change> = {}): Change {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "replaceText",
    range: { start: 0, end: 5 },
    payload: { text: "hello" },
    rationale: "",
    reversible: true,
    ...overrides,
  };
}

describe("revisionAdapter", () => {
  beforeEach(() => {
    setStage01Passed(false);
    setOffice(defaultOfficeMock());
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setOffice(defaultOfficeMock());
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  describe("applyChangePlan", () => {
    it("refuses to apply when Stage 01 gate is not passed", async () => {
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan);

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("Stage 01");
      expect(logger.warn).toHaveBeenCalledWith(
        "Stage 01 gate not passed; refusing to apply ChangePlan",
        { planId: plan.id },
      );
    });

    it("logs validation failure when plan is invalid", async () => {
      setStage01Passed(true);
      const plan = createChangePlan("hash1", "doc1", []);

      await applyChangePlan(plan);

      expect(logger.warn).toHaveBeenCalledWith(
        "ChangePlan validation failed",
        expect.objectContaining({ planId: plan.id }),
      );
    });

    it("logs hash mismatch when currentDocHash differs", async () => {
      setStage01Passed(true);
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "different-hash");

      expect(logger.warn).toHaveBeenCalledWith(
        "Document hash mismatch; refusing to apply ChangePlan",
        expect.objectContaining({ planId: plan.id, expected: "hash1", actual: "different-hash" }),
      );
    });

    it("logs per-change failures", async () => {
      setStage01Passed(true);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn(() => {
                  throw new Error("Range not found");
                }),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "hash1");

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to apply change",
        expect.objectContaining({ changeId: plan.changes[0]?.id }),
      );
    });

    it("logs nothing on successful apply", async () => {
      setStage01Passed(true);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn(() => ({ insertText: vi.fn() })),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "hash1");

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("validatePlanBeforeApply", () => {
    it("returns empty array for valid plan", () => {
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toHaveLength(0);
    });

    it("reports missing docHash", () => {
      const plan = createChangePlan("hash1", "doc1", []);
      (plan as { docHash: string }).docHash = "";

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan.docHash is required");
    });

    it("reports empty changes", () => {
      const plan = createChangePlan("hash1", "doc1", []);

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan has no changes");
    });

    it("reports stale plan", () => {
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);
      plan.stale = true;

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan is stale; re-plan before applying");
    });
  });
});
