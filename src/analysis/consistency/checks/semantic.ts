/**
 * The six model-dependent checks: C4, C5, C7, C8, C10, and the ambiguous residue
 * of C1.
 *
 * Each of these asks a question no rule can answer — is this the same entity,
 * are these two definitions incompatible, do these claims exclude each other —
 * so each one produces **ambiguous candidates only**. The deterministic
 * narrowing they do first (shared subject, mutual exclusivity of a known pair,
 * the presence of a citation) is not a decision; it is the work of throwing out
 * pairs that obviously should not be compared, so the model sees a shortlist
 * rather than every pair in the document.
 *
 * The cost of that design is stated plainly: these six checks can miss a real
 * conflict whose subject overlap is below the threshold. The alternative —
 * escalating every pair — would be both slower and less useful, because a model
 * asked to compare everything finds something in everything.
 */

import type { ConsistencyCandidate } from "../contracts";
import { makeCandidate, pairwise, subjectWords, type IndexedStatement } from "./primitives";

/**
 * Shared-vocabulary thresholds for "these two are about the same thing".
 *
 * The score is measured against the *shorter* statement, not the longer. "All
 * regions are covered by the service." beside "Every region is covered, however
 * three are not yet." is the same claim stated at two lengths, and a
 * max-denominator score would call the pair unrelated purely because one side is
 * wordier. Containment against the shorter side is the measure that matches the
 * question being asked: how much of what the tighter statement says is repeated
 * in the other.
 *
 * `MIN_SHARED` guards the other direction. Containment alone lets a two-word
 * statement look well matched to any paragraph containing those two words, so a
 * pair must also share enough words to be a real overlap rather than a
 * coincidence.
 */
const SUBJECT_OVERLAP = 0.5;
const MIN_SHARED = 2;

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  const shared = a.filter((word) => right.has(word)).length;
  return shared / Math.min(a.length, b.length);
}

interface ScoredPair {
  left: IndexedStatement;
  right: IndexedStatement;
  /** Containment of the shorter statement's subject words in the longer one. */
  score: number;
  /** How many subject words the two share. */
  shared: number;
}

function sharedCount(a: string[], b: string[]): number {
  const right = new Set(b);
  return a.filter((word) => right.has(word)).length;
}

function relatedPairs(statements: IndexedStatement[]): ScoredPair[] {
  return pairwise(statements)
    .map(([left, right]) => {
      const leftWords = subjectWords(left.statement.text);
      const rightWords = subjectWords(right.statement.text);
      return {
        left,
        right,
        score: overlapScore(leftWords, rightWords),
        shared: sharedCount(leftWords, rightWords),
      };
    })
    .filter((pair) => pair.shared >= MIN_SHARED && pair.score >= SUBJECT_OVERLAP)
    .sort((a, b) => b.score - a.score);
}

function candidateFrom(
  pair: ScoredPair,
  input: {
    checkId: ConsistencyCandidate["checkId"];
    suspicion: string;
    evidence?: Record<string, string>;
  },
): ConsistencyCandidate {
  return makeCandidate({
    checkId: input.checkId,
    left: pair.left,
    right: pair.right,
    suspicion: input.suspicion,
    // Every candidate from this module is ambiguous by construction. Marking one
    // certain here would let an unverified guess reach the planner as a decided
    // conflict, which is the failure this engine most needs to avoid.
    certainty: "ambiguous",
    evidence: { ...(input.evidence ?? {}), subjectOverlap: pair.score.toFixed(2) },
  });
}

/**
 * A capitalized multi-letter word, used as an entity anchor.
 *
 * A sentence-initial capital is not excluded, and deliberately so. Excluding it
 * would discard the most common position for a named entity to appear in — a
 * sentence that opens with the subject it is about — and the check only fires on
 * a noun *shared* by both statements, so a shared sentence-initial word is
 * evidence of a shared subject rather than a coincidence.
 */
const PROPER_NOUN = /\b[A-Z][a-zA-Z]{2,}\b/g;

function properNouns(text: string): Set<string> {
  return new Set(text.match(PROPER_NOUN) ?? []);
}

/**
 * C4 — the same entity described with conflicting attributes.
 *
 * Filtered on a shared proper noun rather than on the generic vocabulary overlap
 * the other checks use. The two are not interchangeable here: "Acme was founded
 * in 1998 and is a manufacturer." and "Acme is a software company" share exactly
 * one content word, and an overlap threshold would reject the pair before the
 * entity check ever ran — discarding exactly the case C4 exists to find. The
 * named entity is the stronger signal, so it is the one used.
 */
export function checkEntityAttributeConflict(
  statements: IndexedStatement[],
): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    const leftNouns = properNouns(left.statement.text);
    const rightNouns = properNouns(right.statement.text);
    const shared = [...leftNouns].filter((noun) => rightNouns.has(noun));
    if (shared.length === 0) continue;
    const leftWords = subjectWords(left.statement.text);
    const rightWords = subjectWords(right.statement.text);
    const pair: ScoredPair = {
      left,
      right,
      score: overlapScore(leftWords, rightWords),
      shared: sharedCount(leftWords, rightWords),
    };
    candidates.push(
      candidateFrom(pair, {
        checkId: "C4",
        suspicion: `These two sections describe ${shared[0]} and may give it conflicting attributes.`,
        evidence: { sharedEntity: shared.join(", ") },
      }),
    );
  }
  return candidates;
}

/** `X is defined as ...` / `X means ...` / `X refers to ...`. */
const DEFINITION =
  /^\s*(?:here\s+)?([A-Za-z][A-Za-z\s-]{2,40}?)\s+(?:is|are)\s+defined\s+as\b|^\s*([A-Za-z][A-Za-z\s-]{2,40}?)\s+means\b|^\s*([A-Za-z][A-Za-z\s-]{2,40}?)\s+refers\s+to\b/i;

function definedTerm(text: string): string | null {
  const match = DEFINITION.exec(text.trim());
  const term = match?.[1] ?? match?.[2] ?? match?.[3];
  return term === undefined ? null : term.trim().toLowerCase();
}

/**
 * C5 — the same term defined two incompatible ways.
 *
 * Deterministic detection of *two definitions of one term*, which is safe: two
 * statements that both define the same term are genuinely worth a decision, and
 * whether the definitions actually conflict is the model's to make.
 */
export function checkDefinitionalConflict(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    const leftTerm = definedTerm(left.statement.text);
    const rightTerm = definedTerm(right.statement.text);
    if (leftTerm === null || rightTerm === null) continue;
    if (leftTerm !== rightTerm) continue;
    candidates.push(
      makeCandidate({
        checkId: "C5",
        left,
        right,
        suspicion: `The term "${leftTerm}" is defined more than once, and the two definitions may not agree.`,
        certainty: "ambiguous",
        evidence: { term: leftTerm },
      }),
    );
  }
  return candidates;
}

/**
 * Pairs of states that cannot both be true.
 *
 * Only genuinely exclusive pairs are listed. A pair is added here rather than
 * inferred, because inference is exactly the interpretation this engine is
 * supposed to route to the model instead of guessing at.
 */
const EXCLUSIVE_STATES: readonly (readonly [string, string])[] = Object.freeze([
  ["enabled", "disabled"],
  ["active", "inactive"],
  ["open", "closed"],
  ["public", "private"],
  ["visible", "hidden"],
  ["supported", "unsupported"],
  ["complete", "incomplete"],
  ["required", "optional"],
  ["approved", "rejected"],
  ["deprecated", "current"],
]);

function statedStates(text: string): Set<string> {
  const words = subjectWords(text);
  const found = new Set<string>();
  for (const word of words) {
    const bare = word.replace(/s$/, "");
    if (EXCLUSIVE_STATES.some(([a, b]) => a === word || b === word || a === bare || b === bare)) {
      found.add(bare);
    }
  }
  return found;
}

function isExclusive(a: string, b: string): boolean {
  return EXCLUSIVE_STATES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/**
 * C7 — mutually exclusive claims about the same subject.
 *
 * Fires only when the model-independent part is airtight: the two statements are
 * about the same subject and state a pair drawn from the exclusive list above.
 */
export function checkStatusContradiction(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const pair of relatedPairs(statements)) {
    const leftStates = statedStates(pair.left.statement.text);
    const rightStates = statedStates(pair.right.statement.text);
    const conflict = [...leftStates]
      .flatMap((a) => [...rightStates].map((b) => [a, b] as const))
      .find(([a, b]) => isExclusive(a, b));
    if (conflict === undefined) continue;
    candidates.push(
      candidateFrom(pair, {
        checkId: "C7",
        suspicion: `These two sections describe the same subject as both "${conflict[0]}" and "${conflict[1]}".`,
        evidence: { leftState: conflict[0], rightState: conflict[1] },
      }),
    );
  }
  return candidates;
}

/**
 * `(Smith, 2019)`, `[3]`, `Smith et al. 2019`, `Smith (2019)`.
 *
 * The bare-parenthetical form is a separate alternative rather than an extension
 * of the first one: `(2019)` on its own has no author text for the first pattern
 * to capture, and `Smith (2019)` has parentheses between the name and the year so
 * the bare-name pattern cannot match it. It is the single most common way a
 * document cites a source, so omitting it would silently disable C8 on most
 * real text.
 */
const CITATION =
  /\(([^()]{2,60}?\d{4}[a-z]?)\)|\[(\d{1,3})\]|\b([A-Z][a-z]+)\s+\((\d{4}[a-z]?)\)|\b([A-Z][a-z]+)\s+(?:et al\.,?\s+)?(\d{4})\b/g;

export interface CitationMatch {
  readonly raw: string;
  /** The author or number, normalized. */
  readonly key: string;
  readonly year: number | null;
}

export function extractCitations(text: string): CitationMatch[] {
  const found: CitationMatch[] = [];
  CITATION.lastIndex = 0;
  let match = CITATION.exec(text);
  while (match !== null) {
    const authorDate = match[1];
    const numbered = match[2];
    const parenAuthor = match[3];
    const parenYear = match[4];
    const bareAuthor = match[5];
    const bareYear = match[6];
    if (authorDate !== undefined) {
      const yearMatch = /(\d{4})/.exec(authorDate);
      found.push({
        raw: match[0],
        key: (authorDate.split(",")[0] ?? authorDate).trim().toLowerCase(),
        year: yearMatch?.[1] === undefined ? null : Number(yearMatch[1]),
      });
    } else if (numbered !== undefined) {
      found.push({ raw: match[0], key: `[${numbered}]`, year: null });
    } else if (parenAuthor !== undefined) {
      found.push({
        raw: match[0],
        key: parenAuthor.toLowerCase(),
        year: parenYear === undefined ? null : Number(parenYear),
      });
    } else if (bareAuthor !== undefined) {
      found.push({
        raw: match[0],
        key: bareAuthor.toLowerCase(),
        year: bareYear === undefined ? null : Number(bareYear),
      });
    }
    match = CITATION.exec(text);
  }
  return found;
}

/** A claim word that a citation is attached to. */
const CLAIM_WORDS = [
  "shows",
  "shows",
  "demonstrates",
  "proves",
  "establishes",
  "confirms",
  "indicates",
  "suggests",
  "reports",
  "found",
];

function hasClaimWord(text: string): boolean {
  const lower = text.toLowerCase();
  return CLAIM_WORDS.some((word) => lower.includes(word));
}

/**
 * C8 — a citation that contradicts the claim it is attached to.
 *
 * The same source cited for the same claim with two different years is a real,
 * recognizable inconsistency, so those escalate immediately. A citation whose
 * claim word is present but whose year is merely different is a judgment call
 * and also escalates — the model decides whether it is an error or a later
 * edition.
 */
export function checkReferenceConflict(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const pair of relatedPairs(statements)) {
    const leftCitations = extractCitations(pair.left.statement.text);
    const rightCitations = extractCitations(pair.right.statement.text);
    if (leftCitations.length === 0 || rightCitations.length === 0) continue;
    if (!hasClaimWord(pair.left.statement.text) || !hasClaimWord(pair.right.statement.text)) {
      continue;
    }
    const counterpart = rightCitations.find((b) => leftCitations.some((a) => a.key === b.key));
    const sameSource =
      counterpart === undefined ? undefined : leftCitations.find((a) => a.key === counterpart.key);
    // Both sides must name a year: a citation with no resolvable year cannot be
    // shown to disagree with one that has a year, only to be different.
    if (counterpart === undefined || sameSource === undefined) continue;
    if (counterpart.year === null || sameSource.year === null) continue;
    if (counterpart.year === sameSource.year) continue;
    candidates.push(
      candidateFrom(pair, {
        checkId: "C8",
        suspicion: `The same source is cited for a similar claim with two different years (${sameSource.year} and ${counterpart.year}).`,
        evidence: {
          source: sameSource.key,
          leftYear: String(sameSource.year),
          rightYear: String(counterpart.year),
        },
      }),
    );
  }
  return candidates;
}

const UNIVERSAL = ["always", "never", "all", "every", "none", "cannot", "must", "only"];

function qualifiers(text: string): Set<string> {
  const words = subjectWords(text);
  const found = new Set<string>();
  for (const word of words) {
    if (UNIVERSAL.includes(word)) found.add(word);
  }
  return found;
}

/**
 * C10 — a universal qualifier contradicted by an exception.
 *
 * "All regions are covered" beside "Three regions are not covered" is
 * recognizable structurally: a universal in one statement and a hedged negation
 * in the other, about the same subject. That the negation really is an exception
 * rather than a separate claim is the model's call.
 */
const HEDGE = ["except", "however", "although", "but", "unless", "apart from", "excluding"];

function hasHedge(text: string): boolean {
  const lower = text.toLowerCase();
  return HEDGE.some((word) => lower.includes(word));
}

/** A plain negation, which narrows a claim the same way a conjunction does. */
function hasNegation(text: string): boolean {
  return /\b(not|n't|no|never|cannot|without)\b/i.test(text);
}

/**
 * Whether this statement narrows a claim rather than asserting one outright.
 *
 * "All regions are covered, however three are not yet" narrows on two axes at
 * once: a conjunction and a negation. A check that watched only for conjunctions
 * would miss the half of the sentence that does the actual narrowing.
 */
function narrowsScope(text: string): boolean {
  return hasHedge(text) || hasNegation(text);
}

/**
 * C10 — a universal claim contradicted by an exception elsewhere.
 *
 * This check produces two kinds of candidate and the difference matters. A
 * universal beside a hedge about the same subject is a real structural signal and
 * is escalated. A universal beside another universal is a *possible* conflict
 * but usually means the document is describing different things, so it is only
 * escalated when the subject overlap is high.
 */
export function checkScopeContradiction(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const pair of relatedPairs(statements)) {
    const leftQualifiers = qualifiers(pair.left.statement.text);
    const rightQualifiers = qualifiers(pair.right.statement.text);
    const leftHas = leftQualifiers.size > 0;
    const rightHas = rightQualifiers.size > 0;
    if (!leftHas && !rightHas) continue;

    const leftNarrow = narrowsScope(pair.left.statement.text);
    const rightNarrow = narrowsScope(pair.right.statement.text);

    // A universal claim anywhere in the pair, together with anything that
    // narrows scope anywhere in it, is the structural signal. Both parts are
    // required: a universal alone is an ordinary absolute statement, and a
    // narrowing alone is an ordinary exception.
    if ((leftHas || rightHas) && (leftNarrow || rightNarrow)) {
      candidates.push(
        candidateFrom(pair, {
          checkId: "C10",
          suspicion:
            "One section states something unconditionally while another appears to except it.",
          evidence: {
            leftQualifiers: [...leftQualifiers].join(", "),
            rightQualifiers: [...rightQualifiers].join(", "),
          },
        }),
      );
      continue;
    }

    // Two absolute claims about the same subject with nothing narrowing either
    // one may still not both hold, but that is a weaker signal, so it takes a
    // higher overlap before it is worth a model's time.
    if (leftHas && rightHas && pair.score >= 0.6) {
      candidates.push(
        candidateFrom(pair, {
          checkId: "C10",
          suspicion:
            "Two sections both make an absolute claim about the same subject, which may not both hold.",
          evidence: {
            leftQualifiers: [...leftQualifiers].join(", "),
            rightQualifiers: [...rightQualifiers].join(", "),
          },
        }),
      );
    }
  }
  return candidates;
}
