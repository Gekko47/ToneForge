/**
 * D5 — `language.locale` is enforced, not metadata.
 *
 * **The defect.** `locale` was a free string in the schema, an editable text box
 * in the editor (labelled, to its credit, "recorded, not enforced"), and listed
 * in `METADATA_ONLY_PROFILE_PATHS` so the registry recorded the omission as a
 * reviewed exception. Nothing read it. Selecting a locale changed no finding.
 *
 * That is the same class of defect as ND-13: a field that looks authoritative and
 * governs nothing. The difference here is that the label admitted it — which makes
 * it worse, not better, because a user who believes a setting is metadata is
 * relying on it not to do anything, and one that silently starts firing findings
 * would be the opposite.
 *
 * **What it now does.** Supplies the *default* numeric date shape when the profile
 * has declared no preferred format of its own. `requireUnambiguous` alone cannot
 * tell a month-first date from a day-first one — only a preferred shape can — so
 * the locale is the one setting that can make that call.
 *
 * **What it deliberately does not do.** It does not drive spelling, and it does not
 * override an explicit format.
 */

import { describe, expect, it } from "vitest";

import { findDateIssues } from "../../../src/rules/language";
import {
  LanguageConventionProfileSchema,
  LOCALE_OPTIONS,
  LOCALE_DATE_SHAPES,
  LocaleSchema,
  type LanguageConventionProfile,
  type Locale,
} from "../../../src/core/domain/StyleProfile";
import { METADATA_ONLY_PROFILE_PATHS } from "../../../src/analysis/deterministic/ruleRegistry";

function profile(overrides: Partial<LanguageConventionProfile> = {}): LanguageConventionProfile {
  return LanguageConventionProfileSchema.parse({ ...overrides });
}

describe("language.locale is an enforced setting (D5)", () => {
  it("reports a month-first date under a day-first locale", () => {
    /*
     * The core assertion. Under `en-GB` the house writes `DD/MM/YYYY`, so
     * `05/31/2026` — a month-first date, unambiguous because 31 is not a month —
     * is reported.
     *
     * The second field exceeding 12 is what makes this decidable at all. With
     * `05/03/2026` both readings are valid and the tool must refuse rather than
     * guess; see the ambiguity test below. Before D5 this returned nothing,
     * because with no declared preferred format the rule returned early — the
     * locale was never consulted.
     */
    const findings = findDateIssues({
      text: "The review closes on 05/31/2026.",
      rules: profile({ locale: "en-GB", dates: { formats: [], requireUnambiguous: true } }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "language.date.format",
      actual: "05/31/2026",
      // Reported, never corrected: reordering the fields would change which day
      // the date names if the reader guessed the other way.
      deterministic: { correctionAvailable: false },
    });
  });

  it("still refuses a date both readings allow, rather than resolving it by locale", () => {
    /*
     * The boundary that keeps the locale honest.
     *
     * `05/03/2026` is valid as 5 March and as 5 May. A locale that "resolved" it
     * would be the tool deciding which day the author meant — the exact thing
     * this rule exists not to do, and the reason the locale supplies a *shape*
     * rather than a *reading*.
     */
    const findings = findDateIssues({
      text: "The review closes on 05/03/2026.",
      rules: profile({ locale: "en-GB", dates: { formats: [], requireUnambiguous: true } }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "language.date.ambiguous",
      actual: "05/03/2026",
    });
  });

  it("says nothing when the date already matches the locale's shape", () => {
    // `25/12/2026` under `en-GB`: day-first, unambiguous, and already right.
    const findings = findDateIssues({
      text: "The review closes on 25/12/2026.",
      rules: profile({ locale: "en-GB", dates: { formats: [], requireUnambiguous: true } }),
    });

    expect(findings).toEqual([]);
  });

  it("reports the opposite date order under a month-first locale", () => {
    // The same text must produce a *different* verdict depending on the locale.
    // Without that, the locale is decorative again and only the ambiguous case
    // would look like enforcement.
    const findings = findDateIssues({
      text: "The review closes on 25/12/2026.",
      rules: profile({ locale: "en-US", dates: { formats: [], requireUnambiguous: true } }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("language.date.format");
  });

  it("lets an explicitly preferred format override the locale", () => {
    /*
     * The precedence rule, and the reason the locale is a *default* rather than a
     * command. A house that writes `31/05/2026` under an `en-US` locale has made
     * its own choice; overruling it with the locale beside it would be the tool
     * deciding the house's conventions for it.
     *
     * `31/05/2026` is the date an `en-US` locale would report, so this only
     * passes if the declared format genuinely won.
     */
    const findings = findDateIssues({
      text: "The review closes on 31/05/2026.",
      rules: profile({
        locale: "en-US",
        dates: {
          formats: [{ id: "dmy", format: "DD/MM/YYYY", preferred: true }],
          requireUnambiguous: true,
        },
      }),
    });

    expect(findings).toEqual([]);
  });

  it("lets a declared format report a date the locale would have accepted", () => {
    /*
     * The converse, and the one that proves precedence is real rather than
     * incidental: the locale says month-first, the house says day-first, and the
     * house wins in both directions.
     */
    const findings = findDateIssues({
      text: "The review closes on 05/31/2026.",
      rules: profile({
        locale: "en-US",
        dates: {
          formats: [{ id: "dmy", format: "DD/MM/YYYY", preferred: true }],
          requireUnambiguous: true,
        },
      }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("language.date.format");
  });

  it("names the locale as the field to change when the default is what fired", () => {
    /*
     * The finding has to point at the setting the user would change to silence
     * it. Naming `language.dates.formats` when the locale supplied the default
     * would send the user to a panel that holds no opinion.
     */
    const findings = findDateIssues({
      text: "Review on 05/31/2026.",
      rules: profile({ locale: "en-GB", dates: { formats: [], requireUnambiguous: false } }),
    });

    const [finding] = findings;
    expect(finding?.deterministic?.profilePath).toBe("language.locale");
  });

  it("names the formats list when an explicit preference fired", () => {
    const findings = findDateIssues({
      text: "Review on 2026-03-05.",
      rules: profile({
        locale: "en-GB",
        dates: {
          formats: [{ id: "dmy", format: "DD/MM/YYYY", preferred: true }],
          requireUnambiguous: false,
        },
      }),
    });

    const [finding] = findings;
    expect(finding?.deterministic?.profilePath).toBe("language.dates.formats");
  });

  it("is no longer excused as a metadata-only field", () => {
    // The registry list is now empty, and that is a claim worth asserting: it says
    // every profile field is read by something.
    expect(METADATA_ONLY_PROFILE_PATHS).not.toContain("language.locale");
  });
});

describe("the locale set is closed", () => {
  it("rejects a value outside the set rather than storing it silently", () => {
    /*
     * A free string accepts a typo that parses cleanly and then matches no rule —
     * the ND-13 failure wearing a different hat. The enum is what prevents it.
     */
    expect(LocaleSchema.safeParse("en-GB").success).toBe(true);
    expect(LocaleSchema.safeParse("en-gb").success).toBe(false);
    expect(LocaleSchema.safeParse("klingon").success).toBe(false);
    expect(LocaleSchema.safeParse("").success).toBe(false);
  });

  it("gives every offered locale a date shape, so no dropdown entry is inert", () => {
    // An option that maps to nothing would be a control that changes the profile
    // without changing any behaviour — the defect D5 exists to remove.
    LOCALE_OPTIONS.forEach((locale) => {
      expect(LOCALE_DATE_SHAPES[locale].id.length).toBeGreaterThan(0);
      expect(LOCALE_DATE_SHAPES[locale].format.length).toBeGreaterThan(0);
    });
  });

  it("defaults to en-US, a month-first locale", () => {
    expect(LanguageConventionProfileSchema.parse({}).locale).toBe("en-US");
  });

  it("orders day-first and month-first locales by their actual convention", () => {
    /*
     * Asserted per locale rather than by counting, because a table that
     * accidentally assigned `en-AU` month-first would still pass a count check —
     * and getting that wrong means misreporting which day a date names.
     */
    const dayFirst: Locale[] = ["en-GB", "en-AU", "en-IE", "en-NZ"];
    const monthFirst: Locale[] = ["en-US", "en-CA"];

    dayFirst.forEach((locale) => expect(LOCALE_DATE_SHAPES[locale].id).toBe("dmy"));
    monthFirst.forEach((locale) => expect(LOCALE_DATE_SHAPES[locale].id).toBe("mdy"));
  });
});
