/**
 * D4 — `units.symbols` as a preferred rendering map.
 *
 * **The defect.** `units.symbols` is declared as a map from a *named* unit to
 * the *symbol* the house prefers — `kilogram` → `kg`. Only the **values** were
 * read: they formed the word list the spacing check matched against. The **keys**
 * were used for nothing except to word a capitalisation message. So half the
 * record governed nothing, and the half that governed nothing was the half the
 * user thought they were configuring.
 *
 * A document writing "5 kilogram" against a house that says "5 kg" produced no
 * finding at all. The same failure class as ND-13: a field that looked
 * authoritative and did nothing.
 *
 * These tests assert the observable contract — which findings a profile and a
 * document produce — rather than the private matcher, so they fail again if the
 * behaviour is ever removed by accident.
 */

import { describe, expect, it } from "vitest";

import { findUnitIssues } from "../../../src/rules/language";
import type { LanguageConventionProfile } from "../../../src/core/domain/StyleProfile";
import { LanguageConventionProfileSchema } from "../../../src/core/domain/StyleProfile";
import type { Finding } from "../../../src/core/domain/Finding";

function profile(symbols: Record<string, string>): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({
    units: { valueSpacing: "space", capitalisation: "lower", symbols },
  });
}

function preferredSymbolFindings(text: string, symbols: Record<string, string>): Finding[] {
  return findUnitIssues({ text, rules: profile(symbols) }).filter(
    (finding) => finding.category === "language.unit.preferredSymbol",
  );
}

describe("units.symbols is a preferred rendering map (D4)", () => {
  it("reports a named unit where the house prefers its symbol", () => {
    const findings = preferredSymbolFindings("The parcel weighed 5 kilogram today.", {
      kilogram: "kg",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "language.unit.preferredSymbol",
      actual: "kilogram",
      expected: "kg",
      // The deterministic block, not the finding root: `profilePath`,
      // `correctionAvailable` and `safeBatchKey` all live there, and a test that
      // reads them off the root is asserting on fields that were never set.
      deterministic: {
        profilePath: "language.units.symbols.kilogram",
        // Safe because a name and its symbol denote the same quantity. The edit
        // restates the measurement; it cannot change it.
        correctionAvailable: true,
      },
    });
  });

  it("anchors the finding on the unit, not the number", () => {
    const text = "The parcel weighed 5 kilogram today.";
    const [finding] = preferredSymbolFindings(text, { kilogram: "kg" });

    expect(finding?.range).toEqual({
      start: text.indexOf("kilogram"),
      end: text.indexOf("kilogram") + "kilogram".length,
      unit: "character",
    });
  });

  it("says nothing when the document already uses the preferred symbol", () => {
    // The compliant case. Before D4 this was also silent, but for the wrong
    // reason — the map's keys were never consulted at all.
    expect(preferredSymbolFindings("The parcel weighed 5 kg today.", { kilogram: "kg" })).toEqual(
      [],
    );
  });

  it("says nothing for a name that maps to itself", () => {
    // `m` → `m` expresses no preference. Without this guard every occurrence
    // would be reported as its own correction.
    expect(preferredSymbolFindings("The run took 4 m today.", { m: "m" })).toEqual([]);
  });

  it("does not double-report a symbol written in the wrong case", () => {
    /*
     * The overlap guard, and the case that actually threatens it.
     *
     * `5 KG` against a `kilogram → kg` house is a capitalisation deviation, and
     * the capitalisation check reports it. The rendering check matches the whole
     * word `kilogram`, which `KG` does not contain — so exactly one finding
     * fires. If the two rules ever both matched one span they would build two
     * overlapping changes and the planner would refuse the whole plan as
     * conflicting, which is the failure this assertion exists to prevent.
     */
    const findings = findUnitIssues({
      text: "The parcel weighed 5 KG.",
      rules: profile({ kilogram: "kg" }),
    });

    expect(findings.map((finding) => finding.category)).toEqual(["language.unit.capitalisation"]);
    expect(findings[0]).toMatchObject({ actual: "KG", expected: "kg" });
  });

  it("reports a spelled-out name whose symbol is a single case-sensitive letter", () => {
    // `metre` → `m` is a *rendering* preference, not a casing one: the house wants
    // the symbol, so writing the word out is a deviation even though `Metre`
    // already opens with a capital.
    const findings = preferredSymbolFindings("The run took 4 Metre today.", { metre: "m" });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ actual: "Metre", expected: "m" });
  });

  it("matches a multi-word name whole", () => {
    // The decisive boundary. A substring match would report "second" inside
    // "secondary", which is not a measurement at all.
    expect(
      preferredSymbolFindings("This is a secondary consideration, not 3 second.", {
        second: "s",
      }),
    ).toHaveLength(1);
    expect(
      preferredSymbolFindings("This is a secondary consideration, not 3 second.", {
        second: "s",
      })[0]?.actual,
    ).toBe("second");
  });

  it("does not match a name inside a longer word", () => {
    expect(preferredSymbolFindings("The kilogramme is not a unit.", { kilogram: "kg" })).toEqual(
      [],
    );
  });

  it("is case-insensitive about the name, so a capitalised occurrence is still reported", () => {
    const findings = preferredSymbolFindings("The Parcel weighed 5 Kilogram.", { kilogram: "kg" });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.actual).toBe("Kilogram");
  });

  it("reports every occurrence so the author decides how many to change", () => {
    const findings = preferredSymbolFindings("5 kilogram and 7 kilogram.", { kilogram: "kg" });

    expect(findings).toHaveLength(2);
    // Same rule, same correction — one batch group, not two.
    expect(new Set(findings.map((finding) => finding.deterministic?.safeBatchKey))).toEqual(
      new Set(["unitSymbol:kilogram:kg"]),
    );
  });

  it("keeps separate symbols in separate batch groups", () => {
    const findings = preferredSymbolFindings("5 kilogram and 3 kilometre.", {
      kilogram: "kg",
      kilometre: "km",
    });

    // `kilogram` is not a prefix of `kilometre` and the whole-word match keeps
    // them apart, but the batch keys must differ so "Approve all" cannot offer
    // one edit for two different corrections.
    expect(new Set(findings.map((finding) => finding.deterministic?.safeBatchKey)).size).toBe(2);
  });

  it("says nothing at all when the house declares no symbols", () => {
    // With no map there is no preference to enforce. A default unit list would
    // fire on prose the author never asked about.
    expect(preferredSymbolFindings("The parcel weighed 5 kilogram today.", {})).toEqual([]);
  });

  it("does not disturb the spacing findings beside it", () => {
    const findings = findUnitIssues({
      text: "5 kilogram",
      rules: profile({ kilogram: "kg" }),
    });

    const categories = new Set(findings.map((finding) => finding.category));
    // The gap before `kilogram` is already correct, so spacing is silent and the
    // rendering preference is the only thing reported.
    expect(categories.has("language.unit.spacing")).toBe(false);
    expect(categories.has("language.unit.preferredSymbol")).toBe(true);
  });
});
