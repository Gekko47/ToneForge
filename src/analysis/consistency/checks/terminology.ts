/**
 * C1 — terminology drift.
 *
 * The same concept named by different terms in different sections. Decided
 * deterministically only when the two statements share a subject, differ in one
 * content word each, and those two words are spelling variants of one another,
 * because "organisation" against "organization" is a comparison of characters
 * rather than an interpretation. Every other one-for-one swap is ambiguous: two
 * different words can be two names for one thing or two genuinely different
 * things, and only the model can weigh which.
 */

import type { ConsistencyCandidate } from "../contracts";
import {
  contentWords,
  isExclusiveStatePair,
  isNumericWord,
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

/**
 * Orthographic variations that make two spellings the same word, applied in the
 * order listed.
 *
 * Folding is deliberately narrow. It covers the spellings documents genuinely
 * mix — `-isation`/`-ization`, `-ise`/`-ize`, `-our`/`-or`, `-re`/`-er`,
 * `-ce`/`-se`, `-yse`/`-yze`, and the British doubling of a final or medial
 * consonant — and nothing else. A looser fold would start calling unrelated
 * words the same word, and this check's "certain" findings are reported as
 * decided rather than adjudicated, so a wrong fold is a wrong answer rather than
 * a question.
 *
 * Order matters twice: the plural and `-ise` rules precede the singular `-ise`
 * so "organisations" folds once, and the doubling rule comes last so a word
 * simplified above ("programme" to "program") is not re-simplified.
 */
const SPELLING_FOLDS: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/isations$/, "izations"],
  [/isation$/, "ization"],
  [/ising$/, "izing"],
  [/ised$/, "ized"],
  [/ises$/, "izes"],
  [/ise$/, "ize"],
  [/ours$/, "ors"],
  [/our$/, "or"],
  [/res$/, "ers"],
  [/re$/, "er"],
  [/ces$/, "ses"],
  [/ce$/, "se"],
  [/yse$/, "yze"],
  [/mme$/, "m"],
  [/ae/g, "a"],
  [/oe/g, "e"],
  // British doubling, and only the doubling: "modelling" against "modeling",
  // "programme" against "program". Applied last so it folds whatever the rules
  // above have already reduced to its shared form.
  [/([^aeiou])\1/g, "$1"],
]);

/**
 * The word reduced to the spelling its variants share.
 *
 * "programme" and "program" both fold to "program"; "north" and "south" fold to
 * themselves, which is the point — they are two different words, not two
 * spellings of one.
 */
function spellingKey(word: string): string {
  return SPELLING_FOLDS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    word,
  );
}

/**
 * Whether two words are two spellings of one term, rather than two terms.
 *
 * Numbers are C2's question and exclusive-state pairs are C7's, so a swap
 * involving either is not decided here even though the shape looks like a
 * substitution. Nor is "north" against "south": that shape is identical to
 * "programme" against "program", and only the words themselves distinguish a
 * misspelling from a rename.
 */
function isNameSubstitution(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  if (isNumericWord(left) || isNumericWord(right)) return false;
  if (isExclusiveStatePair(left, right)) return false;
  return spellingKey(left) === spellingKey(right);
}

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

    // Certain only when each side contributes exactly one term of its own AND
    // those two terms are spelling variants of one another. One unique word in
    // total is not enough: a pair where one statement merely adds a word the
    // other omits is not terminology drift, it is one statement saying more, and
    // calling that a decided naming conflict reports a difference the author
    // never made.
    //
    // A one-for-one swap is still not certain when the swapped words are figures,
    // a mutually exclusive pair, or two unrelated terms. "5 days" against "10
    // days" is C2's question, not a naming one; "enabled" against "disabled" is
    // C7's; and "north" against "south" is two places, not two spellings of one
    // place. Reporting any of those as a decided terminology difference would
    // report a conflict the author did not make while naming anything. They all
    // belong in the ambiguous residue, where the model can weigh the pair as a
    // whole.
    const substitution =
      onlyLeft.length === 1 &&
      onlyRight.length === 1 &&
      isNameSubstitution(onlyLeft[0], onlyRight[0]);
    candidates.push(
      makeCandidate({
        checkId: CHECK,
        left,
        right,
        suspicion: `These two sections use different terms for what appears to be the same subject (${[...onlyLeft, ...onlyRight].slice(0, 4).join(", ")}).`,
        // A one-for-one swap of two spellings of one term, on a shared subject,
        // is a naming difference. Anything else is more likely two genuinely
        // different statements, which is a judgment the model should make rather
        // than this function.
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
