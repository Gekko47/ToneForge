import { describe, expect, it } from "vitest";
import type { DateValue } from "../../../../src/analysis/consistency/contracts";
import {
  baseUnit,
  buildAliasIndex,
  collectAliasEntries,
  compatibleUnits,
  currencyCode,
  dateKey,
  dateRangeKey,
  normaliseClaims,
  normaliseDate,
  normaliseValue,
  parseDecimal,
  parseDurationDays,
  partyAliases,
  quantityKey,
  toBaseUnit,
} from "../../../../src/analysis/consistency/normalisation";
import {
  attributionClaim,
  claim,
  delayClaim,
  scenarioClaim,
} from "../../../fixtures/consistencyClaims";

/** A date as the document wrote it, with nothing parsed yet. */
function date(raw: string): DateValue {
  return { raw, coarse: false };
}

/**
 * R3 validation (plan §11): equivalence property tests for the
 * deterministic normalisation stage.
 *
 * Every test here asserts an equivalence the engine relies on:
 * two forms of one date, one figure, one duration, or one label
 * must meet under one canonical key, whatever form the document
 * used — and a form the engine cannot read must stay unkeyed,
 * because unknown stays unknown.
 */

describe("date normalisation equivalence", () => {
  it("meets the long and ISO forms of one date under one key", () => {
    const long = normaliseDate(date("1 April 2026"));
    const iso = normaliseDate(date("2026-04-01"));
    expect(dateKey(long)).toBe("date:2026-04-01");
    expect(dateKey(iso)).toBe("date:2026-04-01");
  });

  it("marks a month-precision date coarse and keys it apart from a day", () => {
    const month = normaliseDate(date("April 2026"));
    expect(month.coarse).toBe(true);
    expect(month.day).toBe(0);
    expect(dateKey(month)).toBe("date:2026-04-00");
    expect(dateKey(month)).not.toBe("date:2026-04-01");
  });

  it("keeps structured fields the extraction pass already filled", () => {
    const structured: DateValue = {
      raw: "1 Apr 2026",
      coarse: false,
      year: 2026,
      month: 4,
      day: 1,
    };
    const normalised = normaliseDate(structured);
    expect(normalised.year).toBe(2026);
    expect(normalised.month).toBe(4);
    expect(normalised.day).toBe(1);
    expect(dateKey(normalised)).toBe("date:2026-04-01");
  });

  it("gives a date it cannot parse no key, never a guessed one", () => {
    const unknown = normaliseDate(date("sometime last quarter"));
    expect(unknown.year).toBeUndefined();
    expect(dateKey(unknown)).toBeNull();
  });

  it("keys a range by both endpoints, and only when both parse", () => {
    expect(
      dateRangeKey(normaliseDate(date("1 April 2026")), normaliseDate(date("30 June 2026"))),
    ).toBe("range:date:2026-04-01..date:2026-06-30");
    expect(
      dateRangeKey(normaliseDate(date("sometime")), normaliseDate(date("30 June 2026"))),
    ).toBeNull();
  });

  it("is deterministic: the same date normalises to the same key", () => {
    const forms = ["1 April 2026", "2026-04-01", "April 2026", "2026"];
    forms.forEach((raw) => {
      expect(dateKey(normaliseDate(date(raw)))).toBe(dateKey(normaliseDate(date(raw))));
    });
  });
});

describe("quantity normalisation equivalence", () => {
  it("parses thousands separators, currency marks, and multipliers", () => {
    expect(parseDecimal("1,250,000")).toBe(1250000);
    expect(parseDecimal("£1,250,000")).toBe(1250000);
    expect(parseDecimal("1.5k")).toBe(1500);
  });

  it("does not parse a value it cannot read", () => {
    expect(parseDecimal("six weeks")).toBeUndefined();
  });

  it("meets equivalent figures under one key, whatever form was used", () => {
    const spaced = normaliseValue({ raw: "1,250,000 USD" });
    const compact = normaliseValue({ raw: "1250000 USD" });
    expect(quantityKey(spaced)).toBe("quantity:1250000::USD");
    expect(quantityKey(compact)).toBe(quantityKey(spaced));
  });

  it("reads a trailing percent sign as the percent unit", () => {
    const percent = normaliseValue({ raw: "15%" });
    expect(percent.unit).toBe("%");
    expect(quantityKey(percent)).toBe("quantity:15:%:");
  });

  it("uppercases the currency code a value carries", () => {
    expect(currencyCode("1,250,000 USD")).toBe("USD");
    expect(normaliseValue({ raw: "100", currency: "gbp" }).currency).toBe("GBP");
  });

  it("gives a figure with no parsed magnitude no key", () => {
    expect(quantityKey(normaliseValue({ raw: "a sum" }))).toBeNull();
  });
});

describe("duration normalisation equivalence", () => {
  it("meets a word duration and its numeral form as one duration", () => {
    expect(parseDurationDays("six weeks")).toBe(42);
    expect(parseDurationDays("42 days")).toBe(42);
  });

  it("uses the calendar approximation for months and years", () => {
    expect(parseDurationDays("one month")).toBe(30);
    expect(parseDurationDays("2 years")).toBe(730);
  });

  it("returns null for text that is not a known duration", () => {
    expect(parseDurationDays("a year")).toBeNull();
    expect(parseDurationDays("next tuesday")).toBeNull();
  });
});

describe("unit compatibility", () => {
  it("converts units of one dimension to the dimension's base unit", () => {
    expect(toBaseUnit(2, "weeks")).toBe(14);
    expect(toBaseUnit(48, "hours")).toBe(2);
    expect(toBaseUnit(1, "km")).toBe(1000);
  });

  it("tells convertible units apart from incompatible ones", () => {
    expect(compatibleUnits("weeks", "days")).toBe(true);
    expect(compatibleUnits("km", "miles")).toBe(true);
    expect(compatibleUnits("kg", "m")).toBe(false);
    expect(compatibleUnits("fortnights", "days")).toBe(false);
  });

  it("treats an unknown unit as compatible only with itself", () => {
    expect(compatibleUnits("fortnights", "fortnights")).toBe(true);
    expect(compatibleUnits("fortnights", "weeks")).toBe(false);
  });

  it("names the base unit of each convertible dimension", () => {
    expect(baseUnit("weeks")).toBe("day");
    expect(baseUnit("miles")).toBe("m");
    expect(baseUnit("kg")).toBe("kg");
    expect(baseUnit("fortnights")).toBeNull();
  });
});

describe("alias resolution", () => {
  it("folds a label's presentation onto one entity", () => {
    const index = buildAliasIndex([
      { entityId: "e-1", label: "The Contractor" },
      { entityId: "e-1", label: "the contractor" },
    ]);
    expect(index.size).toBe(1);
    expect(index.resolve("THE CONTRACTOR")).toBe("e-1");
  });

  it("keeps the first entity a label was asserted for", () => {
    const index = buildAliasIndex([
      { entityId: "e-1", label: "ABC Ltd" },
      { entityId: "e-2", label: "ABC Ltd" },
    ]);
    expect(index.resolve("abc ltd")).toBe("e-1");
  });

  it("lists an entity's labels with its canonical name first", () => {
    const index = buildAliasIndex(partyAliases({ id: "e-1", name: "The Contractor" }, ["ABC Ltd"]));
    expect(index.labelsFor("e-1")).toEqual(["The Contractor", "ABC Ltd"]);
  });

  it("skips empty labels rather than indexing them", () => {
    const index = buildAliasIndex([{ entityId: "e-1", label: "   " }]);
    expect(index.size).toBe(0);
    expect(index.labelsFor("e-1")).toEqual([]);
  });
});

describe("claim normalisation", () => {
  it("is deterministic: the same claims normalise to the same facets", () => {
    const claims = [attributionClaim, scenarioClaim, delayClaim];
    expect(normaliseClaims(claims)).toEqual(normaliseClaims(claims));
  });

  it("parses a delay stated only in text", () => {
    const normalised = normaliseClaims([claim({ delay: { durationText: "six weeks" } })])[0];
    expect(normalised?.durationDays).toBe(42);
  });

  it("keeps the delay's stated days when the extraction filled them", () => {
    const normalised = normaliseClaims([delayClaim])[0];
    expect(normalised?.durationDays).toBe(42);
  });

  it("keeps temporal roles apart, each with its own key", () => {
    const normalised = normaliseClaims([
      claim({
        temporal: {
          assertionDate: date("1 April 2026"),
          eventDate: date("1 April 2026"),
        },
      }),
    ])[0];
    expect(normalised?.dates.map(({ role }) => role)).toEqual(["assertionDate", "eventDate"]);
    normalised?.dates.forEach(({ date: value }) => {
      expect(dateKey(value)).toBe("date:2026-04-01");
    });
  });

  it("normalises values the extraction pass left as raw text", () => {
    const normalised = normaliseClaims([claim({ values: [{ raw: "1,250,000 USD" }] })])[0];
    expect(normalised?.values[0]?.normalized).toBe(1250000);
    expect(normalised?.values[0]?.currency).toBe("USD");
  });

  it("collects every party the claims name, under each role it plays", () => {
    const entries = collectAliasEntries([attributionClaim, scenarioClaim]);
    const entityIds = new Set(entries.map(({ entityId }) => entityId));
    expect(entityIds).toEqual(new Set(["party-contractor", "party-employer"]));
  });
});
