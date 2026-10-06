/**
 * Public surface of the indexed consistency engine.
 *
 * Import from here rather than from the internals. The internal layout is a
 * detail of this engine; the contract callers depend on is the consent gate,
 * the pipeline entry point, and the report shape.
 *
 * Per ADR-0052 this engine is the single sanctioned exception to
 * deterministic-first. It is never called from the typing path or the
 * observer.
 */

export {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS,
  CONSISTENCY_CONSENT_ERROR,
  CONSISTENCY_CHECK_IDS,
  CONSISTENCY_CHECKS,
  ConsistencyCheckIdSchema,
  ConsistencyAdjudicationSchema,
  ConsistencyCandidateSchema,
  ConsistencyCoverageSchema,
  ConsistencyDocumentSchema,
  ConsistencyIssueSchema,
  ConsistencyProgressSchema,
  ConsistencyReportSchema,
  ConsistencyReviewRequestSchema,
  ConsistencyStatementSchema,
  ConsistencyVerdictSchema,
  ClaimClassSchema,
  AdoptionStateSchema,
  ExpertReportClaimSchema,
  EvidenceAnchorSchema,
  EvidenceRegistrySchema,
  DecisionSubjectSchema,
  DOutcomeSchema,
  EvaluationVectorSchema,
  ConfidenceProfileSchema,
  DecisionQuestionSchema,
  DecisionPlanSchema,
  CONSISTENCY_STORE_VERSION,
  ConsistencyStoreRecordSchema,
  consistencyCheck,
  parseConsistencyReviewRequest,
  type ConsistencyCheckId,
  type ConsistencyCheckDescriptor,
  type ConsistencyAdjudication,
  type ConsistencyCandidate,
  type ConsistencyCoverage,
  type ConsistencyDocument,
  type ConsistencyIssue,
  type ConsistencyProgress,
  type ConsistencyReport,
  type ConsistencyReviewRequest,
  type ConsistencyStatement,
  type ConsistencyVerdict,
  type ClaimClass,
  type AdoptionState,
  type ExpertReportClaim,
  type EvidenceAnchor,
  type EvidenceRegistry,
  type DecisionSubject,
  type DOutcome,
  type EvaluationVector,
  type ConfidenceProfile,
  type DecisionQuestion,
  type DecisionPlan,
  type ConsistencyStoreRecord,
  type ConsistencyStore,
} from "./contracts";

export {
  ConsistencyRunCancelled,
  previewStatements,
  runConsistencyReview,
  segmentDocument,
  type ConsistencyRunOptions,
} from "./indexedEngine";

export {
  CONSISTENCY_CHECKERS,
  checkerFor,
  type ConsistencyCheckContext,
  type ConsistencyChecker,
} from "./checks";

export { consistencyCategory, summarizeReport, toFinding, toFindings } from "./bridge";

export {
  collapsedCount,
  groupConsistencyIssues,
  isLocatable,
  issueGroupKey,
  type ConsistencyIssueGroup,
} from "./grouping";
