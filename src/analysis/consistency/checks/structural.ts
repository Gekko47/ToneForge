/**
 * C3 — temporal conflict, and C9 — section promise mismatch.
 *
 * C3 is deterministic when both dates are precise and the years differ, because
 * two precise dates in different years are simply different. A coarse date
 * ("March 2024") against a precise one is `incomparable` rather than a
 * conflict: calling it a conflict would manufacture a false positive on the
 * single most common way documents state dates.
 *
 * C9 compares a section's own heading against what is actually inside it. That
 * is a check on one statement against its container rather than against a
 * sibling, which is why it stays deterministic: it is comparing a declared
 * purpose with observed content, and the question of whether the content meets
 * the purpose is what gets escalated.
 */

import type { ConsistencyCandidate } from "../contracts";
import {
  compareDates,
  contentWords,
  extractDates,
  extractQuantities,
  makeCandidate,
  normalizeForComparison,
  pairwise,
  subjectWords,
  type IndexedStatement,
} from "./primitives";

/** Words in a heading that announce a kind of content. */
const PROMISE_MARKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  numbers: ["figures", "numbers", "metrics", "statistics", "quantities", "totals"],
  dates: ["dates", "timeline", "schedule", "milestones", "chronology"],
  people: ["people", "team", "staff", "authors", "contributors", "roles"],
  steps: ["steps", "procedure", "instructions", "method", "process", "howto"],
  summary: ["summary", "overview", "introduction", "abstract", "conclusion"],
});

type PromiseKind = keyof typeof PROMISE_MARKERS;

/**
 * The kind of content a section heading promises.
 *
 * A heading that promises nothing recognizable returns `null`, and a section
 * with no recognizable promise is never a candidate. Reporting a mismatch for
 * every heading would bury the real ones.
 */
export function promisedContent(heading: string): PromiseKind | null {
  const words = contentWords(heading);
  for (const [kind, markers] of Object.entries(PROMISE_MARKERS) as [
    PromiseKind,
    readonly string[],
  ][]) {
    if (words.some((word) => markers.includes(word))) return kind;
  }
  return null;
}

/**
 * Whether a body actually contains the kind of content its heading promised.
 *
 * `numbers` and `dates` are decided by looking for the thing itself, because a
 * section promising "Key Figures" states its figures as digits and never says
 * "figures" in the body. Matching marker words there reports a section full of
 * numbers as not containing numbers. The remaining kinds have no such extractor
 * — nothing parses "this section contains steps" — so they keep marker matching.
 */
function containsKind(text: string, kind: PromiseKind): boolean {
  if (kind === "numbers") return extractQuantities(text).length > 0;
  if (kind === "dates") return extractDates(text).length > 0;
  const words = contentWords(text);
  const markerSet = new Set(PROMISE_MARKERS[kind]);
  return words.some((word) => markerSet.has(word) || markerSet.has(`${word}s`));
}

/**
 * C3 — events placed on dates that cannot both be true.
 *
 * Only fires where the two statements share a subject, are in different
 * sections, and carry dates that `compareDates` reports as an outright conflict.
 */
export function checkTemporalConflict(statements: IndexedStatement[]): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  for (const [left, right] of pairwise(statements)) {
    if (left.statement.section.length > 0 && left.statement.section === right.statement.section) {
      continue;
    }
    const leftDates = extractDates(left.statement.text);
    const rightDates = extractDates(right.statement.text);
    if (leftDates.length === 0 || rightDates.length === 0) continue;

    // Subject words, not content words: one section saying "the migration" and
    // another saying "migrations" is the same subject, and folding the plural is
    // what keeps that pair from being discarded for a spelling difference.
    const leftWords = new Set(subjectWords(left.statement.text));
    const rightWords = new Set(subjectWords(right.statement.text));
    let shared = 0;
    leftWords.forEach((word) => {
      if (rightWords.has(word)) shared += 1;
    });
    if (shared < 2) continue;

    const conflict = leftDates.some((a) =>
      rightDates.some((b) => compareDates(a, b) === "conflict"),
    );
    if (!conflict) continue;

    // Certain only when there is exactly one date per statement, because only
    // then is the conflicting pair the pair the statements are actually making.
    // With several dates on one side, "some pair conflicts" says nothing about
    // which claim is the contradictory one, and reporting that as decided is
    // how a temporal check ends up confidently wrong about a timeline.
    const single = leftDates.length === 1 && rightDates.length === 1;

    candidates.push(
      makeCandidate({
        checkId: "C3",
        left,
        right,
        suspicion: `The same subject is placed on different dates in two sections.`,
        certainty: single ? "certain" : "ambiguous",
        evidence: {
          left: leftDates.map((d) => d.raw).join(", "),
          right: rightDates.map((d) => d.raw).join(", "),
        },
      }),
    );
  }
  return candidates;
}

/**
 * C9 — a section that does not contain what its heading promises.
 *
 * The comparison is between a heading and its own content, so a section always
 * has its own statement available. Only the *question of whether the mismatch
 * matters* is ambiguous, and that is what goes to the model.
 */
export function checkSectionPromiseMismatch(
  statements: IndexedStatement[],
  headings: readonly string[],
): ConsistencyCandidate[] {
  const candidates: ConsistencyCandidate[] = [];
  headings.forEach((heading, headingIndex) => {
    const kind = promisedContent(heading);
    if (kind === null) return;

    // Find a statement in this section to carry the evidence. A heading with no
    // content at all is an empty section, which is a different problem and is
    // not reported here.
    const body = statements.find((entry) => entry.statement.section === heading);
    if (body === undefined) return;

    if (containsKind(body.statement.text, kind)) return;

    // The heading and the body are the same physical text, so the candidate
    // compares the heading against its own first statement.
    const headingStatement = {
      ...body.statement,
      id: `${body.statement.id}#heading-${headingIndex}`,
      text: heading,
    };
    candidates.push(
      makeCandidate({
        checkId: "C9",
        left: { statement: headingStatement, index: headingIndex },
        right: body,
        suspicion: `The section "${heading}" does not appear to contain the kind of content its heading promises.`,
        certainty: "ambiguous",
        evidence: { promised: kind, heading: normalizeForComparison(heading) },
      }),
    );
  });
  return candidates;
}
