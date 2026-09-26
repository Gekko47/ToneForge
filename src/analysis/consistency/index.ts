/**
 * Public surface of the cross-report consistency engine.
 *
 * Import from here rather than from the internals. The internal layout is a
 * detail of this engine; the contract callers depend on is the consent gate, the
 * pipeline entry point, and the report shape.
 *
 * Per ADR-0052 this engine is the single sanctioned exception to
 * deterministic-first. It is never called from the typing path or the observer.
 */

export {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_CHECK_IDS,
  CONSISTENCY_CHECKS,
  CONSISTENCY_CONSENT_ERROR,
  CONSISTENCY_DEFAULT_MAX_STATEMENTS,
  ConsistencyAdjudicationSchema,
  ConsistencyCandidateSchema,
  ConsistencyCheckIdSchema,
  ConsistencyCoverageSchema,
  ConsistencyDocumentSchema,
  ConsistencyIssueSchema,
  ConsistencyProgressSchema,
  ConsistencyReportSchema,
  ConsistencyReviewRequestSchema,
  ConsistencyStatementSchema,
  ConsistencyVerdictSchema,
  consistencyCheck,
  parseConsistencyReviewRequest,
  type ConsistencyAdjudication,
  type ConsistencyCandidate,
  type ConsistencyCheckDescriptor,
  type ConsistencyCheckId,
  type ConsistencyCoverage,
  type ConsistencyDocument,
  type ConsistencyIssue,
  type ConsistencyProgress,
  type ConsistencyReport,
  type ConsistencyReviewRequest,
  type ConsistencyStatement,
  type ConsistencyVerdict,
} from "./contracts";

export {
  ConsistencyRunCancelled,
  buildAdjudicationPrompt,
  consolidate,
  parseAdjudication,
  previewStatements,
  runConsistencyReview,
  segmentDocument,
  type ConsistencyRunOptions,
} from "./engine";

export {
  CONSISTENCY_CHECKERS,
  checkerFor,
  type ConsistencyCheckContext,
  type ConsistencyChecker,
} from "./checks";

export { consistencyCategory, summarizeReport, toFinding, toFindings } from "./bridge";
