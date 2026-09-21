/**
 * Pure document-hash staleness guard.
 *
 * The current hash is supplied by the caller. This module never reads or
 * mutates Word; the Word boundary remains responsible for producing hashes.
 */

import type { ChangePlan } from "../core/domain/ChangePlan";

/** Return true only when a supplied current hash differs from the plan hash. */
export function isStale(plan: ChangePlan, currentDocHash: string | undefined): boolean {
  return currentDocHash !== undefined && currentDocHash !== plan.docHash;
}

/** Mark a plan stale when the caller's current document hash differs. */
export function markStale(plan: ChangePlan, currentDocHash: string | undefined): ChangePlan {
  if (currentDocHash === undefined) return plan;
  return {
    ...plan,
    stale: isStale(plan, currentDocHash),
  };
}
