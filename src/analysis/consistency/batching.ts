import type { IndexedStatement } from "./checks";

/**
 * Windowing for a pairwise comparison that is quadratic in the number of
 * statements.
 *
 * Before this, a document over `maxStatements` was *truncated*: statements past
 * the bound were never read by any check, so a contradiction in the second half
 * of a long report simply did not exist as far as ToneForge was concerned. The
 * preflight said as much, which made the behaviour honest but left the
 * capability useless on exactly the documents a user most wants reviewed.
 *
 * The trade this makes is explicit rather than silent. Every statement is still
 * examined — that is the property truncation lost. What is bounded is how many
 * *pairs* are compared, and the exact number of pairs that were not compared is
 * reported. A distant contradiction, between two statements in different
 * windows, is a known gap with a known size rather than an invisible one.
 *
 * Non-overlapping windows are deliberate. Overlapping them would catch a few
 * boundary pairs at the cost of duplicate work, and the pair arithmetic below
 * assumes disjointness — an exact count is worth more here than a handful of
 * extra comparisons, because a wrong count is how a partial run reads as a
 * complete one.
 */

export interface StatementWindow {
  index: number;
  statements: IndexedStatement[];
  /** Position of the first statement in the document, for progress reporting. */
  firstIndex: number;
  lastIndex: number;
}

export interface WindowOptions {
  /** Statements compared together in one window. At least 1. */
  windowSize: number;
}

export const DEFAULT_CONSISTENCY_WINDOW_SIZE = 400;

/**
 * Split statements into non-overlapping windows of at most `windowSize`.
 *
 * A document at or under the bound produces exactly one window, so the common
 * case is a single full comparison and reports no gap at all.
 */
export function partitionStatementWindows(
  statements: readonly IndexedStatement[],
  options: WindowOptions,
): StatementWindow[] {
  const size = Math.max(1, Math.floor(options.windowSize));
  const starts = Array.from(
    { length: Math.ceil(statements.length / size) },
    (_, index) => index * size,
  );
  return starts.flatMap((start, index) => {
    const slice = statements.slice(start, start + size);
    if (slice.length === 0) return [];
    return [
      {
        index,
        statements: slice,
        firstIndex: start,
        lastIndex: start + slice.length - 1,
      },
    ];
  });
}

/** Every unordered pair the windows actually compared. */
export function comparedPairCount(windows: readonly StatementWindow[]): number {
  return windows.reduce((sum, window) => sum + pairsIn(window.statements.length), 0);
}

/** Every unordered pair a full comparison would have covered. */
export function totalPairCount(statementCount: number): number {
  return pairsIn(statementCount);
}

/**
 * Pairs that exist in the document but were never compared.
 *
 * This is the number the coverage report has to state. Zero means every
 * statement was in scope and every pair was checked; a positive number means
 * the run compared the document locally and did not look for contradictions
 * between statements in different windows.
 */
export function crossWindowPairCount(
  statementCount: number,
  windows: readonly StatementWindow[],
): number {
  return Math.max(0, totalPairCount(statementCount) - comparedPairCount(windows));
}

function pairsIn(count: number): number {
  return (count * (count - 1)) / 2;
}

/**
 * The sentence a limitation should use for a cross-window gap.
 *
 * Wording is load-bearing: it must not read as "some checking was skipped" in a
 * way a reader could mistake for the whole document being skipped.
 */
export function describeCrossWindowGap(statementCount: number, skipped: number): string {
  return (
    `Compared ${statementCount} statements in windows, so ${skipped} pair comparison` +
    `${skipped === 1 ? "" : "s"} between statements in different windows ` +
    `${skipped === 1 ? "was" : "were"} not made. Contradictions within a window were ` +
    "found; contradictions spanning distant parts of the document may not have been."
  );
}
