/**
 * Comparison (R4, R6).
 *
 * Diff, deterministic E-resolver, C-profiles, 16-outcome D-derivation, hard
 * gates, confidence engine with intervals.
 */

export {
  buildClaimPairDiff,
  compareValues,
  compareDatesByRole,
  type ClaimPairDiff,
  type ClaimFieldMatch,
  type ClaimFieldDifference,
  type ClaimFieldUnknown,
} from "./claimPairDiff";

export {
  resolveCandidate,
  runComparabilityGates,
  type DeterministicResolution,
  type EAnswer,
  type EUnresolved,
  type EQuestion,
  E_QUESTIONS,
} from "./deterministicEvaluationResolver";

export {
  evaluationProfile,
  allRelevantEQuestions,
  type EvaluationProfile,
  EVALUATION_PROFILES,
} from "./evaluationProfiles";

export {
  runPreModelGates,
  runPostModelGates,
  type PreModelGateResult,
  type PostModelGateResult,
} from "./hardGates";

export {
  deriveDOutcome,
  buildEvaluationVector,
  isConclusiveDOutcome,
  getDerivationReasonCodes,
  type DOutcome,
} from "./dDerivation";

export {
  computeConfidence,
  meetsReviewThreshold,
  meetsPresentationThreshold,
  getConfidenceBand,
  formatConfidence,
  type ConfidenceProfile,
} from "./confidenceEngine";
