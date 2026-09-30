/**
 * Spec §16: the review session.
 *
 * A decision — "approve this", "skip that" — is only meaningful against the exact
 * thing the user was looking at. Approving a correction under one document
 * revision, or against a profile they have since edited, and then applying it to
 * a document that has since changed is a fabricated consent: the user agreed to
 * a specific edit at a specific moment, and nothing about the edit survived
 * except the fact that they once said yes.
 *
 * So a session carries the **identity** its decisions were made under, and the
 * whole block is discarded the moment any part of that identity differs. It is
 * wholesale rather than per-decision because a partial carry-over is the worse
 * failure: it keeps some approvals and drops others with nothing on screen
 * saying which, so Pending Changes would be a mixture of two reviews and the
 * user could not tell which is which.
 *
 * `coverageFingerprint` is part of the identity for the same reason. A session
 * that examined a third of the document produced different findings from one
 * that examined all of it; carrying approvals across that boundary would apply a
 * correction chosen from a list that was never complete.
 */

import { z } from "zod";

/**
 * What a session's decisions are bound to.
 *
 * Every field is a claim that can be checked, and any mismatch invalidates.
 * A digest would be tidier to compare and worse to debug: when a session is
 * wrongly invalidated, the reason has to be nameable, and "the profile revision
 * moved from 6 to 7" is an answer while "the fingerprint differs" is not.
 */
export const ReviewSessionIdentitySchema = z.object({
  documentId: z.string().trim().min(1),
  documentVersion: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
  structuralHash: z.string().trim().min(1),
  profileId: z.string().uuid(),
  profileRevision: z.number().int().nonnegative(),
  governancePolicyRevision: z.number().int().nonnegative(),
  coverageFingerprint: z.string().trim().min(1),
});
export type ReviewSessionIdentity = z.infer<typeof ReviewSessionIdentitySchema>;

/** What the user decided about one occurrence. */
export const ReviewDecisionSchema = z.object({
  /** The finding's occurrence identity, as the review pane keys it. */
  identity: z.string().trim().min(1),
  /** The rule that produced it, so a decision can be explained without the finding. */
  ruleId: z.string().trim().min(1),
  category: z.string().trim().min(1),
  decision: z.enum(["approved", "skipped"]),
  /** What the user saw as the correction. `null` when the finding had none. */
  expected: z.string().nullable(),
  decidedAt: z.string().datetime(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const DeterministicReviewSessionSchema = z.object({
  identity: ReviewSessionIdentitySchema,
  decisions: z.array(ReviewDecisionSchema).default([]),
  updatedAt: z.string().datetime(),
});
export type DeterministicReviewSession = z.infer<typeof DeterministicReviewSessionSchema>;

/**
 * Whether a stored session's decisions may be carried into a new identity.
 *
 * A field-by-field comparison rather than a serialised equality check, for the
 * reason in the module comment: the caller has to be able to say *which* field
 * moved. This returns the names of the fields that differ, which is empty when
 * the session survives.
 */
export function changedIdentityFields(
  stored: ReviewSessionIdentity,
  next: ReviewSessionIdentity,
): string[] {
  return Object.keys(next).filter(
    (key) =>
      stored[key as keyof ReviewSessionIdentity] !== next[key as keyof ReviewSessionIdentity],
  );
}
