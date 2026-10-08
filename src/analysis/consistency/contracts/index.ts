/**
 * Contracts for the indexed consistency engine.
 *
 * This module owns every shape the engine produces or consumes. It is the only
 * place a Zod schema may live for an engine object: parsing happens at the
 * boundary (request, LLM response, store load) and the interior of the engine
 * trusts its own output.
 *
 * These are the v3 schemas. They replace the old `contracts.ts` shapes. The
 * public surface re-exported from `index.ts` is deliberately the same set of
 * names the UI and the findings pipeline already import, so the replacement is
 * invisible outside this directory.
 */

export { ConsistencyVerdictSchema, type ConsistencyVerdict } from "./verdict";
export { ConsistencyAdjudicationSchema, type ConsistencyAdjudication } from "./adjudication";
export {
  ConsistencyDocumentSchema,
  ConsistencyReviewRequestSchema,
  type ConsistencyDocument,
  type ConsistencyReviewRequest,
} from "./request";
export { ConsistencyCheckIdSchema, type ConsistencyCheckId } from "./checkIds";
export {
  ConsistencyStatementSchema,
  ConsistencyCandidateSchema,
  type ConsistencyStatement,
  type ConsistencyCandidate,
} from "./candidate";
export {
  ConsistencyCoverageSchema,
  ConsistencyIssueSchema,
  ConsistencyReportSchema,
  ConsistencyProgressSchema,
  type ConsistencyCoverage,
  type ConsistencyIssue,
  type ConsistencyReport,
  type ConsistencyProgress,
} from "./report";
export {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS,
  CONSISTENCY_CONSENT_ERROR,
  CONSISTENCY_CHECK_IDS,
  CONSISTENCY_CHECKS,
  type ConsistencyCheckDescriptor,
  consistencyCheck,
  parseConsistencyReviewRequest,
} from "./registry";
export {
  ClaimClassSchema,
  AdoptionStatusSchema,
  PartyRefSchema,
  CanonicalPredicateSchema,
  DateValueSchema,
  TemporalContextSchema,
  ProgrammeTypeSchema,
  ProgrammeContextSchema,
  DelayContextSchema,
  QuantumBasisSchema,
  QuantumContextSchema,
  CausationContextSchema,
  ResponsibilityContextSchema,
  ContractualBasisSchema,
  EvidenceBasisSchema,
  ClaimValueSchema,
  ClaimScopeKindSchema,
  ClaimScopeSchema,
  ClaimModalitySchema,
  QualifierSchema,
  AssertionStrengthSchema,
  ScenarioTypeSchema,
  ScenarioContextSchema,
  ExtractionPassSchema,
  ExtractionMetadataSchema,
  ExpertReportClaimSchema,
  type ClaimClass,
  type AdoptionStatus,
  type PartyRef,
  type CanonicalPredicate,
  type DateValue,
  type TemporalContext,
  type ProgrammeType,
  type ProgrammeContext,
  type DelayContext,
  type QuantumBasis,
  type QuantumContext,
  type CausationContext,
  type ResponsibilityContext,
  type ContractualBasis,
  type EvidenceBasis,
  type ClaimValue,
  type ClaimScopeKind,
  type ClaimScope,
  type ClaimModality,
  type Qualifier,
  type AssertionStrength,
  type ScenarioType,
  type ScenarioContext,
  type ExtractionPass,
  type ExtractionMetadata,
  type ExpertReportClaim,
} from "./claim";
export {
  EvidenceAnchorSchema,
  QuarantinedClaimSchema,
  EvidenceRegistrySchema,
  type EvidenceAnchor,
  type QuarantinedClaim,
  type EvidenceRegistry,
} from "./evidence";
export { DecisionSubjectSchema, type DecisionSubject } from "./subject";
export {
  DOutcomeSchema,
  EvaluationVectorSchema,
  ConfidenceProfileSchema,
  type DOutcome,
  type EvaluationVector,
  type ConfidenceProfile,
} from "./evaluation";
export {
  DecisionQuestionSchema,
  DecisionPlanSchema,
  type DecisionQuestion,
  type DecisionPlan,
} from "./plan";
export {
  CONSISTENCY_STORE_VERSION,
  ConsistencyStoreRecordSchema,
  type ConsistencyStoreRecord,
  type ConsistencyStore,
} from "./store";
