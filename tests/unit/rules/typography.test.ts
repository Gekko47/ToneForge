import { describe, expect, it } from "vitest";
import type { TypographyRules } from "../../../src/core/domain/StyleProfile";
import { findTypographyIssues } from "../../../src/rules/typography";

const defaultRules: TypographyRules = {
  emDash: "em",
  emDashSpacing: "spaced",
  enDashSpacing: "spaced",
  doubleQuotes: "curly",
  singleQuotes: "curly",
  apostrophes: "curly",
  decimalSeparator: "dot",
  thousandsSeparator: "none",
  ellipsis: "ellipsis",
};

describe("findTypographyIssues", () => {
  it("returns an empty array for empty input", () => {
    expect(findTypographyIssues({ text: "", rules: defaultRules })).toEqual([]);
  });

  it("flags double hyphen when em dash is preferred", () => {
    const findings = findTypographyIssues({
      text: "This is a test -- with emphasis",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.emDash");
    expect(findings[0]?.message).toContain("em dash");
    expect(findings[0]?.range).toEqual({
      start: 15,
      end: 17,
      unit: "character",
    });
    expect(findings[0]?.evidence).toBe("--");
    expect(findings[0]?.kind).toBe("deterministic");
    expect(findings[0]?.confidence).toBe(1);
  });

  it("flags em dash when double hyphen is preferred", () => {
    const findings = findTypographyIssues({
      text: "This is a test — with emphasis",
      rules: { ...defaultRules, emDash: "hyphen" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.emDash");
    expect(findings[0]?.message).toContain("double hyphen");
    expect(findings[0]?.range).toEqual({
      start: 15,
      end: 16,
      unit: "character",
    });
  });

  it("flags em dash and double hyphen when space is preferred", () => {
    const findings = findTypographyIssues({
      text: "First—dash -- second",
      rules: { ...defaultRules, emDash: "space" },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.category)).toEqual(["typography.emDash", "typography.emDash"]);
    expect(findings[0]?.range).toEqual({ start: 5, end: 6, unit: "character" });
    expect(findings[1]?.range).toEqual({ start: 11, end: 13, unit: "character" });
  });

  it("flags spaced em dash when tight spacing is preferred", () => {
    const findings = findTypographyIssues({
      text: "word — word",
      rules: { ...defaultRules, emDashSpacing: "tight" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.emDashSpacing");
    expect(findings[0]?.range).toEqual({
      start: 5,
      end: 6,
      unit: "character",
    });
    expect(findings[0]?.message).toContain("tight");
  });

  it("flags tight em dash when spaced spacing is preferred", () => {
    const findings = findTypographyIssues({
      text: "word—word",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.emDashSpacing");
    expect(findings[0]?.range).toEqual({
      start: 4,
      end: 5,
      unit: "character",
    });
    expect(findings[0]?.message).toContain("spaced");
  });

  it("does not flag em dash at text boundaries for spacing", () => {
    const findings = findTypographyIssues({
      text: "—word",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(0);
  });

  it("flags spaced en dash when tight spacing is preferred", () => {
    const findings = findTypographyIssues({
      text: "1 – 5",
      rules: { ...defaultRules, enDashSpacing: "tight" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.enDashSpacing");
    expect(findings[0]?.range).toEqual({
      start: 2,
      end: 3,
      unit: "character",
    });
  });

  it("flags tight en dash when spaced spacing is preferred", () => {
    const findings = findTypographyIssues({
      text: "1–5",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.enDashSpacing");
    expect(findings[0]?.range).toEqual({
      start: 1,
      end: 2,
      unit: "character",
    });
  });

  it("flags straight double quotes when curly quotes are preferred", () => {
    const findings = findTypographyIssues({
      text: 'He said "hello"',
      rules: defaultRules,
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.category)).toEqual([
      "typography.doubleQuotes",
      "typography.doubleQuotes",
    ]);
    expect(findings[0]?.range).toEqual({ start: 8, end: 9, unit: "character" });
    expect(findings[1]?.range).toEqual({ start: 14, end: 15, unit: "character" });
  });

  it("flags curly double quotes when straight quotes are preferred", () => {
    const findings = findTypographyIssues({
      text: "He said “hello”",
      rules: { ...defaultRules, doubleQuotes: "straight" },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.category)).toEqual([
      "typography.doubleQuotes",
      "typography.doubleQuotes",
    ]);
    expect(findings[0]?.message).toContain("straight double quote");
  });

  it("flags straight single quotes when curly quotes are preferred", () => {
    const findings = findTypographyIssues({
      text: "She said 'hello'",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.category)).toEqual([
      "typography.singleQuotes",
      "typography.singleQuotes",
    ]);
    expect(findings[0]?.range).toEqual({ start: 9, end: 10, unit: "character" });
  });

  it("flags curly single quotes when straight quotes are preferred", () => {
    const findings = findTypographyIssues({
      text: "She said ‘hello’",
      rules: { ...defaultRules, singleQuotes: "straight" },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.category)).toEqual([
      "typography.singleQuotes",
      "typography.singleQuotes",
    ]);
  });

  it("flags straight apostrophes when curly apostrophes are preferred", () => {
    const findings = findTypographyIssues({
      text: "don't stop",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.apostrophes");
    expect(findings[0]?.range).toEqual({
      start: 3,
      end: 4,
      unit: "character",
    });
  });

  it("flags curly apostrophes when straight apostrophes are preferred", () => {
    const findings = findTypographyIssues({
      text: "don’t stop",
      rules: { ...defaultRules, apostrophes: "straight" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.apostrophes");
    expect(findings[0]?.range).toEqual({
      start: 3,
      end: 4,
      unit: "character",
    });
  });

  it("does not flag apostrophes as single quotes and vice versa", () => {
    const apostropheFindings = findTypographyIssues({
      text: "don't",
      rules: defaultRules,
    });
    expect(apostropheFindings).toHaveLength(1);
    expect(apostropheFindings[0]?.category).toBe("typography.apostrophes");

    const quoteFindings = findTypographyIssues({
      text: "say 'hello'",
      rules: defaultRules,
    });
    expect(quoteFindings).toHaveLength(2);
    expect(quoteFindings.every((f) => f.category === "typography.singleQuotes")).toBe(true);
  });

  it("flags three dots when ellipsis character is preferred", () => {
    const findings = findTypographyIssues({
      text: "wait...",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.ellipsis");
    expect(findings[0]?.range).toEqual({
      start: 4,
      end: 7,
      unit: "character",
    });
  });

  it("flags ellipsis character when three dots are preferred", () => {
    const findings = findTypographyIssues({
      text: "wait…",
      rules: { ...defaultRules, ellipsis: "three-dots" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.ellipsis");
    expect(findings[0]?.message).toContain("three dots");
  });

  it("flags both ellipsis and three dots when spaced dots are preferred", () => {
    const findings = findTypographyIssues({
      text: "wait… then...",
      rules: { ...defaultRules, ellipsis: "spaced-dots" },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.range.start)).toEqual([4, 10]);
  });

  it("flags multiple consecutive spaces", () => {
    const findings = findTypographyIssues({
      text: "hello  world",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.whitespace");
    expect(findings[0]?.range).toEqual({
      start: 5,
      end: 7,
      unit: "character",
    });
  });

  it("flags trailing spaces", () => {
    const findings = findTypographyIssues({
      text: "hello \nworld",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.whitespace");
    expect(findings[0]?.range).toEqual({
      start: 5,
      end: 6,
      unit: "character",
    });
  });

  it("flags tabs", () => {
    const findings = findTypographyIssues({
      text: "hello\tworld",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.whitespace");
    expect(findings[0]?.range).toEqual({
      start: 5,
      end: 6,
      unit: "character",
    });
  });

  it("flags non-breaking spaces", () => {
    const findings = findTypographyIssues({
      text: "hello\u00a0world",
      rules: defaultRules,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.whitespace");
    expect(findings[0]?.range).toEqual({
      start: 5,
      end: 6,
      unit: "character",
    });
  });

  it("reports multiple issue categories for mixed input", () => {
    const findings = findTypographyIssues({
      text: 'He said "don\'t..." -- really',
      rules: defaultRules,
    });

    const categories = findings.map((f) => f.category);
    expect(categories).toEqual(
      expect.arrayContaining([
        "typography.doubleQuotes",
        "typography.apostrophes",
        "typography.ellipsis",
        "typography.emDash",
      ]),
    );
  });
});
