/**
 * Hard gates (R4, original §24).
 *
 * Two sets of gates:
 * - Before System One: terminate proven non-comparability and proven
 *   non-conflict, avoiding model calls entirely.
 * - After System One: apply completed E-answers and enforce that
 *   the model's answers do not contradict proven facts.
 *
 * These gates are the "prove everything provable before any
 * decision call" and "never let the model override proven facts"
 * rules.
 */

import type { NormalisedClaim } from "../normalisation";
import type { ConsistencyCheckId } from "../contracts";
import type { ClaimPairDiff } from "./claimPairDiff";
import { evaluationProfile } from "./evaluationProfiles";
import { runComparabilityGates } from "./deterministicEvaluationResolver";
import { attributionKey } from "../checks/primitives";

/** Result of running the pre-model hard gates. */
export interface PreModelGateResult {
  /** Whether the candidate should proceed to the model. */
  readonly proceedToModel: boolean;
  /** If not proceeding, the final state. */
  readonly state: "consistent" | "not_comparable" | null;
  /** Reason codes for the gate decision. */
  readonly reasonCodes: readonly string[];
}

/** Result of running the post-model hard gates. */
export interface PostModelGateResult {
  /** Whether the model's answers are accepted. */
  readonly accept: boolean;
  /** If rejected, the override state. */
  readonly overrideState: "consistent" | "conflict" | "not_comparable" | null;
  /** Reason codes for the gate decision. */
  readonly reasonCodes: readonly string[];
}

/**
 * Run the pre-model hard gates for a candidate.
 *
 * These are the "Before System One" gates from §24. They
 * terminate proven non-comparability and proven non-conflict
 * before any model call.
 */
export function runPreModelGates(
  claims: readonly NormalisedClaim[],
  checkId: ConsistencyCheckId,
  diff: ClaimPairDiff,
): PreModelGateResult {
  // Reuse the comparability gates from the deterministic resolver
  const gateResult = runComparabilityGates(claims, checkId, diff);
  if (gateResult !== null) {
    return {
      proceedToModel: false,
      state: gateResult.state,
      reasonCodes: gateResult.reasonCodes,
    };
  }

  // Check if the profile has any hard gates that apply
  const profile = evaluationProfile(checkId);
  const applicableGates = profile.hardGates.filter((gate) => gateApplies(gate, claims));

  if (applicableGates.length > 0) {
    return {
      proceedToModel: false,
      state: "not_comparable",
      reasonCodes: applicableGates,
    };
  }

  return { proceedToModel: true, state: null, reasonCodes: [] };
}

/**
 * Run the post-model hard gates for a candidate.
 *
 * These are the "After System One" gates from §24. They
 * apply completed E-answers and enforce that the model's
 * answers do not contradict proven facts.
 */
export function runPostModelGates(
  _claims: readonly NormalisedClaim[],
  checkId: ConsistencyCheckId,
  modelAnswers: readonly { question: string; holds: boolean; reason: string }[],
  deterministicAnswers: readonly { question: string; holds: boolean; reason: string }[],
): PostModelGateResult {
  const reasonCodes: string[] = [];

  // Gate: model must not contradict a proven fact
  for (const det of deterministicAnswers) {
    const model = modelAnswers.find((m) => m.question === det.question);
    if (model !== undefined && model.holds !== det.holds) {
      // Model contradicts a proven fact — reject the model's answer
      // If the proven fact holds (e.g., values ARE incompatible), override is conflict.
      // If the proven fact doesn't hold (e.g., values are equivalent), override is consistent.
      reasonCodes.push(`model-contradicts-proven:${det.question}`);
      return {
        accept: false,
        overrideState: det.holds ? "conflict" : "consistent",
        reasonCodes,
      };
    }
  }

  // Gate: if all relevant E-questions are answered and no conflict, consistent
  const profile = evaluationProfile(checkId);
  const allRelevantAnswered = profile.relevantEQuestions.every(
    (q) =>
      modelAnswers.some((m) => m.question === q) ||
      deterministicAnswers.some((d) => d.question === q),
  );

  if (allRelevantAnswered) {
    const anyConflict =
      modelAnswers.some((m) => m.holds && isConflictQuestion(m.question)) ||
      deterministicAnswers.some((d) => d.holds && isConflictQuestion(d.question));
    if (!anyConflict) {
      return {
        accept: true,
        overrideState: "consistent",
        reasonCodes: ["all-questions-answered-no-conflict"],
      };
    }
  }

  return { accept: true, overrideState: null, reasonCodes: [] };
}

/** Check if a hard gate applies to the given claims. */
function gateApplies(gate: string, claims: readonly NormalisedClaim[]): boolean {
  const [left, right] = claims;
  if (left === undefined || right === undefined) return false;

  switch (gate) {
    case "different-scenario": {
      const leftScenario = left.claim.scenario?.type;
      const rightScenario = right.claim.scenario?.type;
      return (
        leftScenario !== undefined && rightScenario !== undefined && leftScenario !== rightScenario
      );
    }
    case "different-attribution-domain": {
      const leftAttribution = attributionKey(left.claim);
      const rightAttribution = attributionKey(right.claim);
      return leftAttribution !== rightAttribution;
    }
    case "different-valuation-period": {
      const leftValuation = left.claim.quantum?.valuationPeriod;
      const rightValuation = right.claim.quantum?.valuationPeriod;
      if (leftValuation === undefined || rightValuation === undefined) return false;
      const leftStart = leftValuation.start?.iso ?? leftValuation.start?.raw ?? "";
      const rightStart = rightValuation.start?.iso ?? rightValuation.start?.raw ?? "";
      const leftEnd = leftValuation.end?.iso ?? leftValuation.end?.raw ?? "";
      const rightEnd = rightValuation.end?.iso ?? rightValuation.end?.raw ?? "";
      return leftStart !== rightStart || leftEnd !== rightEnd;
    }
    case "different-programme-basis": {
      const leftProgrammes = new Set(left.claim.programmeIds);
      const rightProgrammes = new Set(right.claim.programmeIds);
      const sharedProgrammes = [...leftProgrammes].filter((id) => rightProgrammes.has(id));
      return leftProgrammes.size > 0 && rightProgrammes.size > 0 && sharedProgrammes.length === 0;
    }
    case "forecast-vs-actual": {
      const leftForecast = left.claim.temporal.forecastDate;
      const rightData = right.claim.temporal.dataDate;
      const rightForecast = right.claim.temporal.forecastDate;
      const leftData = left.claim.temporal.dataDate;
      return (
        (leftForecast !== undefined && rightData !== undefined) ||
        (rightForecast !== undefined && leftData !== undefined)
      );
    }
    case "different-measurement-basis": {
      const leftMethod = left.claim.delay?.analysisMethod;
      const rightMethod = right.claim.delay?.analysisMethod;
      return leftMethod !== undefined && rightMethod !== undefined && leftMethod !== rightMethod;
    }
    case "entity-or-event-mismatch": {
      const sharedEntities = left.claim.subjectIds.filter((id) =>
        right.claim.subjectIds.includes(id),
      );
      const sharedEvents = left.claim.eventIds.filter((id) => right.claim.eventIds.includes(id));
      const hasEntities = left.claim.subjectIds.length > 0 && right.claim.subjectIds.length > 0;
      const hasEvents = left.claim.eventIds.length > 0 && right.claim.eventIds.length > 0;
      return (
        (hasEntities && sharedEntities.length === 0) || (hasEvents && sharedEvents.length === 0)
      );
    }
    case "insufficient-evidence": {
      return left.claim.evidence === undefined || right.claim.evidence === undefined;
    }
    case "unresolved-source-evidence": {
      return left.claim.evidenceBasis.length === 0 && right.claim.evidenceBasis.length === 0;
    }
    default:
      return false;
  }
}

/** Whether an E-question represents a conflict when it holds. */
function isConflictQuestion(question: string): boolean {
  return [
    "E-VALUE-INCOMPATIBLE",
    "E-STATUS-MUTUALLY-EXCLUSIVE",
    "E-DEFINITION-INCOMPATIBLE",
    "E-CRITICALITY-INCOMPATIBLE",
    "E-SUBSTANTIVE-CONFLICT",
  ].includes(question);
}
