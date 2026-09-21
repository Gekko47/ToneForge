import { describe, expect, it } from "vitest";
import {
  lookupWordStyle,
  WORD_STYLE_MAPPING,
  HEADING_STYLE_NAMES,
} from "../../../src/formatting/wordStyles";

describe("lookupWordStyle", () => {
  it("returns the mapping for a known style name", () => {
    const mapping = lookupWordStyle("Heading 1");
    expect(mapping).toBeDefined();
    expect(mapping?.wordName).toBe("Heading 1");
  });

  it("matches case-insensitively", () => {
    expect(lookupWordStyle("heading 1")).toBeDefined();
    expect(lookupWordStyle("TITLE")).toBeDefined();
    expect(lookupWordStyle("Normal")).toBeDefined();
  });

  it("returns undefined for unknown styles", () => {
    expect(lookupWordStyle("Unknown Style")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(lookupWordStyle("")).toBeUndefined();
    expect(lookupWordStyle("   ")).toBeUndefined();
  });

  it("exposes a non-empty mapping table", () => {
    expect(WORD_STYLE_MAPPING.length).toBeGreaterThan(0);
    expect(WORD_STYLE_MAPPING.some((m) => m.wordName === "Normal")).toBe(true);
    expect(WORD_STYLE_MAPPING.some((m) => m.wordName === "Title")).toBe(true);
  });

  it("exposes heading names 1 through 9", () => {
    expect(HEADING_STYLE_NAMES).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Heading 7",
      "Heading 8",
      "Heading 9",
    ]);
  });
});
