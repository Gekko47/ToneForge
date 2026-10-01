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
    // A V2 answer, because that is what `buildStyleProfile` now sends by
    // default. The V1 path is covered in `profiler.test.ts` and goes away in P4.
    const registry = createLlmRegistry({
      provider: "mock",
      mock: {
        responses: {
          "Analyze the following writing sample": JSON.stringify({
            tone: { primary: "analytical", secondary: ["restrained"], description: "" },
            voice: {
              person: "third",
              construction: "active",
              authorialPresence: "restrained",
              description: "",
            },
            formality: { score: 75, label: "professional" },
            register: { primary: "expert", description: "" },
            assertionStyle: {
              strength: "qualified",
              ordering: "evidence-first",
              directness: "measured",
            },
            qualificationStyle: {
              frequency: "frequent",
              strength: "moderate",
              exceptions: "inline",
              conditionals: true,
            },
            evidenceFraming: {
              recordFirst: true,
              attribution: "systematic",
              quotation: "frequent",
              explicitReferences: true,
              progression: "source-analysis-conclusion",
            },
            uncertaintyStyle: {
              incompleteEvidence: "stated",
              confidenceLanguage: "explicit",
              modality: "frequent",
              avoidsUnsupportedCertainty: true,
            },
            sentenceArchitecture: {
              complexity: "complex",
              clauseDensity: "high",
              targetWords: 18,
              coordination: "subordination",
              shortClosingSentence: true,
            },
            paragraphArchitecture: {
              function: "analysis",
              ordering: "topic-evidence-conclusion",
              targetWords: 120,
              propositions: "multiple",
            },
            transitions: "explicit",
            agency: {
              actorNaming: "named",
              passiveTendency: "low",
              attributionPrecision: "exact",
            },
            technicality: {
              density: "medium",
              explainsTerms: true,
              abbreviationTendency: "first-use",
            },
            rhetoricalStyle: "forensic",
            conclusionStyle: { form: "qualified", avoidsRepetition: true },
            lexicalPreferences: {
              toneAvoid: ["very"],
              prefersNeutralVerbs: true,
              evaluativeLanguage: "restrained",
            },
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
    expect(result.draft.semantic.tone.primary).toBe("analytical");
    expect(result.draft.semantic.evidenceFraming.recordFirst).toBe(true);
    expect(result.draft.sourceSampleIds).toHaveLength(1);
  });

  it("refuses a sample that fails the quality gate", async () => {
    await expect(learnStyleDraft(captureFromText("Too short."))).rejects.toThrow(
      "Sample is not suitable for style learning",
    );
  });
});
