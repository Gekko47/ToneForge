/**
 * The registry of the ten cross-report checks.
 *
 * Each entry is a pure function from statements to candidates. That signature is
 * the whole contract: no check reads Word, sends anything over a network, or
 * knows whether a model exists. A check that cannot be run without a model has
 * already lost, because the engine's value is that most candidates are decided
 * before any of them leave the machine.
 */

import type { ConsistencyCandidate, ConsistencyCheckId } from "../contracts";
import { checkTerminologyDrift } from "./terminology";
import { checkNumericContradiction, checkUnitInconsistency } from "./numeric";
import { checkSectionPromiseMismatch, checkTemporalConflict } from "./structural";
import {
  checkDefinitionalConflict,
  checkEntityAttributeConflict,
  checkReferenceConflict,
  checkScopeContradiction,
  checkStatusContradiction,
} from "./semantic";
import type { IndexedStatement } from "./primitives";

export interface ConsistencyCheckContext {
  /** Statements extracted from the snapshot. */
  readonly statements: readonly IndexedStatement[];
  /** Section headings in document order, used by C9. */
  readonly headings: readonly string[];
}

export interface ConsistencyChecker {
  readonly id: ConsistencyCheckId;
  readonly run: (context: ConsistencyCheckContext) => ConsistencyCandidate[];
}

/**
 * The ten checkers.
 *
 * Ordered by check id, not by cost: the pipeline reports progress by id so a
 * user reading the results can find the check that produced a finding, and a
 * stable order is what makes that possible.
 */
export const CONSISTENCY_CHECKERS: readonly ConsistencyChecker[] = Object.freeze([
  { id: "C1", run: ({ statements }) => checkTerminologyDrift([...statements]) },
  { id: "C2", run: ({ statements }) => checkNumericContradiction([...statements]) },
  { id: "C3", run: ({ statements }) => checkTemporalConflict([...statements]) },
  { id: "C4", run: ({ statements }) => checkEntityAttributeConflict([...statements]) },
  { id: "C5", run: ({ statements }) => checkDefinitionalConflict([...statements]) },
  { id: "C6", run: ({ statements }) => checkUnitInconsistency([...statements]) },
  { id: "C7", run: ({ statements }) => checkStatusContradiction([...statements]) },
  { id: "C8", run: ({ statements }) => checkReferenceConflict([...statements]) },
  {
    id: "C9",
    run: ({ statements, headings }) => checkSectionPromiseMismatch([...statements], headings),
  },
  { id: "C10", run: ({ statements }) => checkScopeContradiction([...statements]) },
]);

export function checkerFor(id: ConsistencyCheckId): ConsistencyChecker {
  const found = CONSISTENCY_CHECKERS.find((checker) => checker.id === id);
  if (found === undefined) {
    // Unreachable through the typed id union, but a missing checker would
    // silently drop a check from the run, so it fails loudly.
    throw new Error(`No checker registered for ${id}`);
  }
  return found;
}

export { checkTerminologyDrift } from "./terminology";
export { checkNumericContradiction, checkUnitInconsistency } from "./numeric";
export { checkTemporalConflict, checkSectionPromiseMismatch } from "./structural";
export {
  checkEntityAttributeConflict,
  checkDefinitionalConflict,
  checkStatusContradiction,
  checkReferenceConflict,
  checkScopeContradiction,
} from "./semantic";
export type { IndexedStatement } from "./primitives";
