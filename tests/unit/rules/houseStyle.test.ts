import { describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/domain/Finding";
import type { HouseStyle } from "../../../src/core/domain/StyleProfile";
import { findHouseStyleIssues } from "../../../src/rules/houseStyle";

const defaultHouseStyle: HouseStyle = {
  preferredTerminology: {},
  bannedTerms: [],
  capitalization: {
    sentenceCase: true,
    titleCaseWords: [],
  },
  spellingVariant: "en-US",
};

const quietHouseStyle: HouseStyle = {
  ...defaultHouseStyle,
  capitalization: { sentenceCase: false, titleCaseWords: [] },
};

function expectDeterministicFinding(finding: Finding): void {
  expect(finding.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(finding.kind).toBe("deterministic");
  expect(finding.range.unit).toBe("character");
  expect(finding.confidence).toBe(1);
}

describe("findHouseStyleIssues", () => {
  it("returns an empty array for empty input", () => {
    expect(findHouseStyleIssues({ text: "", rules: defaultHouseStyle })).toEqual([]);
  });

  it("returns no findings when terminology, banned terms, and title-case words are empty", () => {
    const findings = findHouseStyleIssues({
      text: "This sentence follows the default house style.",
      rules: defaultHouseStyle,
    });

    expect(findings).toEqual([]);
  });

  it("finds preferred terminology case-insensitively with exact offsets and evidence", () => {
    const text = "Use CUSTOMER_ID and customer_id consistently.";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...quietHouseStyle,
        preferredTerminology: { customer_id: "customer identifier" },
      },
    });

    expect(findings).toHaveLength(2);
    findings.forEach(expectDeterministicFinding);
    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.terminology",
      "houseStyle.terminology",
    ]);
    expect(findings[0]).toMatchObject({
      range: { start: 4, end: 15, unit: "character" },
      evidence: "CUSTOMER_ID",
      message: "Use “customer identifier” instead of “customer_id”",
      severity: "warning",
    });
    expect(findings[1]).toMatchObject({
      range: { start: 20, end: 31, unit: "character" },
      evidence: "customer_id",
    });
  });

  it("selects the longest overlapping preferred terminology candidate", () => {
    const findings = findHouseStyleIssues({
      text: "The artificial intelligence platform is ready.",
      rules: {
        ...quietHouseStyle,
        preferredTerminology: {
          ai: "AI",
          artificial: "synthetic",
          "artificial intelligence": "machine intelligence",
        },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "houseStyle.terminology",
      range: { start: 4, end: 27, unit: "character" },
      evidence: "artificial intelligence",
      message: "Use “machine intelligence” instead of “artificial intelligence”",
    });
  });

  it("orders non-overlapping preferred terminology findings by text position", () => {
    const findings = findHouseStyleIssues({
      text: "beta then alpha",
      rules: {
        ...quietHouseStyle,
        preferredTerminology: {
          alpha: "first",
          beta: "second",
        },
      },
    });

    expect(findings.map((finding) => finding.range.start)).toEqual([0, 10]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["beta", "alpha"]);
  });

  it("uses bounded preferred terminology matching", () => {
    const findings = findHouseStyleIssues({
      text: "colorful paint uses color.",
      rules: {
        ...quietHouseStyle,
        preferredTerminology: { color: "colour" },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      range: { start: 20, end: 25, unit: "character" },
      evidence: "color",
    });
  });

  it("ignores empty and whitespace-only terminology entries", () => {
    const findings = findHouseStyleIssues({
      text: "color and colour",
      rules: {
        ...quietHouseStyle,
        preferredTerminology: {
          "": "ignored",
          "   ": "ignored",
          color: "",
          "  colour  ": "  hue  ",
        },
      },
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      category: "houseStyle.terminology",
      range: { start: 10, end: 16, unit: "character" },
      evidence: "colour",
      message: "Use “hue” instead of “colour”",
    });
    expect(findings[1]).toMatchObject({
      category: "houseStyle.spellingVariant",
      range: { start: 10, end: 16, unit: "character" },
      evidence: "colour",
    });
  });

  it("finds banned terms at boundaries and deduplicates duplicate configured terms", () => {
    const text = "color, COLOR and colorful.";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...quietHouseStyle,
        bannedTerms: ["color", "  color  ", "COLOR"],
      },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.bannedTerm",
      "houseStyle.bannedTerm",
    ]);
    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 5, unit: "character" },
      { start: 7, end: 12, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["color", "COLOR"]);
    expect(findings.every((finding) => finding.severity === "error")).toBe(true);
  });

  it("does not flag banned terms inside larger words", () => {
    const findings = findHouseStyleIssues({
      text: "colorful and discolor are allowed here",
      rules: {
        ...quietHouseStyle,
        bannedTerms: ["color"],
      },
    });

    expect(findings).toEqual([]);
  });

  it("supports multi-word banned terms and punctuation boundaries", () => {
    const text = "Use open source tools; open-source is different.";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...quietHouseStyle,
        bannedTerms: ["open source"],
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      range: { start: 4, end: 15, unit: "character" },
      evidence: "open source",
      message: "Remove banned term “open source”",
    });
  });

  it("flags lowercase sentence starts, including after punctuation", () => {
    const text = "hello world. another world! third starts here.";
    const findings = findHouseStyleIssues({ text, rules: defaultHouseStyle });

    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.capitalization.sentenceCase",
      "houseStyle.capitalization.sentenceCase",
      "houseStyle.capitalization.sentenceCase",
    ]);
    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 1, unit: "character" },
      { start: 13, end: 14, unit: "character" },
      { start: 28, end: 29, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["h", "a", "t"]);
    expect(findings.map((finding) => finding.message)).toEqual([
      "Start the sentence with uppercase “H”",
      "Start the sentence with uppercase “A”",
      "Start the sentence with uppercase “T”",
    ]);
  });

  it("skips punctuation and numbers when finding the first sentence character", () => {
    const findings = findHouseStyleIssues({
      text: '"hello" again. 123 second.',
      rules: defaultHouseStyle,
    });

    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 1, end: 2, unit: "character" },
      { start: 19, end: 20, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["h", "s"]);
  });

  it("does not flag sentence starts when sentence-case checking is disabled", () => {
    const findings = findHouseStyleIssues({
      text: "lowercase start. another lowercase start.",
      rules: {
        ...defaultHouseStyle,
        capitalization: { sentenceCase: false, titleCaseWords: [] },
      },
    });

    expect(findings).toEqual([]);
  });

  it("does not flag already capitalized sentence starts", () => {
    const findings = findHouseStyleIssues({
      text: "Hello world. Another sentence.",
      rules: defaultHouseStyle,
    });

    expect(findings).toEqual([]);
  });

  it("flags configured title-case words when their first cased character is lowercase", () => {
    const text = "the Value and test";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...defaultHouseStyle,
        capitalization: { sentenceCase: false, titleCaseWords: ["the", "value", "and"] },
      },
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.capitalization.titleCase",
      "houseStyle.capitalization.titleCase",
    ]);
    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 1, unit: "character" },
      { start: 10, end: 11, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["t", "a"]);
    expect(findings.map((finding) => finding.actual)).toEqual(["t", "a"]);
    expect(findings.map((finding) => finding.expected)).toEqual(["T", "A"]);
    expect(findings.map((finding) => finding.transformation)).toEqual([
      { kind: "case", style: "title", text: "t" },
      { kind: "case", style: "title", text: "a" },
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      "Capitalize title-case word “the”",
      "Capitalize title-case word “and”",
    ]);
  });

  it("matches title-case words case-insensitively but ignores larger words", () => {
    const findings = findHouseStyleIssues({
      text: "VALUE value valueless",
      rules: {
        ...defaultHouseStyle,
        capitalization: { sentenceCase: false, titleCaseWords: ["value"] },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      range: { start: 6, end: 7, unit: "character" },
      evidence: "v",
    });
  });

  it("ignores empty and whitespace-only title-case words", () => {
    const findings = findHouseStyleIssues({
      text: "The Value",
      rules: {
        ...defaultHouseStyle,
        capitalization: {
          sentenceCase: false,
          titleCaseWords: ["", "   ", "value"],
        },
      },
    });

    expect(findings).toEqual([]);
  });

  it("flags en-GB alternatives while leaving the preferred en-GB spelling alone", () => {
    const findings = findHouseStyleIssues({
      text: "color favorite program",
      rules: {
        ...quietHouseStyle,
        spellingVariant: "en-GB",
      },
    });

    expect(findings).toHaveLength(3);
    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.spellingVariant",
      "houseStyle.spellingVariant",
      "houseStyle.spellingVariant",
    ]);
    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 5, unit: "character" },
      { start: 6, end: 14, unit: "character" },
      { start: 15, end: 22, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["color", "favorite", "program"]);
    expect(findings.every((finding) => finding.message.includes("en-GB"))).toBe(true);
  });

  it("flags en-US alternatives while leaving preferred en-US spellings alone", () => {
    const findings = findHouseStyleIssues({
      text: "colour favourite programme",
      rules: {
        ...quietHouseStyle,
        spellingVariant: "en-US",
      },
    });

    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 6, unit: "character" },
      { start: 7, end: 16, unit: "character" },
      { start: 17, end: 26, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual([
      "colour",
      "favourite",
      "programme",
    ]);
  });

  it("uses the Australian variant table and treats program as preferred", () => {
    const findings = findHouseStyleIssues({
      text: "color favorite programme",
      rules: {
        ...quietHouseStyle,
        spellingVariant: "au",
      },
    });

    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 5, unit: "character" },
      { start: 6, end: 14, unit: "character" },
      { start: 15, end: 24, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["color", "favorite", "programme"]);
  });

  it("does not flag preferred spelling variants or alternatives inside larger words", () => {
    const findings = findHouseStyleIssues({
      text: "Colorful colourless Favorite",
      rules: {
        ...quietHouseStyle,
        spellingVariant: "en-US",
      },
    });

    expect(findings).toEqual([]);
  });

  it("reports exact JavaScript character offsets for Unicode text", () => {
    const text = "🙂 café color";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...quietHouseStyle,
        preferredTerminology: { café: "cafe" },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      range: { start: 3, end: 7, unit: "character" },
      evidence: "café",
    });
  });

  it("handles case folding for Unicode terminology", () => {
    const findings = findHouseStyleIssues({
      text: "CAFÉ is a café",
      rules: {
        ...quietHouseStyle,
        preferredTerminology: { café: "cafe" },
      },
    });

    expect(findings.map((finding) => finding.range)).toEqual([
      { start: 0, end: 4, unit: "character" },
      { start: 10, end: 14, unit: "character" },
    ]);
    expect(findings.map((finding) => finding.evidence)).toEqual(["CAFÉ", "café"]);
  });

  it("reports all house-style categories for mixed input", () => {
    const findings = findHouseStyleIssues({
      text: "color the colour. next sentence.",
      rules: {
        preferredTerminology: { color: "colour" },
        bannedTerms: ["the"],
        capitalization: {
          sentenceCase: true,
          titleCaseWords: ["the"],
        },
        spellingVariant: "en-GB",
      },
    });

    expect(findings.map((finding) => finding.category)).toEqual([
      "houseStyle.terminology",
      "houseStyle.bannedTerm",
      "houseStyle.capitalization.sentenceCase",
      "houseStyle.capitalization.sentenceCase",
      "houseStyle.capitalization.titleCase",
      "houseStyle.spellingVariant",
    ]);
    expect(findings.map((finding) => finding.range.start)).toEqual([0, 6, 0, 18, 6, 0]);
  });

  it("handles large inputs without missing repeated matches", () => {
    const text = "color ".repeat(2_000);
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...quietHouseStyle,
        spellingVariant: "en-GB",
      },
    });

    expect(findings).toHaveLength(2_000);
    expect(findings[0]).toMatchObject({
      range: { start: 0, end: 5, unit: "character" },
      evidence: "color",
    });
    expect(findings.at(-1)).toMatchObject({
      range: { start: 11_994, end: 11_999, unit: "character" },
      evidence: "color",
    });
  });
});
