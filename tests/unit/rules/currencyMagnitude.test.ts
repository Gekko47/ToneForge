/**
 * `language.currency.magnitude` — how large an amount is written.
 *
 * **The field was inert.** `magnitude` is declared as "how large amounts are
 * abbreviated: `4.2m` versus `4,200,000`", listed in `PROFILE_FIELD_PATHS`, and
 * named in `language/currency`'s `profilePaths`. `findCurrencyIssues` read
 * `representation` and `symbolSpacing` and never this one. The fourth instance of
 * the same defect class, and the reason ADR-0111 exists.
 *
 * **Reported, never corrected, and that is the design rather than a gap.**
 * Abbreviating `4,200,000` as `4.2m` does not restate the figure — it replaces it
 * with a rounded one. Expanding `4.2m` needs the tool to decide which magnitude the
 * author meant. Either correction would be ToneForge choosing the author's number.
 */

import { describe, expect, it } from "vitest";

import { findCurrencyIssues } from "../../../src/rules/language";
import type {
  CurrencyProfile,
  LanguageConventionProfile,
} from "../../../src/core/domain/StyleProfile";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

const MAGNITUDE = "language.currency.magnitude";

function profile(currency: Partial<CurrencyProfile> = {}): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({ currency });
}

function magnitudeFindings(text: string, currency: Partial<CurrencyProfile> = {}): Finding[] {
  return findCurrencyIssues({ text, rules: profile(currency) }).filter(
    (finding) => finding.category === MAGNITUDE,
  );
}

describe("magnitude reports how the house wants amounts written", () => {
  it("reports an abbreviated amount under a full-figure house", () => {
    const findings = magnitudeFindings("The contract is worth £4.2m.", { magnitude: "full" });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: MAGNITUDE,
      severity: "warning",
      actual: "4.2",
      // No correction: rounding the figure is not restating it.
      expected: "",
      deterministic: {
        profilePath: "language.currency.magnitude",
        correctionAvailable: false,
      },
    });
    expect(findings[0]?.range).toEqual({ start: 23, end: 26, unit: "character" });
  });

  it("reports a full figure under a house that abbreviates", () => {
    const findings = magnitudeFindings("The contract is worth £4,200,000.", {
      magnitude: "millions",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ actual: "4,200,000", expected: "" });
  });

  it("names the house's magnitude in the message", () => {
    expect(magnitudeFindings("Worth £4,200,000.", { magnitude: "thousands" })[0]?.message).toBe(
      "This style abbreviates amounts of thousands",
    );
  });

  it("recognises every suffix a house writes", () => {
    ["k", "m", "bn", "million", "thousand"].forEach((suffix) => {
      expect(magnitudeFindings(`Worth £4${suffix}.`, { magnitude: "full" })).toHaveLength(1);
    });
  });

  it("reads a code as well as a symbol", () => {
    expect(
      magnitudeFindings("The contract is worth GBP 4.2m.", { magnitude: "full" }),
    ).toHaveLength(1);
  });

  it("reads an amount written with a gap after the marker", () => {
    expect(magnitudeFindings("The contract is worth £ 4.2m.", { magnitude: "full" })).toHaveLength(
      1,
    );
  });
});

describe("magnitude says nothing when the document already matches", () => {
  it("says nothing about a full figure under a full-figure house", () => {
    expect(magnitudeFindings("Worth £4,200,000.", { magnitude: "full" })).toEqual([]);
  });

  it("says nothing about an abbreviation under an abbreviating house", () => {
    expect(magnitudeFindings("Worth £4.2m.", { magnitude: "millions" })).toEqual([]);
  });

  it("leaves a three-digit amount alone even under an abbreviating house", () => {
    // `£900` is not a large amount. Reporting it would be the rule deciding what
    // "large" means, which is the house's decision and not the tool's.
    expect(magnitudeFindings("Worth £900.", { magnitude: "millions" })).toEqual([]);
  });

  it("says nothing about a figure with no currency marker", () => {
    expect(magnitudeFindings("The population is 4,200,000.", { magnitude: "millions" })).toEqual(
      [],
    );
    expect(magnitudeFindings("The population is 4.2m.", { magnitude: "full" })).toEqual([]);
  });

  it("does not read a unit that follows the figure as a magnitude suffix", () => {
    // `5 metre` ends in `m`, and a rule that matched any trailing letter would call
    // every measurement an abbreviated amount.
    expect(magnitudeFindings("The rod is 5 metre long.", { magnitude: "full" })).toEqual([]);
  });
});

describe("magnitude is wired end to end", () => {
  it("is a category the registered rule emits", async () => {
    const { DETERMINISTIC_RULES } =
      await import("../../../src/analysis/deterministic/ruleRegistry");
    const rule = DETERMINISTIC_RULES.find((entry) => entry.id === "language/currency");

    expect(rule?.emits).toContain(MAGNITUDE);
  });

  it("is stated as report-only rather than silently unplannable", async () => {
    const { DETERMINISTIC_REPORTED_ONLY_CATEGORIES } =
      await import("../../../src/changes/deterministicChanges");

    // The registry's gate requires every category a correctable rule emits to have
    // a plan *or a stated refusal*. A category in neither list is a finding with
    // no plan and no reason for having none.
    expect(DETERMINISTIC_REPORTED_ONLY_CATEGORIES.has(MAGNITUDE)).toBe(true);
  });
});
