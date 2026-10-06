import { z } from "zod";

/**
 * The evidence registry (E-registry, original §6).
 *
 * Every claim cites registry entries, never raw offsets. The validator
 * quarantines a claim whose evidence cannot be resolved — a corrupt
 * offset, a hash mismatch, a citation to text that is not there — and
 * the quarantine is counted in coverage, so the report says what it
 * refused to compare.
 *
 * The anchor carries no id of its own: the registry key is the
 * canonical anchor id, assigned by the validator from the anchor's
 * content, so the same span always maps to the same entry within a
 * session.
 */

/** One anchored span of source text (original §6 EvidenceAnchor). */
export const EvidenceAnchorSchema = z.object({
  documentId: z.string().trim().min(1),
  sectionId: z.string().trim().optional(),
  sectionPath: z.array(z.string().trim()).default([]),
  paragraphId: z.string().trim().min(1),
  /** Character range within the document text. */
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  /** The exact text, as extracted. */
  exactText: z.string(),
  /** Content hash of the anchored text, for integrity and staleness. */
  evidenceHash: z.string().trim().min(1),
  nearbyContextHash: z.string().trim().optional(),
});

export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

/** Why a claim was quarantined, keyed by its provisional id. */
export const QuarantinedClaimSchema = z.object({
  claimId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export type QuarantinedClaim = z.infer<typeof QuarantinedClaimSchema>;

/** The registry: anchors keyed by canonical id, plus the quarantine list. */
export const EvidenceRegistrySchema = z.object({
  anchors: z.record(z.string(), EvidenceAnchorSchema),
  quarantined: z.array(QuarantinedClaimSchema).default([]),
});

export type EvidenceRegistry = z.infer<typeof EvidenceRegistrySchema>;
