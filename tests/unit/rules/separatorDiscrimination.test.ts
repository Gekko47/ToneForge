/**
 * ND-1 / ND-2 regression: separator discrimination.
 *
 * **The defect.** `checkDecimalSeparator` in `src/rules/typography.ts` matched
 * `\d<sep>\d`. Under a dot-decimal profile the "wrong" separator is a comma, so
 * `1,000` matched and the rule offered a `replaceText` rewriting the group mark
 * as a decimal point. A figure was silently altered by a punctuation rule.
 *
 * `findNumberIssues` in `src/rules/language.ts` guards this with `isGroupMark`
 * — one to three digits from a non-digit boundary, then exactly three digits —
 * and its comment describes precisely the corruption the typography rule was
 * missing.
 *
 * **ND-2.** Both scanners ran under the single registry rule `typography/numbers`
 * and both reported the same comma at the same offset, so two changes were built
 * over one range and the planner was entitled to refuse the whole plan.
 *
 * These tests exist to fail if either defect returns. They assert on the finding,
 * which is the observable contract, rather than on the private matcher.
 */

import { describe, expect, it } from "vitest";

import { findTypographyIssues } from "../../../src/rules/typography";
import { findNumberIssues } from "../../../src/rules/language";
import type { Finding } from "../../../src/core/domain/Finding";
import {
  TypographyRulesSchema,
  LanguageConventionProfileSchema,
} from "../../../src/core/domain/StyleProfile";

function typography(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof TypographyRulesSchema.parse> {
  return TypographyRulesSchema.parse({
    decimalSeparator: "dot",
    thousandsSeparator: "none",
    ...overrides,
  });
}

function language(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof LanguageConventionProfileSchema.parse> {
  return LanguageConventionProfileSchema.parse(overrides);
}

/** Every category each scanner emitted, with the offsets it claimed. */
function occurrences(
  findings: readonly Finding[],
  category: string,
): { start: number; end: number }[] {
  return findings
    .filter((finding) => finding.category === category)
    .map((finding) => ({ start: finding.range.start, end: finding.range.end }));
}

describe("ND-1: a thousands group mark is never reported as a decimal separator", () => {
  it("does not report the comma in `1,000` under a dot-decimal typography profile", () => {
    const findings = findTypographyIssues({
      text: "The value is 1,000 units.",
      rules: typography(),
    });

    expect(occurrences(findings, "typography.decimalSeparator")).toEqual([]);
  });

  it.each([
    ["1,000", "a simple group"],
    ["1,000,000", "two groups"],
    ["12,345", "two leading digits"],
    ["123,456", "three leading digits"],
  ])("does not treat the comma in %s (%s) as a decimal", (text) => {
    const findings = findTypographyIssues({ text, rules: typography() });
    expect(occurrences(findings, "typography.decimalSeparator")).toEqual([]);
  });

  it("still reports a genuine decimal separator", () => {
    /*
     * The guard must not swallow the case the rule exists for.
     *
     * Under a comma-decimal profile the unwanted separator is a dot, so the
     * fixture is `1.00`. (An earlier version of this test used `1,00` against a
     * comma profile, which asked the rule to object to a comma while it was
     * looking for a dot - it passed only after the guard was added, and for the
     * wrong reason.)
     */
    const findings = findTypographyIssues({
      text: "The value is 1.00 units.",
      rules: typography({ decimalSeparator: "comma" }),
    });

    expect(occurrences(findings, "typography.decimalSeparator")).toHaveLength(1);
  });

  it("reports a separator that is neither a clean decimal nor a clean group", () => {
    // `1,2345` has four digits after the mark: not a clean decimal, not a
    // three-digit group. It is ambiguous, and must still be surfaced.
    const findings = findTypographyIssues({ text: "Value 1,2345 here.", rules: typography() });

    expect(occurrences(findings, "typography.decimalSeparator")).toHaveLength(1);
  });

  it("leaves an ISO date alone", () => {
    // `2026-05-31` is not this rule's business, but a document containing one
    // must not acquire decimal-separator findings from it.
    const findings = findTypographyIssues({ text: "Dated 2026-05-31.", rules: typography() });
    expect(occurrences(findings, "typography.decimalSeparator")).toEqual([]);
  });
});

describe("ND-2: one rule owns each separator, and the language rule owns neither", () => {
  it("emits no separator category at all", () => {
    /*
     * The structural fix, not just a behavioural one.
     *
     * Owner decision D2 gave both separators to `typography`. The language number
     * rule previously emitted `language.number.decimalSeparator` from the same
     * character, so this asserts the *category is gone* — the strongest form of
     * "exactly one owner", and one that cannot be reintroduced by a fixture change.
     */
    const findings = findNumberIssues({
      text: "Totals are 1,000 and 3,50 and 1.00 today.",
      rules: language({ numbers: { percentageSpacing: "tight", rangeStyle: "enDash" } }),
    });

    expect(findings.map((finding) => finding.category)).not.toContain(
      "language.number.decimalSeparator",
    );
  });

  it("keeps the conventions only the number profile can express", () => {
    /*
     * `50 %` is a deviation under a `tight` profile, and `10-20` is a deviation
     * under `enDash`. Both fixtures were written as though the defaults were the
     * opposite, which made the rule correct and the test wrong: it asserted
     * findings for text that already matched the profile.
     */
    const findings = findNumberIssues({
      text: "Progress reached 50 % in 10-20 days.",
      rules: language({ numbers: { percentageSpacing: "tight", rangeStyle: "enDash" } }),
    });

    const categories = new Set(findings.map((finding) => finding.category));
    expect(categories.has("language.number.percentageSpacing")).toBe(true);
    expect(categories.has("language.number.range")).toBe(true);
  });

  it("reports no overlapping ranges across every separator category", () => {
    const text = "Totals are 1,000 and 3,50 and 1,000,000 across 42 days.";
    const typographic = findTypographyIssues({ text, rules: typography() });
    const numeric = findNumberIssues({
      text,
      rules: language({ numbers: { percentageSpacing: "tight", rangeStyle: "enDash" } }),
    });

    const claims = [
      ...occurrences(typographic, "typography.decimalSeparator"),
      ...occurrences(typographic, "typography.thousandsSeparator"),
      ...occurrences(numeric, "language.number.decimalSeparator"),
      ...occurrences(numeric, "language.number.thousandsSeparator"),
    ];

    const overlaps: string[] = [];
    claims.forEach((left, i) => {
      claims.slice(i + 1).forEach((right) => {
        if (left.start < right.end && right.start < left.end) {
          overlaps.push(`${left.start}-${left.end} overlaps ${right.start}-${right.end}`);
        }
      });
    });

    expect(overlaps).toEqual([]);
  });

  it("separates a group mark from a decimal point in the same sentence (D2)", () => {
    /*
     * The owner's acceptance example, asserted directly: `1,000` is a thousands
     * separator with three digits behind it; `1.00` is a decimal point with two.
     *
     * Under a dot-decimal / comma-group profile — the American default — both of
     * those are **correct**, so a run that reported either one would be rewriting a
     * figure the author wrote properly. That is the whole ND-1 defect, and the
     * ND-1 fix is what makes this pass.
     */
    const correct = findTypographyIssues({
      text: "We recorded 1,000 units at a rate of 1.00 today.",
      rules: typography({ decimalSeparator: "dot", thousandsSeparator: "comma" }),
    });

    expect(correct).toEqual([]);
  });

  it("still reports a separator that is genuinely wrong for the locale", () => {
    /*
     * The other direction, so the guard cannot be satisfied by suppressing
     * everything. A dot-decimal profile wants `1.00`, so the `1,00` in this text
     * *is* a wrongly-written decimal point and must be reported — and the group
     * mark in `1,000` on the same line must not be.
     */
    const text = "We recorded 1,000 units at a rate of 1,00 today.";
    const findings = findTypographyIssues({
      text,
      rules: typography({ decimalSeparator: "dot", thousandsSeparator: "comma" }),
    });

    expect(findings.map((finding) => finding.category)).toEqual(["typography.decimalSeparator"]);
    // The comma in the trailing `1,00`, not the one inside `1,000`. `lastIndexOf`
    // rather than `indexOf`, because `1,00` is a prefix of `1,000` and would
    // otherwise resolve to the group mark the guard is protecting.
    expect(findings[0]?.range.start).toBe(text.lastIndexOf("1,00") + 1);
  });

  it("does not read a group mark as a decimal point under a dot-decimal profile", () => {
    const findings = findTypographyIssues({
      text: "Totals were 1,000,000 across 42 days.",
      rules: typography({ decimalSeparator: "dot", thousandsSeparator: "comma" }),
    });

    // A dot-decimal profile does want a comma group mark, so `1,000,000` is
    // correct and silent. The ND-1 defect reported the first comma as a wrong
    // decimal separator and offered to rewrite it as `1.000`, changing the figure.
    expect(findings).toEqual([]);
  });

  it("reads a dot followed by three digits as a group mark, not a decimal point", () => {
    /*
     * The mirror of ND-1. The guard was written for a comma, but the same
     * corruption is reachable through the other separator: a dot in `1.000` is a
     * group mark, and rewriting it to `1,000` under a comma-group profile would
     * change the figure's value just as silently.
     */
    const findings = findTypographyIssues({
      text: "We recorded 1.000 units today.",
      rules: typography({ decimalSeparator: "comma", thousandsSeparator: "space" }),
    });

    expect(findings).toEqual([]);
  });
});
