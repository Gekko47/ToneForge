/**
 * Quantity normalisation (original §8: percentages, decimal
 * values, currencies, durations, compatible units).
 *
 * A claim's values are parsed from the raw text when the
 * extraction pass left them as text, so every value the engine
 * holds has one canonical key — magnitude, unit, and currency.
 * `1,250,000 USD` and `1250000 USD` are one key, and a figure
 * in another currency is another.
 *
 * This module is pure: it parses text and folds keys, and it
 * never guesses. A value that does not parse keeps its raw text
 * and gets no key, so it is simply not indexed — unknown stays
 * unknown.
 */

import { UNIT_MULTIPLIERS } from "../checks/primitives";
import type { ClaimValue } from "../contracts";

/**
 * Parse a decimal written with thousands separators, currency
 * marks, or a unit suffix, so `1,250,000` is `1250000` and
 * `1.5k` is `1500`.
 *
 * A recognized multiplier suffix is applied; an unrecognized
 * suffix is dropped rather than guessed at, so `1,250,000 USD`
 * parses as `1250000` and `six weeks` does not parse at all.
 */
export function parseDecimal(raw: string): number | undefined {
  const compact = raw.replace(/[£$€]/g, "").replace(/[,\s]/g, "");
  const match = /^(-?\d[\d.]*)([a-zA-Z%]*)$/.exec(compact);
  if (match === null) return undefined;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return undefined;
  const suffix = match[2] ?? "";
  const multiplier = UNIT_MULTIPLIERS[suffix.toLowerCase()] ?? 1;
  return parsed * multiplier;
}

/**
 * The ISO 4217 codes this module recognises.
 *
 * A bare three-letter uppercase token is not a currency: `GDP`, `VAT`, and
 * `THE` all match `[A-Z]{3}`. Only a known code is read as a currency, so an
 * acronym in the text is not mistaken for one.
 */
const CURRENCY_CODES: ReadonlySet<string> = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "CNY",
  "INR",
  "HKD",
  "SGD",
  "ZAR",
  "MXN",
  "BRL",
  "RUB",
  "KRW",
]);

const CURRENCY_CODE = /\b([A-Z]{3})\b/g;

/** The ISO 4217 code a raw value carries, uppercased. */
export function currencyCode(raw: string): string | undefined {
  return [...raw.matchAll(CURRENCY_CODE)]
    .map((match) => match[1])
    .find((code): code is string => code !== undefined && CURRENCY_CODES.has(code));
}

/**
 * Normalise one claim value.
 *
 * The magnitude is parsed from the raw text when the extraction
 * pass did not fill it, the unit is lowercased, a trailing
 * percent sign is read as the `%` unit, and the currency code is
 * uppercased — so equivalent values meet under one key whatever
 * form the document used.
 */
export function normaliseValue(value: ClaimValue): ClaimValue {
  const normalised: ClaimValue = { raw: value.raw };
  if (value.normalized !== undefined) {
    normalised.normalized = value.normalized;
  } else {
    const parsed = parseDecimal(value.raw);
    if (parsed !== undefined) normalised.normalized = parsed;
  }
  if (value.unit !== undefined) {
    normalised.unit = value.unit.toLowerCase();
  } else if (/%\s*$/.test(value.raw)) {
    normalised.unit = "%";
  }
  if (value.currency !== undefined) {
    normalised.currency = value.currency.toUpperCase();
  } else {
    const code = currencyCode(value.raw);
    if (code !== undefined) normalised.currency = code;
  }
  return normalised;
}

/**
 * The canonical key of a value: magnitude, unit, and currency.
 *
 * A value with no parsed magnitude is not keyed — unknown stays
 * unknown, and an unparseable figure is never compared against
 * a parseable one.
 */
export function quantityKey(value: ClaimValue): string | null {
  if (value.normalized === undefined) return null;
  return `quantity:${value.normalized}:${value.unit ?? ""}:${value.currency ?? ""}`;
}

const DURATION_NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

const DURATION_UNITS: Readonly<Record<string, number>> = Object.freeze({
  day: 1,
  week: 7,
  month: 30,
  year: 365,
});

const DURATION_PATTERN =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\b/i;

/**
 * Parse a duration like "six weeks" or "42 days" into days.
 *
 * A month is 30 days and a year 365 — the calendar
 * approximation the delay vocabulary uses — so "six weeks" and
 * "42 days" meet as one duration. Returns null when the text is
 * not a single duration the engine knows.
 */
export function parseDurationDays(text: string): number | null {
  const match = DURATION_PATTERN.exec(text);
  if (match === null) return null;
  const amount = DURATION_NUMBER_WORDS[(match[1] ?? "").toLowerCase()] ?? Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const days = DURATION_UNITS[unit];
  return days === undefined ? null : amount * days;
}

/**
 * Units the engine can convert, with the dimension each
 * measures and its factor to that dimension's base unit.
 *
 * A unit not listed here is not convertible: two unknown units
 * are compatible only when they are the same word, because
 * guessing a conversion is how a false contradiction is
 * manufactured.
 */
const CONVERTIBLE_UNITS: Readonly<Record<string, { dimension: string; toBase: number }>> =
  Object.freeze({
    day: { dimension: "time", toBase: 1 },
    days: { dimension: "time", toBase: 1 },
    hour: { dimension: "time", toBase: 1 / 24 },
    hours: { dimension: "time", toBase: 1 / 24 },
    minute: { dimension: "time", toBase: 1 / 1440 },
    minutes: { dimension: "time", toBase: 1 / 1440 },
    week: { dimension: "time", toBase: 7 },
    weeks: { dimension: "time", toBase: 7 },
    month: { dimension: "time", toBase: 30 },
    months: { dimension: "time", toBase: 30 },
    year: { dimension: "time", toBase: 365 },
    years: { dimension: "time", toBase: 365 },
    m: { dimension: "length", toBase: 1 },
    metre: { dimension: "length", toBase: 1 },
    metres: { dimension: "length", toBase: 1 },
    meter: { dimension: "length", toBase: 1 },
    meters: { dimension: "length", toBase: 1 },
    km: { dimension: "length", toBase: 1000 },
    kilometre: { dimension: "length", toBase: 1000 },
    kilometres: { dimension: "length", toBase: 1000 },
    mile: { dimension: "length", toBase: 1609.344 },
    miles: { dimension: "length", toBase: 1609.344 },
    ft: { dimension: "length", toBase: 0.3048 },
    foot: { dimension: "length", toBase: 0.3048 },
    feet: { dimension: "length", toBase: 0.3048 },
    g: { dimension: "mass", toBase: 1 },
    gram: { dimension: "mass", toBase: 1 },
    grams: { dimension: "mass", toBase: 1 },
    kg: { dimension: "mass", toBase: 1 },
    kilogram: { dimension: "mass", toBase: 1 },
    kilograms: { dimension: "mass", toBase: 1 },
    tonne: { dimension: "mass", toBase: 1000 },
    tonnes: { dimension: "mass", toBase: 1000 },
    lb: { dimension: "mass", toBase: 0.45359237 },
    lbs: { dimension: "mass", toBase: 0.45359237 },
    pound: { dimension: "mass", toBase: 0.45359237 },
    pounds: { dimension: "mass", toBase: 0.45359237 },
  });

/** The base unit of each convertible dimension. */
const BASE_UNITS: Readonly<Record<string, string>> = Object.freeze({
  time: "day",
  length: "m",
  mass: "kg",
});

/** The dimension a unit measures, or null when the engine cannot convert it. */
export function unitDimension(unit: string): string | null {
  return CONVERTIBLE_UNITS[unit.toLowerCase()]?.dimension ?? null;
}

/** The canonical base unit of a unit's dimension, or null when unknown. */
export function baseUnit(unit: string): string | null {
  const dimension = unitDimension(unit);
  return dimension === null ? null : (BASE_UNITS[dimension] ?? null);
}

/**
 * Whether two units can be converted into one another.
 *
 * Same dimension: "weeks" and "days" are compatible, so a
 * delay stated in each can be compared after conversion.
 * Different dimensions, or an unknown unit against anything
 * but itself: not compatible, and never guessed.
 */
export function compatibleUnits(a: string, b: string): boolean {
  const unitA = a.toLowerCase();
  const unitB = b.toLowerCase();
  if (unitA === unitB) return true;
  const specA = CONVERTIBLE_UNITS[unitA];
  const specB = CONVERTIBLE_UNITS[unitB];
  if (specA === undefined || specB === undefined) return false;
  return specA.dimension === specB.dimension;
}

/** Convert a quantity to its dimension's base unit, or null when the unit is unknown. */
export function toBaseUnit(value: number, unit: string): number | null {
  const spec = CONVERTIBLE_UNITS[unit.toLowerCase()];
  return spec === undefined ? null : value * spec.toBase;
}
