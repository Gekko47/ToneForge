/**
 * Date normalisation (original §8: dates, date ranges).
 *
 * A claim's temporal facet carries dates as the document gave them.
 * Normalisation fills the parsed fields from the raw text when the
 * extraction pass did not fill them, so every date the engine holds
 * has one canonical key — `date:YYYY-MM-DD`, `date:YYYY-MM-00` for
 * a month-precision date, `date:YYYY-00-00` for a year-only one.
 * Two claims about one date then meet in the TemporalIndex whatever
 * form the document used.
 *
 * This module is pure: it parses text and folds keys, and it never
 * guesses. A date that does not parse keeps its raw text and gets no
 * key, so it is simply not indexed — unknown stays unknown.
 */

import { extractDates } from "../checks/primitives";
import type { DateValue } from "../contracts";

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Normalise one date value.
 *
 * Structured fields the extraction pass already filled are kept; the
 * missing ones are parsed from the raw text. A month-year form
 * ("April 2026") parses with day `0` and is marked coarse, because a
 * coarse date covers a range and is never equal to a precise day.
 */
export function normaliseDate(date: DateValue): DateValue {
  const parsed = extractDates(date.raw)[0];
  const year = date.year ?? parsed?.year;
  const month = date.month ?? parsed?.month;
  const day = date.day ?? parsed?.day;
  const iso =
    date.iso ??
    parsed?.iso ??
    (year === undefined ? undefined : `${year}-${pad(month ?? 0)}-${pad(day ?? 0)}`);

  const normalised: DateValue = { raw: date.raw, coarse: date.coarse || day === 0 };
  if (iso !== undefined) normalised.iso = iso;
  if (year !== undefined) normalised.year = year;
  if (month !== undefined) normalised.month = month;
  if (day !== undefined) normalised.day = day;
  return normalised;
}

/**
 * The canonical key of a date, or `null` when no year was given.
 *
 * Precision is part of the key: a precise day, a month, and a year
 * are three different keys, so a coarse date never silently equals a
 * precise one — the comparison stages decide what a coarse date
 * covers, and the key keeps the distinction visible.
 */
export function dateKey(date: DateValue): string | null {
  if (date.year === undefined) return null;
  return `date:${date.year}-${pad(date.month ?? 0)}-${pad(date.day ?? 0)}`;
}

/**
 * The canonical key of a date range, or `null` when either endpoint
 * is unparseable. A claim that states a period ("works run April to
 * June 2026") is date-bearing on both endpoints, and the range key
 * is what the comparison stages compare.
 */
export function dateRangeKey(start: DateValue, end: DateValue): string | null {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  if (startKey === null || endKey === null) return null;
  return `range:${startKey}..${endKey}`;
}
