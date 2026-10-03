import { describe, expect, it } from "vitest";

import {
  findAbbreviationIssues,
  findCapitalisationIssues,
  findCurrencyIssues,
  findDateIssues,
  findLanguageIssues,
  findNumberIssues,
  findTerminologyIssues,
  findUnitIssues,
} from "../../../src/rules/language";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { LanguageConventionProfile } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

/**
 * Spec §4.2 language-convention rules.
 *
 * These are pure functions over a string and a profile, so no Office mock and no
 * LLM provider appear anywhere in this file. The assertions are on the three
 * things a rule owes the user: the category it reports, the range it points at,
 * and — the one most easily skipped — whether it actually offers a correction.
 */
function profile(overrides: unknown = {}): LanguageConventionProfile {
  /*
   * `unknown` rather than `Partial<LanguageConventionProfile>` on purpose. A
   * partial of the *output* type still demands every defaulted leaf, so a test
   * that only cares about `numberWordThreshold` would have to restate the other
   * five fields — and a field restated in a test is a field whose default the
   * test is no longer checking.
   */
  return LanguageConventionProfileSchema.parse(overrides);
}

const categories = (findings: readonly { category: string }[]): string[] =>
  findings.map((finding) => finding.category);

describe("findTerminologyIssues", () => {
  it("reports a preferred term with the replacement it wants", () => {
    const findings = findTerminologyIssues({
      text: "The recovery program was late.",
      rules: profile({
        terminology: [{ id: "program", source: "program", replacement: "programme" }],
      }),
    });

    expect(categories(findings)).toEqual(["language.terminology.preferred"]);
    expect(findings[0]?.expected).toBe("programme");
    expect(findings[0]?.deterministic?.profilePath).toBe("language.terminology.program");
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(true);
  });

  it("preserves the source's own capitalisation rather than lower-casing it", () => {
    // A capitalised occurrence is a capitalised occurrence. Rewriting `Program`
    // to `programme` would be a capitalisation error introduced by a
    // terminology rule, and the author would see the fix as the bug.
    const findings = findTerminologyIssues({
      text: "The Program review begins here.",
      rules: profile({
        terminology: [
          { id: "program", source: "program", replacement: "programme", caseSensitive: false },
        ],
      }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected).toBe("Programme");
  });

  it("reports a term from the banned list, which the scanner previously never read", () => {
    /*
     * `language.bannedTerms` was declared in the registry as read by
     * `language/banned` and consumed nothing: this function scanned
     * `rules.terminology` and the legacy record, never the banned list. A
     * setting the user could change that changed nothing — the exact spec §11
     * failure the registry audit exists to catch.
     */
    const findings = findTerminologyIssues({
      text: "Please utilize the dashboard.",
      rules: profile({ bannedTerms: ["utilize"] }),
    });

    expect(categories(findings)).toEqual(["language.bannedTerm"]);
    expect(findings[0]?.range).toEqual({ start: 7, end: 14, unit: "character" });
    expect(findings[0]?.severity).toBe("error");
    // An empty `expected` is how a banned term is distinguished from a
    // substitution, and it is what makes the planner build a deleteRange.
    expect(findings[0]?.expected).toBe("");
    expect(findings[0]?.deterministic?.profilePath).toBe("language.bannedTerms");
  });

  it("matches a banned term case-insensitively and only as a whole word", () => {
    const capitalised = findTerminologyIssues({
      text: "Please Utilize the dashboard.",
      rules: profile({ bannedTerms: ["utilize"] }),
    });
    expect(categories(capitalised)).toEqual(["language.bannedTerm"]);

    // Banning `utilize` is not a claim about `utilization`.
    const longer = findTerminologyIssues({
      text: "The utilization rate rose.",
      rules: profile({ bannedTerms: ["utilize"] }),
    });
    expect(longer).toEqual([]);
  });

  it("does not match inside a longer word by default", () => {
    const findings = findTerminologyIssues({
      text: "A colorful display.",
      rules: profile({
        terminology: [{ id: "color", source: "color", replacement: "colour" }],
      }),
    });

    // `colorful` contains `color` but is not the word `color`.
    expect(findings).toEqual([]);
  });

  it("matches inside a longer word when the rule says to", () => {
    const findings = findTerminologyIssues({
      text: "A colorful display.",
      rules: profile({
        terminology: [{ id: "color", source: "color", replacement: "colour", wholeWord: false }],
      }),
    });

    expect(categories(findings)).toEqual(["language.terminology.preferred"]);
  });

  it("does not treat a non-ASCII letter as a word boundary", () => {
    // `\b` would end the word at the `é`, so `color` would "match" inside
    // `coloré`. The lookaround form uses Unicode properties and does not.
    const findings = findTerminologyIssues({
      text: "Un coloré profond.",
      rules: profile({
        terminology: [{ id: "color", source: "color", replacement: "colour" }],
      }),
    });

    expect(findings).toEqual([]);
  });

  it("maps a mandatory rule to an error and an advisory one to a warning", () => {
    const findings = findTerminologyIssues({
      text: "program and organize",
      rules: profile({
        terminology: [
          { id: "a", source: "program", replacement: "programme", severity: "mandatory" },
          { id: "b", source: "organize", replacement: "organise", severity: "advisory" },
        ],
      }),
    });

    // The rule's own id is the profilePath, not the ruleId: `ruleId` names the
    // registry rule, and one registry rule runs many profile rules.
    expect(findings.find((f: Finding) => f.actual === "program")?.severity).toBe("error");
    expect(findings.find((f: Finding) => f.actual === "organize")?.severity).toBe("warning");
  });

  it("stays silent on a rule scoped to a style the occurrence is not in", () => {
    const rules = profile({
      terminology: [
        {
          id: "scoped",
          source: "program",
          replacement: "programme",
          scope: { withinStyle: "Heading 1" },
        },
      ],
    });

    expect(
      findTerminologyIssues({
        text: "The program.",
        rules,
        styleByStart: new Map([[0, "Body Text"]]),
      }),
    ).toEqual([]);
    expect(
      findTerminologyIssues({
        text: "The program.",
        rules,
        styleByStart: new Map([[0, "Heading 1"]]),
      }),
    ).toHaveLength(1);
  });

  it("stays silent on a section-scoped rule when no headings were read", () => {
    // The rule cannot be shown to apply, and a rule that cannot be shown to
    // apply must not fire — a false positive inside an excluded quotation is
    // worse than a missed one.
    const findings = findTerminologyIssues({
      text: "The program.",
      rules: profile({
        terminology: [
          {
            id: "scoped",
            source: "program",
            replacement: "programme",
            scope: { withinSectionContaining: "Appendix" },
          },
        ],
      }),
    });

    expect(findings).toEqual([]);
  });

  it("fires a section-scoped rule only inside the matching section", () => {
    const text = "Methods\nThe program. Appendix\nThe program.";
    const rules = profile({
      terminology: [
        {
          id: "scoped",
          source: "program",
          replacement: "programme",
          scope: { withinSectionContaining: "Appendix" },
        },
      ],
    });
    const findings = findTerminologyIssues({
      text,
      rules,
      sectionHeads: [
        { start: 0, text: "Methods" },
        { start: text.indexOf("Appendix"), text: "Appendix" },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.range.start).toBe(text.lastIndexOf("program"));
  });

  it("reports a rule with no replacement as a banned term with no expected value", () => {
    const findings = findTerminologyIssues({
      text: "Use the old form.",
      rules: profile({
        terminology: [{ id: "old", source: "old" }],
      }),
    });

    expect(categories(findings)).toEqual(["language.bannedTerm"]);
    expect(findings[0]?.expected).toBe("");
    expect(findings[0]?.severity).toBe("error");
  });

  it("fires the legacy term map a profile authored under the old editor still has", () => {
    const findings = findTerminologyIssues({
      text: "The recovery program was late.",
      rules: profile({ legacyPreferredTerminology: { program: "programme" } }),
    });

    expect(categories(findings)).toEqual(["language.terminology.preferred"]);
  });

  it("reports the longest match once when two rules overlap", () => {
    const findings = findTerminologyIssues({
      text: "the organization name",
      rules: profile({
        terminology: [
          { id: "short", source: "organization", replacement: "organisation" },
          { id: "long", source: "organization name", replacement: "organisation name" },
        ],
      }),
    });

    // Both rules would match, and reporting both is one deviation shown twice.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected).toBe("organisation name");
  });
});

describe("findCapitalisationIssues", () => {
  it("reports a proper noun written in lower case", () => {
    const findings = findCapitalisationIssues({
      text: "The parliament met.",
      rules: profile({ capitalisation: { properNouns: ["Parliament"] } }),
    });

    expect(categories(findings)).toEqual(["language.capitalisation.properNoun"]);
    expect(findings[0]?.expected).toBe("Parliament");
  });

  it("says nothing about a proper noun already correctly capitalised", () => {
    const findings = findCapitalisationIssues({
      text: "The Parliament met.",
      rules: profile({ capitalisation: { properNouns: ["Parliament"] } }),
    });

    expect(findings).toEqual([]);
  });

  it("reports a common noun written in upper case", () => {
    const findings = findCapitalisationIssues({
      text: "The Committee met.",
      rules: profile({ capitalisation: { prohibitedCapitalised: ["committee"] } }),
    });

    expect(categories(findings)).toEqual(["language.capitalisation.prohibited"]);
    expect(findings[0]?.expected).toBe("committee");
  });

  it("reports a sentence that does not open with a capital", () => {
    const findings = findCapitalisationIssues({
      text: "The first sentence. the second sentence.",
      rules: profile({ capitalisation: { sentenceCase: true } }),
    });

    expect(categories(findings)).toEqual(["language.capitalisation.sentenceCase"]);
    // The range covers the letter, not the terminator before it: the deviation
    // is the `t`, and the user fixes the `t`.
    expect(findings[0]?.range).toEqual({ start: 20, end: 21, unit: "character" });
    expect("The first sentence. the second sentence."[20]).toBe("t");
  });

  it("does not treat a decimal point as a sentence boundary", () => {
    const findings = findCapitalisationIssues({
      text: "It costs 3.5 units. The rest follows.",
      rules: profile({ capitalisation: { sentenceCase: true } }),
    });

    // `5` follows the point, and a lower-case `5` is not a missing capital.
    expect(findings).toEqual([]);
  });

  it("checks the letter after an opening quote rather than the quote itself", () => {
    const findings = findCapitalisationIssues({
      text: 'He said "hello there".',
      rules: profile({ capitalisation: { sentenceCase: true } }),
    });

    expect(findings).toEqual([]);
  });
});

describe("findAbbreviationIssues", () => {
  it("reports a prohibited form and offers the approved one when there is one", () => {
    const findings = findAbbreviationIssues({
      text: "See the Dept. for details.",
      rules: profile({
        abbreviations: { approved: { "Dept.": "Department" }, prohibitedVariants: ["Dept."] },
      }),
    });

    expect(categories(findings)).toEqual(["language.abbreviation.prohibited"]);
    expect(findings[0]?.expected).toBe("Department");
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(true);
  });

  it("reports a prohibited form with no replacement as not correctable", () => {
    const findings = findAbbreviationIssues({
      text: "See the Dept. for details.",
      rules: profile({ abbreviations: { prohibitedVariants: ["Dept."] } }),
    });

    // The planner has nothing to substitute, so offering Approve would be an
    // offer the Apply path cannot honour.
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("says nothing about the first use when the profile has not asked", () => {
    const findings = findAbbreviationIssues({
      text: "The NHS issued guidance.",
      rules: profile({ abbreviations: { approved: { NHS: "National Health Service" } } }),
    });

    // `undefined` means "not configured", which is a different answer from
    // "the expansion is not required".
    expect(findings).toEqual([]);
  });

  it("requires the expansion on first use when the profile asks for it", () => {
    const findings = findAbbreviationIssues({
      text: "The NHS issued guidance.",
      rules: profile({
        abbreviations: {
          approved: { NHS: "National Health Service" },
          requireFirstUseExpansion: true,
        },
      }),
    });

    expect(categories(findings)).toEqual(["language.abbreviation.firstUse"]);
    expect(findings[0]?.expected).toBe("National Health Service (NHS)");
  });

  it("says nothing when the expansion already precedes the first use", () => {
    const findings = findAbbreviationIssues({
      text: "The National Health Service (NHS) issued guidance.",
      rules: profile({
        abbreviations: {
          approved: { NHS: "National Health Service" },
          requireFirstUseExpansion: true,
        },
      }),
    });

    expect(findings).toEqual([]);
  });
});

describe("findNumberIssues", () => {
  it("no longer reports a decimal separator - typography owns both separators (D2)", () => {
    /*
     * The check moved to `checkDecimalSeparator` in `src/rules/typography.ts`.
     *
     * Running it here as well meant both rules reported the same character, which
     * produced two overlapping changes and let the planner refuse an entire plan
     * over one separator (ND-2). Owner decision D2 gives both separators to
     * `typography`, so this asserts the category is gone rather than merely
     * changed - a weaker assertion would let it creep back.
     */
    const findings = findNumberIssues({
      text: "It cost 3,50 units.",
      rules: profile({}),
    });

    expect(categories(findings)).not.toContain("language.number.decimalSeparator");
  });

  it("reports a percentage written with the wrong spacing", () => {
    const spaced = findNumberIssues({
      text: "Up 50 % this year.",
      rules: profile({ numbers: { percentageSpacing: "tight" } }),
    });
    expect(categories(spaced)).toEqual(["language.number.percentageSpacing"]);

    const tight = findNumberIssues({
      text: "Up 50% this year.",
      rules: profile({ numbers: { percentageSpacing: "space" } }),
    });
    expect(categories(tight)).toEqual(["language.number.percentageSpacing"]);

    /*
     * The spelled-out form is not a spacing violation.
     *
     * The marker pattern also matched `percent`, so `gapsBefore` measured the gap
     * in front of the *word*. Under the default tight rule that reported "50
     * percent" and proposed deleting the space — turning a correctly written
     * figure into "50percent". The setting governs the gap before the sign, and
     * there is no sign here.
     */
    const spelledOut = findNumberIssues({
      text: "Up 50 percent this year.",
      rules: profile({}),
    });
    expect(categories(spelledOut)).not.toContain("language.number.percentageSpacing");
  });

  it("reports a numeral below the threshold without offering to rewrite it", () => {
    const findings = findNumberIssues({
      text: "There were 3 reasons.",
      rules: profile({ numbers: { numberWordThreshold: 10 } }),
    });

    expect(categories(findings)).toEqual(["language.number.spelling"]);
    // Spelling out a numeral rewrites the author's prose. Reporting it without
    // a correction is the honest answer; the user decides.
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("says nothing about numerals above the threshold", () => {
    const findings = findNumberIssues({
      text: "There were 40 reasons.",
      rules: profile({ numbers: { numberWordThreshold: 10 } }),
    });

    expect(findings).toEqual([]);
  });

  it("says nothing about spelling when the threshold is null", () => {
    const findings = findNumberIssues({
      text: "There were 3 reasons.",
      rules: profile({ numbers: { numberWordThreshold: null } }),
    });

    expect(findings).toEqual([]);
  });

  it("offers no correction for a range rewritten as words", () => {
    const findings = findNumberIssues({
      text: "Pages 10-20 cover it.",
      rules: profile({ numbers: { rangeStyle: "to" } }),
    });

    expect(categories(findings)).toEqual(["language.number.range"]);
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("offers a correction for a range whose punctuation is wrong", () => {
    const findings = findNumberIssues({
      text: "Pages 10 to 20 cover it.",
      rules: profile({ numbers: { rangeStyle: "enDash" } }),
    });

    expect(categories(findings)).toEqual(["language.number.range"]);
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(true);
  });

  /*
   * A separator inside a chain of digits is not a range.
   *
   * `2026-05-31` satisfies the range pattern three times over, and each match
   * looked exactly like `10-20`. Under an en-dash profile the rule therefore
   * reported three range deviations on an ISO date and offered to rewrite its
   * hyphens — corrupting a date that `findDateIssues` in the same file is
   * simultaneously reporting as the wrong shape. Reported, never corrected.
   */
  it("reports but does not correct a separator inside a digit chain", () => {
    const findings = findNumberIssues({
      text: "Signed on 2026-05-31.",
      rules: profile({ numbers: { rangeStyle: "enDash" } }),
    });

    const ranges = findings.filter((f: Finding) => f.category === "language.number.range");
    expect(ranges.length).toBeGreaterThan(0);
    ranges.forEach((range: Finding) => {
      expect(range.deterministic?.correctionAvailable).toBe(false);
      // No batch key either: a key claims every occurrence wants one edit.
      expect(range.deterministic?.safeBatchKey).toBeUndefined();
    });
  });

  it("still corrects a standalone range that merely sits near a chain", () => {
    const findings = findNumberIssues({
      text: "Pages 10-20 of the 2026-05-31 edition.",
      rules: profile({ numbers: { rangeStyle: "enDash" } }),
    });

    const correctable = findings.filter(
      (f: Finding) =>
        f.category === "language.number.range" && f.deterministic?.correctionAvailable === true,
    );
    expect(correctable).toHaveLength(1);
    expect("Pages 10-20 of the 2026-05-31 edition."[correctable[0]!.range.start]).toBe("-");
  });

  it("does not read a thousands group mark as a decimal separator", () => {
    // A figure is the one thing a formatting tool must not alter. `1,000` and
    // `4,200,000` are grouped, and the previous lookaround reported a
    // decimal-separator deviation at every group mark.
    // Grouped figures are never a decimal separator, here or in the typography
    // rule that now owns the check (ND-1).
    const grouped = findNumberIssues({
      text: "The total was 1,000 and then 4,200,000.",
      rules: profile({}),
    });
    expect(categories(grouped)).not.toContain("language.number.decimalSeparator");
  });

  it("reports no separator finding at all", () => {
    /*
     * The three cases this file used to assert here - a clean decimal, a grouped
     * figure and an ambiguous `0,1234` - are all covered in
     * `tests/unit/rules/separatorDiscrimination.test.ts` against the rule that now
     * owns them. Keeping duplicates here would mean two places to update and one
     * of them quietly testing nothing.
     */
    const findings = findNumberIssues({
      text: "It cost 3,50 units and the total was 1,000 or 0,1234.",
      rules: profile({}),
    });

    expect(categories(findings)).not.toContain("language.number.decimalSeparator");
  });
});

describe("findDateIssues", () => {
  const dateProfile = profile({
    dates: { formats: [{ id: "year-first", format: "%Y-%m-%d", preferred: true }] },
  });

  it("falls back to the locale when the profile declares no preferred format", () => {
    /*
     * **This contract changed under D5, deliberately.** It used to read "No
     * preference declared is not a preference for the shape already there", and
     * return nothing. That was correct while `locale` governed nothing — with no
     * declared shape and no enforced default, silence *was* the honest answer.
     *
     * It is no longer correct, because a profile now always carries an enforced
     * default (`en-US` unless the author chose otherwise). A house that has
     * selected `en-US` and written `31/05/2026` has made a mistake, and reporting
     * it is the whole point of D5. Silence here would make the locale decorative
     * again for every profile that never opened the date panel.
     */
    const findings = findDateIssues({
      text: "It happened on 31/05/2026.",
      rules: profile({ dates: { formats: [] } }),
    });

    // Day-first under the default month-first locale.
    expect(categories(findings)).toEqual(["language.date.format"]);
    // The finding names the setting that produced the comparison, so the user is
    // sent to the locale rather than to a date panel holding no opinion.
    expect(findings[0]?.deterministic?.profilePath).toBe("language.locale");
  });

  it("reports a numerically ambiguous date and offers no rewrite", () => {
    /*
     * `05/03/2026` is valid as both 5 March and 5 May, so it is `numeric` and the
     * existing `requireUnambiguous` refusal applies. The locale does **not** resolve
     * it — doing so would be the tool deciding which day the author meant.
     *
     * The text changed from `31/05/2026` for the same reason: that one is
     * decidable now, so it is a format finding rather than an ambiguity one. The
     * case this test exists for is the genuinely undecidable one.
     */
    const findings = findDateIssues({ text: "It happened on 05/03/2026.", rules: dateProfile });

    expect(categories(findings)).toEqual(["language.date.ambiguous"]);
    // Converting the shape means deciding which field is the day, and this is
    // exactly the case where guessing is worst.
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("says nothing when the date already matches the preferred shape", () => {
    const findings = findDateIssues({ text: "It happened on 2026-05-31.", rules: dateProfile });

    expect(findings).toEqual([]);
  });

  it("reports an unambiguous but non-preferred shape", () => {
    const findings = findDateIssues({ text: "It happened on 31 May 2026.", rules: dateProfile });

    expect(categories(findings)).toEqual(["language.date.format"]);
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });
});

describe("findCurrencyIssues", () => {
  it("reports a code where the profile wants a symbol, without a correction", () => {
    const findings = findCurrencyIssues({
      text: "The cost was 100 GBP.",
      rules: profile({ currency: { representation: "symbol" } }),
    });

    expect(categories(findings)).toEqual(["language.currency.representation"]);
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("reports a symbol written tight where the profile wants a space", () => {
    const findings = findCurrencyIssues({
      text: "The cost was £100.",
      rules: profile({ currency: { symbolSpacing: "space" } }),
    });

    expect(categories(findings)).toEqual(["language.currency.spacing"]);
    expect(findings[0]?.deterministic?.correctionAvailable).toBe(true);
  });

  it("says nothing about a symbol already spaced as the profile wants", () => {
    const findings = findCurrencyIssues({
      text: "The cost was £ 100.",
      rules: profile({ currency: { symbolSpacing: "space" } }),
    });

    expect(findings).toEqual([]);
  });
});

describe("findUnitIssues", () => {
  it("reports a unit written tight where the profile wants a space", () => {
    /*
     * `symbols` is declared, and it has to be: the rule matches the symbols the
     * profile names, not any short word after a digit. The previous shape-based
     * match (`\p{L}{1,4}`) reported "3 items" and "2 March" as units and offered
     * to insert a space, which is a confident wrong edit to prose.
     */
    const findings = findUnitIssues({
      text: "It weighs 10kg.",
      rules: profile({ units: { valueSpacing: "space", symbols: { kilogram: "kg" } } }),
    });

    expect(categories(findings)).toEqual(["language.unit.spacing"]);
    expect(findings[0]?.expected).toBe(" ");
  });

  it("says nothing about a short word the profile has not declared a unit", () => {
    // The regression the symbol restriction exists to prevent.
    const findings = findUnitIssues({
      text: "There were 3 items and 2 March deadlines.",
      rules: profile({ units: { valueSpacing: "space", symbols: { kilogram: "kg" } } }),
    });

    expect(findings).toEqual([]);
  });

  it("says nothing at all when the profile declares no units", () => {
    // A house that has not said which words are its units has not asked this
    // rule to fire. A default list would be ToneForge guessing.
    const findings = findUnitIssues({
      text: "It weighs 10kg.",
      rules: profile({ units: { valueSpacing: "space" } }),
    });

    expect(findings).toEqual([]);
  });

  it("matches a declared symbol whole, not as the prefix of a longer word", () => {
    const findings = findUnitIssues({
      text: "It weighs 10kilos.",
      rules: profile({ units: { valueSpacing: "space", symbols: { kilogram: "kg" } } }),
    });

    expect(findings).toEqual([]);
  });

  it("prefers the longest declared symbol where two share a prefix", () => {
    const findings = findUnitIssues({
      text: "It weighs 10mg.",
      rules: profile({
        units: { valueSpacing: "space", symbols: { gram: "g", milligram: "mg" } },
      }),
    });

    expect(categories(findings)).toEqual(["language.unit.spacing"]);
    // "It weighs 10mg." — the `10` ends at 12, so the zero-width gap that needs a
    // space inserted sits at 12, immediately before the `mg`.
    expect(findings[0]?.range).toEqual({ start: 12, end: 12, unit: "character" });
  });

  it("reports a unit symbol capitalised where the profile wants lower case", () => {
    const findings = findUnitIssues({
      text: "It weighs 10 KG.",
      rules: profile({ units: { capitalisation: "lower", symbols: { kilogram: "kg" } } }),
    });

    expect(categories(findings)).toContain("language.unit.capitalisation");
    expect(
      findings.find((f: Finding) => f.category === "language.unit.capitalisation")?.expected,
    ).toBe("kg");
  });

  it("never rewrites a figure's magnitude", () => {
    // There is no unit finding for `4,200,000` under any unit setting, because
    // rounding a figure is not a formatting decision.
    const findings = findUnitIssues({
      text: "The total was 4,200,000 tonnes.",
      rules: profile({ units: { valueSpacing: "space" } }),
    });

    expect(categories(findings)).not.toContain("language.unit.magnitude");
  });
});

describe("findLanguageIssues", () => {
  it("returns every scanner's findings in document order", () => {
    const findings = findLanguageIssues({
      text: "The program was 3.5 units and cost £100. The NHS responded.",
      rules: profile({
        terminology: [{ id: "p", source: "program", replacement: "programme" }],
        numbers: { decimalSeparator: "dot" },
        currency: { symbolSpacing: "space" },
        abbreviations: { approved: { NHS: "National Health Service" } },
      }),
    });

    const starts = findings.map((finding: Finding) => finding.range.start);
    expect([...starts].sort((left, right) => left - right)).toEqual(starts);
  });

  it("carries the profile path on every finding", () => {
    // Spec §12: a finding must name the profile field that produced it, or the
    // registry audit and the review UI have nothing to point at.
    const findings = findLanguageIssues({
      text: "The program was 3,50 units and cost 100 GBP.",
      rules: profile({
        terminology: [{ id: "p", source: "program", replacement: "programme" }],
        numbers: { decimalSeparator: "dot" },
        currency: { representation: "symbol" },
      }),
    });

    expect(findings.length).toBeGreaterThan(0);
    findings.forEach((finding: Finding) => {
      expect(finding.deterministic?.profilePath.length ?? 0).toBeGreaterThan(0);
    });
  });

  it("declares a safe batch key only where every occurrence wants the same fix", () => {
    const findings = findLanguageIssues({
      text: "program and program",
      rules: profile({
        terminology: [{ id: "p", source: "program", replacement: "programme" }],
      }),
    }).filter((finding: Finding) => finding.category === "language.terminology.preferred");

    // Both occurrences want `programme`, so one key covers them. Spec §13's
    // batch approval depends on this being set — and the key has to be *the
    // same* for both, or the group splits into two that must be approved
    // individually.
    expect(findings).toHaveLength(2);
    findings.forEach((finding: Finding) => {
      expect(finding.deterministic?.safeBatchKey).toBe("terminology:program:programme");
    });
  });
});
