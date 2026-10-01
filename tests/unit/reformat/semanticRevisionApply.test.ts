/**
 * The approved-revision apply path (plan P6, D4).
 *
 * Three things are being pinned here, and each is a way the old path could go
 * wrong:
 *
 * 1. **No `Finding` anywhere.** The plan carries no findings and the change no
 *    `findingId`, so the adapter's protection and preservation checks have to work
 *    from the `Change` alone. The adapter's own proof of that lives in
 *    `tests/unit/word/revisionAdapter.test.ts`; this file proves the semantic path
 *    actually produces such a plan rather than smuggling a finding back in.
 * 2. **Preservation is re-run at write time**, not trusted from the proposal. The
 *    user approved a revision; whether that revision is still safe is a separate
 *    question, and a proposal object that has been sitting in component state
 *    since the model call is not evidence about the document.
 * 3. **The write path is chosen before the write.** A whole paragraph goes through
 *    the path every host has; a partial range needs `Range.set`, and a host without
 *    it is refused with the remedy rather than allowed to throw mid-apply.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSemanticRevisionChange } from "../../../src/reformat/semanticApply";
import { hashText } from "../../../src/shared/utils/text";
import type { SemanticSelectionAnchor } from "../../../src/core/domain/SemanticReviewSession";
import type { ApprovedSemanticRevision } from "../../../src/reformat/semanticApply";
import type { DocumentNode } from "../../../src/core/domain/DocumentSnapshot";

const mocks = vi.hoisted(() => ({
  applyReviewedPlan: vi.fn(async () => ({
    results: [{ changeId: "c1", applied: true }],
    tracking: { managed: true },
    stale: false,
    applied: true,
    verified: true,
    outcome: {
      changes: [{ changeId: "c1", verified: true, error: "" }],
      verifiedCount: 1,
      unverifiedCount: 0,
      failedCount: 0,
      remainingFindings: null,
    },
  })),
  getStructuredSnapshot: vi.fn(async () => snapshot()),
  supportsRangedReplacement: vi.fn(async () => true),
}));

vi.mock("../../../src/reformat/orchestrator", () => ({
  applyReviewedPlan: mocks.applyReviewedPlan,
}));

vi.mock("../../../src/word/documentReader", () => ({
  getStructuredSnapshot: mocks.getStructuredSnapshot,
}));

vi.mock("../../../src/word/rangeResolution", async (importOriginal) => {
  // Only one member is replaced, so the real module is spread rather than
  // restated. Typed as a plain record because `importOriginal` is generic and an
  // `import()` type annotation is forbidden by the lint rules.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, supportsRangedReplacement: mocks.supportsRangedReplacement };
});

const ORIGINAL = "The pour completed on 3 March 2026 and the cube was cured for 28 days.";
const REVISED = "The pour finished on 3 March 2026 and the cube cured for 28 days.";

function anchor(overrides: Partial<SemanticSelectionAnchor> = {}): SemanticSelectionAnchor {
  return {
    documentId: "doc-1",
    nodeIds: ["p-1"],
    startOffset: 0,
    endOffset: ORIGINAL.length,
    selectedText: ORIGINAL,
    selectionHash: hashText(ORIGINAL),
    capturedAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function paragraphNode(): DocumentNode {
  return {
    nodeId: "word-paragraph-p-1",
    type: "paragraph",
    text: ORIGINAL,
    sourcePath: "body/paragraph/0",
    sourceRange: {
      nodeId: "word-paragraph-p-1",
      paragraphIndex: 0,
      structuralPath: "body/paragraph/0",
      startOffset: 0,
      endOffset: ORIGINAL.length,
    },
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
  } as DocumentNode;
}

function snapshot() {
  return {
    documentId: "doc-1",
    versionToken: "2026-10-01T09:00:00.000Z:hash",
    contentHash: "hash",
    structuralHash: "structural",
    capturedAt: "2026-10-01T09:00:00.000Z",
    fullText: ORIGINAL,
    analysisText: ORIGINAL,
    analysisStart: 0,
    analysisEnd: ORIGINAL.length,
    analysisTruncated: false,
    nodes: [paragraphNode()],
  };
}

function revision(overrides: Partial<ApprovedSemanticRevision> = {}): ApprovedSemanticRevision {
  return {
    original: ORIGINAL,
    revised: REVISED,
    anchor: anchor(),
    coversWholeParagraph: true,
    rationale: "The sentence carries more than one main clause.",
    actionable: true,
    ...overrides,
  };
}

/**
 * The plan the shared path was actually handed.
 *
 * Read through a cast because the hoisted mock's call tuple is inferred as
 * empty; the assertion is on what the writer received, which is the only thing
 * the D4 claim rests on.
 */
function submittedPlan(): {
  schemaVersion: number;
  docHash: string;
  baseDocId: string;
  findings?: unknown[];
  changes: { range: unknown; findingId?: string }[];
} {
  const calls = mocks.applyReviewedPlan.mock.calls as unknown as [{ plan: unknown }][];
  return calls[0]![0].plan as never;
}

beforeEach(() => {
  mocks.applyReviewedPlan.mockClear();
  mocks.getStructuredSnapshot.mockClear();
  mocks.supportsRangedReplacement.mockClear();
  mocks.supportsRangedReplacement.mockResolvedValue(true);
});

describe("buildSemanticRevisionChange", () => {
  it("writes exactly the span and text the user approved", () => {
    const change = buildSemanticRevisionChange(revision(), {
      range: { start: 0, end: 1, unit: "paragraph" },
    });

    expect(change.type).toBe("replaceText");
    expect(change.payload).toEqual({ text: REVISED });
    expect(change.range).toMatchObject({ start: 0, end: 1, unit: "paragraph" });
  });

  it("carries the approved text as an exact precondition", () => {
    const change = buildSemanticRevisionChange(revision(), {
      range: { start: 0, end: ORIGINAL.length, unit: "character" },
    });

    expect(change.precondition).toEqual({ kind: "text", expectedText: ORIGINAL });
  });

  it("carries no Finding provenance at all", () => {
    const change = buildSemanticRevisionChange(revision(), {
      range: { start: 0, end: 1, unit: "paragraph" },
    });

    // The absence is the point: it is what makes this plan a live test of the
    // adapter's two Change-keyed checks.
    expect(change.findingId).toBeUndefined();
    expect(change.source).toBe("ai");
  });

  it("keeps the approval requirement and records it as satisfied", () => {
    const change = buildSemanticRevisionChange(revision(), {
      range: { start: 0, end: 1, unit: "paragraph" },
    });

    expect(change.approvalRequired).toBe(true);
    expect(change.approvalState).toBe("approved");
  });
});

describe("applyApprovedSemanticRevision", () => {
  it("writes one change through the shared path, with no Finding in the plan", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({ revision: revision() });

    expect(result.refusal).toBeNull();
    expect(result.plan.changes).toHaveLength(1);
    expect(result.plan.findings).toHaveLength(0);
    expect(result.plan.schemaVersion).toBe(2);
    expect(result.plan.changes[0]?.findingId).toBeUndefined();
    const plan = submittedPlan();
    expect(plan.docHash).toBe("hash");
    expect(plan.baseDocId).toBe("doc-1");
  });

  it("re-runs preservation at write time rather than trusting the proposal", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");

    // Actionable, because that flag was set when the user reviewed it — and the
    // text has moved a date since. Only a check run now can catch that.
    const result = await applyApprovedSemanticRevision({
      revision: revision({
        revised: "The pour finished on 18 July 2026 and the cube cured for 28 days.",
      }),
    });

    expect(mocks.applyReviewedPlan).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.refusal).toMatch(/date/i);
    expect(result.preservation.pass).toBe(false);
  });

  it("refuses a revision the gates already refused, without reading the document", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");

    const result = await applyApprovedSemanticRevision({
      revision: revision({ actionable: false, refusalReason: "No provider is configured." }),
    });

    expect(mocks.getStructuredSnapshot).not.toHaveBeenCalled();
    expect(result.refusal).toBe("No provider is configured.");
    expect(result.plan.changes).toHaveLength(0);
    // Zero counts, not failures: nothing was attempted.
    expect(result.outcome).toMatchObject({ verifiedCount: 0, failedCount: 0 });
  });

  it("prefers the paragraph path for a whole paragraph, without asking the host", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");

    await applyApprovedSemanticRevision({ revision: revision() });

    // The whole-paragraph path needs only `Paragraph.getRange("Whole")`, so asking
    // a host that cannot narrow a range is a question we can skip entirely.
    expect(mocks.supportsRangedReplacement).not.toHaveBeenCalled();
    // The node id is the one the acquisition builds from the host's
    // `uniqueLocalId`, not the raw id the anchor carries — the adapter compares
    // against document nodes.
    expect(submittedPlan().changes[0]?.range).toEqual({
      start: 0,
      end: 1,
      unit: "paragraph",
      target: { kind: "paragraph", index: 0, nodeId: "word-paragraph-p-1" },
    });
  });

  it("falls back to the character path for a partial selection on a capable host", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");

    await applyApprovedSemanticRevision({
      revision: revision({
        coversWholeParagraph: false,
        anchor: anchor({ nodeIds: [], startOffset: 12, endOffset: 40 }),
      }),
    });

    expect(mocks.supportsRangedReplacement).toHaveBeenCalledTimes(1);
    expect(submittedPlan().changes[0]?.range).toEqual({ start: 12, end: 40, unit: "character" });
  });

  it("refuses a partial selection on a host without Range.set, and names the remedy", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");
    mocks.supportsRangedReplacement.mockResolvedValue(false);

    const result = await applyApprovedSemanticRevision({
      revision: revision({
        coversWholeParagraph: false,
        anchor: anchor({ nodeIds: [], startOffset: 12, endOffset: 40 }),
      }),
    });

    expect(mocks.applyReviewedPlan).not.toHaveBeenCalled();
    expect(result.refusal).toMatch(/whole paragraph/i);
  });

  it("does not trust a whole-paragraph claim the snapshot cannot corroborate", async () => {
    const { applyApprovedSemanticRevision } = await import("../../../src/reformat/semanticApply");
    // The anchor's offsets no longer describe the paragraph in the document, so
    // the paragraph path would write to the wrong place. The character path is
    // checked against the host instead.
    mocks.getStructuredSnapshot.mockResolvedValue({
      ...snapshot(),
      nodes: [
        { ...paragraphNode(), sourceRange: { ...paragraphNode().sourceRange!, startOffset: 5 } },
      ],
    });

    await applyApprovedSemanticRevision({ revision: revision() });

    expect(mocks.supportsRangedReplacement).toHaveBeenCalledTimes(1);
    expect((submittedPlan().changes[0]?.range as { unit: string } | undefined)?.unit).toBe(
      "character",
    );
  });
});
