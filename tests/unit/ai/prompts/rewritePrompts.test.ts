import { describe, it, expect } from "vitest";
import { buildRewritePrompt } from "../../../../src/ai/prompts/index";

describe("buildRewritePrompt", () => {
  it("throws when includeRawText is false (default)", () => {
    expect(() => buildRewritePrompt("some text", "make it shorter")).toThrow(/includeRawText/);
  });

  it("throws when includeRawText is explicitly false", () => {
    expect(() =>
      buildRewritePrompt("some text", "make it shorter", { includeRawText: false }),
    ).toThrow(/includeRawText/);
  });

  it("includes the raw text and instructions when opted in", () => {
    const prompt = buildRewritePrompt("The quick brown fox.", "make it shorter", {
      includeRawText: true,
    });
    expect(prompt).toContain("The quick brown fox.");
    expect(prompt).toContain("make it shorter");
    expect(prompt).toContain("Rewrite the following text");
    expect(prompt).toContain("Return ONLY the rewritten text");
  });

  it("does not include raw text when opt-in is absent", () => {
    let thrown: unknown;
    try {
      buildRewritePrompt("secret text", "rewrite");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
  });
});
