/**
 * What stops the revision on screen from being applied, in two tiers.
 *
 * **D6's vocabulary, applied to the whole review.** The plan's approved split is
 * `hard` disables Apply, `soft` requires an explicit acknowledgement, `clean`
 * needs neither — and it is stated for the local preservation validator. This
 * module applies the same split to the engine's verdict, because one button and
 * one sentence present both, and a user cannot tell which produced a disabled
 * Apply.
 *
 * - **hard** — a factual difference (`preservation.pass === false`) or a revision
 *   written for a span the selection never named. No acknowledgement can override
 *   it; the way forward is to regenerate.
 * - **soft** — a concern the user may accept: an unclassified change the validator
 *   flagged, or a meaning dimension the *model* reported it may not have
 *   preserved. Applying needs one acknowledgement, exactly as the validator's own
 *   soft warnings do. The model's self-report is evidence about its own work, not
 *   a verdict — a model asked whether its output is safe will say yes, so a
 *   `false` there is a warning, not a fence.
 *
 * Derived from fields, never from `refusalReason`'s prose, so the copy can change
 * without changing the gate. The engine's `actionable` is false for three
 * different reasons — a hard factual change, a span the model chose, or a meaning
 * flag — and only the last is soft, so `preservation.pass` and the meaning flags
 * are what separate them.
 */
import { unpreservedFlags, type SemanticReviewResult } from "../../analysis/semantic/contracts";

export interface ApplyConcern {
  /** A failure no acknowledgement can override. */
  hard: boolean;
  /** Something soft the user must acknowledge before the revision may be applied. */
  acknowledgementRequired: boolean;
}

export function applyConcernFor(result: SemanticReviewResult): ApplyConcern {
  // Nothing proposed means nothing to apply. The card says so, and no gate reads this.
  if (result.proposedRevision === undefined) {
    return { hard: false, acknowledgementRequired: false };
  }
  if (result.preservation.pass === false) {
    return { hard: true, acknowledgementRequired: false };
  }
  const unpreserved = unpreservedFlags(result.meaningPreservation);
  if (result.actionable === false) {
    // `pass` is true here, so the refusal is either the model's own meaning flag
    // (soft) or a revision scoped to a span the selection never named (hard).
    return unpreserved.length > 0
      ? { hard: false, acknowledgementRequired: true }
      : { hard: true, acknowledgementRequired: false };
  }
  return { hard: false, acknowledgementRequired: result.preservation.requiresAcknowledgement };
}
