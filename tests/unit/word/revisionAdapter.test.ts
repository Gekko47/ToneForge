import { describe, it, expect } from "vitest";
import { validatePlanBeforeApply } from "../../../src/word/revisionAdapter";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";

describe("validatePlanBeforeApply", () => {
  it("rejects empty docHash", () => {
    expect(() => createChangePlan("", "doc-1", [])).toThrow();
  });

  it("rejects empty changes", () => {
    const plan = createChangePlan("hash-123", "doc-1", []);
    expect(validatePlanBeforeApply(plan).length).toBeGreaterThan(0);
  });

  it("accepts a valid plan", () => {
    const plan = createChangePlan("hash-123", "doc-1", [
      {
        id: crypto.randomUUID(),
        type: "insertText",
        range: { start: 0, end: 0 },
        payload: { text: "hello" },
        rationale: "test",
        reversible: true,
      },
    ]);
    expect(validatePlanBeforeApply(plan)).toEqual([]);
  });
});
