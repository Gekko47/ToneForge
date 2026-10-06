import { z } from "zod";

/**
 * The evidence registry (E-registry).
 *
 * Every claim cites registry entries, never raw offsets. The validator
 * quarantines a claim whose evidence cannot be resolved — a corrupt offset, a
 * hash mismatch, a citation to text that is not there — and the quarantine is
 * counted in coverage, so the report says what it refused to compare.
 */

/** One anchored span of source text. */
export const EvidenceAnchorSchema = z.object({
  id: z.string().trim().min(1),
  /** The exact text, as extracted. */
  text: z.string(),
  /** Character range within the document text, when locatable. */
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  section: z.string().default(""),
  /** Content hash of the anchored text, for staleness detection. */
  hash: z.string().optional(),
});

export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

/** The registry: anchors keyed by id, plus the quarantine list. */
export const EvidenceRegistrySchema = z.object({
  anchors: z.record(z.string(), EvidenceAnchorSchema),
  quarantined: z.array(
    z.object({
      claimId: z.string(),
      reason: z.string(),
    }),
  ),
});

export type EvidenceRegistry = z.infer<typeof EvidenceRegistrySchema>;
