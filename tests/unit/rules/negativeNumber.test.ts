/**
 * `language.numbers.negativeNumber` — `-5` or `(5)`.
 *
 * The fifth and last declared-but-unread field in the language profile, and the
 * last one this audit found by asking "where would a user set this?" rather than
 * "does a rule read it?" (ADR-0112).
 *
 * **Both directions are correctable**, which is what distinguishes this from the
 * range rule's `to` form: `(5)` and `-5` are the same number written two ways,
 * and neither correction changes the value or the author's prose.
 *
 * **The false-positive boundaries are the point of these tests.** A sign flanked
 * by digits is not a negative — `2026-05-31` and a telephone number both contain
 * hyphens — and a single `(1)` is far more often a numbered reference than an
 * accounting negative.
 */

import { describe, expect, it } from "vitest";

import { findNumberIssues } from "../../../src/rules/language";
import type {
  LanguageConventionProfile,
  NumberProfile,
} from "../../../src/core/domain/StyleProfile";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

const NEGATIVE = "language.number.negative";

function profile(numbers: Partial<NumberProfile> = {}): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({ numbers });
}

function negativeFindings(text: string, numbers: Partial<NumberProfile> = {}): Finding[] {
  return findNumberIssues({ text, rules: profile(numbers) }).filter(
    (finding) => finding.category === NEGATIVE,
  );
}

describe("a house that writes parentheses", () => {
  const parenthesis = { negativeNumber: "parenthesis" } as const;

  it("reports a minus-signed figure", () => {
    const findings = negativeFindings("The balance is -5 today.", parenthesis);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: NEGATIVE,
      actual: "-5",
      expected: "(5)",
      deterministic: {
        profilePath: "language.numbers.negativeNumber",
        correctionAvailable: true,
      },
    });
    expect(findings[0]?.range).toEqual({ start: 15, end: 17, unit: "character" });
  });

  it("accepts a Unicode minus", () => {
    expect(negativeFindings("The balance is −5 today.", parenthesis)).toHaveLength(1);
  });

  it("accepts a negative written with separators", () => {
    const findings = negativeFindings("The balance is -4,200.50 today.", parenthesis);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ actual: "-4,200.50", expected: "(4,200.50)" });
  });

  it("says nothing about a figure already in parentheses", () => {
    expect(negativeFindings("The balance is (5) today.", parenthesis)).toEqual([]);
  });

  it("does not read an ISO date as a negative", () => {
    // The hyphens are flanked by digits on both sides. Reading `-05` as a negative
    // would report a finding on every dated document in the corpus.
    expect(negativeFindings("It was signed 2026-05-31 and filed.", parenthesis)).toEqual([]);
  });

  it("does not read a hyphenated identifier as a negative", () => {
    expect(negativeFindings("See clause AB-12 of the agreement.", parenthesis)).toEqual([]);
  });

  it("declares a batch key, because every occurrence wants the same edit", () => {
    const findings = negativeFindings("-5 and -7 and -9.", parenthesis);

    expect(findings.map((finding) => finding.deterministic?.safeBatchKey)).toEqual([
      "negativeParenthesis",
      "negativeParenthesis",
      "negativeParenthesis",
    ]);
  });
});

describe("a house that writes a minus sign", () => {
  const minus = { negativeNumber: "minus" } as const;

  it("reports a parenthesised figure", () => {
    const findings = negativeFindings("The balance is (4,200) today.", minus);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: NEGATIVE,
      actual: "(4,200)",
      expected: "-4,200",
      deterministic: {
        profilePath: "language.numbers.negativeNumber",
        correctionAvailable: true,
      },
    });
  });

  it("says nothing about a minus-signed figure", () => {
    expect(negativeFindings("The balance is -5 today.", minus)).toEqual([]);
  });

  it("leaves a single-digit reference alone", () => {
    /*
     * `(1)` is far more often a numbered reference than an accounting negative.
     * A rule that reports citations is a rule its users stop reading, and this one
     * is reported for every bracketed cross-reference in an ordinary document.
     */
    expect(negativeFindings("See (1) for the derivation.", minus)).toEqual([]);
  });

  it("reports a single digit when it carries a decimal separator", () => {
    // `(1.5)` is a figure whatever its size; the digit count is only a proxy for
    // "looks like a reference", and a decimal point settles it.
    expect(negativeFindings("The balance is (1.5) today.", minus)).toHaveLength(1);
  });

  it("declares a batch key, because every occurrence wants the same edit", () => {
    const findings = negativeFindings("(12) and (300) and (4500).", minus);

    expect(findings.map((finding) => finding.deterministic?.safeBatchKey)).toEqual([
      "negativeMinus",
      "negativeMinus",
      "negativeMinus",
    ]);
  });
});

describe("the setting is wired end to end", () => {
  it("is a category the registered rule emits", async () => {
    const { DETERMINISTIC_RULES } =
      await import("../../../src/analysis/deterministic/ruleRegistry");
    // The number conventions live on `typography/numbers`, the one rule that reads
    // both the typography and language number settings.
    const rule = DETERMINISTIC_RULES.find((entry) => entry.id === "typography/numbers");

    expect(rule?.emits).toContain(NEGATIVE);
  });

  it("is a category the planner will turn into a substitution", async () => {
    const { DETERMINISTIC_CORRECTABLE_CATEGORIES } =
      await import("../../../src/changes/deterministicChanges");

    expect(DETERMINISTIC_CORRECTABLE_CATEGORIES.has(NEGATIVE)).toBe(true);
  });
});
