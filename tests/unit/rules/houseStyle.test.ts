/**
 * The house-style rule, after ND-13.
 *
 * This module used to check preferred terminology and banned terms as well as
 * capitalisation. The registry filtered both terminology checks out of its
 * result — `language/terminology` and `language/banned` already reported the same
 * things from the normative `language` section — so the two House style fields a
 * user could edit produced nothing at all. They looked authoritative, validated
 * on save, round-tripped through storage, and governed nothing.
 *
 * `findTerminologyIssues` in `language.ts` is the single terminology engine now,
 * and it is strictly more capable: a `TerminologyRule` carries `wholeWord`,
 * `caseSensitive`, `severity` and a scope, where a `Record<string, string>` could
 * express a term and its replacement and nothing else. Its behaviour is asserted
 * in `language.test.ts` and `requiredTerms.test.ts`.
 *
 * What is left here is capitalisation, and it is tested properly.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/domain/Finding";
import type { HouseStyle } from "../../../src/core/domain/StyleProfile";
import { findHouseStyleIssues } from "../../../src/rules/houseStyle";

const defaultHouseStyle: HouseStyle = {
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

  it("returns no findings when the capitalisation settings are at their quiet defaults", () => {
    const findings = findHouseStyleIssues({
      text: "the Value and test",
      rules: quietHouseStyle,
    });

    expect(findings).toEqual([]);
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
    findings.forEach(expectDeterministicFinding);
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
      rules: quietHouseStyle,
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

  it("reports exact JavaScript character offsets for Unicode text", () => {
    const findings = findHouseStyleIssues({
      text: "🙂 café test",
      rules: {
        ...quietHouseStyle,
        capitalization: { sentenceCase: false, titleCaseWords: ["test"] },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      // Offset 8, not 7: `🙂 café ` is two UTF-16 units for the emoji plus four
      // for `café` plus two spaces, and JS string indexing counts the surrogate
      // pair as two. This is the offset contract the planner's ranges depend on.
      range: { start: 8, end: 9, unit: "character" },
      evidence: "t",
    });
  });

  it("handles case folding for Unicode title-case words", () => {
    const findings = findHouseStyleIssues({
      text: "CAFÉ and café",
      rules: {
        ...quietHouseStyle,
        capitalization: { sentenceCase: false, titleCaseWords: ["café"] },
      },
    });

    // `CAFÉ` opens correctly so only the trailing `café` is a finding: the check
    // is "does this word start with the house casing", not "is this word equal
    // to the configured one".
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      range: { start: 9, end: 10, unit: "character" },
      evidence: "c",
    });
  });
});

describe("terminology has left the house-style rule (ND-13)", () => {
  it("reports nothing for text that only a terminology rule could have flagged", () => {
    /*
     * This is the regression guard for the whole defect.
     *
     * `color` is the word the retired `preferredTerminology: { color: "colour" }`
     * check reported, and `utilise` is what the retired `bannedTerms` check
     * reported. Both are still exactly the words the *live* `language` engine
     * reports on — see `language.test.ts` — but nothing here may report them.
     *
     * Before the fix these two calls returned findings; a test that only counted
     * categories would have caught it, but the assertion is on the text because
     * the text is what a user would have typed and then seen nothing happen to.
     */
    const findings = findHouseStyleIssues({
      text: "The color is wrong. We could utilise it.",
      rules: quietHouseStyle,
    });

    expect(findings).toEqual([]);
  });
});
