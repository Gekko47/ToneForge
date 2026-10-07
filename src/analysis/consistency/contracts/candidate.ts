import { z } from "zod";
import { ConsistencyCheckIdSchema } from "./registry";
import { DecisionSubjectSchema } from "./subject";

/**
 * One statement the engine segmented from the document.
 *
 * Segmentation (R0) splits the document into trimmed, non-empty
 * statements with stable ids and 0-based positions, so retrieval
 * and comparison can cite the exact statement they examined.
 */
export const ConsistencyStatementSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  section: z.string(),
  /** 0-based position in the document's statement order. */
  index: z.number().int().min(0),
  /** Character range within `document.text`, if the engine could locate it. */
  range: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
});
export type ConsistencyStatement = z.infer<typeof ConsistencyStatementSchema>;

/**
 * One retrieved candidate (original §10 ConsistencyCandidateV3).
 *
 * Retrieval (R3) groups the claims that share a subject — an entity,
 * an event, a term, a quantity, a reference, a section — so the
 * comparison stages (R4 onward) examine a plausible subject instead
 * of windowing the document. A candidate is never a user-facing
 * issue by itself: it is the input the deterministic resolver
 * compares, and only what it cannot settle reaches the model.
 *
 * `subject` is what the claims are about, after alias resolution.
 * C8 and C9 use reference and section subjects — a citation and its
 * target are one subject, a heading promise and its section are one
 * subject — never a forced claim pair.
 *
 * `claimIds` are the retrieved claims, in document order, capped at
 * the per-subject bound; the overflow is counted in coverage, never
 * silently dropped. `state` is `pending` at retrieval: the
 * deterministic resolver classifies it into consistent, conflict,
 * unresolved, or not-comparable.
 */
export const ConsistencyCandidateSchema = z.object({
  id: z.string().trim().min(1),
  checkId: ConsistencyCheckIdSchema,
  subject: DecisionSubjectSchema,
  fingerprint: z.string().trim().min(1),
  claimIds: z.array(z.string().trim().min(1)).min(1),
  retrieval: z
    .object({
      /** Why retrieval grouped these claims, in machine-readable form. */
      reasonCodes: z.array(z.string().trim().min(1)).default([]),
      sharedEntityIds: z.array(z.string().trim()).default([]),
      sharedEventIds: z.array(z.string().trim()).default([]),
      sharedProgrammeIds: z.array(z.string().trim()).default([]),
      sharedMetricIds: z.array(z.string().trim()).default([]),
    })
    .default({}),
  /** The evidence anchors of the retrieved claims, for provenance. */
  evidenceIds: z.array(z.string().trim().min(1)).default([]),
  state: z
    .enum(["pending", "consistent", "conflict", "unresolved", "not_comparable"])
    .default("pending"),
});

export type ConsistencyCandidate = z.infer<typeof ConsistencyCandidateSchema>;
