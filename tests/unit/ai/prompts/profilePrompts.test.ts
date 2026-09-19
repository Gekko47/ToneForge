import { describe, it, expect } from "vitest";
import {
  buildProfilePrompt,
  buildDeviationPrompt,
  ProfileResponseSchema,
  DeviationResponseSchema,
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

describe("buildDeviationPrompt", () => {
  it("throws when includeRawText is false (default)", () => {
    expect(() => buildDeviationPrompt({}, "target text")).toThrow(/includeRawText/);
  });

  it("includes target text when includeRawText is true", () => {
    const prompt = buildDeviationPrompt({ tone: "formal" }, "target text", {
      includeRawText: true,
    });
    expect(prompt).toContain("target text");
    expect(prompt).toContain("Target text:");
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

describe("DeviationResponseSchema", () => {
  it("accepts a valid deviation response", () => {
    const result = DeviationResponseSchema.safeParse({
      deviation: "wordy phrasing",
      severity: "medium",
      suggestion: "trim it",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    const result = DeviationResponseSchema.safeParse({
      deviation: "x",
      severity: "critical",
      suggestion: "y",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty deviation", () => {
    const result = DeviationResponseSchema.safeParse({
      deviation: "",
      severity: "low",
      suggestion: "y",
    });
    expect(result.success).toBe(false);
  });
});
