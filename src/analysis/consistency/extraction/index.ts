/**
 * Extraction (R1–R2).
 *
 * The evidence validator (R1) is here: it proves a proposed
 * claim's evidence against the document text before the claim
 * may enter the pipeline, quarantines what it cannot prove, and
 * assigns canonical ids only to what survives. Secondary
 * citations are resolved against the registry after validation.
 *
 * R2 lands the two extraction passes around it: the section
 * hierarchy batches the document with stable paragraph ids, the
 * prompt encodes the ten extraction rules behind the raw-text
 * opt-in gate, Pass A extracts one batch per provider call with
 * retry and abort support, and Pass B resolves claims to their
 * canonical identity across the whole document.
 */
export {
  canonicalAnchorId,
  resolveSecondaryCitations,
  validateEvidence,
  type EvidenceValidationInput,
  type EvidenceValidationResult,
} from "./evidenceValidator";
export { buildExtractionBatches, type ExtractionBatch, type ExtractionParagraph } from "./batch";
export {
  buildExtractionPrompt,
  ExtractionResponseSchema,
  RawExtractedClaimSchema,
  RawEvidenceSchema,
  type ExtractionPromptOptions,
  type ExtractionResponse,
  type RawExtractedClaim,
  type RawEvidence,
} from "./prompt";
export {
  extractClaims,
  type ExtractionCallOptions,
  type ExtractionDocument,
  type ExtractionResult,
} from "./batchExtractor";
export { resolveCanonicalClaims, type CanonicalResolutionInput } from "./globalResolver";
