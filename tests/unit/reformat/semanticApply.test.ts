/**
 * The semantic rewrite's own change, and its own refusals.
 *
 * This module exists because the deterministic planner cannot express a prose
 * rewrite, and routing one through it produced a button that refused every
 * rewrite. So the behaviour that matters here is not "it applied" — that is the
 * adapter's, and shared with every other path — but the three properties that
 * make *this* change safe to write:
 *
 * 1. The range and the precondition come from the verified proposal, never from
 *    a recomputation. An AI-supplied offset is only usable because the rewrite
 *    engine resolved it against the acquired nodes and refused anything it
 *    could not; recomputing it here would throw that away.
 * 2. An un-actionable proposal is refused with a reason, not written.
 * 3. The approval requirement stands; pressing Apply is what satisfies it.
 */

import { describe, expect, it, vi } from "vitest";
import { buildSemanticRewriteChange } from "../../../src/reformat/semanticApply";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";
import { v4 as uuidv4 } from "uuid";

vi.mock("../../../src/reformat/orchestrator", () => ({
  applyReviewedPlan: vi.fn(async () => ({
    results: [],
    tracking: { managed: true },
    stale: false,
    applied: true,
    verified: true,
  })),
}));

function proposal(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "semantic",
    category: "semantic.rewrite",
    range: { start: 120, end: 184, unit: "character" },
    message: "Tightened the sentence.",
    severity: "info",
    evidence: "The original paragraph as the model quoted it.",
    ruleId: "semantic:rewrite",
    confidence: 0.9,
    actionable: true,
    nodeIds: ["node-7"],
    source: "ai",
    reversible: true,
    risk: "medium",
    status: "new",
    actual: "The original paragraph as the model quoted it.",
    expected: "The tightened paragraph the model proposed.",
    explanation: "Tightened the sentence.",
    ...overrides,
  });
}

describe("buildSemanticRewriteChange", () => {
  it("replaces exactly the span the engine verified", () => {
    const change = buildSemanticRewriteChange(proposal());

    expect(change.type).toBe("replaceText");
    // Straight from the proposal. A recomputed range would look plausible and
    // could point at a different sentence entirely.
    expect(change.range).toMatchObject({ start: 120, end: 184, unit: "character" });
    expect(change.payload).toEqual({ text: "The tightened paragraph the model proposed." });
    // Inside the range, not beside it: `ChangeSchema` has no top-level target
    // field, so a sibling key would be stripped rather than rejected, and the
    // anchored node would silently never reach the plan.
    expect(change.range.target).toEqual({ kind: "paragraph", index: 0, nodeId: "node-7" });
  });

  it("carries the original text as an exact precondition", () => {
    const change = buildSemanticRewriteChange(proposal());

    // The adapter refuses the write if the document moved underneath. Without
    // this, a user who edits the paragraph, comes back and presses Apply gets
    // the rewrite written into whatever now occupies those offsets.
    expect(change.precondition).toEqual({
      kind: "text",
      expectedText: "The original paragraph as the model quoted it.",
    });
  });

  it("keeps the approval requirement and records it as satisfied", () => {
    const change = buildSemanticRewriteChange(proposal());

    // Not removed — satisfied. The button is the approval.
    expect(change.approvalRequired).toBe(true);
    expect(change.approvalState).toBe("approved");
  });

  it("falls back to the evidence when the proposal carries no actual", () => {
    // Older proposals recorded the quote only. The precondition must still
    // describe the real text or the write is refused for the wrong reason.
    const withoutActual = proposal({ actual: undefined });
    const change = buildSemanticRewriteChange(withoutActual);

    expect(change.precondition).toEqual({
      kind: "text",
      expectedText: withoutActual.evidence,
    });
  });

  it("refuses a proposal that carries no text to write", () => {
    /*
     * Built by hand rather than by passing `undefined`.
     *
     * `exactOptionalPropertyTypes` is on, so an optional property cannot be set
     * to `undefined` — which is correct, and means the only way to express
     * "this proposal genuinely has none of these" is a literal without them.
     */
    const { actual: _a, evidence: _e, expected: _x, ...rest } = proposal();
    const empty = { ...rest } as Finding;
    expect(() => buildSemanticRewriteChange(empty)).toThrow(/no text to replace/i);
  });
});

describe("applySemanticRewrite", () => {
  it("writes an actionable proposal through the shared mutation path", async () => {
    const { applySemanticRewrite } = await import("../../../src/reformat/semanticApply");
    const { applyReviewedPlan } = await import("../../../src/reformat/orchestrator");

    const result = await applySemanticRewrite({
      finding: proposal(),
      documentId: "doc-1",
      currentDocHash: "hash-now",
    });

    expect(applyReviewedPlan).toHaveBeenCalledTimes(1);
    // Schema version 2, because the change carries the exact precondition that
    // version requires. A version 1 plan parses and is then refused by the
    // adapter, which reads as a host problem rather than a missing contract.
    const options = (applyReviewedPlan as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as { plan: { schemaVersion: number; changes: unknown[] } };
    expect(options.plan.schemaVersion).toBe(2);
    expect(options.plan.changes).toHaveLength(1);
    expect(result.verified).toBe(true);
    expect(result.refusal).toBeNull();
  });

  it("refuses an un-actionable proposal and returns the reason", async () => {
    const { applySemanticRewrite } = await import("../../../src/reformat/semanticApply");
    const { applyReviewedPlan } = await import("../../../src/reformat/orchestrator");
    (applyReviewedPlan as unknown as { mock: { calls: unknown[] } }).mock.calls.length = 0;

    const result = await applySemanticRewrite({
      finding: proposal({
        actionable: false,
        advisoryReason: "The anchor could not be located.",
      }),
      documentId: "doc-1",
      currentDocHash: "hash-now",
    });

    // Never reaches the writer. The caller hides the control, so this is the
    // second refusal rather than the first — but it must not be the only one.
    expect(applyReviewedPlan).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.refusal).toBe("The anchor could not be located.");
  });
});
