/**
 * The registry of the ten cross-report checks (R0 skeleton).
 *
 * Each entry is a pure function from statements to candidates. That signature
 * is the whole contract: no check reads Word, sends anything over a network,
 * or knows whether a model exists.
 *
 * R0 registers the ten identities with empty retrievers. R3 implements
 * indexed retrieval per check; until then a run produces no candidates, which
 * the coverage reports honestly rather than hiding.
 */

import type { ConsistencyCandidate } from "../contracts";
import type { IndexedStatement } from "./primitives";

export interface ConsistencyCheckContext {
  /** Statements extracted from the snapshot. */
  readonly statements: readonly IndexedStatement[];
  /** Section headings in document order, used by C9. */
  readonly headings: readonly string[];
}

export interface ConsistencyChecker {
  readonly id: string;
  readonly run: (context: ConsistencyCheckContext) => ConsistencyCandidate[];
}

function empty(): ConsistencyCandidate[] {
  return [];
}

/**
 * The ten checkers, ordered by check id.
 *
 * Ordered by id, not by cost: the pipeline reports progress by id so a user
 * reading the results can find the check that produced a finding, and a
 * stable order is what makes that possible.
 */
export const CONSISTENCY_CHECKERS: readonly ConsistencyChecker[] = Object.freeze([
  { id: "C1", run: empty },
  { id: "C2", run: empty },
  { id: "C3", run: empty },
  { id: "C4", run: empty },
  { id: "C5", run: empty },
  { id: "C6", run: empty },
  { id: "C7", run: empty },
  { id: "C8", run: empty },
  { id: "C9", run: empty },
  { id: "C10", run: empty },
]);

export function checkerFor(id: string): ConsistencyChecker {
  const found = CONSISTENCY_CHECKERS.find((checker) => checker.id === id);
  if (found === undefined) {
    // Unreachable through the typed id union, but a missing checker would
    // silently drop a check from the run, so it fails loudly.
    throw new Error(`No checker registered for ${id}`);
  }
  return found;
}
