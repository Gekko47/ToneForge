/**
 * Required terms (D1).
 *
 * `requiredTerms` was a `requiredTerms: string[]` on the *governance* profile,
 * editable in the governance policy page and read by nothing. It moved to
 * `language.requiredTerms` on the deterministic profile as a `TerminologyRule[]`,
 * and this file proves the field is no longer inert.
 *
 * The rule's central claim is that it reports an **absence**: a term the house
 * insists on that the document does not contain. That is the opposite of every
 * other terminology finding, which anchors at a span that exists, and it is why
 * these findings are report-only - there is no text to rewrite, and inventing a
 * sentence to hold the term would be the tool writing the author's prose.
 */

import { describe, expect, it } from "vitest";

import { findTerminologyIssues } from "../../../src/rules/language";
import type { Finding } from "../../../src/core/domain/Finding";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";

function profile(overrides: Record<string, unknown> = {}) {
  return LanguageConventionProfileSchema.parse(overrides);
}

function missing(findings: readonly Finding[]) {
  return findings.filter((finding) => finding.category === "language.terminology.missing");
}

function rule(source: string, extra: Record<string, unknown> = {}) {
  return { id: `req:${source}`, source, ...extra };
}

describe("required terms", () => {
  it("reports a required term the document does not contain", () => {
    const findings = findTerminologyIssues({
      text: "The contractor completed the works.",
      rules: profile({ requiredTerms: [rule("completion certificate")] }),
    });

    const reported = missing(findings);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("completion certificate");
    expect(reported[0]?.expected).toBe("completion certificate");
  });

  it("says nothing when the required term is present", () => {
    const findings = findTerminologyIssues({
      text: "The completion certificate was issued on 30 June.",
      rules: profile({ requiredTerms: [rule("completion certificate")] }),
    });

    expect(missing(findings)).toEqual([]);
  });

  it("matches on whole words, so a partial hit does not satisfy the rule", () => {
    // `certificate` inside `certificates` is not the term the house requires. A
    // substring match would report a compliant document as non-compliant, which is
    // the failure mode that trains a reader to ignore the rule.
    const findings = findTerminologyIssues({
      text: "Two certificates were filed.",
      rules: profile({ requiredTerms: [rule("certificate")] }),
    });

    expect(missing(findings)).toHaveLength(1);
  });

  it("honours a case-sensitive rule", () => {
    const rules = profile({
      requiredTerms: [rule("Employer", { caseSensitive: true })],
    });

    const satisfied = findTerminologyIssues({ text: "The Employer agreed.", rules });
    expect(missing(satisfied)).toEqual([]);

    const wrongCase = findTerminologyIssues({ text: "The employer agreed.", rules });
    expect(missing(wrongCase)).toHaveLength(1);
  });

  it("is case-insensitive by default", () => {
    const findings = findTerminologyIssues({
      text: "The employer agreed.",
      rules: profile({ requiredTerms: [rule("Employer")] }),
    });

    expect(missing(findings)).toEqual([]);
  });

  it("offers no correction, because an absent term has no text to rewrite", () => {
    const findings = findTerminologyIssues({
      text: "Nothing relevant here.",
      rules: profile({ requiredTerms: [rule("completion certificate")] }),
    });

    // A correction here would advertise an Apply that has nothing to apply.
    expect(missing(findings)[0]?.deterministic?.correctionAvailable).toBe(false);
  });

  it("carries no batch key, so several absences are not approved as one set", () => {
    const findings = findTerminologyIssues({
      text: "Nothing relevant here.",
      rules: profile({ requiredTerms: [rule("alpha"), rule("beta")] }),
    });

    const reported = missing(findings);
    expect(reported).toHaveLength(2);
    reported.forEach((finding) => {
      expect(finding.deterministic?.safeBatchKey).toBeUndefined();
    });
  });

  it("anchors at a zero-length range at the document start", () => {
    /*
     * There is no span in the text holding the missing term, so any range would be
     * a fiction - and "Go to text" would then send the reader somewhere the term
     * is not.
     */
    const findings = findTerminologyIssues({
      text: "Nothing relevant here.",
      rules: profile({ requiredTerms: [rule("completion certificate")] }),
    });

    const [finding] = missing(findings);
    expect(finding?.range).toEqual({ start: 0, end: 0, unit: "character" });
  });

  it("names the profile field each finding came from", () => {
    const findings = findTerminologyIssues({
      text: "Nothing relevant here.",
      rules: profile({ requiredTerms: [rule("alpha")] }),
    });

    expect(missing(findings)[0]?.deterministic?.profilePath).toBe(
      "language.requiredTerms.req:alpha",
    );
  });

  it("carries the severity the rule declares", () => {
    const findings = findTerminologyIssues({
      text: "Nothing relevant here.",
      rules: profile({
        requiredTerms: [rule("alpha", { severity: "mandatory" })],
      }),
    });

    expect(missing(findings)[0]?.severity).toBe("error");
  });

  it("cannot be given a blank source at all", () => {
    /*
     * Asserted at the schema rather than at the rule, because that is where it is
     * actually prevented. An earlier version of this test built the profile with a
     * whitespace source and expected the rule to ignore it - which failed, because
     * `TerminologyRuleSchema` rejects the value before the rule ever sees it.
     *
     * That is the better place for the guarantee: a required term of "" would
     * otherwise report "this style requires the term ''", a finding about nothing no
     * user could act on.
     */
    const result = LanguageConventionProfileSchema.safeParse({
      requiredTerms: [{ id: "req:blank", source: "   " }],
    });

    expect(result.success).toBe(false);
  });

  it("is silent when the profile requires nothing", () => {
    const findings = findTerminologyIssues({
      text: "Any text at all.",
      rules: profile({}),
    });

    expect(missing(findings)).toEqual([]);
  });

  it("does not disturb the substitution findings beside it", () => {
    const findings = findTerminologyIssues({
      text: "The color scheme was reviewed.",
      rules: profile({
        terminology: [rule("color", { replacement: "colour" })],
        requiredTerms: [rule("completion certificate")],
      }),
    });

    // Both kinds survive the same scan: a substitution anchored at a span, and an
    // absence anchored nowhere. Merging them would lose the distinction between
    // "you wrote this word" and "this document never says this".
    expect(missing(findings)).toHaveLength(1);
    expect(findings.some((finding) => finding.category === "language.terminology.preferred")).toBe(
      true,
    );
  });
});
