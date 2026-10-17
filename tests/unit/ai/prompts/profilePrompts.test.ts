import { describe, it, expect } from "vitest";
import { buildProfilePromptV2 } from "../../../../src/ai/prompts/index";

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

  it("shows the response shape literally, so a model is not left to infer nesting", () => {
    // The key list this replaced stated the names and left the nesting, the
    // delimiters and the value types to inference.
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    expect(prompt).toContain('"tone": { "primary": "<allowed>"');
    expect(prompt).toContain('"transitions": "<allowed>",');
    expect(prompt).toContain('"lexicalPreferences": { "toneAvoid": [');
    expect(prompt).toContain('"formality": { "score": <integer 0-100>');
  });

  it("states each value's type, not only its key", () => {
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    expect(prompt).toContain("each of the sixteen keys is a JSON object");
    expect(prompt).toMatch(/boolean field is JSON true or false, unquoted/);
    expect(prompt).toMatch(/JSON arrays of strings, never one comma-separated string/);
  });

  it("tells the model not to quote the sample in any free-text field", () => {
    // Verified afterwards regardless, but telling the model is cheaper than
    // telling a user their provider returned a leak. The instruction covers
    // every free-text field — descriptions — because the leakage check reads
    // all of them (R2). The formality label is derived, not free-text (R14).
    const prompt = buildProfilePromptV2("text", [], { includeRawText: true });
    expect(prompt).toMatch(/No free-text field \(description\)/);
    expect(prompt).toMatch(/must name a project, a company, a person, a date, an amount/);
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
