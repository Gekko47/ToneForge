import { describe, expect, it, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { createGovernanceProfile } from "../../../../src/core/domain/GovernanceProfile";
import {
  DocumentNodeSchema,
  type DocumentNode,
  type DocumentSnapshot,
} from "../../../../src/core/domain/DocumentSnapshot";
import { ReviewRequestSchema } from "../../../../src/core/domain/ReviewRequest";
import { buildMinimalContext } from "../../../../src/ai/review/contextMinimizer";
import { buildSpotPrompt } from "../../../../src/ai/prompts/spotPrompts";
import { reviewSpot } from "../../../../src/ai/review/spotReview";
import { partitionReviewBatches } from "../../../../src/ai/review/batcher";
import { reviewEntireDocument } from "../../../../src/ai/review/documentEditorialReview";
import { toRevisionsCsv } from "../../../../src/changes/exportAdapter";
import { MockAdapter } from "../../../../src/ai/providers/mockAdapter";
import { withSemanticHelpers } from "../../../../src/ai/providers/LlmProvider";
import { buildCoverage } from "../../../../src/analysis/coverage";

function node(id: string, text: string, protectedNode = false): DocumentNode {
  return DocumentNodeSchema.parse({
    nodeId: id,
    type: "paragraph",
    text,
    sourcePath: `body/paragraph/${id}`,
    editable: !protectedNode,
    includedInGovernance: true,
    includedInAIReview: true,
    ...(protectedNode ? { protectionReason: "quote" } : {}),
  });
}

function rangedNode(id: string, text: string, startOffset: number): DocumentNode {
  return DocumentNodeSchema.parse({
    nodeId: id,
    type: "paragraph",
    text,
    sourcePath: `body/paragraph/${id}`,
    sourceRange: {
      nodeId: id,
      startOffset,
      endOffset: startOffset + text.length,
      structuralPath: `body/paragraph/${id}`,
    },
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
  });
}

function request(
  text: string,
  operation: "spot_selection" | "spot_paragraph" | "document_editorial_review" = "spot_selection",
) {
  const profile = createEmptyProfile("Test");
  return {
    request: ReviewRequestSchema.parse({
      id: uuidv4(),
      operation,
      documentId: "doc",
      documentVersion: "version-1",
      targetNodeIds: ["aaaa1111"],
      text,
      profileId: profile.id,
      profileRevision: 1,
      privacyPolicyId: "test-policy",
    }),
    profile: createGovernanceProfile(profile),
  };
}

describe("AI review contracts and pipeline", () => {
  it("rejects the reserved Phase H operation", () => {
    expect(() => request("text", "document_editorial_review").request).not.toThrow();
    expect(() =>
      ReviewRequestSchema.parse({
        ...request("text").request,
        id: uuidv4(),
        operation: "future_document_consistency_review",
      }),
    ).toThrow(/reserved for Phase H/);
  });

  it("requires explicit raw-text opt-in", () => {
    expect(() => buildSpotPrompt("spot_selection", "text", { includeRawText: false })).toThrow(
      /includeRawText/,
    );
    expect(buildSpotPrompt("spot_selection", "text", { includeRawText: true })).toContain("text");
  });

  it("requires scope-specific consent before spot provider access", async () => {
    const base = request("text");
    const adapter = new MockAdapter();
    const complete = vi.spyOn(adapter, "complete");

    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        // @ts-expect-error verifying the runtime gate as well as the contract
        consent: { spotReview: false },
        registry: adapter,
        nodes: [node("aaaa1111", "text")],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/explicit raw-text consent/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps target accounting truthful at a truncation boundary", () => {
    const result = buildMinimalContext({
      selectedText: "editable",
      nodes: [node("aaaa1111", "editable")],
      targetNodeIds: ["aaaa1111"],
      charBudget: 7,
    });
    expect(result.requestedNodeIds).toEqual(["aaaa1111"]);
    expect(result.excludedNodeIds).toEqual([]);
    expect(result.includedNodeIds).toEqual([]);
    expect(result.truncatedNodeIds).toEqual(["aaaa1111"]);
    expect(result.text).toBe("editabl");
    expect(result.truncated).toBe(true);
  });

  it("includes a node only when all selected text is within the budget", () => {
    const result = buildMinimalContext({
      selectedText: "editable",
      nodes: [node("aaaa1111", "editable")],
      targetNodeIds: ["aaaa1111"],
      charBudget: 8,
    });
    expect(result.includedNodeIds).toEqual(["aaaa1111"]);
    expect(result.truncatedNodeIds).toEqual([]);
    expect(result.text).toBe("editable");
    expect(result.truncated).toBe(false);
  });

  it("validates AI output into findings and a normal ChangePlan", async () => {
    const base = request("The quick brown fox");
    const adapter = withSemanticHelpers(
      new MockAdapter({
        defaultResponse: JSON.stringify({
          findings: [
            {
              category: "editorial.clarity",
              severity: "warning",
              risk: "low",
              confidence: 0.8,
              actual: "quick brown",
              expected: "quick, brown",
              explanation: "Add a comma for clarity.",
              start: 4,
              end: 15,
            },
          ],
        }),
      }),
    );
    const result = await reviewSpot({
      ...base,
      includeRawText: true,
      consent: { spotReview: true },
      registry: adapter,
      nodes: [node("aaaa1111", "The quick brown fox")],
      rangeOffset: 4,
      contentHash: "complete-hash",
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.source).toBe("ai");
    expect(result.findings[0]?.actionable).toBe(true);
    expect(result.changes[0]?.source).toBe("ai");
    expect(result.plan.changes).toHaveLength(1);
    expect(result.plan.docHash).toBe("complete-hash");
    expect(result.plan.documentVersion).toBe("version-1");
    expect(result.findings[0]?.range).toEqual({ start: 8, end: 19, unit: "character" });
    expect(result.changes[0]?.range).toEqual({ start: 8, end: 19 });
  });

  it("converts an empty AI expectation into a delete change", async () => {
    const adapter = new MockAdapter({
      defaultResponse: JSON.stringify({
        findings: [
          {
            category: "editorial.clarity",
            severity: "warning",
            risk: "low",
            confidence: 0.8,
            actual: "red",
            expected: "",
            start: 0,
            end: 3,
          },
        ],
      }),
    });

    const result = await reviewSpot({
      ...request("red blue"),
      includeRawText: true,
      consent: { spotReview: true },
      registry: adapter,
      nodes: [node("aaaa1111", "red blue")],
      contentHash: "complete-hash",
    });

    expect(result.changes[0]).toMatchObject({
      type: "deleteRange",
      range: { start: 0, end: 3 },
      payload: {},
      precondition: { kind: "text", expectedText: "red" },
    });
  });

  it("rejects an actual that exists elsewhere but not in the reported slice", async () => {
    const base = request("red blue");
    const adapter = new MockAdapter({
      defaultResponse: JSON.stringify({
        findings: [
          {
            category: "editorial.clarity",
            severity: "warning",
            risk: "low",
            confidence: 0.8,
            actual: "blue",
            expected: "azure",
            start: 0,
            end: 3,
          },
        ],
      }),
    });

    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: adapter,
        nodes: [node("aaaa1111", "red blue")],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/exact source slice/);
  });

  it("returns unresolved semantic suggestions as advisory and non-actionable", async () => {
    const base = request("red blue");
    const adapter = new MockAdapter({
      defaultResponse: JSON.stringify({
        findings: [
          {
            category: "editorial.clarity",
            severity: "warning",
            risk: "low",
            confidence: 0.8,
            expected: "azure",
            start: 0,
            end: 8,
          },
        ],
      }),
    });
    const result = await reviewSpot({
      ...base,
      includeRawText: true,
      consent: { spotReview: true },
      registry: adapter,
      nodes: [node("aaaa1111", "red blue")],
      contentHash: "complete-hash",
    });

    expect(result.findings[0]).toMatchObject({
      actionable: false,
      status: "deferred",
      source: "ai",
    });
    expect(result.changes).toEqual([]);
    expect(result.plan.changes).toEqual([]);
  });

  it("fails malformed provider output instead of guessing", async () => {
    const base = request("text");
    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: new MockAdapter({ defaultResponse: "not-json" }),
        nodes: [node("aaaa1111", "text")],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("refuses protected selected text before calling the provider", async () => {
    const base = request("quoted");
    base.request.targetNodeIds = ["bbbb2222"];
    const adapter = new MockAdapter();
    const complete = vi.spyOn(adapter, "complete");

    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: adapter,
        nodes: [node("bbbb2222", "quoted", true)],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/Protected or non-editable/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses selected text outside the requested target", async () => {
    const base = request("outside");
    const adapter = new MockAdapter();
    const complete = vi.spyOn(adapter, "complete");

    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: adapter,
        nodes: [node("aaaa1111", "different")],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/unambiguous in-scope/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses ambiguous repeated selected text across multiple targets", async () => {
    const base = request("repeat");
    base.request.targetNodeIds = ["aaaa1111", "cccc3333"];
    const adapter = new MockAdapter();
    const complete = vi.spyOn(adapter, "complete");

    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: adapter,
        nodes: [node("aaaa1111", "repeat"), node("cccc3333", "repeat")],
        contentHash: "complete-hash",
      }),
    ).rejects.toThrow(/unambiguous in-scope/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("propagates caller abort", async () => {
    const base = request("text");
    const controller = new AbortController();
    controller.abort();
    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        consent: { spotReview: true },
        registry: new MockAdapter(),
        nodes: [node("aaaa1111", "text")],
        contentHash: "complete-hash",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it("partitions editable nodes without protected content and preserves offsets", () => {
    const source = DocumentNodeSchema.parse({
      nodeId: "dddd4444",
      type: "paragraph",
      text: "one",
      sourcePath: "body/paragraph/0",
      sourceRange: {
        nodeId: "dddd4444",
        startOffset: 10,
        endOffset: 13,
        structuralPath: "body/paragraph/0",
      },
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
    const batches = partitionReviewBatches(
      [source, node("bbbb2222", "two", true), node("cccc3333", "three")],
      { maxCharacters: 6, maxNodes: 10 },
    );
    expect(batches.flatMap((batch) => batch.nodeIds)).toEqual(["dddd4444", "cccc3333"]);
    expect(batches[0]?.startOffset).toBe(10);
  });

  it("combines only contiguous nodes and honors the node limit", () => {
    const source = [
      rangedNode("aaaa1111", "one", 0),
      rangedNode("bbbb2222", "two", 3),
      rangedNode("cccc3333", "six", 8),
    ];

    const contiguous = partitionReviewBatches(source, { maxCharacters: 20 });
    const limited = partitionReviewBatches(source, { maxCharacters: 20, maxNodes: 1 });

    expect(contiguous.map((batch) => batch.nodeIds)).toEqual([
      ["aaaa1111", "bbbb2222"],
      ["cccc3333"],
    ]);
    expect(contiguous[0]?.text).toBe("onetwo");
    expect(contiguous.map((batch) => batch.startOffset)).toEqual([0, 8]);
    expect(limited.map((batch) => batch.nodeIds)).toEqual([
      ["aaaa1111"],
      ["bbbb2222"],
      ["cccc3333"],
    ]);
  });

  it("reviews a combined contiguous batch without losing target-node mapping", async () => {
    const nodes = [rangedNode("aaaa1111", "one", 0), rangedNode("bbbb2222", "two", 3)];
    const batches = partitionReviewBatches(nodes, { maxCharacters: 10 });
    const base = request(batches[0]?.text ?? "", "document_editorial_review");
    base.request.targetNodeIds = batches[0]?.nodeIds ?? [];
    const result = await reviewSpot({
      ...base,
      profile: request("text").profile,
      includeRawText: true,
      consent: { spotReview: true },
      registry: new MockAdapter({ defaultResponse: JSON.stringify({ findings: [] }) }),
      nodes,
      rangeOffset: batches[0]?.startOffset ?? 0,
      contentHash: "complete-hash",
    });

    expect(batches[0]?.nodeIds).toEqual(["aaaa1111", "bbbb2222"]);
    expect(result.plan.changes).toEqual([]);
  });

  it("splits oversized nodes into bounded batches with absolute offsets", () => {
    const source = DocumentNodeSchema.parse({
      nodeId: "eeee5555",
      type: "paragraph",
      text: "abcdefgh",
      sourcePath: "body/paragraph/0",
      sourceRange: {
        nodeId: "eeee5555",
        startOffset: 20,
        endOffset: 28,
        structuralPath: "body/paragraph/0",
      },
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
    const batches = partitionReviewBatches([source], { maxCharacters: 3 });
    expect(batches.map((batch) => batch.text)).toEqual(["abc", "def", "gh"]);
    expect(batches.map((batch) => batch.startOffset)).toEqual([20, 23, 26]);
  });

  it("completes a covered full-document review through the normal plan contract", async () => {
    const snapshot: DocumentSnapshot = {
      documentId: "doc",
      versionToken: "v1",
      contentHash: "hash",
      structuralHash: "structure",
      capturedAt: new Date().toISOString(),
      nodes: [
        DocumentNodeSchema.parse({
          nodeId: "body0000",
          type: "body",
          sourcePath: "body",
          editable: true,
          includedInGovernance: true,
          includedInAIReview: true,
        }),
        node("aaaa1111", "hello world"),
      ],
    };
    const result = await reviewEntireDocument({
      snapshot,
      profile: request("text").profile,
      includeRawText: true,
      consent: { fullDocumentReview: true },
      registry: new MockAdapter({
        defaultResponse: JSON.stringify({
          findings: [
            {
              category: "editorial.clarity",
              severity: "info",
              risk: "low",
              confidence: 0.8,
              actual: "hello world",
              expected: "Hi",
              start: 0,
              end: 11,
            },
          ],
        }),
      }),
    });
    expect(result.status).toBe("complete");
    expect(result.plan.changes).toHaveLength(1);
    expect(result.plan).toMatchObject({
      docHash: "hash",
      documentVersion: "v1",
      contentHash: "hash",
      structuralHash: "structure",
      profileRevision: 1,
    });
    expect(result.coverage.complete).toBe(true);
  });

  it("fails closed when the live document changes between batches", async () => {
    const body = DocumentNodeSchema.parse({
      nodeId: "body0000",
      type: "body",
      sourcePath: "body",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
    const snapshot: DocumentSnapshot = {
      documentId: "doc",
      versionToken: "v1",
      contentHash: "hash",
      structuralHash: "structure",
      capturedAt: new Date().toISOString(),
      nodes: [body, node("aaaa1111", "one"), node("bbbb2222", "two")],
    };
    const adapter = new MockAdapter({
      defaultResponse: JSON.stringify({ findings: [] }),
    });
    const result = await reviewEntireDocument({
      snapshot,
      profile: request("text").profile,
      includeRawText: true,
      consent: { fullDocumentReview: true },
      registry: adapter,
      getCurrentDocumentHash: async () => "changed",
    });
    expect(result.status).toBe("stale");
    expect(result.findings).toEqual([]);
    expect(adapter.name).toBe("mock");
  });

  it("blocks full-document review when coverage is incomplete", async () => {
    const snapshot: DocumentSnapshot = {
      documentId: "doc",
      versionToken: "v1",
      contentHash: "hash",
      structuralHash: "structure",
      capturedAt: new Date().toISOString(),
      nodes: [node("aaaa1111", "only")],
    };
    const result = await reviewEntireDocument({
      snapshot,
      profile: request("text").profile,
      includeRawText: true,
      consent: { fullDocumentReview: true },
      registry: new MockAdapter(),
    });
    expect(result.status).toBe("failed_coverage");
    expect(result.coverage.complete).toBe(false);
  });

  it("exports two-column CSV only after coverage completes", () => {
    const body = DocumentNodeSchema.parse({
      nodeId: "body0000",
      type: "body",
      sourcePath: "body",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
    const coverage = buildCoverage({ nodes: [body, node("aaaa1111", "one")], text: "one" });
    const result = toRevisionsCsv([], [], coverage);
    expect(result).toBe("before,after");
    expect(() => toRevisionsCsv([], [], { ...coverage, complete: false })).toThrow(
      /FAILED_COVERAGE/,
    );
  });
});
