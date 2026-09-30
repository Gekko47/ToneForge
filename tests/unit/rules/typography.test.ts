import { describe, expect, it } from "vitest";
import { TypographyRulesSchema } from "../../../src/core/domain/StyleProfile";
import type { TypographyRules } from "../../../src/core/domain/StyleProfile";
import { findTypographyIssues } from "../../../src/rules/typography";

/**
 * Built through the schema, not written out field by field.
 *
 * A hand-written literal has to be amended every time a setting is added, and
 * the amend is mechanical — which is how a new typography field ends up absent
 * from its own test and therefore untested. Parsing an empty object makes the
 * schema's defaults the single source of truth for "the default profile", so a
 * new field is exercised here the moment it has one.
 */
const defaultRules: TypographyRules = TypographyRulesSchema.parse({});

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

  it("flags decimal and thousands separators against the profile", () => {
    const findings = findTypographyIssues({
      text: "Total 1,234.56",
      rules: { ...defaultRules, decimalSeparator: "dot", thousandsSeparator: "none" },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.category)).toEqual([
      "typography.decimalSeparator",
      "typography.thousandsSeparator",
    ]);
    expect(findings.map((finding) => finding.range.start)).toEqual([7, 7]);
  });

  it("converts alternate locale separators to the configured punctuation", () => {
    const decimalFindings = findTypographyIssues({
      text: "Total 1234.56",
      rules: { ...defaultRules, decimalSeparator: "comma", thousandsSeparator: "comma" },
    });
    const thousandsFindings = findTypographyIssues({
      text: "Total 1 234",
      rules: { ...defaultRules, thousandsSeparator: "comma" },
    });

    expect(decimalFindings.map((finding) => finding.category)).toEqual([
      "typography.decimalSeparator",
    ]);
    expect(thousandsFindings.map((finding) => finding.category)).toEqual([
      "typography.thousandsSeparator",
    ]);
    expect(thousandsFindings[0]?.evidence).toBe(" ");
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

  /*
   * A spacing finding's range must cover the gap and nothing else.
   *
   * Both rules below matched one character wider than the gap, so the planner
   * replaced text the finding was only pointing at: the currency symbol with the
   * space case, and the word before the bracket with the parenthetical case.
   * These assert the range, because "a finding was reported" was true before and
   * said nothing about what applying it would have destroyed.
   */
  it("measures a currency symbol's gap without covering the symbol", () => {
    const findings = findTypographyIssues({
      text: "The cost was $ 100.",
      rules: { ...defaultRules, currencySpacing: "tight" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("typography.punctuation");
    // The single space, and only the single space. The `$` at index 13 is
    // outside it, so the correction removes the gap and keeps the symbol.
    expect(findings[0]?.range).toEqual({ start: 14, end: 15, unit: "character" });
    expect(findings[0]?.evidence).toBe(" ");
  });

  it("reports a tight currency symbol as a zero-width gap to insert into", () => {
    const findings = findTypographyIssues({
      text: "The cost was $100.",
      rules: { ...defaultRules, currencySpacing: "spaced" },
    });

    expect(findings).toHaveLength(1);
    // Zero-width, immediately after the symbol: the planner turns this into an
    // insert of one space rather than a replacement over the `$`.
    expect(findings[0]?.range).toEqual({ start: 14, end: 14, unit: "character" });
    expect(findings[0]?.expected).toBe(" ");
  });

  it("says nothing about a currency symbol already spaced as the profile wants", () => {
    const findings = findTypographyIssues({
      text: "The cost was $ 100.",
      rules: { ...defaultRules, currencySpacing: "spaced" },
    });

    expect(findings).toEqual([]);
  });

  it("says nothing about a bracket that already has its space", () => {
    // The setting asks for a space, and this text has one. The previous rule
    // reported it anyway, which is the failure the function's own note warns
    // about: a rule that fires on correct text teaches the reader to ignore it.
    const findings = findTypographyIssues({
      text: "See the note (below) for detail.",
      rules: { ...defaultRules, spaceBeforeParenthesis: true },
    });

    expect(findings).toEqual([]);
  });

  it("never puts the word before a bracket inside the finding's range", () => {
    /*
     * The load-bearing assertion: whatever the rule reports, applying it must
     * not touch the word. The old match began at the non-space character, so
     * its range covered `note` and the correction replaced the word.
     */
    const findings = findTypographyIssues({
      text: "See the note(below) for detail.",
      rules: { ...defaultRules, spaceBeforeParenthesis: true },
    });

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    // Zero-width, immediately before the bracket at index 12.
    expect(finding?.range).toEqual({ start: 12, end: 12, unit: "character" });
    expect("See the note(below) for detail.".slice(12, 12)).toBe("");
    expect("See the note(below) for detail."[12]).toBe("(");
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
