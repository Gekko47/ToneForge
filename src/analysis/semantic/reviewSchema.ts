/**
 * What a Semantic Review response must contain.
 *
 * **Separate from `contracts.ts` on purpose.** The contract is what the product
 * produces; this is what the model is asked for. They differ in three ways that
 * matter:
 *
 * 1. **The model does not decide whether its own revision may be applied.** There
 *    is no `actionable` field to ask for. The engine computes that from the local
 *    preservation report and the meaning assessment — a model asked whether its
 *    output is safe to apply will answer yes, and a boolean the model sets about
 *    its own work is not evidence.
 * 2. **The proposed revision is the whole selection, verbatim, or absent.** The
 *    engine refuses anything else, and the prompt says so, because a model that
 *    rewrites a paragraph and returns a fragment of it produces a change whose
 *    scope it cannot describe.
 * 3. **`meaningPreservation` is five booleans with no hedging.** The
 *    specification calls this model evidence rather than proof, and evidence is
 *    only usable if it is unambiguous. "mostly" is not an answer.
 */

import { z } from "zod";

import { MeaningPreservationAssessmentSchema, SemanticAssessmentSchema } from "./contracts";

/**
 * The revision, exactly as the selection is to be replaced.
 *
 * A separate object rather than a bare string so the model states what it is
 * replacing. The engine compares the two and refuses a mismatch, and a model that
 * has to write the original back out has to notice when it rewrote more than the
 * selection.
 */
export const ProposedRevisionSchema = z.object({
  /** The exact selection text, copied. Checked against the request. */
  original: z.string().min(1),
  /** The restyled text for the same span. */
  revised: z.string().min(1),
});
export type ProposedRevision = z.infer<typeof ProposedRevisionSchema>;

export const SemanticReviewResponseSchema = z.object({
  assessment: SemanticAssessmentSchema,
  /**
   * Absent when the model found the selection aligned and proposed nothing.
   *
   * Optional rather than nullable so "no proposal" and "an empty proposal" cannot
   * be confused: an empty string is not a revision, and a revision that empties a
   * span is a deletion the user must be able to see.
   */
  proposedRevision: ProposedRevisionSchema.optional(),
  meaningPreservation: MeaningPreservationAssessmentSchema,
  /** One sentence on what the revision changes and why, rendered to the user. */
  rationale: z.string().trim().min(1).max(600),
});
export type SemanticReviewResponse = z.infer<typeof SemanticReviewResponseSchema>;
