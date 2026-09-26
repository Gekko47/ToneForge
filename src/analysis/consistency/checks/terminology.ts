/**
 * C1 — terminology drift.
 *
 * The same concept named by different terms in different sections. Resolved
 * deterministically when the two statements share a subject and differ only in
 * one content word, because that is a comparison of tokens rather than an
 * interpretation. Left ambiguous when they share a subject and differ in
 * several places, because that is a genuine judgment call.
 */

import type { ConsistencyCandidate } from "../contracts";
import {
  contentWords,
  makeCandidate,
  normalizeForComparison,
  pairwise,
  type IndexedStatement,
} from "./primitives";

const CHECK = "C1" as const;

function sharedWords(a: string[], b: string[]): Set<string> {
  const right = new Set(b);
  return new Set(a.filter((word) => right.has(word)));
}

/**
 * Statements that are about the same subject.
 *
 * "The quarterly revenue target is 4M." and "The quarterly revenue target is
 * 5M." share three content words. Two unrelated sentences rarely do, so a
 * threshold of three keeps the candidate set small enough to be reviewable.
 */
const MIN_SHARED_SUBJECT_WORDS = 3;

export function checkTerminologyDrift(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    const leftWords = contentWords(left.statement.text);
    const rightWords = contentWords(right.statement.text);
    const shared = sharedWords(leftWords, rightWords);
    if (shared.size < MIN_SHARED_SUBJECT_WORDS) continue;

    const leftSet = new Set(leftWords);
    const rightSet = new Set(rightWords);
    const onlyLeft = leftWords.filter((word) => !rightSet.has(word));
    const onlyRight = rightWords.filter((word) => !leftSet.has(word));

    // A pair with no unique vocabulary on either side is simply a repetition.
    if (onlyLeft.length === 0 && onlyRight.length === 0) continue;
    // Statements in the same section are allowed to be worded differently;
    // drift only matters across the document.
    if (left.statement.section.length > 0 && left.statement.section === right.statement.section) {
      continue;
    }

    // Certain only when each side contributes exactly one term of its own. One
    // unique word in total is not enough: a pair where one statement merely adds
    // a word the other omits is not terminology drift, it is one statement saying
    // more, and calling that a decided naming conflict reports a difference the
    // author never made.
    const substitution = onlyLeft.length === 1 && onlyRight.length === 1;
    candidates.push(
      makeCandidate({
        checkId: CHECK,
        left,
        right,
        suspicion: `These two sections use different terms for what appears to be the same subject (${[...onlyLeft, ...onlyRight].slice(0, 4).join(", ")}).`,
        // A one-for-one swap on a shared subject is a naming difference. Anything
        // else is more likely two genuinely different statements, which is a
        // judgment the model should make rather than this function.
        certainty: substitution ? "certain" : "ambiguous",
        evidence: {
          shared: [...shared].slice(0, 6).join(", "),
          onlyLeft: onlyLeft.join(", "),
          onlyRight: onlyRight.join(", "),
        },
      }),
    );
  }
  return candidates;
}

/** Statements that mention a term at all, for display and de-duplication. */
export function statementsMentioning(statements: IndexedStatement[], term: string): string[] {
  const needle = normalizeForComparison(term);
  return statements
    .filter((entry) => normalizeForComparison(entry.statement.text).includes(needle))
    .map((entry) => entry.statement.id);
}
