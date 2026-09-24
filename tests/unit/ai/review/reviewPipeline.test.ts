import { describe, expect, it } from "vitest";
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
      targetNodeIds: [],
      text,
      profileId: profile.id,
      profileVersion: "1.0.0",
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

  it("excludes protected nodes and enforces the context budget", () => {
    const result = buildMinimalContext({
      selectedText: "selected",
      nodes: [node("aaaa1111", "editable"), node("bbbb2222", "quoted", true)],
      targetNodeIds: ["aaaa1111", "bbbb2222"],
      charBudget: 10,
    });
    expect(result.excludedNodeIds).toEqual(["bbbb2222"]);
    expect(result.text.length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
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
      registry: adapter,
      nodes: [node("aaaa1111", "The quick brown fox")],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.source).toBe("ai");
    expect(result.changes[0]?.source).toBe("ai");
    expect(result.plan.changes).toHaveLength(1);
  });

  it("fails malformed provider output instead of guessing", async () => {
    const base = request("text");
    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        registry: new MockAdapter({ defaultResponse: "not-json" }),
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("propagates caller abort", async () => {
    const base = request("text");
    const controller = new AbortController();
    controller.abort();
    await expect(
      reviewSpot({
        ...base,
        includeRawText: true,
        registry: new MockAdapter(),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it("partitions editable nodes without protected content", () => {
    const batches = partitionReviewBatches(
      [node("aaaa1111", "one"), node("bbbb2222", "two", true), node("cccc3333", "three")],
      { maxCharacters: 6, maxNodes: 10 },
    );
    expect(batches.flatMap((batch) => batch.nodeIds)).toEqual(["aaaa1111", "cccc3333"]);
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
      registry: new MockAdapter({
        defaultResponse: JSON.stringify({
          findings: [
            {
              category: "editorial.clarity",
              severity: "info",
              risk: "low",
              confidence: 0.8,
              actual: "hello",
              expected: "hi",
              start: 0,
              end: 5,
            },
          ],
        }),
      }),
    });
    expect(result.status).toBe("complete");
    expect(result.plan.changes).toHaveLength(1);
    expect(result.coverage.complete).toBe(true);
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
