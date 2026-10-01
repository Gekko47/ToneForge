/**
 * The semantic review surface.
 *
 * One barrel so the task pane imports from one place and never reaches past it
 * into an engine, a prompt, or a schema. That is what keeps the review pipeline
 * separable from the deterministic findings list it used to be merged into — the
 * two share this directory's directory and nothing else.
 */

export { reviewSemanticSelection, type SemanticReviewEngineOptions } from "./semanticReviewEngine";
export { buildSemanticReviewPrompt, type SemanticReviewPromptOptions } from "./reviewPrompt";
export {
  SemanticReviewResponseSchema,
  ProposedRevisionSchema,
  type SemanticReviewResponse,
  type ProposedRevision,
} from "./reviewSchema";
export {
  AlignmentSchema,
  MeaningPreservationAssessmentSchema,
  ProviderMetadataSchema,
  SemanticAssessmentSchema,
  SemanticDimensionSchema,
  SemanticObservationSchema,
  SemanticReviewRequestSchema,
  unpreservedFlags,
  type Alignment,
  type MeaningPreservationAssessment,
  type ProviderMetadata,
  type SemanticAssessment,
  type SemanticDimension,
  type SemanticObservation,
  type SemanticReviewRequest,
  type SemanticReviewResult,
} from "./contracts";
export {
  advanceSession,
  checkSessionFreshness,
  createSemanticReviewSession,
  currentSession,
  isApplicable,
  type SemanticReviewOptions,
  type SessionContext,
} from "./session";
export {
  HARD_TIER_KINDS,
  PRESERVATION_TIERS,
  validatePreservation,
  type FactChange,
  type PreservationReport,
  type PreservationTier,
  type PreservationWarning,
} from "./preservationValidator";
export {
  extractProtectedFacts,
  findFactsPresentIn,
  PROTECTED_FACT_KINDS,
  type ProtectedFact,
  type ProtectedFactKind,
} from "./protectedFacts";
export {
  countTerm,
  extractQualifiers,
  NEGATION_TERMS,
  QUALIFIER_TERMS,
  type QualifierClass,
  type QualifierOccurrence,
} from "./qualifiers";
export {
  EMPTY_ANALYSIS_MESSAGE,
  extractionFreeText,
  parseSemanticStyleExtraction,
  SemanticStyleExtractionSchema,
  type ExtractionRefusal,
  type SemanticStyleExtraction,
} from "./semanticStyleExtraction";
