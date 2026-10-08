/**
 * D-derivation (R6, original §25).
 *
 * Derives the 16 D-outcomes from the completed E-vector.
 * The derivation is mechanical where possible; a direct D-choice
 * question is asked only when the E-vector cannot determine the relationship.
 *
 * The 16 outcomes are:
 * - D-CONSISTENT
 * - D-CONFLICT
 * - D-NOT-COMPARABLE
 * - D-UPDATED-POSITION
 * - D-DIFFERENT-SCOPE
 * - D-DIFFERENT-SCENARIO
 * - D-DIFFERENT-BASIS
 * - D-DIFFERENT-PERIOD
 * - D-DIFFERENT-ATTRIBUTION
 * - D-QUALIFIED-POSITION
 * - D-DIFFERENT-PROGRAMME-BASIS
 * - D-FORECAST-VS-ACTUAL
 * - D-DIFFERENT-VALUATION-BASIS
 * - D-DIFFERENT-MEASUREMENT-BASIS
 * - D-INSUFFICIENT-EVIDENCE
 * - D-AMBIGUOUS
 */

import type { DOutcome, EvaluationVector, ConsistencyCheckId } from "../contracts";
export type { DOutcome, EvaluationVector } from "../contracts";
import { evaluationProfile } from "./evaluationProfiles";

/**
 * Derive the D-outcome from a completed E-vector.
 *
 * The profile's deriveDOutcome function is the primary derivation.
 * If it returns null (ambiguous), we fall back to the generic
 * derivation rules based on the E-vector facets.
 */
export function deriveDOutcome(
  checkId: string,
  vector: EvaluationVector,
  modelAnswers: readonly { question: string; holds: boolean; reason: string }[] = [],
  deterministicAnswers: readonly { question: string; holds: boolean; reason: string }[] = [],
): DOutcome {
  const profile = evaluationProfile(checkId as ConsistencyCheckId);

  // First, check model answers for substantive conflicts and specific outcomes
  // that the profile's vector-based derivation cannot detect
  const modelOutcome = deriveFromModelAnswers(modelAnswers);
  if (modelOutcome !== null) {
    return modelOutcome;
  }

  // Then, try the profile's derivation function
  const profileOutcome = profile.deriveDOutcome(vector);
  if (profileOutcome !== null) {
    return profileOutcome;
  }

  // Fallback: generic derivation from E-vector
  return genericDeriveDOutcome(checkId, vector, modelAnswers, deterministicAnswers);
}

/**
 * Derive a D-outcome from model answers.
 *
 * Model answers can indicate specific outcomes that the vector-based
 * derivation cannot detect, such as programme basis differences,
 * forecast-vs-actual, valuation basis differences, measurement basis
 * differences, insufficient evidence, and updated positions.
 */
function deriveFromModelAnswers(
  modelAnswers: readonly { question: string; holds: boolean; reason: string }[],
): DOutcome | null {
  // Check for substantive conflict from model answers
  const hasSubstantiveConflict = modelAnswers.some(
    (a) =>
      a.holds &&
      [
        "E-VALUE-INCOMPATIBLE",
        "E-STATUS-MUTUALLY-EXCLUSIVE",
        "E-DEFINITION-INCOMPATIBLE",
        "E-CRITICALITY-INCOMPATIBLE",
        "E-SUBSTANTIVE-CONFLICT",
      ].includes(a.question),
  );

  if (hasSubstantiveConflict) {
    return "D-CONFLICT";
  }

  // Check for specific D-outcomes based on model answers
  const programmeBasisAnswer = modelAnswers.find((a) => a.question === "E-PROGRAMME-BASIS-SAME");
  if (programmeBasisAnswer !== undefined && !programmeBasisAnswer.holds) {
    return "D-DIFFERENT-PROGRAMME-BASIS";
  }

  const forecastActualAnswer = modelAnswers.find((a) => a.question === "E-TEMPORAL-COMPARABLE");
  if (forecastActualAnswer !== undefined && !forecastActualAnswer.holds) {
    return "D-FORECAST-VS-ACTUAL";
  }

  const valuationBasisAnswer = modelAnswers.find((a) => a.question === "E-VALUATION-PERIOD-SAME");
  if (valuationBasisAnswer !== undefined && !valuationBasisAnswer.holds) {
    return "D-DIFFERENT-VALUATION-BASIS";
  }

  const measurementBasisAnswer = modelAnswers.find(
    (a) => a.question === "E-MEASUREMENT-BASIS-SAME",
  );
  if (measurementBasisAnswer !== undefined && !measurementBasisAnswer.holds) {
    return "D-DIFFERENT-MEASUREMENT-BASIS";
  }

  const evidenceAnswer = modelAnswers.find((a) => a.question === "E-EVIDENCE-SUFFICIENT");
  if (evidenceAnswer !== undefined && !evidenceAnswer.holds) {
    return "D-INSUFFICIENT-EVIDENCE";
  }

  const updateAnswer = modelAnswers.find((a) => a.question === "E-UPDATE-SUPERSEDES");
  if (updateAnswer !== undefined && !updateAnswer.holds) {
    return "D-UPDATED-POSITION";
  }

  return null;
}

/**
 * Generic D-outcome derivation when the profile returns null.
 * This handles the ambiguous cases that need model input.
 */
function genericDeriveDOutcome(
  _checkId: string,
  vector: EvaluationVector,
  modelAnswers: readonly { question: string; holds: boolean; reason: string }[],
  deterministicAnswers: readonly { question: string; holds: boolean; reason: string }[],
): DOutcome {
  // Combine all answers
  const allAnswers = [...deterministicAnswers, ...modelAnswers];

  // Check for substantive conflict from model answers
  const hasSubstantiveConflict = allAnswers.some(
    (a) =>
      a.holds &&
      [
        "E-VALUE-INCOMPATIBLE",
        "E-STATUS-MUTUALLY-EXCLUSIVE",
        "E-DEFINITION-INCOMPATIBLE",
        "E-CRITICALITY-INCOMPATIBLE",
        "E-SUBSTANTIVE-CONFLICT",
      ].includes(a.question),
  );

  if (hasSubstantiveConflict) {
    return "D-CONFLICT";
  }

  // Check for specific D-outcomes based on E-vector facets
  if (!vector.sameSubject) return "D-NOT-COMPARABLE";
  if (!vector.samePeriod) return "D-DIFFERENT-PERIOD";
  if (!vector.sameScenario) return "D-DIFFERENT-SCENARIO";
  if (!vector.sameBasis) return "D-DIFFERENT-BASIS";
  if (!vector.sameAttribution) return "D-DIFFERENT-ATTRIBUTION";
  if (!vector.sameScope) return "D-DIFFERENT-SCOPE";
  if (!vector.qualifiersCompatible) return "D-QUALIFIED-POSITION";

  // Check for programme basis difference
  const programmeBasisAnswer = allAnswers.find((a) => a.question === "E-PROGRAMME-BASIS-SAME");
  if (programmeBasisAnswer !== undefined && !programmeBasisAnswer.holds) {
    return "D-DIFFERENT-PROGRAMME-BASIS";
  }

  // Check for forecast vs actual
  const forecastActualAnswer = allAnswers.find((a) => a.question === "E-TEMPORAL-COMPARABLE");
  if (forecastActualAnswer !== undefined && !forecastActualAnswer.holds) {
    // Could be forecast vs actual or incomparable dates
    return "D-FORECAST-VS-ACTUAL";
  }

  // Check for valuation basis difference
  const valuationBasisAnswer = allAnswers.find((a) => a.question === "E-VALUATION-PERIOD-SAME");
  if (valuationBasisAnswer !== undefined && !valuationBasisAnswer.holds) {
    return "D-DIFFERENT-VALUATION-BASIS";
  }

  // Check for measurement basis difference
  const measurementBasisAnswer = allAnswers.find((a) => a.question === "E-MEASUREMENT-BASIS-SAME");
  if (measurementBasisAnswer !== undefined && !measurementBasisAnswer.holds) {
    return "D-DIFFERENT-MEASUREMENT-BASIS";
  }

  // Check for insufficient evidence
  const evidenceAnswer = allAnswers.find((a) => a.question === "E-EVIDENCE-SUFFICIENT");
  if (evidenceAnswer !== undefined && !evidenceAnswer.holds) {
    return "D-INSUFFICIENT-EVIDENCE";
  }

  // Check for updated position
  const updateAnswer = allAnswers.find((a) => a.question === "E-UPDATE-SUPERSEDES");
  if (updateAnswer !== undefined && !updateAnswer.holds) {
    return "D-UPDATED-POSITION";
  }

  // If we have model answers but no clear outcome, it's ambiguous
  if (modelAnswers.length > 0) {
    return "D-AMBIGUOUS";
  }

  // Default to consistent if all checks pass
  return "D-CONSISTENT";
}

/**
 * Build the complete E-vector from deterministic and model answers.
 */
export function buildEvaluationVector(
  deterministicAnswers: readonly { question: string; holds: boolean; reason: string }[],
  modelAnswers: readonly { question: string; holds: boolean; reason: string }[],
): EvaluationVector {
  const allAnswers = [...deterministicAnswers, ...modelAnswers];
  const answerMap = new Map(allAnswers.map((a) => [a.question, a.holds]));

  return {
    sameSubject: answerMap.get("E-ENTITY-SAME") ?? answerMap.get("E-EVENT-SAME") ?? false,
    samePeriod:
      answerMap.get("E-TEMPORAL-COMPARABLE") ??
      answerMap.get("E-DATA-DATE-COMPARABLE") ??
      answerMap.get("E-VALUATION-PERIOD-SAME"),
    sameScenario: answerMap.get("E-SCENARIO-SAME"),
    sameBasis: answerMap.get("E-BASIS-SAME") ?? answerMap.get("E-PROGRAMME-BASIS-SAME"),
    sameAttribution: answerMap.get("E-ATTRIBUTION-COMPATIBLE"),
    sameScope: answerMap.get("E-SCOPE-SAME") ?? answerMap.get("E-SCOPE-EXCEPTION"),
    // Tri-state: absent means the facet was never resolved, which is not the
    // same as "values disagree". Collapsing absence to false fabricated a
    // conflict for every pair the resolver could not answer.
    valuesAgree: answerMap.has("E-VALUE-INCOMPATIBLE")
      ? answerMap.get("E-VALUE-INCOMPATIBLE") === false
      : undefined,
    unitsCompatible:
      answerMap.get("E-CURRENCY-COMPATIBLE") ?? answerMap.get("E-MEASUREMENT-BASIS-SAME"),
    qualifiersCompatible: answerMap.get("E-QUALIFIER-RECONCILES"),
  };
}

/**
 * Check if a D-outcome is conclusive (doesn't need model input).
 */
export function isConclusiveDOutcome(outcome: DOutcome): boolean {
  return outcome !== "D-AMBIGUOUS" && outcome !== "D-INSUFFICIENT-EVIDENCE";
}

/**
 * Get the reason codes for a derived D-outcome.
 */
export function getDerivationReasonCodes(
  _checkId: string,
  vector: EvaluationVector,
  outcome: DOutcome,
): string[] {
  const codes: string[] = [`derived:${outcome}`];

  if (!vector.sameSubject) codes.push("different-subject");
  if (!vector.samePeriod) codes.push("different-period");
  if (!vector.sameScenario) codes.push("different-scenario");
  if (!vector.sameBasis) codes.push("different-basis");
  if (!vector.sameAttribution) codes.push("different-attribution");
  if (!vector.sameScope) codes.push("different-scope");
  if (!vector.qualifiersCompatible) codes.push("different-qualifiers");
  if (vector.valuesAgree === false) codes.push("values-disagree");
  if (!vector.unitsCompatible) codes.push("units-incompatible");

  return codes;
}
