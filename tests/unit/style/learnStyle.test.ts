import { describe, expect, it } from "vitest";
import { createLlmRegistry } from "../../../src/ai/providers/registry";
import { captureFromText } from "../../../src/style/sampleCapture";
import { learnStyleDraft } from "../../../src/style/learnStyle";

const sampleText =
  "The team shipped the feature on time. It was a careful release with clear notes. Everyone stayed focused on the customer and the evidence. The review covered the scope, the risks, and the follow-up work for the next release tomorrow.";

describe("learnStyleDraft", () => {
  it("builds a deterministic draft without calling a provider", async () => {
    const result = await learnStyleDraft(captureFromText(sampleText), { name: "Team profile" });

    expect(result.draft.name).toBe("Team profile");
    expect(result.draft.measured.sampleWordCount).toBe(result.evidence.wordCount);
    expect(result.draft.sourceSampleIds).toEqual([result.evidence.sampleId]);
    expect(result.evidence.pass).toBe(true);
    expect(result.evidence.semanticIncluded).toBe(false);
  });

  it("adds semantic interpretation only after explicit opt-in", async () => {
    const registry = createLlmRegistry({
      provider: "mock",
      mock: {
        responses: {
          "Analyze the following writing sample": JSON.stringify({
            tone: "professional",
            voice: "third-person",
            formality: 75,
            readingGradeTarget: 12,
            preferredSentenceLength: 18,
            vocabularyRegister: "standard",
            rhetoricalStyle: "direct",
            avoidWords: ["very"],
          }),
        },
      },
    });

    const result = await learnStyleDraft(captureFromText(sampleText), {
      name: "Interpreted profile",
      includeSemantic: true,
      registry,
    });

    expect(result.evidence.semanticIncluded).toBe(true);
    expect(result.draft.semantic.tone).toBe("professional");
    expect(result.draft.sourceSampleIds).toHaveLength(1);
  });

  it("refuses a sample that fails the quality gate", async () => {
    await expect(learnStyleDraft(captureFromText("Too short."))).rejects.toThrow(
      "Sample is not suitable for style learning",
    );
  });
});
