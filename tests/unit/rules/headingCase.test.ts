/**
 * `language.capitalisation.headingCase` — the convention headings are written in.
 *
 * **The defect.** The field was declared in the schema, named in
 * `language/capitalisation`'s `profilePaths`, and read by nothing. The registry
 * reported it as wired, so the §11 audit reported no defect — the guard counts a
 * field as covered when a rule with a body *claims* it, and a claim is not a read.
 * This is the third instance of that failure mode (after ND-13 and
 * `preferredExpanded`) and the reason ADR-0111 exists.
 *
 * **What these tests are really pinning.** Three conventions with three
 * different correction stories. `upper` and `title` are correctable — raising or
 * capping one letter inside a word cannot change which word it is. `sentence` is
 * not, because lower-casing a word the profile has not listed as a proper noun may
 * destroy one. A rule that offered the correction anyway would be offering to
 * delete a capital the author put there on purpose.
 */

import { describe, expect, it } from "vitest";

import { findCapitalisationIssues } from "../../../src/rules/language";
import type {
  CapitalisationProfile,
  LanguageConventionProfile,
} from "../../../src/core/domain/StyleProfile";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

const HEADING_CASE = "language.capitalisation.headingCase";

function profile(capitalisation: Partial<CapitalisationProfile> = {}): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({
    capitalisation: { sentenceCase: false, ...capitalisation },
  });
}

/** The style map the reader would produce: paragraph start offset → style name. */
function styles(entries: readonly (readonly [number, string])[]): ReadonlyMap<number, string> {
  return new Map(entries);
}

function headingFindings(
  text: string,
  capitalisation: Partial<CapitalisationProfile>,
  styleByStart?: ReadonlyMap<number, string>,
): Finding[] {
  return findCapitalisationIssues({
    text,
    rules: profile(capitalisation),
    ...(styleByStart === undefined ? {} : { styleByStart }),
  }).filter((finding) => finding.category === HEADING_CASE);
}

describe("headingCase says nothing until the house has chosen a convention", () => {
  it("reports nothing when headingCase is unset", () => {
    expect(headingFindings("a report on things", {}, styles([[0, "Heading 1"]]))).toEqual([]);
  });

  it("reports nothing when the reader gave no paragraph styles", () => {
    // The honest answer to "which paragraphs are headings" on a text-only scan is
    // none. Reporting every paragraph as a heading would be a guess.
    expect(headingFindings("a report on things", { headingCase: "title" })).toEqual([]);
  });

  it("reports nothing when the style map is empty", () => {
    expect(headingFindings("a report on things", { headingCase: "title" }, new Map())).toEqual([]);
  });

  it("ignores a body paragraph whatever convention is chosen", () => {
    expect(
      headingFindings("A Report On Things", { headingCase: "upper" }, styles([[0, "Body Text"]])),
    ).toEqual([]);
  });

  it("distinguishes unset from a chosen sentence-case convention", () => {
    // The two are different answers, which is why the field is optional and the
    // editor offers "Not set". A profile that has not chosen must not be reported
    // as though it had chosen sentence case.
    expect(headingFindings("A Report On Things", {}, styles([[0, "Heading 1"]]))).toEqual([]);
    expect(
      headingFindings(
        "A Report On Things",
        { headingCase: "sentence" },
        styles([[0, "Heading 1"]]),
      ),
    ).not.toEqual([]);
  });
});

describe("upper-case headings", () => {
  const upper = (text: string) =>
    headingFindings(text, { headingCase: "upper" }, styles([[0, "Heading 1"]]));

  it("reports every lower-case letter and offers to raise it", () => {
    const findings = upper("Annual Report");

    expect(findings.map((finding) => finding.actual)).toEqual([
      "n",
      "n",
      "u",
      "a",
      "l",
      "e",
      "p",
      "o",
      "r",
      "t",
    ]);
    expect(findings[0]).toMatchObject({
      category: HEADING_CASE,
      severity: "warning",
      expected: "N",
      deterministic: {
        profilePath: "language.capitalisation.headingCase",
        correctionAvailable: true,
      },
    });
  });

  it("gives each occurrence its own offset rather than repeating the first", () => {
    // "Annual" has two lower-case n's at different offsets. A `indexOf` walk would
    // report the second at the first one's position, and the user would be sent to
    // the wrong character twice.
    expect(upper("Annual").map((finding) => finding.range.start)).toEqual([1, 2, 3, 4, 5]);
  });

  it("says nothing about a heading already in upper case", () => {
    expect(upper("ANNUAL REPORT")).toEqual([]);
  });

  it("leaves digits and punctuation alone", () => {
    // The 2, 0, 2, 6 and the colon are not letters, and an upper-case rule that
    // rewrote a digit would be corrupting a figure.
    expect(upper("Report 2026: A Review").map((finding) => finding.actual)).toEqual([
      "e",
      "p",
      "o",
      "r",
      "t",
      "e",
      "v",
      "i",
      "e",
      "w",
    ]);
  });

  it("declares no batch key, because each occurrence wants a different correction", () => {
    upper("Annual").forEach((finding) => {
      expect(finding.deterministic?.safeBatchKey).toBeUndefined();
    });
  });
});

describe("title-case headings", () => {
  const title = (text: string, capitalisation: Partial<CapitalisationProfile> = {}) =>
    headingFindings(text, { headingCase: "title", ...capitalisation }, styles([[0, "Heading 1"]]));

  it("reports a significant word written in lower case, correctably", () => {
    const findings = title("The Swan lake Report");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      actual: "l",
      expected: "L",
      range: { start: 9, end: 10 },
      deterministic: { correctionAvailable: true },
    });
  });

  it("leaves a minor word in lower case", () => {
    expect(title("Swan Lake of the Hour")).toEqual([]);
  });

  it("leaves a listed proper noun alone", () => {
    // The house has told the rule what a proper noun is. Guessing that `tuesday`
    // is one would be the tool second-guessing a field the user filled in — and
    // this text puts it past the first word so the proper-noun path is the only
    // thing that can excuse it.
    expect(title("The tuesday Review", { properNouns: ["tuesday"] })).toEqual([]);
  });

  it("says nothing about a heading already in title case", () => {
    expect(title("The Swan Lake Report")).toEqual([]);
  });

  it("accepts one capitalised word after a colon, and no more", () => {
    // Only the word the colon introduces. Excusing everything after it would let
    // a heading in any case at all hide behind one colon.
    expect(title("Annual Report: The Swan Lake")).toEqual([]);
    expect(title("Annual Report: The swan lake")).toHaveLength(2);
  });

  it("does not report a minor word that has been over-capitalised", () => {
    /*
     * A capitalised "Of" is a deviation from most title-case rules, and this rule
     * deliberately does not report it. Lower-casing a word the profile has not
     * listed as a proper noun may destroy one, so the finding would have to be
     * non-correctable — and a report of something the user can only fix by hand,
     * on every document that capitalises a small word, is noise.
     *
     * Stated as a test rather than left implied, because "we only catch one
     * direction" is exactly the kind of half-rule a later reader assumes is a bug.
     */
    expect(title("Swan Lake Of The Hour")).toEqual([]);
  });
});

describe("sentence-case headings", () => {
  const sentence = (text: string, capitalisation: Partial<CapitalisationProfile> = {}) =>
    headingFindings(
      text,
      { headingCase: "sentence", ...capitalisation },
      styles([[0, "Heading 1"]]),
    );

  it("reports every later word that is capitalised, with no correction", () => {
    const findings = sentence("The Swan Lake Report");

    // "Swan" is included: it is not the first word, it is not an acronym, and the
    // profile has not said it is a proper noun. Under sentence case it is wrong.
    expect(findings.map((finding) => finding.actual)).toEqual(["S", "L", "R"]);
    expect(findings[0]).toMatchObject({
      category: HEADING_CASE,
      expected: "",
      deterministic: { correctionAvailable: false },
    });
  });

  it("leaves the first word alone", () => {
    expect(sentence("Swan lake report")).toEqual([]);
  });

  it("leaves an acronym alone", () => {
    // Flagging `IBM` in a heading would make the rule cry wolf on every document
    // that names a product, and a rule users stop reading is worse than no rule.
    expect(sentence("The IBM report")).toEqual([]);
  });

  it("leaves a listed proper noun alone", () => {
    expect(sentence("The Swan Lake Report", { properNouns: ["swan", "lake", "report"] })).toEqual(
      [],
    );
  });

  it("accepts a capitalised word after a colon", () => {
    expect(sentence("Annual report: The swan lake")).toEqual([]);
  });

  it("says nothing about a heading already in sentence case", () => {
    expect(sentence("The swan lake report")).toEqual([]);
  });
});

describe("headings are recognised by their paragraph style", () => {
  it("accepts the built-in heading styles", () => {
    ["Heading 1", "Heading 2", "heading 3", "Title", "Subtitle"].forEach((style) => {
      expect(headingFindings("annual", { headingCase: "upper" }, styles([[0, style]]))).not.toEqual(
        [],
      );
    });
  });

  it("rejects a style whose name merely contains the word", () => {
    expect(
      headingFindings("annual", { headingCase: "upper" }, styles([[0, "Not A Heading"]])),
    ).toEqual([]);
  });

  it("checks only the heading paragraphs, and reports absolute offsets", () => {
    const text = "annual report\nBody Text Goes Here\nanother heading";
    const findings = headingFindings(
      text,
      { headingCase: "upper" },
      styles([
        [0, "Heading 1"],
        [14, "Body Text"],
        [34, "Heading 2"],
      ]),
    );

    // Nothing from the body paragraph, and the second heading's offsets are
    // absolute — they are what "Go to item" seeks in the document.
    expect(findings.map((finding) => finding.range.start)).toEqual([
      0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48,
    ]);
  });

  it("treats the last paragraph as running to the end of the text", () => {
    const findings = headingFindings(
      "Body text\nAnnual Report",
      { headingCase: "upper" },
      styles([[10, "Heading 1"]]),
    );

    expect(findings.map((finding) => finding.range.start)).toEqual([
      11, 12, 13, 14, 15, 18, 19, 20, 21, 22,
    ]);
  });

  it("skips a heading paragraph that holds nothing", () => {
    // The blank paragraph is a heading by style and empty by content. Reporting
    // its "missing" letters would be reporting on whitespace.
    expect(
      headingFindings(
        "   \nAnnual Report",
        { headingCase: "upper" },
        styles([
          [0, "Heading 1"],
          [4, "Normal"],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("the finding is reachable through the registered rule", () => {
  it("survives the category filter the registry applies to this rule", async () => {
    const { DETERMINISTIC_RULES } =
      await import("../../../src/analysis/deterministic/ruleRegistry");
    const rule = DETERMINISTIC_RULES.find((entry) => entry.id === "language/capitalisation");

    // The category was previously missing from this list, which is the second
    // half of the defect: even a rule that produced the finding would have had it
    // filtered out of every report.
    expect(rule?.emits).toContain(HEADING_CASE);
  });

  it("is a category the planner can act on when a correction exists", async () => {
    const { DETERMINISTIC_CORRECTABLE_CATEGORIES } =
      await import("../../../src/changes/deterministicChanges");

    expect(DETERMINISTIC_CORRECTABLE_CATEGORIES).toContain(HEADING_CASE);
  });
});
