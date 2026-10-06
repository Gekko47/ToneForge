/**
 * Extraction (R1–R2).
 *
 * The evidence validator (R1) is here: it proves a proposed
 * claim's evidence against the document text before the claim
 * may enter the pipeline, quarantines what it cannot prove, and
 * assigns canonical ids only to what survives. Secondary
 * citations are resolved against the registry after validation.
 * The prompt, the batch extractor, and the global resolver land
 * in R2.
 */
export {
  canonicalAnchorId,
  resolveSecondaryCitations,
  validateEvidence,
  type EvidenceValidationInput,
  type EvidenceValidationResult,
} from "./evidenceValidator";
