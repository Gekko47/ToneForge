import { describe, expect, it } from "vitest";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { isStale, markStale } from "../../../src/changes/staleGuard";

function freshPlan() {
  return createChangePlan("hash-before", "doc-1", [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "insertText",
      range: { start: 0, end: 0 },
      payload: { text: "new" },
      rationale: "test",
      reversible: true,
    },
  ]);
}

describe("staleGuard", () => {
  it("considers an unavailable current hash fresh", () => {
    const plan = freshPlan();

    expect(isStale(plan, undefined)).toBe(false);
    expect(markStale(plan, undefined)).toBe(plan);
  });

  it("considers an equal current hash fresh", () => {
    const plan = freshPlan();
    const marked = markStale(plan, "hash-before");

    expect(isStale(plan, "hash-before")).toBe(false);
    expect(marked.stale).toBe(false);
    expect(marked).not.toBe(plan);
  });

  it("marks a differing current hash stale", () => {
    const plan = freshPlan();
    const marked = markStale(plan, "hash-after");

    expect(isStale(plan, "hash-after")).toBe(true);
    expect(marked.stale).toBe(true);
    expect(marked.docHash).toBe("hash-before");
    expect(marked.changes).toBe(plan.changes);
  });

  it("treats an explicitly empty current hash as a mismatch", () => {
    const plan = freshPlan();

    expect(isStale(plan, "")).toBe(true);
    expect(markStale(plan, "").stale).toBe(true);
  });
});
