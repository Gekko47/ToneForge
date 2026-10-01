import { describe, it, expect } from "vitest";
import {
  buildProfilePrompt,
  buildProfilePromptV2,
  ProfileResponseSchema,
} from "../../../../src/ai/prompts/index";

describe("buildProfilePrompt", () => {
  it("throws when includeRawText is false (default)", () => {
    expect(() => buildProfilePrompt("some text")).toThrow(/includeRawText/);
  });

  it("throws when includeRawText is explicitly false", () => {
    expect(() => buildProfilePrompt("some text", [], { includeRawText: false })).toThrow(
      /includeRawText/,
    );
  });

  it("includes sample text when includeRawText is true", () => {
    const prompt = buildProfilePrompt("hello world", [], { includeRawText: true });
    expect(prompt).toContain("hello world");
    expect(prompt).toContain("Writing sample:");
  });

  it("includes constraints when provided", () => {
    const prompt = buildProfilePrompt("text", ["no em dashes"], { includeRawText: true });
    expect(prompt).toContain("Constraints: no em dashes");
  });

  it("omits constraints line when empty", () => {
    const prompt = buildProfilePrompt("text", [], { includeRawText: true });
    expect(prompt).not.toContain("Constraints:");
  });
});

describe("buildProfilePromptV2", () => {
  it("throws when includeRawText is false (default)", () => {
    expect(() => buildProfilePromptV2("some text")).toThrow(/includeRawText/);
  });

  it("includes the sample when includeRawText is true", () => {
    const prompt = buildProfilePromptV2("hello world", [], { includeRawText: true });
    expect(prompt).toContain("hello world");
    expect(prompt).toContain("Writing sample:");
  });

  it("names every group and tells the model not to omit one", () => {
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    ["tone", "voice", "evidenceFraming", "lexicalPreferences"].forEach((group) => {
      expect(prompt).toContain(group);
    });
    expect(prompt).toContain("sixteen keys");
  });

  it("tells the model not to quote the sample in a description", () => {
    // Verified afterwards regardless, but telling the model is cheaper than
    // telling a user their provider returned a leak.
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    expect(prompt).toMatch(/must not name a project/);
  });
});

describe("ProfileResponseSchema", () => {
  it("accepts a valid profile response", () => {
    const result = ProfileResponseSchema.safeParse({
      tone: "formal",
      voice: "third-person",
      formality: 70,
      readingGradeTarget: 10,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: ["very"],
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown fields", () => {
    const result = ProfileResponseSchema.safeParse({
      tone: "formal",
      voice: "third-person",
      formality: 70,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: [],
      extraField: "should be dropped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("extraField");
    }
  });

  it("rejects out-of-range formality", () => {
    const result = ProfileResponseSchema.safeParse({
      tone: "formal",
      voice: "third-person",
      formality: 200,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid vocabularyRegister", () => {
    const result = ProfileResponseSchema.safeParse({
      tone: "formal",
      voice: "third-person",
      formality: 70,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "bogus",
      rhetoricalStyle: "direct",
      avoidWords: [],
    });
    expect(result.success).toBe(false);
  });

  it("defaults avoidWords when omitted", () => {
    const result = ProfileResponseSchema.safeParse({
      tone: "formal",
      voice: "third-person",
      formality: 70,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avoidWords).toEqual([]);
    }
  });
});

/*
 * `DeviationResponseSchema` and `buildDeviationPrompt` are gone, with their tests.
 *
 * They described a list of independent complaints with quoted anchors — the shape
 * the deterministic findings list uses. That shape is why a model's stylistic
 * opinion and a machine-verified rule breach could end up on the same list.
 * `SemanticReviewResponseSchema` replaces them, and is tested in
 * `tests/unit/analysis/semantic/semanticReviewEngine.test.ts`.
 */
