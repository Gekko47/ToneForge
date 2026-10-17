import { describe, expect, it } from "vitest";

import { buildProfilePromptV2 } from "../../../src/ai/prompts/profilePrompts";
import { EMPTY_ANALYSIS_MESSAGE } from "../../../src/analysis/semantic/semanticStyleExtraction";
import type { LlmSemanticProvider } from "../../../src/ai/providers/LlmProvider";
import { buildStyleProfile } from "../../../src/style/profiler";
import { captureFromText } from "../../../src/style/sampleCapture";

const sampleText =
  "The team shipped the feature on time. It was a careful release with clear notes. Everyone stayed focused.";

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
  agency: { actorNaming: "named", attributionPrecision: "exact" },
  technicality: { density: "medium", explainsTerms: true, abbreviationTendency: "first-use" },
  rhetoricalStyle: "forensic",
  conclusionStyle: { form: "qualified", avoidsRepetition: true },
  lexicalPreferences: {
    toneAvoid: ["very"],
    prefersNeutralVerbs: true,
    evaluativeLanguage: "restrained",
  },
};

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
      review: respond,
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
    // The formality label is derived, not free text (R14), so the leakage
    // instruction now covers descriptions only.
    expect(prompt).toMatch(/No free-text field \(description\)/);
    expect(prompt).toMatch(/must name a project, a company, a person, a date, an amount/);
  });
});
