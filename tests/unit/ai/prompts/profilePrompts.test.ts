import { describe, it, expect } from "vitest";
import {
  buildProfilePrompt,
  buildDeviationPrompt,
} from "../../../../src/ai/prompts/profilePrompts";

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
