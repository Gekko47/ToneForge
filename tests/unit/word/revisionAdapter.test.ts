import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChangePlan,
  setStage01Passed,
  validatePlanBeforeApply,
} from "../../../src/word/revisionAdapter";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import type { Change } from "../../../src/core/domain/Change";

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
  });

  afterEach(() => {
    setOffice(defaultOfficeMock());
    setStage01Passed(false);
  });

  describe("applyChangePlan", () => {
    it("refuses to apply when Stage 01 gate is not passed", async () => {
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan);

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("Stage 01");
    });

    it("refuses to apply when plan has no changes", async () => {
      setStage01Passed(true);
      const plan = createChangePlan("hash1", "doc1", []);

      const results = await applyChangePlan(plan);

      expect(results).toHaveLength(0);
    });

    it("refuses to apply when document hash mismatches", async () => {
      setStage01Passed(true);
      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan, "different-hash");

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("hash mismatch");
    });

    it("applies changes when gate is passed and hash matches", async () => {
      setStage01Passed(true);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn(() => ({
                  insertText: vi.fn(),
                })),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createChangePlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan, "hash1");

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(true);
    });

    it("isolates per-change failures", async () => {
      setStage01Passed(true);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn((start: number, length: number) => {
                  if (start === 0 && length === 5) {
                    return { insertText: vi.fn() };
                  }
                  throw new Error("Range not found");
                }),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createChangePlan("hash1", "doc1", [
        makeChange({ id: "550e8400-e29b-41d4-a716-446655440001", range: { start: 0, end: 5 } }),
        makeChange({ id: "550e8400-e29b-41d4-a716-446655440002", range: { start: 100, end: 200 } }),
      ]);

      const results = await applyChangePlan(plan, "hash1");

      expect(results).toHaveLength(2);
      expect(results[0]?.applied).toBe(true);
      expect(results[1]?.applied).toBe(false);
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
