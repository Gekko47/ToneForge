import { describe, expect, it } from "vitest";

import { SEMANTIC_DIMENSIONS } from "../../../../src/core/domain/SemanticStyleProfile";
import { ToneTraitSchema } from "../../../../src/core/domain/SemanticStyleProfile";
import { buildProfilePromptV2 } from "../../../../src/ai/prompts/profilePrompts";
import { buildSemanticReviewPrompt } from "../../../../src/analysis/semantic/reviewPrompt";
import { SEMANTIC_DIMENSIONS_LIST } from "../../../../src/analysis/semantic/reviewPrompt";
import { createEmptySemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";

describe("prompt/schema sync", () => {
  it("SEMANTIC_DIMENSIONS_LIST equals SEMANTIC_DIMENSIONS", () => {
    expect([...SEMANTIC_DIMENSIONS_LIST]).toEqual([...SEMANTIC_DIMENSIONS]);
  });

  it("every dimension in SEMANTIC_DIMENSIONS appears in the V2 prompt", () => {
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    SEMANTIC_DIMENSIONS.forEach((dimension) => {
      expect(prompt).toContain(dimension);
    });
  });

  it("every ToneTrait value appears in the V2 prompt", () => {
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    ToneTraitSchema.options.forEach((value) => {
      expect(prompt).toContain(value);
    });
  });

  it("every dimension in SEMANTIC_DIMENSIONS appears in the review prompt", () => {
    const request = {
      domain: "general" as const,
      semantic: createEmptySemanticStyleProfile(),
      selectedText: "sample",
      includeRawText: true as const,
      selectionAnchor: {
        selectedText: "sample",
        documentId: "doc",
        nodeIds: [],
        startOffset: 0,
        endOffset: 6,
        selectionHash: "h",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
      profile: createEmptySemanticStyleProfile(),
    };
    const prompt = buildSemanticReviewPrompt(
      request as unknown as Parameters<typeof buildSemanticReviewPrompt>[0],
      { includeRawText: true },
    );
    SEMANTIC_DIMENSIONS.forEach((dimension) => {
      expect(prompt).toContain(dimension);
    });
  });
});
