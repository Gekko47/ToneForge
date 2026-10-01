import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  buildProfilePromptV2,
  ProfileResponseSchema,
} from "../../../src/ai/prompts/profilePrompts";
import { EMPTY_ANALYSIS_MESSAGE } from "../../../src/analysis/semantic/semanticStyleExtraction";
import { migrateSemanticStyleFromV1 } from "../../../src/core/domain/SemanticStyleProfile";
import { LlmError, type LlmSemanticProvider } from "../../../src/ai/providers/LlmProvider";
import { createLlmRegistry } from "../../../src/ai/providers/registry";
import { buildStyleProfile } from "../../../src/style/profiler";
import { captureFromText } from "../../../src/style/sampleCapture";
import { computeMeasuredProfile } from "../../../src/style/metrics";

const sampleText =
  "The team shipped the feature on time. It was a careful release with clear notes. Everyone stayed focused.";

/** The V1 prompt's answer shape, still reachable while the Semantic tab uses it. */
const semanticResponse = {
  tone: "professional",
  voice: "third-person",
  formality: 75,
  readingGradeTarget: 12,
  preferredSentenceLength: 18,
  vocabularyRegister: "standard",
  rhetoricalStyle: "direct",
  avoidWords: ["very"],
};

/** A complete V2 extraction: every group, every leaf, nothing at its default. */
const v2Response = {
  tone: { primary: "analytical", secondary: ["restrained"], description: "" },
  voice: {
    person: "third",
    construction: "active",
    authorialPresence: "restrained",
    description: "",
  },
  formality: { score: 75, label: "professional" },
  register: { primary: "expert", description: "" },
  assertionStyle: { strength: "qualified", ordering: "evidence-first", directness: "measured" },
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
  agency: { actorNaming: "named", passiveTendency: "low", attributionPrecision: "exact" },
  technicality: { density: "medium", explainsTerms: true, abbreviationTendency: "first-use" },
  rhetoricalStyle: "forensic",
  conclusionStyle: { form: "qualified", avoidsRepetition: true },
  lexicalPreferences: {
    toneAvoid: ["very"],
    prefersNeutralVerbs: true,
    evaluativeLanguage: "restrained",
  },
};

describe("buildStyleProfile on the V1 prompt", () => {
  // Still reachable while the Semantic tab calls it. P4 removes this path and
  // these tests with it; until then both prompt versions must keep working, and a
  // provider that only answers the old shape must look like a mismatch rather
  // than like a regression.
  const v1 = { includeRawText: true as const, promptVersion: "v1" as const };

  it("builds a profile from a captured sample using the mock provider", async () => {
    const registry = createLlmRegistry({
      provider: "mock",
      mock: {
        responses: {
          "Analyze the following writing sample": JSON.stringify(semanticResponse),
        },
      },
    });
    const sample = captureFromText(sampleText);

    const profile = await buildStyleProfile(sample, { ...v1, registry, name: "Team profile" });

    expect(profile.name).toBe("Team profile");
    expect(profile.measured.sampleWordCount).toBe(sample.wordCount);
    // The learning path still emits V1, and `profiler` maps it forward with the
    // same function the v14 state migration uses. Asserting the V1 shape here
    // would pin the persisted profile to a schema it no longer has.
    expect(profile.semantic).toEqual(
      migrateSemanticStyleFromV1(ProfileResponseSchema.parse(semanticResponse)),
    );
    expect(profile.sourceSampleIds).toEqual([]);
  });

  it("passes constraints and sample text into the profile prompt", async () => {
    let capturedPrompt = "";
    const registry: LlmSemanticProvider = {
      name: "test",
      complete: async (request) => {
        capturedPrompt = request.prompt;
        return { text: JSON.stringify(semanticResponse), model: "test" };
      },
      profile: async (request) => {
        capturedPrompt = request.prompt;
        return { text: JSON.stringify(semanticResponse), model: "test" };
      },
      deviations: async (request) => {
        capturedPrompt = request.prompt;
        return { text: JSON.stringify(semanticResponse), model: "test" };
      },
      rewrite: async (request) => {
        capturedPrompt = request.prompt;
        return { text: JSON.stringify(semanticResponse), model: "test" };
      },
    };
    const sample = captureFromText(sampleText);

    await buildStyleProfile(sample, {
      ...v1,
      registry,
      constraints: ["Keep it concise", "Use plain language"],
    });

    expect(capturedPrompt).toContain(sampleText);
    expect(capturedPrompt).toContain("Keep it concise; Use plain language");
  });

  it("rejects a non-JSON model response", async () => {
    const registry: LlmSemanticProvider = {
      name: "test",
      complete: async () => ({ text: "not json", model: "test" }),
      profile: async () => ({ text: "not json", model: "test" }),
      deviations: async () => ({ text: "not json", model: "test" }),
      rewrite: async () => ({ text: "not json", model: "test" }),
    };
    const sample = captureFromText(sampleText);

    await expect(buildStyleProfile(sample, { ...v1, registry })).rejects.toThrow(
      "Style profile response is not valid JSON",
    );
  });

  it("rejects a model response that fails the profile schema", async () => {
    const registry: LlmSemanticProvider = {
      name: "test",
      complete: async () => ({ text: JSON.stringify({ tone: "professional" }), model: "test" }),
      profile: async () => ({ text: JSON.stringify({ tone: "professional" }), model: "test" }),
      deviations: async () => ({ text: JSON.stringify({ tone: "professional" }), model: "test" }),
      rewrite: async () => ({ text: JSON.stringify({ tone: "professional" }), model: "test" }),
    };
    const sample = captureFromText(sampleText);

    await expect(buildStyleProfile(sample, { ...v1, registry })).rejects.toBeInstanceOf(ZodError);
  });

  it("honors caller abort without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = createLlmRegistry({ provider: "mock" });
    const sample = captureFromText(sampleText);

    await expect(
      buildStyleProfile(sample, { ...v1, registry, signal: controller.signal }),
    ).rejects.toThrow("Mock request aborted by caller");
  });

  it("retries retryable provider failures", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new LlmError("temporary", "test", true))
      .mockResolvedValue({ text: JSON.stringify(semanticResponse), model: "test" });
    const registry: LlmSemanticProvider = {
      name: "test",
      complete,
      profile: complete,
      deviations: complete,
      rewrite: complete,
    };
    const sample = captureFromText(sampleText);

    const profile = await buildStyleProfile(sample, { ...v1, registry });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(profile.semantic).toEqual(
      migrateSemanticStyleFromV1(ProfileResponseSchema.parse(semanticResponse)),
    );
  });

  it("does not retry non-retryable provider failures", async () => {
    const complete = vi.fn().mockRejectedValue(new LlmError("permanent", "test", false));
    const registry: LlmSemanticProvider = {
      name: "test",
      complete,
      profile: complete,
      deviations: complete,
      rewrite: complete,
    };
    const sample = captureFromText(sampleText);

    await expect(buildStyleProfile(sample, { ...v1, registry })).rejects.toThrow("permanent");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("uses the deterministic metrics as the measured half of the profile", async () => {
    const registry: LlmSemanticProvider = {
      name: "test",
      complete: async () => ({ text: JSON.stringify(semanticResponse), model: "test" }),
      profile: async () => ({ text: JSON.stringify(semanticResponse), model: "test" }),
      deviations: async () => ({ text: JSON.stringify(semanticResponse), model: "test" }),
      rewrite: async () => ({ text: JSON.stringify(semanticResponse), model: "test" }),
    };
    const sample = captureFromText(sampleText);

    const profile = await buildStyleProfile(sample, { ...v1, registry });

    expect(profile.measured).toEqual(computeMeasuredProfile(sample.text));
    expect(profile.measured.sampleWordCount).toBeGreaterThan(0);
  });
});

describe("buildStyleProfile on the V2 prompt", () => {
  const v2 = { includeRawText: true as const };

  function registryReturning(payload: unknown): LlmSemanticProvider {
    const respond = async () => ({ text: JSON.stringify(payload), model: "test" });
    return {
      name: "test",
      complete: respond,
      profile: respond,
      deviations: respond,
      rewrite: respond,
    };
  }

  it("is the default, so a caller that says nothing gets the strict path", async () => {
    const registry = registryReturning(v2Response);
    const profile = await buildStyleProfile(captureFromText(sampleText), {
      ...v2,
      registry,
    });
    expect(profile.semantic.tone.primary).toBe("analytical");
    expect(profile.semantic.evidenceFraming.recordFirst).toBe(true);
  });

  it("refuses an answer that omits a group rather than defaulting it", async () => {
    // The whole point of the strict schema. Defaulting here would persist
    // "tone: neutral" as though it had been learned.
    const incomplete = { ...v2Response } as Record<string, unknown>;
    delete incomplete.evidenceFraming;
    await expect(
      buildStyleProfile(captureFromText(sampleText), {
        ...v2,
        registry: registryReturning(incomplete),
      }),
    ).rejects.toThrow(/evidenceFraming/);
  });

  it("reports the refusal reason, so the pane can say what happened", async () => {
    const incomplete = { ...v2Response } as Record<string, unknown>;
    delete incomplete.evidenceFraming;
    await expect(
      buildStyleProfile(captureFromText(sampleText), {
        ...v2,
        registry: registryReturning(incomplete),
      }),
    ).rejects.toMatchObject({ refusal: { reason: "schema" } });
  });

  it("refuses a valid but all-default answer as uninformative", async () => {
    const blank = {
      ...v2Response,
      tone: { primary: "neutral", secondary: [], description: "" },
      voice: {
        person: "impersonal",
        construction: "balanced",
        authorialPresence: "restrained",
        description: "",
      },
      formality: { score: 50, label: "" },
      register: { primary: "professional", description: "" },
      evidenceFraming: {
        recordFirst: true,
        attribution: "occasional",
        quotation: "selective",
        explicitReferences: false,
        progression: "source-analysis-conclusion",
      },
      sentenceArchitecture: {
        complexity: "moderate",
        clauseDensity: "medium",
        targetWords: 22,
        coordination: "mixed",
        shortClosingSentence: false,
      },
      paragraphArchitecture: {
        function: "mixed",
        ordering: "topic-evidence-conclusion",
        targetWords: 90,
        propositions: "single",
      },
      qualificationStyle: {
        frequency: "occasional",
        strength: "moderate",
        exceptions: "inline",
        conditionals: true,
      },
      uncertaintyStyle: {
        incompleteEvidence: "stated",
        confidenceLanguage: "explicit",
        modality: "occasional",
        avoidsUnsupportedCertainty: true,
      },
      transitions: "restrained",
      technicality: { density: "medium", explainsTerms: true, abbreviationTendency: "first-use" },
      rhetoricalStyle: "direct-analytical",
      lexicalPreferences: {
        toneAvoid: [],
        prefersNeutralVerbs: true,
        evaluativeLanguage: "restrained",
      },
    };
    await expect(
      buildStyleProfile(captureFromText(sampleText), { ...v2, registry: registryReturning(blank) }),
    ).rejects.toThrow(EMPTY_ANALYSIS_MESSAGE);
  });

  it("refuses an answer that leaked a figure from the sample", async () => {
    const leaky = {
      ...v2Response,
      register: { primary: "expert", description: "the figure used was £1,240,000" },
    };
    const sample = captureFromText(
      "The prolongation cost of £1,240,000 is recoverable in my opinion.",
    );
    await expect(
      buildStyleProfile(sample, { ...v2, registry: registryReturning(leaky) }),
    ).rejects.toMatchObject({ refusal: { reason: "factualLeakage" } });
  });

  it("does not fall back to V1 when the strict schema rejects an answer", async () => {
    // A silent retry against the old prompt would report an all-default profile
    // as learned, which is the one outcome this whole change exists to prevent.
    await expect(
      buildStyleProfile(captureFromText(sampleText), {
        ...v2,
        registry: registryReturning({ tone: "professional" }),
      }),
    ).rejects.toMatchObject({ name: "StyleExtractionError" });
  });
});

describe("buildProfilePromptV2", () => {
  it("refuses to build a prompt without explicit raw-text consent", () => {
    expect(() => buildProfilePromptV2(sampleText)).toThrow(/includeRawText: true/);
    expect(() => buildProfilePromptV2(sampleText, [], { includeRawText: false })).toThrow(
      /includeRawText: true/,
    );
  });

  it("carries the sample and the constraints into the prompt", () => {
    const prompt = buildProfilePromptV2(sampleText, ["Keep it concise"], { includeRawText: true });
    expect(prompt).toContain(sampleText);
    expect(prompt).toContain("Keep it concise");
  });

  it("tells the model every group is required, and not to quote the sample", () => {
    const prompt = buildProfilePromptV2(sampleText, [], { includeRawText: true });
    expect(prompt).toContain("sixteen keys");
    expect(prompt).toMatch(/must not name a project/);
  });
});
