/**
 * `language.abbreviations.preferredExpanded` — the rendering the house wants.
 *
 * **The defect.** The field is declared "long form → the short form to use in
 * running text", is listed in `PROFILE_FIELD_PATHS`, and is named in
 * `language/abbreviations`'s `profilePaths` — so the registry reported it as
 * wired. `findAbbreviationIssues` read `approved`, `requireFirstUseExpansion` and
 * `prohibitedVariants`, and never this one. A profile could author a preferred
 * rendering, save it, and see no finding ever, which is the ND-13 failure with a
 * different field name.
 *
 * **The interaction this had to be built around.** A house can legitimately hold
 * `approved`, `preferredExpanded` *and* `requireFirstUseExpansion: true` at once:
 * expand on first use, then use the short form throughout. Read independently, the
 * two rules contradict each other — one demands the long form appear, the other
 * reports every long form. These tests pin the reconciliation, not just the happy
 * path, because a regression here would have one rule demanding the user delete
 * what the other just told them to add.
 *
 * Every assertion is on the observable contract — which findings a profile and a
 * document produce — so these fail again if the behaviour is removed by accident.
 */

import { describe, expect, it } from "vitest";

import { findAbbreviationIssues } from "../../../src/rules/language";
import type { LanguageConventionProfile } from "../../../src/core/domain/StyleProfile";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

const PREFERRED = "language.abbreviation.preferredExpanded";

function profile(abbreviations: Record<string, unknown> = {}): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({
    abbreviations: { preferredExpanded: { "for example": "e.g." }, ...abbreviations },
  });
}

function preferredFindings(text: string, abbreviations: Record<string, unknown> = {}): Finding[] {
  return findAbbreviationIssues({ text, rules: profile(abbreviations) }).filter(
    (finding) => finding.category === PREFERRED,
  );
}

describe("preferredExpanded reports the long form where the house prefers the short one", () => {
  it("reports a long form the profile wants shortened", () => {
    const findings = preferredFindings("The rule applies, for example, to headings.");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: PREFERRED,
      severity: "warning",
      actual: "for example",
      expected: "e.g.",
      deterministic: {
        profilePath: "language.abbreviations.preferredExpanded.for example",
        // Safe because the two forms denote the same thing. Replacing one with
        // the other restates it; it cannot change what the sentence says.
        correctionAvailable: true,
        safeBatchKey: "abbrevPreferred:for example",
      },
    });
  });

  it("reports every occurrence, not only the first", () => {
    const findings = preferredFindings("For example, this. And for example that.");

    expect(findings.map((finding) => finding.range.start)).toEqual([0, 23]);
  });

  it("says nothing when the document already uses the short form", () => {
    expect(preferredFindings("That is fine, e.g. here.")).toEqual([]);
  });

  it("matches the long form case-insensitively and as a whole phrase", () => {
    const findings = preferredFindings("For Example, and another FOR EXAMPLE.");

    expect(findings).toHaveLength(2);
  });

  it("matches the phrase whole, and not as the prefix of a longer word", () => {
    expect(preferredFindings("This is for examples only.")).toEqual([]);
    expect(preferredFindings("This is for example only.")).toHaveLength(1);
  });

  it("matches the phrase before an apostrophe, which is still the phrase", () => {
    // The boundary class is letters, numbers and underscore. An apostrophe is
    // punctuation, so "for example's sake" *is* an occurrence of the phrase with a
    // possessive attached — reporting it is correct, and a boundary that included
    // the apostrophe would silently exempt a very common construction.
    const findings = preferredFindings("This is for example's sake only.");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ actual: "for example" });
  });

  it("declares a batch key, because every occurrence wants the same replacement", () => {
    const findings = preferredFindings("for example. for example.");

    const keys = findings.map((finding) => finding.deterministic?.safeBatchKey);
    expect(keys).toEqual(["abbrevPreferred:for example", "abbrevPreferred:for example"]);
  });
});

describe("preferredExpanded and requireFirstUseExpansion are read together", () => {
  const requireExpansion = { requireFirstUseExpansion: true, approved: { "e.g.": "for example" } };

  it("does not report the long form that precedes the first short form", () => {
    const findings = preferredFindings(
      "For example, this one. And e.g. that one.",
      requireExpansion,
    );

    expect(findings).toEqual([]);
  });

  it("reports a long form that appears after the first short form", () => {
    const findings = preferredFindings("Use e.g. here. And for example there.", requireExpansion);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      actual: "for example",
      expected: "e.g.",
    });
  });

  it("reports every long form when the profile does not ask for an expansion", () => {
    // The contrasting case, and the reason the two settings are not the same
    // switch. With no expansion required there is no licensed long form, so the
    // document's opening "for example" is a deviation like any other.
    const findings = preferredFindings("For example, this one. And for example that one.", {
      requireFirstUseExpansion: false,
      approved: { "e.g.": "for example" },
    });

    expect(findings).toHaveLength(2);
  });

  it("reports every long form when the profile expresses no opinion at all", () => {
    const findings = preferredFindings("For example, this one. And for example that one.", {
      approved: { "e.g.": "for example" },
    });

    // `requireFirstUseExpansion` is optional, so "absent" must not read as
    // "granted" — that is the whole reason it is not a boolean with a default.
    expect(findings).toHaveLength(2);
  });

  it("still reports a long form when the document never uses the short form", () => {
    const findings = preferredFindings(
      "For example, this. And for example that.",
      requireExpansion,
    );

    expect(findings).toHaveLength(2);
  });
});

describe("preferredExpanded never produces a no-op or a second owner", () => {
  it("stays silent on a form mapped to itself", () => {
    const findings = preferredFindings("Write it as and when you like.", {
      preferredExpanded: { "and when": "and when" },
    });

    // A profile that maps a form to itself has expressed no preference. Reporting
    // it would offer an Approve whose correction is identical to what is there.
    expect(findings).toEqual([]);
  });

  it("cannot be handed an entry with a blank half", () => {
    // The guard is the schema, not the rule. A profile holding `{ "": "e.g." }`
    // would make an empty-string pattern match every offset in the document, so
    // the record is rejected at the boundary and the rule never sees it.
    expect(
      LanguageConventionProfileSchema.safeParse({
        abbreviations: { preferredExpanded: { "": "e.g." } },
      }).success,
    ).toBe(false);
    expect(
      LanguageConventionProfileSchema.safeParse({
        abbreviations: { preferredExpanded: { "for example": "" } },
      }).success,
    ).toBe(false);
  });

  it("does not claim a span the prohibited rule has already claimed", () => {
    const findings = findAbbreviationIssues({
      text: "Write for example here.",
      rules: profile({
        prohibitedVariants: ["for example"],
        preferredExpanded: { "for example": "e.g." },
      }),
    });

    // Two owners for one character is ND-2, and the planner is entitled to refuse
    // the whole plan over it. The prohibited rule wins the claim: it is the
    // stricter statement, and it is the one carrying the `approved` replacement.
    expect(findings.map((finding) => finding.category)).toEqual([
      "language.abbreviation.prohibited",
    ]);
  });
});

describe("the category is wired end to end", () => {
  it("is a category the rule registry says this rule emits", async () => {
    const { DETERMINISTIC_RULES } =
      await import("../../../src/analysis/deterministic/ruleRegistry");
    const rule = DETERMINISTIC_RULES.find((entry) => entry.id === "language/abbreviations");

    expect(rule?.emits).toContain(PREFERRED);
  });

  it("is a category the planner will turn into a substitution", async () => {
    const { DETERMINISTIC_CORRECTABLE_CATEGORIES } =
      await import("../../../src/changes/deterministicChanges");

    expect(DETERMINISTIC_CORRECTABLE_CATEGORIES).toContain(PREFERRED);
  });
});
