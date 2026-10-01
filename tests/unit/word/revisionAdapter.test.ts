import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSource } from "../../../src/core/domain/Change";

import {
  applyChangePlan,
  setStage01Passed,
  validatePlanBeforeApply,
} from "../../../src/word/revisionAdapter";
import { createTestPlan } from "../../fixtures/changePlans";
import type { Change } from "../../../src/core/domain/Change";
import type { WordCapabilities } from "../../../src/word/capabilityProbe";
import { logger } from "../../../src/shared/utils/logger";

function setOffice(office: unknown): void {
  (globalThis as { Office?: unknown }).Office = office;
}

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

function makeRangeMock() {
  return {
    text: "",
    insertText: vi.fn(function (this: unknown) {
      return this;
    }),
    insertBreak: vi.fn(),
    insertParagraph: vi.fn(() => ({ format: {}, load: vi.fn() })),
    paragraphs: { load: vi.fn(), items: [] },
    font: { name: "", size: 0, color: "", load: vi.fn(), set: vi.fn(), reset: vi.fn() },
    paragraphFormat: { set: vi.fn() },
    listFormat: { set: vi.fn() },
    style: "",
    set: vi.fn(function (this: unknown) {
      return this;
    }),
    load: vi.fn(),
  };
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
            getRange: vi.fn(() => makeRangeMock()),
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
    source: "deterministic" as ChangeSource,
    risk: "none" as const,
    approvalRequired: false,
    approvalState: "notRequired",
    dependsOn: [],
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
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan, "hash1");

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("Stage 01");
      expect(logger.warn).toHaveBeenCalledWith(
        "Stage 01 gate not passed; refusing to apply ChangePlan",
        { planId: plan.id },
      );
    });

    it("logs validation failure when plan is invalid", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);
      const plan = createTestPlan("hash1", "doc1", []);

      await applyChangePlan(plan, "hash1");

      expect(logger.warn).toHaveBeenCalledWith(
        "ChangePlan validation failed",
        expect.objectContaining({ planId: plan.id }),
      );
    });

    it("refuses when currentDocHash is missing", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan, "");

      expect(results).toHaveLength(1);
      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("currentDocHash is required");
    });

    it("logs hash mismatch when currentDocHash differs", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "different-hash");

      expect(logger.warn).toHaveBeenCalledWith(
        "Document hash mismatch; refusing to apply ChangePlan",
        expect.objectContaining({ planId: plan.id, expected: "hash1", actual: "different-hash" }),
      );
    });

    it("logs per-change failures", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);

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

      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "hash1");

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to apply change",
        expect.objectContaining({ changeId: plan.changes[0]?.id }),
      );
    });

    it("logs nothing on successful apply", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn(() => makeRangeMock()),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      await applyChangePlan(plan, "hash1");

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("resolves offsets via body.getRange(Whole) plus range.set", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);
      const rangeMock = makeRangeMock();
      const getRange = vi.fn(() => rangeMock);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: { text: "hello world", load: vi.fn(), getRange },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      const results = await applyChangePlan(plan, "hash1");

      expect(results[0]?.applied).toBe(true);
      expect(getRange).toHaveBeenCalledWith("Whole");
      expect(rangeMock.set).toHaveBeenCalledWith({ start: 0, end: 5 });
    });

    it("reports out-of-bounds ranges as per-change failures", async () => {
      setStage01Passed(true, FULL_CAPABILITIES);

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hi",
                load: vi.fn(),
                getRange: vi.fn(() => makeRangeMock()),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createTestPlan(
        "hash1",
        "doc1",
        [makeChange({ range: { start: 0, end: 100 } })],
        "hi",
      );

      const results = await applyChangePlan(plan, "hash1");

      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("out of bounds");
    });

    it("requires a capability snapshot before text mutations", async () => {
      // Gate passed without a snapshot is impossible via the public setter,
      // so simulate the legacy gap by passing undefined capabilities through
      // a direct false-then-true transition is blocked; instead verify the
      // setter itself throws.
      expect(() => setStage01Passed(true)).toThrow("requires a verified WordCapabilities snapshot");
    });

    it("blocks insertText when the host lacks support", async () => {
      setStage01Passed(true, { ...FULL_CAPABILITIES, supportsInsertText: false });

      setOffice({
        run: async (func: (context: unknown) => Promise<unknown>) =>
          func({
            document: {
              body: {
                text: "hello world",
                load: vi.fn(),
                getRange: vi.fn(() => makeRangeMock()),
              },
            },
            sync: vi.fn(),
          }),
        InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
      });

      const plan = createTestPlan("hash1", "doc1", [
        makeChange({ type: "insertText", payload: { text: "x" } }),
      ]);

      const results = await applyChangePlan(plan, "hash1");

      expect(results[0]?.applied).toBe(false);
      expect(results[0]?.error).toContain("not supported");
    });
  });

  describe("validatePlanBeforeApply", () => {
    it("requires the current governance revision for a governed plan", () => {
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);
      plan.governancePolicyRevision = 2;

      expect(validatePlanBeforeApply(plan)).toContain(
        "Current governance policy revision is required to apply a governed plan",
      );
    });

    it("rejects a governed plan when the current policy revision changed", () => {
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);
      plan.governancePolicyRevision = 2;

      expect(validatePlanBeforeApply(plan, false, undefined, 3)).toContain(
        "Governance policy revision mismatch: plan 2, current 3",
      );
    });

    it("returns empty array for valid plan", () => {
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toHaveLength(0);
    });

    it("reports missing docHash", () => {
      const plan = createTestPlan("hash1", "doc1", []);
      (plan as { docHash: string }).docHash = "";

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan.docHash is required");
    });

    it("reports empty changes", () => {
      const plan = createTestPlan("hash1", "doc1", []);

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan has no changes");
    });

    it("reports stale plan", () => {
      const plan = createTestPlan("hash1", "doc1", [makeChange()]);
      plan.stale = true;

      const problems = validatePlanBeforeApply(plan);

      expect(problems).toContain("ChangePlan is stale; re-plan before applying");
    });

    it("reports invalid ranges", () => {
      // Bypass createChangePlan: the Zod schema already rejects start > end,
      // so construct the plan object directly to exercise the adapter's
      // own pre-flight range check.
      const base = createTestPlan("hash1", "doc1", [makeChange()]);
      const plan = {
        ...base,
        changes: [{ ...makeChange(), range: { start: 5, end: 2 } }],
      };

      const problems = validatePlanBeforeApply(plan);

      expect(problems.some((p) => p.includes("invalid range"))).toBe(true);
    });

    it("accepts an empty reset-character-formatting payload", () => {
      const base = createTestPlan("hash1", "doc1", [makeChange()]);
      const change = base.changes[0];
      if (!change) throw new Error("Expected fixture change");
      const plan = {
        ...base,
        changes: [{ ...change, type: "resetCharacterFormatting" as const, payload: {} }],
      };

      expect(validatePlanBeforeApply(plan)).toHaveLength(0);
    });

    it("rejects malformed setListLevel payloads independently of reset formatting", () => {
      const base = createTestPlan("hash1", "doc1", [makeChange()]);
      const plan = {
        ...base,
        changes: [{ ...makeChange(), type: "setListLevel" as const, payload: { level: -1 } }],
      };

      expect(
        validatePlanBeforeApply(plan).some((problem) =>
          problem.includes("integer payload.level from 0 through 8"),
        ),
      ).toBe(true);
    });

    it("reports missing insertText payload", () => {
      // Bypass createChangePlan: the Zod schema already rejects an empty
      // insertText payload, so construct directly to exercise the adapter's
      // own pre-flight payload check.
      const base = createTestPlan("hash1", "doc1", [makeChange()]);
      const plan = {
        ...base,
        changes: [{ ...makeChange(), type: "insertText" as const, payload: {} }],
      };

      const problems = validatePlanBeforeApply(plan);

      expect(problems.some((p) => p.includes("non-empty payload.text"))).toBe(true);
    });
  });
});

/**
 * D4's behavioural proof: neither check may be switched off by leaving a field
 * out.
 *
 * The two checks used to read `finding.nodeIds` and `finding.actual`/`expected`
 * through `change.findingId`, so a change with no `findingId` — which is every
 * semantic change on the new contract — skipped both, and the write proceeded.
 * These cases carry **no `Finding` anywhere in the plan** on purpose: that is the
 * only way they can fail if the checks ever go back to reading one.
 */
describe("the merge point's two checks, with no Finding in the plan", () => {
  function node(overrides: Record<string, unknown> = {}) {
    return {
      nodeId: "word-paragraph-p1",
      type: "paragraph",
      text: "The pour completed on 3 March 2026.",
      sourcePath: "body/paragraph/0",
      sourceRange: {
        nodeId: "word-paragraph-p1",
        paragraphIndex: 0,
        structuralPath: "body/paragraph/0",
        startOffset: 0,
        endOffset: 33,
      },
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    setStage01Passed(false);
    setOffice(defaultOfficeMock());
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  it("refuses a protected node reached only by the change's span", () => {
    const plan = createTestPlan("hash1", "doc1", [
      makeChange({
        range: { start: 0, end: 33 },
        precondition: { kind: "text", expectedText: "The pour completed on 3 March 2026." },
        payload: { text: "The pour finished on 3 March 2026." },
      }),
    ]);

    const problems = validatePlanBeforeApply(plan, false, [node({ editable: false })]);

    expect(problems.some((problem) => problem.includes("targets protected range"))).toBe(true);
    expect(plan.findings).toHaveLength(0);
    expect(plan.changes[0]?.findingId).toBeUndefined();
  });

  it("refuses a protected node named by the change's own target", () => {
    const plan = createTestPlan("hash1", "doc1", [
      makeChange({
        range: {
          start: 0,
          end: 1,
          unit: "paragraph",
          target: { kind: "paragraph", index: 0, nodeId: "word-paragraph-p1" },
        },
        precondition: { kind: "text", expectedText: "The pour completed on 3 March 2026." },
        payload: { text: "The pour finished on 3 March 2026." },
      }),
    ]);

    const problems = validatePlanBeforeApply(plan, false, [node({ editable: false })]);

    expect(problems.some((problem) => problem.includes("targets protected range"))).toBe(true);
  });

  it("refuses a change whose precondition drops a preserved literal", () => {
    const plan = createTestPlan("hash1", "doc1", [
      makeChange({
        range: { start: 0, end: 33 },
        precondition: { kind: "text", expectedText: "Completed on 3 March 2026 for £1,240,000." },
        payload: { text: "Completed for the client." },
      }),
    ]);

    const problems = validatePlanBeforeApply(plan);

    expect(problems.some((problem) => problem.includes("would remove preserved content"))).toBe(
      true,
    );
    expect(plan.findings).toHaveLength(0);
  });

  it("still reads the finding when one is present, so the deterministic path is unchanged", () => {
    const plan = createTestPlan("hash1", "doc1", [
      makeChange({
        range: { start: 900, end: 933 },
        findingId: "3f1c8f2e-6f2a-4a3f-9a5e-2f0a1b2c3d4e",
        precondition: { kind: "text", expectedText: "The pour completed on 3 March 2026." },
        payload: { text: "The pour finished on 3 March 2026." },
      }),
    ]);
    // The span resolves to nothing (offsets 900–933 are outside the node), so this
    // case only passes if the finding's own node ids are still consulted.
    (plan as { findings?: unknown[] }).findings = [
      { id: "3f1c8f2e-6f2a-4a3f-9a5e-2f0a1b2c3d4e", nodeIds: ["word-paragraph-p1"] },
    ] as never;

    const problems = validatePlanBeforeApply(plan, false, [node({ editable: false })]);

    expect(problems.some((problem) => problem.includes("targets protected range"))).toBe(true);
  });
});
