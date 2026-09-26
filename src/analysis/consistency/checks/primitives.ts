/**
 * Shared, pure primitives for the cross-report consistency checks.
 *
 * Every function here is deterministic: same statements in, same candidates out.
 * That is what lets a check decide most of its own candidates without the model,
 * and it is why the residue that reaches adjudication is genuinely the residue
 * rather than everything.
 *
 * These helpers know nothing about Word, about the provider, or about the rest
 * of ToneForge. They take statements and return comparisons.
 */

import type { ConsistencyCandidate, ConsistencyStatement } from "../contracts";

/** A statement paired with its own source. Keeps check code free of index maths. */
export interface IndexedStatement {
  readonly statement: ConsistencyStatement;
  readonly index: number;
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Split text into trimmed, non-empty sentences.
 *
 * Deliberately simple. A smarter splitter would mis-handle abbreviations
 * ("e.g.", "Fig. 3") in ways that look clever and are wrong; a coarse split that
 * occasionally divides one sentence in two is the safer failure for a check that
 * only ever *compares* the results.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Lowercase and collapse whitespace, for comparison that ignores presentation. */
export function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every pair of statements, in a stable order. */
export function pairwise<T>(items: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  items.forEach((item, i) => {
    items.slice(i + 1).forEach((other) => {
      pairs.push([item, other]);
    });
  });
  return pairs;
}

/**
 * A stable identity for a comparison between two statements.
 *
 * Order-independent on purpose: the same two statements compared in the other
 * order are the same finding, and a fingerprint that changed with iteration
 * order would produce a duplicate for every conflict.
 */
export function candidateFingerprint(checkId: string, a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `${checkId}:${first}|${second}`;
}

/** Build a candidate, filling in the derived fields the checks would otherwise repeat. */
export function makeCandidate(input: {
  checkId: ConsistencyCandidate["checkId"];
  left: IndexedStatement;
  right: IndexedStatement;
  suspicion: string;
  certainty: ConsistencyCandidate["certainty"];
  evidence?: Record<string, string>;
}): ConsistencyCandidate {
  return {
    checkId: input.checkId,
    fingerprint: candidateFingerprint(
      input.checkId,
      input.left.statement.id,
      input.right.statement.id,
    ),
    suspicion: input.suspicion,
    left: input.left.statement,
    right: input.right.statement,
    certainty: input.certainty,
    evidence: input.evidence ?? {},
  };
}

/** Content words, with common stop words removed. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

export function contentWords(text: string): string[] {
  return normalizeForComparison(text)
    .split(/[^a-z0-9%$€£-]+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Fold a content word to a singular form for *subject comparison only*.
 *
 * A document says "region" in one place and "regions" in another while meaning
 * the same thing. Comparing the raw forms would report those pairs as unrelated
 * and silently drop real candidates. This is deliberately not applied inside
 * `contentWords`: heading promises are matched against literal marker words
 * ("figures", "statistics"), and folding there would break the match in the
 * opposite direction.
 */
export function singular(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Content words folded to singular form, for deciding whether two statements are about one thing. */
export function subjectWords(text: string): string[] {
  return contentWords(text).map(singular);
}

/** A stable key for a value, so `12,000` and `12000` compare equal. */
export function valueKey(value: string): string {
  return value.toLowerCase().replace(/[,\s]/g, "").replace(/[.]$/, "");
}

// ---------------------------------------------------------------------------
// Number, date, and unit extraction
// ---------------------------------------------------------------------------

/** Multipliers keyed by the word or symbol that introduces them. */
export const UNIT_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  k: 1_000,
  thousand: 1_000,
  thousands: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
  billions: 1_000_000_000,
});

export interface QuantityMatch {
  /** The numeric text as written. */
  readonly raw: string;
  /** `raw` as a number. */
  readonly value: number;
  /** The unit word or symbol immediately after the number, if any. */
  readonly unit: string;
  /** `value` multiplied by its unit, so `5k` and `5000` compare equal. */
  readonly normalized: number;
  readonly start: number;
  readonly end: number;
}

const NUMBER_PATTERN = /(-?\d[\d,]*\.?\d*)\s*([a-zA-Z%€£]{0,8})/g;

/**
 * Extract every quantity in a statement with its unit resolved.
 *
 * A multiplier is applied only when the word is a recognized one. An unknown
 * suffix is kept as the unit rather than guessed at, so `5 apples` stays
 * `5 apples` and does not silently become `5` to compare against a bare `5`.
 */
export function extractQuantities(text: string): QuantityMatch[] {
  const matches: QuantityMatch[] = [];
  NUMBER_PATTERN.lastIndex = 0;
  let match = NUMBER_PATTERN.exec(text);
  while (match !== null) {
    const raw = match[1] ?? "";
    const unit = (match[2] ?? "").toLowerCase();
    const parsed = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      const multiplier = UNIT_MULTIPLIERS[unit] ?? 1;
      matches.push({
        raw,
        value: parsed,
        unit,
        normalized: parsed * multiplier,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    match = NUMBER_PATTERN.exec(text);
  }
  return matches;
}

export interface DateMatch {
  /** ISO form where the source was unambiguous. */
  readonly iso: string;
  /** The date as written, for display. */
  readonly raw: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
});

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const LONG_DATE =
  /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/gi;
const MONTH_YEAR =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/gi;

/**
 * Extract dates in whatever form the document used.
 *
 * Three forms are handled because real documents mix all three. A month with no
 * day yields day `0`, which `compareDates` treats as "not comparable by day" so a
 * coarse date is never reported as contradicting a precise one.
 *
 * The three patterns overlap — "4 April 2026" matches both the long form and the
 * month-and-year form — so already-consumed spans are skipped. Without that, one
 * date in a document would be counted twice, which would inflate both the reported
 * comparisons and the number of candidates C3 raises.
 */
export function extractDates(text: string): DateMatch[] {
  const found: DateMatch[] = [];
  const consumed: [number, number][] = [];
  const overlapsConsumed = (start: number, end: number): boolean =>
    consumed.some(([from, to]) => start < to && from < end);

  ISO_DATE.lastIndex = 0;
  let match = ISO_DATE.exec(text);
  while (match !== null) {
    consumed.push([match.index, match.index + match[0].length]);
    found.push({
      iso: match[0],
      raw: match[0],
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    });
    match = ISO_DATE.exec(text);
  }
  LONG_DATE.lastIndex = 0;
  match = LONG_DATE.exec(text);
  while (match !== null) {
    const month = MONTHS[(match[2] ?? "").toLowerCase()] ?? 0;
    consumed.push([match.index, match.index + match[0].length]);
    found.push({
      iso: `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`,
      raw: match[0],
      year: Number(match[3]),
      month,
      day: Number(match[1]),
    });
    match = LONG_DATE.exec(text);
  }
  MONTH_YEAR.lastIndex = 0;
  match = MONTH_YEAR.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (!overlapsConsumed(start, end)) {
      const month = MONTHS[(match[1] ?? "").toLowerCase()] ?? 0;
      const year = Number(match[2]);
      consumed.push([start, end]);
      found.push({
        iso: `${year}-${String(month).padStart(2, "0")}-00`,
        raw: match[0],
        year,
        month,
        day: 0,
      });
    }
    match = MONTH_YEAR.exec(text);
  }
  return found;
}

/**
 * Whether two dates agree, conflict, or cannot be compared.
 *
 * A month-only date is neither. It cannot be *equal* to a specific day in that
 * month — it covers the whole month — and it cannot *contradict* one, because
 * "March 2026" is still true of a document that also says "4 March 2026".
 * Reporting it as `same` would be a false negative that reads as a decision;
 * reporting it as `conflict` would be a false positive on the most common way
 * documents state dates. Hence `incomparable`, which means "no conclusion".
 */
export function compareDates(a: DateMatch, b: DateMatch): "same" | "conflict" | "incomparable" {
  if (a.year !== b.year) {
    // Different years are only a conflict when both dates are precise; a
    // "March 2024" next to "4 March 2025" may simply describe a later event.
    if (a.day === 0 || b.day === 0) return "incomparable";
    return "conflict";
  }
  if (a.month !== 0 && b.month !== 0 && a.month !== b.month) return "conflict";
  // A coarse date covers a range, so no day-level conclusion is available.
  if (a.day === 0 || b.day === 0) return "incomparable";
  return a.day === b.day ? "same" : "conflict";
}

/** A comparison outcome shared by the checks. */
export type Comparison = "same" | "differs" | "incomparable" | "unrelated";
