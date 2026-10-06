import { z } from "zod";

/**
 * One statement as the engine sees it.
 *
 * `id` is the statement's canonical identifier, assigned after extraction and
 * stable within a session. `section` is the heading it sits under, or the
 * empty string for a statement before the first heading.
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
 * One comparison a check wants adjudicated.
 *
 * `certainty` is the split that makes the engine cheap: `certain` candidates
 * are resolved by the check itself and never reach the model. Only `ambiguous`
 * ones are sent, and only up to `maxAdjudications` of them.
 *
 * `evidence` carries whatever the check computed to justify its suspicion — a
 * shared term, a numeric value, a date. It is shown to the adjudicator and to
 * the user.
 */
export const ConsistencyCandidateSchema = z.object({
  checkId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  suspicion: z.string().trim().min(1),
  left: ConsistencyStatementSchema,
  right: ConsistencyStatementSchema,
  certainty: z.enum(["certain", "ambiguous"]),
  evidence: z.record(z.string(), z.string()),
});

export type ConsistencyCandidate = z.infer<typeof ConsistencyCandidateSchema>;
