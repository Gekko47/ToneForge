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
 *
 * **`checkSentenceCase` was deleted** (ADR-0125), along with the profile field and
 * the toggle that wrote it. It flagged a sentence not opening with a capital —
 * the same judgement `language.capitalisation.sentenceCase` makes — while walking
 * every sentence in the document. The registry filtered its category out, so the
 * toggle produced nothing a user could observe. Scoped to headings it would have
 * collided with `language.capitalisation.headingCase`, which already enforces
 * sentence case there.
 *
 * The four tests that asserted its behaviour are deleted rather than rewritten,
 * because the behaviour is gone. `sentenceCase has left the house-style rule`
 * below replaces them: it asserts the module reports nothing for the text those
 * tests used to assert it reported, which is the direction that actually matters.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/domain/Finding";
import type { HouseStyle } from "../../../src/core/domain/StyleProfile";
import { findHouseStyleIssues } from "../../../src/rules/houseStyle";

const defaultHouseStyle: HouseStyle = {
  capitalization: { titleCaseWords: [] },
  spellingVariant: "en-US",
};

/**
 * The neutral profile: nothing configured, so nothing reported.
 *
 * Was a distinct object with `sentenceCase: false`, which existed to switch the
 * deleted check off. With the field gone the two constants were the same value,
 * and an alias of `defaultHouseStyle` under a second name is a reader's cue that
 * they differ. One name now.
 */
const quietHouseStyle: HouseStyle = defaultHouseStyle;

/**
 * The shape every finding this module emits must have.
 *
 * Applied to the title-case findings rather than only asserted once: a finding
 * with no id cannot be reviewed, and one without `kind` cannot be told apart
 * from a semantic finding in a list that shows both.
 */
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

  it("flags configured title-case words when their first cased character is lowercase", () => {
    const text = "the Value and test";
    const findings = findHouseStyleIssues({
      text,
      rules: {
        ...defaultHouseStyle,
        capitalization: { titleCaseWords: ["the", "value", "and"] },
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
    findings.forEach(expectDeterministicFinding);
  });

  it("matches title-case words case-insensitively but ignores larger words", () => {
    const findings = findHouseStyleIssues({
      text: "VALUE value valueless",
      rules: {
        ...defaultHouseStyle,
        capitalization: { titleCaseWords: ["value"] },
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
        capitalization: { titleCaseWords: ["test"] },
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
        capitalization: { titleCaseWords: ["café"] },
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

describe("sentenceCase has left the house-style rule (ADR-0125)", () => {
  /*
   * Four tests were deleted with the check they asserted. This is what replaces
   * them, and it asserts the opposite direction: the text those tests expected
   * findings for must now produce none.
   *
   * Without this, deleting the rule would look identical to deleting its tests —
   * which is the shape a coverage loss takes when nobody is looking. Here the
   * removal is the assertion.
   */
  it("reports nothing for the text the retired check used to flag", () => {
    const findings = findHouseStyleIssues({
      text: 'hello world. another world! third starts here. "quoted" again. 123 second.',
      rules: defaultHouseStyle,
    });

    expect(findings).toEqual([]);
  });

  it("emits no sentence-case category or profile path at all, whatever the text", () => {
    const findings = findHouseStyleIssues({
      text: "lowercase start. Another Sentence. yet another one.",
      rules: defaultHouseStyle,
    });

    const categories = findings.map((finding) => finding.category);
    const profilePaths = findings.flatMap((finding) =>
      finding.deterministic === undefined ? [] : [finding.deterministic.profilePath],
    );

    expect(categories).not.toContain("houseStyle.capitalization.sentenceCase");
    expect(profilePaths).not.toContain("houseStyle.capitalization.sentenceCase");
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
