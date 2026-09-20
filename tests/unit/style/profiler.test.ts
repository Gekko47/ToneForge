import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ProfileResponseSchema } from "../../../src/ai/prompts/profilePrompts";
import { LlmError, type LlmSemanticProvider } from "../../../src/ai/providers/LlmProvider";
import { createLlmRegistry } from "../../../src/ai/providers/registry";
import { buildStyleProfile } from "../../../src/style/profiler";
import { captureFromText } from "../../../src/style/sampleCapture";
import { computeMeasuredProfile } from "../../../src/style/metrics";

const sampleText =
  "The team shipped the feature on time. It was a careful release with clear notes. Everyone stayed focused.";

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

describe("buildStyleProfile", () => {
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

    const profile = await buildStyleProfile(sample, {
      includeRawText: true,
      registry,
      name: "Team profile",
    });

    expect(profile.name).toBe("Team profile");
    expect(profile.measured.sampleWordCount).toBe(sample.wordCount);
    expect(profile.semantic).toEqual(ProfileResponseSchema.parse(semanticResponse));
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
      includeRawText: true,
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

    await expect(buildStyleProfile(sample, { includeRawText: true, registry })).rejects.toThrow(
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

    await expect(
      buildStyleProfile(sample, { includeRawText: true, registry }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("honors caller abort without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = createLlmRegistry({ provider: "mock" });
    const sample = captureFromText(sampleText);

    await expect(
      buildStyleProfile(sample, { includeRawText: true, registry, signal: controller.signal }),
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

    const profile = await buildStyleProfile(sample, { includeRawText: true, registry });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(profile.semantic).toEqual(ProfileResponseSchema.parse(semanticResponse));
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

    await expect(buildStyleProfile(sample, { includeRawText: true, registry })).rejects.toThrow(
      "permanent",
    );
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

    const profile = await buildStyleProfile(sample, { includeRawText: true, registry });

    expect(profile.measured).toEqual(computeMeasuredProfile(sample.text));
    expect(profile.measured.sampleWordCount).toBeGreaterThan(0);
  });
});
