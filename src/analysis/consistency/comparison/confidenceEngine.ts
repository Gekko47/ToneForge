/**
 * Confidence engine with intervals (R6, original §26, D7).
 *
 * Computes versioned confidence with explicit intervals from:
 * - E-vector dispersion (how many facets are resolved vs unresolved)
 * - Model calibration (per-model, per-check calibration version)
 * - Deterministic answer weight (proven facts carry more weight)
 *
 * The UI renders the interval, not just the point, so a 0.72 with a
 * wide interval reads as the uncertain thing it is.
 */

import type {
  ConfidenceProfile,
  DOutcome,
  EvaluationVector,
  ConsistencyCheckId,
} from "../contracts";
import type { EQuestion } from "./deterministicEvaluationResolver";
import { evaluationProfile } from "./evaluationProfiles";

/**
 * Compute confidence with interval for a candidate.
 *
 * The point estimate is a weighted calibration; the interval comes from
 * E-vector dispersion plus model calibration. `calibrationVersion` pins
 * which calibration produced the score, so a later recalibration does not
 * silently rewrite what an old report meant.
 */
export function computeConfidence(
  checkId: string,
  _vector: EvaluationVector,
  modelAnswers: readonly {
    question: string;
    holds: boolean;
    confidence: number;
    reason: string;
  }[] = [],
  deterministicAnswers: readonly { question: string; holds: boolean; reason: string }[] = [],
  dOutcome: DOutcome,
): ConfidenceProfile {
  const profile = evaluationProfile(checkId as ConsistencyCheckId);
  const confidenceProfile = profile.confidenceProfile;

  // Count resolved vs unresolved facets
  const totalFacets = profile.relevantEQuestions.length;
  const resolvedFacets = deterministicAnswers.length + modelAnswers.length;
  const unresolvedFacets = totalFacets - resolvedFacets;

  // Base weight from deterministic answers (proven facts)
  let deterministicWeight = 0;
  for (const ans of deterministicAnswers) {
    const weight = confidenceProfile.weights[ans.question as EQuestion] ?? 0.1;
    deterministicWeight += weight * (ans.holds ? 1 : 0.5);
  }

  // Model answer weight (calibrated by model confidence)
  let modelWeight = 0;
  let modelConfidenceSum = 0;
  for (const ans of modelAnswers) {
    const weight = confidenceProfile.weights[ans.question as EQuestion] ?? 0.1;
    modelWeight += weight * ans.confidence;
    modelConfidenceSum += ans.confidence;
  }

  // Total possible weight
  const totalWeight = Object.values(confidenceProfile.weights).reduce((sum, w) => sum + w, 0);

  // Point estimate: weighted combination
  const point =
    totalWeight > 0
      ? Math.min(1, Math.max(0, (deterministicWeight + modelWeight) / totalWeight))
      : 0.5;

  // Interval calculation
  // - Deterministic answers narrow the interval (they're proven)
  // - Unresolved facets widen the interval
  // - Model calibration uncertainty widens the interval
  // - Low model confidence widens the interval

  const deterministicRatio = deterministicAnswers.length / Math.max(1, totalFacets);
  const modelRatio = modelAnswers.length / Math.max(1, totalFacets);
  const unresolvedRatio = unresolvedFacets / Math.max(1, totalFacets);

  // Base interval width from unresolved facets
  const baseWidth = 0.3 * unresolvedRatio;

  // Model calibration uncertainty
  const avgModelConfidence =
    modelAnswers.length > 0 ? modelConfidenceSum / modelAnswers.length : 0.5;
  const calibrationWidth = 0.2 * (1 - avgModelConfidence) * modelRatio;

  // Deterministic certainty narrows
  const deterministicNarrowing = 0.15 * deterministicRatio;

  // Outcome-specific adjustment
  let outcomeAdjustment = 0;
  switch (dOutcome) {
    case "D-CONSISTENT":
    case "D-CONFLICT":
      outcomeAdjustment = -0.05; // Conclusive outcomes are more certain
      break;
    case "D-AMBIGUOUS":
    case "D-INSUFFICIENT-EVIDENCE":
      outcomeAdjustment = 0.1; // Ambiguous outcomes are less certain
      break;
    case "D-NOT-COMPARABLE":
      outcomeAdjustment = -0.1; // Not comparable is usually clear
      break;
  }

  const halfWidth = Math.max(
    0.05,
    Math.min(0.4, baseWidth + calibrationWidth - deterministicNarrowing + outcomeAdjustment),
  );

  const lower = Math.max(0, point - halfWidth);
  const upper = Math.min(1, point + halfWidth);

  return {
    point: Math.round(point * 1000) / 1000,
    lower: Math.round(lower * 1000) / 1000,
    upper: Math.round(upper * 1000) / 1000,
    calibrationVersion: confidenceProfile.calibrationModelVersion ?? "consistency_decision-v1",
    reviewThreshold: confidenceProfile.reviewThreshold,
    presentationThreshold: confidenceProfile.presentationThreshold,
  };
}

/**
 * Check if a confidence profile meets the review threshold.
 * Issues below review threshold are not shown in the review UI.
 */
export function meetsReviewThreshold(confidence: ConfidenceProfile): boolean {
  return confidence.point >= confidence.reviewThreshold;
}

/**
 * Check if a confidence profile meets the presentation threshold.
 * Issues below presentation threshold are suppressed entirely.
 */
export function meetsPresentationThreshold(confidence: ConfidenceProfile): boolean {
  return confidence.point >= confidence.presentationThreshold;
}

/**
 * Get the confidence band for UI rendering.
 */
export function getConfidenceBand(confidence: ConfidenceProfile): "high" | "medium" | "low" {
  const width = confidence.upper - confidence.lower;
  if (width <= 0.15 && confidence.point >= 0.7) return "high";
  if (width <= 0.4 && confidence.point >= 0.5) return "medium";
  return "low";
}

/**
 * Format confidence for display in Why-confidence UI.
 */
export function formatConfidence(confidence: ConfidenceProfile): string {
  const pct = Math.round(confidence.point * 100);
  const lowerPct = Math.round(confidence.lower * 100);
  const upperPct = Math.round(confidence.upper * 100);
  return `${pct}% [${lowerPct}%–${upperPct}%]`;
}

export type { ConfidenceProfile } from "../contracts";
