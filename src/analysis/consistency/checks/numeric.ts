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
}

function labeled(text: string): LabeledQuantity[] {
  const words = contentWords(text);
  return extractQuantities(text).map((quantity) => ({
    value: quantity.value,
    unit: quantity.unit,
    raw: quantity.raw,
    normalized: quantity.normalized,
    words,
  }));
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
    const leftQuantities = labeled(left.statement.text);
    const rightQuantities = labeled(right.statement.text);
    for (const a of leftQuantities) {
      for (const b of rightQuantities) {
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
            certainty: "certain",
            evidence: { left: `${a.raw} ${a.unit}`.trim(), right: `${b.raw} ${b.unit}`.trim() },
          }),
        );
      }
    }
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
    const leftQuantities = labeled(left.statement.text);
    const rightQuantities = labeled(right.statement.text);
    for (const a of leftQuantities) {
      for (const b of rightQuantities) {
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
            certainty: "certain",
            evidence: { left: a.raw, right: b.raw, leftUnit: a.unit, rightUnit: b.unit },
          }),
        );
      }
    }
  }
  return candidates;
}

/** Text of a statement, normalized, for reuse by the model-dependent checks. */
export function normalizedStatementText(entry: IndexedStatement): string {
  return normalizeForComparison(entry.statement.text);
}
