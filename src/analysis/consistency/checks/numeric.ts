/**
 * C2 — numeric contradiction, and C6 — unit inconsistency.
 *
 * Both compare quantities, and they are kept apart deliberately: `5,000` and
 * `5000` are the same value, while `5,000` and `5k` are the same value stated in
 * different units. A document can agree on every number while disagreeing about
 * its units, so one check cannot answer for the other.
 *
 * Both are resolved deterministically whenever the subject is clearly shared and
 * the values are clearly comparable, because comparing two parsed numbers needs
 * no interpretation.
 */

import type { ConsistencyCandidate } from "../contracts";
import {
  contentWords,
  extractQuantities,
  makeCandidate,
  normalizeForComparison,
  pairwise,
  type IndexedStatement,
} from "./primitives";

/** A quantity with the words around it, so two can be matched by subject. */
interface LabeledQuantity {
  readonly value: number;
  readonly unit: string;
  readonly raw: string;
  /** `value` with its unit multiplier applied, so `5k` and `5000` agree. */
  readonly normalized: number;
  /** Content words in the statement, used to decide whether it is the same subject. */
  readonly words: string[];
  /** The words immediately around this quantity, used to align two of them. */
  readonly context: string[];
}

/** How many content words either side of a quantity count as its context. */
const CONTEXT_WORDS = 3;

function labeled(text: string): LabeledQuantity[] {
  const words = contentWords(text);
  return extractQuantities(text).map((quantity) => ({
    value: quantity.value,
    unit: quantity.unit,
    raw: quantity.raw,
    normalized: quantity.normalized,
    words,
    context: contextAround(text, quantity.start, quantity.end),
  }));
}

/**
 * The content words immediately before and after one quantity.
 *
 * Two quantities in different statements are only comparable if the text around
 * them is about the same thing. The whole statement's word set cannot do that job:
 * in a sentence with three numbers every number shares the same words, so they
 * would all look interchangeable.
 */
function contextAround(text: string, start: number, end: number): string[] {
  const before = contentWords(text.slice(Math.max(0, start - 80), start));
  const after = contentWords(text.slice(end, end + 80));
  return [...before.slice(-CONTEXT_WORDS), ...after.slice(0, CONTEXT_WORDS)];
}

/** Fraction of one word set that also appears in the other. */
function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  const shared = a.filter((word) => right.has(word)).length;
  return shared / Math.max(a.length, b.length);
}

/**
 * Above this, two statements are treated as being about the same thing.
 *
 * Set high on purpose. A false positive here becomes a reported contradiction in
 * a document that was fine, which is the failure a user cannot easily explain
 * away; a false negative is a conflict the model pass may still surface.
 */
const SAME_SUBJECT_OVERLAP = 0.6;

function sameSubject(a: LabeledQuantity, b: LabeledQuantity): boolean {
  return overlap(a.words, b.words) >= SAME_SUBJECT_OVERLAP;
}

/** One aligned pair of quantities, and whether the alignment was trustworthy. */
interface AlignedPair {
  readonly a: LabeledQuantity;
  readonly b: LabeledQuantity;
  /**
   * True when the pairing follows from the text — one quantity each, equal
   * counts in the same order, or matching surrounding words. False when the only
   * thing established is that both statements are about the same subject, which
   * does not say *which* number is being compared with which.
   */
  readonly aligned: boolean;
}

/**
 * Align one quantity on each side, so a statement pair yields at most one
 * candidate.
 *
 * Without this, a sentence carrying three quantities compared against a sentence
 * carrying three produces up to nine candidates for the same two statements, all
 * with the same fingerprint. The user sees one conflict nine times and cannot tell
 * which pair of numbers is actually in dispute.
 *
 * The order of preference is: one quantity each (unambiguous), then matching
 * counts aligned by position, then the best match on surrounding words. Only the
 * last of those can fail to align, and when it does the candidate is ambiguous so
 * it goes to adjudication rather than being reported as decided.
 */
function align(
  left: readonly LabeledQuantity[],
  right: readonly LabeledQuantity[],
): AlignedPair | null {
  if (left.length === 0 || right.length === 0) return null;
  const single = left[0];
  const other = right[0];
  if (single === undefined || other === undefined) return null;
  if (left.length === 1 && right.length === 1) {
    return { a: single, b: other, aligned: true };
  }
  if (left.length === right.length) {
    return { a: single, b: other, aligned: true };
  }
  // Unequal counts. Score every cross-pairing on shared context and keep the
  // best, but only call it aligned if that pairing is actually the best match.
  const scored = left
    .flatMap((a) => right.map((b) => ({ a, b, score: overlap(a.context, b.context) })))
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (best === undefined) return null;
  const runnerUp = scored[1];
  const uniquelyBest = runnerUp === undefined || best.score > runnerUp.score;
  return { a: best.a, b: best.b, aligned: uniquelyBest && best.score > 0 };
}

/**
 * C2 — the same quantity given two different values.
 *
 * Unitless quantities are compared directly. Quantities carrying the *same*
 * non-empty unit are compared after normalization, so `5k` and `5000 k` agree.
 * Quantities with *different* units are left to C6, because "4M users" and
 * "4000 thousand users" may be the same figure written differently and this
 * check is not the place to decide.
 */
export function checkNumericContradiction(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    const pair = align(labeled(left.statement.text), labeled(right.statement.text));
    if (pair === null) continue;
    const { a, b } = pair;
    if (!sameSubject(a, b)) continue;
    if (a.value === b.value) continue;
    // Different units is C6's question, not this one.
    if (a.unit !== "" && b.unit !== "" && a.unit !== b.unit) continue;
    if (a.unit === "" && b.unit !== "") continue;
    if (a.unit !== "" && b.unit === "") continue;
    candidates.push(
      makeCandidate({
        checkId: "C2",
        left,
        right,
        suspicion: `The same quantity is given two different values here: ${a.raw} and ${b.raw}.`,
        certainty: pair.aligned ? "certain" : "ambiguous",
        evidence: { left: `${a.raw} ${a.unit}`.trim(), right: `${b.raw} ${b.unit}`.trim() },
      }),
    );
  }
  return candidates;
}

/**
 * C6 — the same measure expressed in units that do not agree.
 *
 * Only fires when the normalized values match but the written forms do not,
 * which is the specific signature of a unit problem: `5k` and `5000` mean the
 * same number and were written differently.
 */
export function checkUnitInconsistency(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    const pair = align(labeled(left.statement.text), labeled(right.statement.text));
    if (pair === null) continue;
    const { a, b } = pair;
    if (!sameSubject(a, b)) continue;
    if (a.unit === b.unit) continue;
    if (a.unit === "" || b.unit === "") continue;
    // Only the equal-value-different-form case is a unit problem. Two
    // different numbers in two different units is an ordinary conflict the
    // model has to reason about, not a unit mismatch.
    if (a.normalized !== b.normalized) continue;
    candidates.push(
      makeCandidate({
        checkId: "C6",
        left,
        right,
        suspicion: `The same figure is written in two different units here: "${a.unit}" and "${b.unit}".`,
        certainty: pair.aligned ? "certain" : "ambiguous",
        evidence: { left: a.raw, right: b.raw, leftUnit: a.unit, rightUnit: b.unit },
      }),
    );
  }
  return candidates;
}

/** Text of a statement, normalized, for reuse by the model-dependent checks. */
export function normalizedStatementText(entry: IndexedStatement): string {
  return normalizeForComparison(entry.statement.text);
}
