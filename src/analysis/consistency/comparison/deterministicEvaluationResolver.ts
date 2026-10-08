/**
 * Deterministic E-resolver (R4, original §16).
 *
 * Answers every provable E-question without a model call.
 * Only genuinely semantic questions remain unresolved and
 * reach the decision model. This is the "prove everything
 * provable before any decision call" stage.
 *
 * The resolver is deterministic: same claims in, same
 * resolution out. It never calls a provider.
 */

import type { ConsistencyCandidate, ConsistencyCheckId } from "../contracts";
import type { NormalisedClaim } from "../normalisation";
import {
  buildClaimPairDiff,
  compareDatesByRole,
  compareValues,
  type ClaimPairDiff,
} from "./claimPairDiff";
import { attributionKey } from "../checks/primitives";
import { isExclusiveStatePair } from "../checks/primitives";

/**
 * The E-questions the resolver can answer (original §13).
 *
 * Each question has exactly one defined meaning. The resolver
 * answers the ones it can prove deterministically; the rest
 * stay unresolved for the decision model.
 */
export const E_QUESTIONS = [
  "E-ENTITY-SAME",
  "E-EVENT-SAME",
  "E-PREDICATE-COMPARABLE",
  "E-SCOPE-SAME",
  "E-SCENARIO-SAME",
  "E-ATTRIBUTION-COMPATIBLE",
  "E-MODALITY-COMPATIBLE",
  "E-TEMPORAL-COMPARABLE",
  "E-BASIS-SAME",
  "E-VALUE-INCOMPATIBLE",
  "E-QUALIFIER-RECONCILES",
  "E-EVIDENCE-SUFFICIENT",
  "E-UPDATE-SUPERSEDES",
  "E-PROGRAMME-BASIS-SAME",
  "E-DATA-DATE-COMPARABLE",
  "E-ANALYSIS-WINDOW-SAME",
  "E-CRITICALITY-INCOMPATIBLE",
  "E-CONCURRENCY-RECONCILES",
  "E-MEASUREMENT-BASIS-SAME",
  "E-VALUATION-PERIOD-SAME",
  "E-CURRENCY-COMPATIBLE",
  "E-INCLUSIONS-SAME",
  "E-DEFINITION-INCOMPATIBLE",
  "E-REFERENCE-SUPPORTS-CLAIM",
  "E-STATUS-MUTUALLY-EXCLUSIVE",
  "E-SECTION-FULFILS-PROMISE",
  "E-SCOPE-EXCEPTION",
  "E-SUBSTANTIVE-CONFLICT",
] as const;

export type EQuestion = (typeof E_QUESTIONS)[number];

/** One answered E-question. */
export interface EAnswer {
  readonly question: EQuestion;
  /** True when the resolver proved the proposition holds. */
  readonly holds: boolean;
  /** Why the resolver concluded what it did. */
  readonly reason: string;
}

/** One E-question the resolver could not answer. */
export interface EUnresolved {
  readonly question: EQuestion;
  /** Why the resolver could not answer it. */
  readonly reason: string;
}

/** The deterministic resolution of one candidate. */
export interface DeterministicResolution {
  readonly candidateId: string;
  readonly checkId: ConsistencyCheckId;
  /** The diff between the candidate's claims, when it has a pair. */
  readonly diff: ClaimPairDiff | null;
  /** E-questions the resolver answered. */
  readonly answers: readonly EAnswer[];
  /** E-questions the resolver could not answer. */
  readonly unresolved: readonly EUnresolved[];
  /** The classification after gates and answers. */
  readonly state: "consistent" | "conflict" | "unresolved" | "not_comparable";
  /** Reason codes for the classification. */
  readonly reasonCodes: readonly string[];
}

/**
 * Resolve one candidate deterministically.
 *
 * The candidate's claims are already normalised and indexed.
 * The resolver compares them, answers every provable E-question,
 * runs the comparability gates, and classifies the candidate.
 *
 * A candidate with fewer than two claims cannot be compared and
 * is classified `not_comparable` — there is nothing to contradict.
 */
export function resolveCandidate(
  candidate: ConsistencyCandidate,
  claims: readonly NormalisedClaim[],
): DeterministicResolution {
  const claimIds = candidate.claimIds;
  const byId = new Map(claims.map((c) => [c.claim.id, c]));
  const resolved: NormalisedClaim[] = [];
  claimIds.forEach((id) => {
    const claim = byId.get(id);
    if (claim !== undefined) resolved.push(claim);
  });

  if (resolved.length < 2) {
    return {
      candidateId: candidate.id,
      checkId: candidate.checkId,
      diff: null,
      answers: [],
      unresolved: [],
      state: "not_comparable",
      reasonCodes: ["insufficient-claims"],
    };
  }

  // Build the diff between the first two claims (the primary pair).
  // Additional claims are compared pairwise in the engine's comparison loop.
  const diff = buildClaimPairDiff(resolved[0]!.claim, resolved[1]!.claim);

  // Answer every provable E-question.
  const answers: EAnswer[] = [];
  const unresolved: EUnresolved[] = [];
  answerEQuestions(resolved, candidate.checkId, answers, unresolved);

  // Run the comparability gates.
  const gateResult = runComparabilityGates(resolved, candidate.checkId, diff);
  if (gateResult !== null) {
    return {
      candidateId: candidate.id,
      checkId: candidate.checkId,
      diff,
      answers,
      unresolved,
      state: gateResult.state,
      reasonCodes: gateResult.reasonCodes,
    };
  }

  // Classify from the answers.
  return classify(candidate.id, candidate.checkId, diff, answers, unresolved);
}

/**
 * Answer every E-question the resolver can prove.
 *
 * The resolver answers questions about identity, comparability,
 * and deterministic contradiction. Questions that require
 * semantic judgement stay unresolved.
 */
function answerEQuestions(
  claims: readonly NormalisedClaim[],
  checkId: ConsistencyCheckId,
  answers: EAnswer[],
  unresolved: EUnresolved[],
): void {
  const [left, right] = claims;
  if (left === undefined || right === undefined) return;

  // E-ENTITY-SAME: shared entity IDs
  const sharedEntities = left.claim.subjectIds.filter((id) => right.claim.subjectIds.includes(id));
  if (sharedEntities.length > 0) {
    answers.push({
      question: "E-ENTITY-SAME",
      holds: true,
      reason: `shared entity IDs: ${sharedEntities.join(", ")}`,
    });
  } else if (left.claim.subjectIds.length > 0 && right.claim.subjectIds.length > 0) {
    answers.push({
      question: "E-ENTITY-SAME",
      holds: false,
      reason: "disjoint entity IDs",
    });
  } else {
    unresolved.push({
      question: "E-ENTITY-SAME",
      reason: "one or both claims lack entity IDs",
    });
  }

  // E-EVENT-SAME: shared event IDs
  const sharedEvents = left.claim.eventIds.filter((id) => right.claim.eventIds.includes(id));
  if (sharedEvents.length > 0) {
    answers.push({
      question: "E-EVENT-SAME",
      holds: true,
      reason: `shared event IDs: ${sharedEvents.join(", ")}`,
    });
  } else if (left.claim.eventIds.length > 0 && right.claim.eventIds.length > 0) {
    answers.push({
      question: "E-EVENT-SAME",
      holds: false,
      reason: "disjoint event IDs",
    });
  } else {
    unresolved.push({
      question: "E-EVENT-SAME",
      reason: "one or both claims lack event IDs",
    });
  }

  // E-PREDICATE-COMPARABLE: predicates are comparable when they share content words
  const leftWords = new Set(contentWords(left.claim.predicate.text));
  const rightWords = new Set(contentWords(right.claim.predicate.text));
  const sharedWords = [...leftWords].filter((w) => rightWords.has(w));
  if (sharedWords.length > 0) {
    answers.push({
      question: "E-PREDICATE-COMPARABLE",
      holds: true,
      reason: `shared predicate words: ${sharedWords.join(", ")}`,
    });
  } else {
    unresolved.push({
      question: "E-PREDICATE-COMPARABLE",
      reason: "predicates share no content words",
    });
  }

  // E-SCOPE-SAME: scope kind
  const leftScope = left.claim.scope.kind;
  const rightScope = right.claim.scope.kind;
  if (leftScope !== "unknown" && rightScope !== "unknown") {
    answers.push({
      question: "E-SCOPE-SAME",
      holds: leftScope === rightScope,
      reason:
        leftScope === rightScope
          ? `both claims have scope ${leftScope}`
          : `scope kinds differ: ${leftScope} vs ${rightScope}`,
    });
  } else {
    unresolved.push({
      question: "E-SCOPE-SAME",
      reason: "one or both claims have unknown scope",
    });
  }

  // E-SCENARIO-SAME: scenario type
  const leftScenario = left.claim.scenario?.type;
  const rightScenario = right.claim.scenario?.type;
  if (leftScenario !== undefined && rightScenario !== undefined) {
    answers.push({
      question: "E-SCENARIO-SAME",
      holds: leftScenario === rightScenario,
      reason:
        leftScenario === rightScenario
          ? `both claims in scenario ${leftScenario}`
          : `scenarios differ: ${leftScenario} vs ${rightScenario}`,
    });
  } else {
    unresolved.push({
      question: "E-SCENARIO-SAME",
      reason: "one or both claims lack scenario type",
    });
  }

  // E-ATTRIBUTION-COMPATIBLE: speaker and attributedTo
  const leftAttribution = attributionKey(left.claim);
  const rightAttribution = attributionKey(right.claim);
  answers.push({
    question: "E-ATTRIBUTION-COMPATIBLE",
    holds: leftAttribution === rightAttribution,
    reason:
      leftAttribution === rightAttribution
        ? "same attribution"
        : `attribution differs: ${leftAttribution} vs ${rightAttribution}`,
  });

  // E-MODALITY-COMPATIBLE: modality
  const leftModality = left.claim.modality;
  const rightModality = right.claim.modality;
  if (leftModality !== "unknown" && rightModality !== "unknown") {
    answers.push({
      question: "E-MODALITY-COMPATIBLE",
      holds: leftModality === rightModality,
      reason:
        leftModality === rightModality
          ? `both claims have modality ${leftModality}`
          : `modalities differ: ${leftModality} vs ${rightModality}`,
    });
  } else {
    unresolved.push({
      question: "E-MODALITY-COMPATIBLE",
      reason: "one or both claims have unknown modality",
    });
  }

  // E-TEMPORAL-COMPARABLE: dates in the same role
  const temporalAnswer = answerTemporalComparability(left, right);
  if (temporalAnswer !== null) {
    answers.push(temporalAnswer);
  } else {
    unresolved.push({
      question: "E-TEMPORAL-COMPARABLE",
      reason: "no shared temporal role with dates on both sides",
    });
  }

  // E-BASIS-SAME: contractual basis
  const leftBasis = left.claim.contractualBasis?.map((b) => b.reference).join(", ") ?? "";
  const rightBasis = right.claim.contractualBasis?.map((b) => b.reference).join(", ") ?? "";
  if (leftBasis && rightBasis) {
    answers.push({
      question: "E-BASIS-SAME",
      holds: leftBasis === rightBasis,
      reason:
        leftBasis === rightBasis
          ? `same contractual basis: ${leftBasis}`
          : `basis differs: ${leftBasis} vs ${rightBasis}`,
    });
  } else {
    unresolved.push({
      question: "E-BASIS-SAME",
      reason: "one or both claims lack contractual basis",
    });
  }

  // E-VALUE-INCOMPATIBLE: values with unit conversion
  const valueAnswer = answerValueIncompatibility(left, right);
  if (valueAnswer !== null) {
    answers.push(valueAnswer);
  } else {
    unresolved.push({
      question: "E-VALUE-INCOMPATIBLE",
      reason: "one or both claims lack normalised values",
    });
  }

  // E-QUALIFIER-RECONCILES: qualifiers
  const leftQualifiers = left.claim.qualifiers.map((q) => q.text).join("; ");
  const rightQualifiers = right.claim.qualifiers.map((q) => q.text).join("; ");
  if (leftQualifiers && rightQualifiers) {
    answers.push({
      question: "E-QUALIFIER-RECONCILES",
      holds: leftQualifiers === rightQualifiers,
      reason:
        leftQualifiers === rightQualifiers
          ? "identical qualifiers"
          : `qualifiers differ: ${leftQualifiers} vs ${rightQualifiers}`,
    });
  } else {
    unresolved.push({
      question: "E-QUALIFIER-RECONCILES",
      reason: "one or both claims lack qualifiers",
    });
  }

  // E-EVIDENCE-SUFFICIENT: both claims have evidence anchors
  if (left.claim.evidence !== undefined && right.claim.evidence !== undefined) {
    answers.push({
      question: "E-EVIDENCE-SUFFICIENT",
      holds: true,
      reason: "both claims have evidence anchors",
    });
  } else {
    unresolved.push({
      question: "E-EVIDENCE-SUFFICIENT",
      reason: "one or both claims lack evidence anchors",
    });
  }

  // E-UPDATE-SUPERSEDES: adoption status
  const leftAdoption = left.claim.adoptionStatus;
  const rightAdoption = right.claim.adoptionStatus;
  if (leftAdoption !== "unknown" && rightAdoption !== "unknown") {
    answers.push({
      question: "E-UPDATE-SUPERSEDES",
      holds: leftAdoption === rightAdoption,
      reason:
        leftAdoption === rightAdoption
          ? `both claims have adoption ${leftAdoption}`
          : `adoption differs: ${leftAdoption} vs ${rightAdoption}`,
    });
  } else {
    unresolved.push({
      question: "E-UPDATE-SUPERSEDES",
      reason: "one or both claims have unknown adoption status",
    });
  }

  // E-PROGRAMME-BASIS-SAME: programme IDs
  const sharedProgrammes = left.claim.programmeIds.filter((id) =>
    right.claim.programmeIds.includes(id),
  );
  if (sharedProgrammes.length > 0) {
    answers.push({
      question: "E-PROGRAMME-BASIS-SAME",
      holds: true,
      reason: `shared programme IDs: ${sharedProgrammes.join(", ")}`,
    });
  } else if (left.claim.programmeIds.length > 0 && right.claim.programmeIds.length > 0) {
    answers.push({
      question: "E-PROGRAMME-BASIS-SAME",
      holds: false,
      reason: "disjoint programme IDs",
    });
  } else {
    unresolved.push({
      question: "E-PROGRAMME-BASIS-SAME",
      reason: "one or both claims lack programme IDs",
    });
  }

  // E-DATA-DATE-COMPARABLE: dataDate role
  const dataDateAnswer = answerDataDateComparability(left, right);
  if (dataDateAnswer !== null) {
    answers.push(dataDateAnswer);
  } else {
    unresolved.push({
      question: "E-DATA-DATE-COMPARABLE",
      reason: "one or both claims lack data dates",
    });
  }

  // E-ANALYSIS-WINDOW-SAME: delay analysis window
  const analysisWindowAnswer = answerAnalysisWindow(left, right);
  if (analysisWindowAnswer !== null) {
    answers.push(analysisWindowAnswer);
  } else {
    unresolved.push({
      question: "E-ANALYSIS-WINDOW-SAME",
      reason: "one or both claims lack analysis windows",
    });
  }

  // E-CRITICALITY-INCOMPATIBLE: delay criticality
  const leftCriticality = left.claim.delay?.criticality;
  const rightCriticality = right.claim.delay?.criticality;
  if (leftCriticality !== undefined && rightCriticality !== undefined) {
    answers.push({
      question: "E-CRITICALITY-INCOMPATIBLE",
      holds: leftCriticality !== rightCriticality,
      reason:
        leftCriticality === rightCriticality
          ? `both claims have criticality ${leftCriticality}`
          : `criticality differs: ${leftCriticality} vs ${rightCriticality}`,
    });
  } else {
    unresolved.push({
      question: "E-CRITICALITY-INCOMPATIBLE",
      reason: "one or both claims lack criticality",
    });
  }

  // E-CONCURRENCY-RECONCILES: delay concurrency
  const leftConcurrency = left.claim.delay?.concurrency;
  const rightConcurrency = right.claim.delay?.concurrency;
  if (leftConcurrency !== undefined && rightConcurrency !== undefined) {
    answers.push({
      question: "E-CONCURRENCY-RECONCILES",
      holds: leftConcurrency === rightConcurrency,
      reason:
        leftConcurrency === rightConcurrency
          ? `both claims have concurrency ${leftConcurrency}`
          : `concurrency differs: ${leftConcurrency} vs ${rightConcurrency}`,
    });
  } else {
    unresolved.push({
      question: "E-CONCURRENCY-RECONCILES",
      reason: "one or both claims lack concurrency",
    });
  }

  // E-MEASUREMENT-BASIS-SAME: delay analysis method
  const leftMethod = left.claim.delay?.analysisMethod;
  const rightMethod = right.claim.delay?.analysisMethod;
  if (leftMethod !== undefined && rightMethod !== undefined) {
    answers.push({
      question: "E-MEASUREMENT-BASIS-SAME",
      holds: leftMethod === rightMethod,
      reason:
        leftMethod === rightMethod
          ? `both claims use method ${leftMethod}`
          : `methods differ: ${leftMethod} vs ${rightMethod}`,
    });
  } else {
    unresolved.push({
      question: "E-MEASUREMENT-BASIS-SAME",
      reason: "one or both claims lack analysis method",
    });
  }

  // E-VALUATION-PERIOD-SAME: quantum valuation period
  const valuationPeriodAnswer = answerValuationPeriod(left, right);
  if (valuationPeriodAnswer !== null) {
    answers.push(valuationPeriodAnswer);
  } else {
    unresolved.push({
      question: "E-VALUATION-PERIOD-SAME",
      reason: "one or both claims lack valuation periods",
    });
  }

  // E-CURRENCY-COMPATIBLE: currency
  const leftCurrency = left.claim.values[0]?.currency ?? left.claim.quantum?.currency;
  const rightCurrency = right.claim.values[0]?.currency ?? right.claim.quantum?.currency;
  if (leftCurrency !== undefined && rightCurrency !== undefined) {
    answers.push({
      question: "E-CURRENCY-COMPATIBLE",
      holds: leftCurrency === rightCurrency,
      reason:
        leftCurrency === rightCurrency
          ? `both claims in currency ${leftCurrency}`
          : `currencies differ: ${leftCurrency} vs ${rightCurrency}`,
    });
  } else {
    unresolved.push({
      question: "E-CURRENCY-COMPATIBLE",
      reason: "one or both claims lack currency",
    });
  }

  // E-INCLUSIONS-SAME: quantum inclusions (gross/net/tax/overhead/profit)
  const inclusionsAnswer = answerInclusions(left, right);
  if (inclusionsAnswer !== null) {
    answers.push(inclusionsAnswer);
  } else {
    unresolved.push({
      question: "E-INCLUSIONS-SAME",
      reason: "one or both claims lack quantum inclusions",
    });
  }

  // E-DEFINITION-INCOMPATIBLE: C5 only, semantic
  if (checkId === "C5") {
    unresolved.push({
      question: "E-DEFINITION-INCOMPATIBLE",
      reason: "definition compatibility requires semantic judgement",
    });
  }

  // E-REFERENCE-SUPPORTS-CLAIM: C8 only, semantic
  if (checkId === "C8") {
    unresolved.push({
      question: "E-REFERENCE-SUPPORTS-CLAIM",
      reason: "reference support requires semantic judgement",
    });
  }

  // E-STATUS-MUTUALLY-EXCLUSIVE: C7, deterministic from exclusive states
  const statusAnswer = answerStatusMutuallyExclusive(left, right);
  if (statusAnswer !== null) {
    answers.push(statusAnswer);
  } else {
    unresolved.push({
      question: "E-STATUS-MUTUALLY-EXCLUSIVE",
      reason: "claims do not carry comparable status words",
    });
  }

  // E-SECTION-FULFILS-PROMISE: C9 only, semantic
  if (checkId === "C9") {
    unresolved.push({
      question: "E-SECTION-FULFILS-PROMISE",
      reason: "section fulfilment requires semantic judgement",
    });
  }

  // E-SCOPE-EXCEPTION: C10, deterministic from scope kind
  const scopeExceptionAnswer = answerScopeException(left, right);
  if (scopeExceptionAnswer !== null) {
    answers.push(scopeExceptionAnswer);
  } else {
    unresolved.push({
      question: "E-SCOPE-EXCEPTION",
      reason: "claims do not carry comparable scope kinds",
    });
  }

  // E-SUBSTANTIVE-CONFLICT: derived from other answers
  const substantiveConflict = answers.some(
    (a) =>
      (a.question === "E-VALUE-INCOMPATIBLE" && a.holds) ||
      (a.question === "E-STATUS-MUTUALLY-EXCLUSIVE" && a.holds) ||
      (a.question === "E-DEFINITION-INCOMPATIBLE" && a.holds) ||
      (a.question === "E-CRITICALITY-INCOMPATIBLE" && a.holds),
  );
  answers.push({
    question: "E-SUBSTANTIVE-CONFLICT",
    holds: substantiveConflict,
    reason: substantiveConflict
      ? "a substantive incompatibility was proven"
      : "no substantive incompatibility was proven",
  });
}

/** Answer E-TEMPORAL-COMPARABLE from shared temporal roles. */
function answerTemporalComparability(
  left: NormalisedClaim,
  right: NormalisedClaim,
): EAnswer | null {
  const leftRoles = new Map(left.dates.map((d) => [d.role, d.date]));
  const rightRoles = new Map(right.dates.map((d) => [d.role, d.date]));
  const sharedRoles = [...leftRoles.keys()].filter((role) => rightRoles.has(role));
  if (sharedRoles.length === 0) return null;
  // Every shared role is compared, not just the first: a conflict in any role
  // is a conflict, and a role that cannot be compared only makes the facet
  // incomparable when no role actually conflicts.
  const comparisons = sharedRoles.map((role) => ({
    role,
    comparison: compareDatesByRole(leftRoles.get(role)!, rightRoles.get(role)!),
  }));
  const conflict = comparisons.find((entry) => entry.comparison === "conflict");
  if (conflict !== undefined) {
    return {
      question: "E-TEMPORAL-COMPARABLE",
      holds: false,
      reason: `dates in role ${conflict.role} conflict`,
    };
  }
  const incomparable = comparisons.find((entry) => entry.comparison === "incomparable");
  if (incomparable !== undefined) {
    return {
      question: "E-TEMPORAL-COMPARABLE",
      holds: true,
      reason: `dates in role ${incomparable.role} are incomparable (coarse vs precise)`,
    };
  }
  return {
    question: "E-TEMPORAL-COMPARABLE",
    holds: true,
    reason: `dates in shared roles (${sharedRoles.join(", ")}) are the same`,
  };
}

/** Answer E-DATA-DATE-COMPARABLE from the dataDate role. */
function answerDataDateComparability(
  left: NormalisedClaim,
  right: NormalisedClaim,
): EAnswer | null {
  const leftData = left.dates.find((d) => d.role === "dataDate");
  const rightData = right.dates.find((d) => d.role === "dataDate");
  if (leftData === undefined || rightData === undefined) return null;
  const comparison = compareDatesByRole(leftData.date, rightData.date);
  return {
    question: "E-DATA-DATE-COMPARABLE",
    holds: comparison !== "conflict",
    reason:
      comparison === "same"
        ? "data dates are the same"
        : comparison === "conflict"
          ? "data dates conflict"
          : "data dates are incomparable (coarse vs precise)",
  };
}

/** Answer E-ANALYSIS-WINDOW-SAME from delay analysis windows. */
function answerAnalysisWindow(left: NormalisedClaim, right: NormalisedClaim): EAnswer | null {
  const leftWindow = left.claim.delay?.analysisWindow;
  const rightWindow = right.claim.delay?.analysisWindow;
  if (leftWindow === undefined || rightWindow === undefined) return null;
  const leftStart = leftWindow.start?.iso ?? leftWindow.start?.raw ?? "";
  const rightStart = rightWindow.start?.iso ?? rightWindow.start?.raw ?? "";
  const leftEnd = leftWindow.end?.iso ?? leftWindow.end?.raw ?? "";
  const rightEnd = rightWindow.end?.iso ?? rightWindow.end?.raw ?? "";
  const same = leftStart === rightStart && leftEnd === rightEnd;
  return {
    question: "E-ANALYSIS-WINDOW-SAME",
    holds: same,
    reason: same
      ? "analysis windows are the same"
      : `analysis windows differ: ${leftStart}..${leftEnd} vs ${rightStart}..${rightEnd}`,
  };
}

/** Answer E-VALUATION-PERIOD-SAME from quantum valuation periods. */
function answerValuationPeriod(left: NormalisedClaim, right: NormalisedClaim): EAnswer | null {
  const leftPeriod = left.claim.quantum?.valuationPeriod;
  const rightPeriod = right.claim.quantum?.valuationPeriod;
  if (leftPeriod === undefined || rightPeriod === undefined) return null;
  const leftStart = leftPeriod.start?.iso ?? leftPeriod.start?.raw ?? "";
  const rightStart = rightPeriod.start?.iso ?? rightPeriod.start?.raw ?? "";
  const leftEnd = leftPeriod.end?.iso ?? leftPeriod.end?.raw ?? "";
  const rightEnd = rightPeriod.end?.iso ?? rightPeriod.end?.raw ?? "";
  const same = leftStart === rightStart && leftEnd === rightEnd;
  return {
    question: "E-VALUATION-PERIOD-SAME",
    holds: same,
    reason: same
      ? "valuation periods are the same"
      : `valuation periods differ: ${leftStart}..${leftEnd} vs ${rightStart}..${rightEnd}`,
  };
}

/** Answer E-INCLUSIONS-SAME from quantum inclusions. */
function answerInclusions(left: NormalisedClaim, right: NormalisedClaim): EAnswer | null {
  const leftQ = left.claim.quantum;
  const rightQ = right.claim.quantum;
  if (leftQ === undefined || rightQ === undefined) return null;
  const leftInclusions = [leftQ.gross, leftQ.net, leftQ.tax, leftQ.overhead, leftQ.profit];
  const rightInclusions = [rightQ.gross, rightQ.net, rightQ.tax, rightQ.overhead, rightQ.profit];
  const leftPresent = leftInclusions.some((v) => v !== undefined);
  const rightPresent = rightInclusions.some((v) => v !== undefined);
  if (!leftPresent || !rightPresent) return null;
  const same = leftInclusions.every((v, i) => v === rightInclusions[i]);
  return {
    question: "E-INCLUSIONS-SAME",
    holds: same,
    reason: same ? "quantum inclusions are the same" : "quantum inclusions differ",
  };
}

/** Answer E-STATUS-MUTUALLY-EXCLUSIVE from predicate content words. */
function answerStatusMutuallyExclusive(
  left: NormalisedClaim,
  right: NormalisedClaim,
): EAnswer | null {
  const leftWords = contentWords(left.claim.predicate.text);
  const rightWords = contentWords(right.claim.predicate.text);
  for (const lw of leftWords) {
    for (const rw of rightWords) {
      if (isExclusiveStatePair(lw, rw)) {
        return {
          question: "E-STATUS-MUTUALLY-EXCLUSIVE",
          holds: true,
          reason: `exclusive state pair: ${lw} vs ${rw}`,
        };
      }
    }
  }
  return null;
}

/** Answer E-SCOPE-EXCEPTION from scope kinds. */
function answerScopeException(left: NormalisedClaim, right: NormalisedClaim): EAnswer | null {
  const leftScope = left.claim.scope.kind;
  const rightScope = right.claim.scope.kind;
  if (leftScope === "unknown" || rightScope === "unknown") return null;
  // A universal claim and an exception claim are the C10 tension
  const isException =
    (leftScope === "universal" && rightScope === "exception") ||
    (leftScope === "exception" && rightScope === "universal");
  return {
    question: "E-SCOPE-EXCEPTION",
    holds: isException,
    reason: isException
      ? "one claim is universal and the other is an exception"
      : `scope kinds are ${leftScope} and ${rightScope}`,
  };
}

/** Answer E-VALUE-INCOMPATIBLE from normalised values with unit conversion. */
function answerValueIncompatibility(left: NormalisedClaim, right: NormalisedClaim): EAnswer | null {
  const leftValues = left.values.filter((v) => v.normalized !== undefined);
  const rightValues = right.values.filter((v) => v.normalized !== undefined);
  if (leftValues.length === 0 || rightValues.length === 0) return null;
  // Every comparable pair is examined, not just the first: a difference in any
  // pair is a difference, and incompatible units only make the facet
  // incomparable when no pair actually differs.
  const comparisons = leftValues.flatMap((leftValue) =>
    rightValues.map((rightValue) => compareValues(leftValue, rightValue)),
  );
  const comparable = comparisons.filter((comparison) => comparison !== "unrelated");
  if (comparable.length === 0) return null;
  if (comparable.includes("differs")) {
    return {
      question: "E-VALUE-INCOMPATIBLE",
      holds: true,
      reason: "values differ after unit conversion",
    };
  }
  if (comparable.includes("incomparable")) {
    return {
      question: "E-VALUE-INCOMPATIBLE",
      holds: false,
      reason: "values are incomparable (incompatible units)",
    };
  }
  return {
    question: "E-VALUE-INCOMPATIBLE",
    holds: false,
    reason: "values are equivalent after unit conversion",
  };
}

/**
 * Run the comparability gates (original §24, before System One).
 *
 * These gates terminate proven non-comparability and proven
 * non-conflict before any model call. If a gate fires, the
 * candidate is classified immediately.
 */
export function runComparabilityGates(
  claims: readonly NormalisedClaim[],
  _checkId: ConsistencyCheckId,
  diff: ClaimPairDiff,
): { state: "consistent" | "not_comparable"; reasonCodes: string[] } | null {
  const [left, right] = claims;
  if (left === undefined || right === undefined) return null;

  // Gate: different scenario → not comparable
  const leftScenario = left.claim.scenario?.type;
  const rightScenario = right.claim.scenario?.type;
  if (leftScenario !== undefined && rightScenario !== undefined && leftScenario !== rightScenario) {
    return {
      state: "not_comparable",
      reasonCodes: [`different-scenario:${leftScenario}-vs-${rightScenario}`],
    };
  }

  // Gate: different attribution domain → not comparable
  const leftAttribution = attributionKey(left.claim);
  const rightAttribution = attributionKey(right.claim);
  if (leftAttribution !== rightAttribution) {
    return {
      state: "not_comparable",
      reasonCodes: ["different-attribution-domain"],
    };
  }

  // Gate: different valuation period → not comparable
  const leftValuation = left.claim.quantum?.valuationPeriod;
  const rightValuation = right.claim.quantum?.valuationPeriod;
  if (leftValuation !== undefined && rightValuation !== undefined) {
    const leftStart = leftValuation.start?.iso ?? leftValuation.start?.raw ?? "";
    const rightStart = rightValuation.start?.iso ?? rightValuation.start?.raw ?? "";
    const leftEnd = leftValuation.end?.iso ?? leftValuation.end?.raw ?? "";
    const rightEnd = rightValuation.end?.iso ?? rightValuation.end?.raw ?? "";
    if (leftStart !== rightStart || leftEnd !== rightEnd) {
      return {
        state: "not_comparable",
        reasonCodes: ["different-valuation-period"],
      };
    }
  }

  // Gate: different programme basis → not comparable
  const leftProgrammes = new Set(left.claim.programmeIds);
  const rightProgrammes = new Set(right.claim.programmeIds);
  const sharedProgrammes = [...leftProgrammes].filter((id) => rightProgrammes.has(id));
  if (leftProgrammes.size > 0 && rightProgrammes.size > 0 && sharedProgrammes.length === 0) {
    return {
      state: "not_comparable",
      reasonCodes: ["different-programme-basis"],
    };
  }

  // Gate: forecast vs actual → not comparable
  const leftForecast = left.dates.find((d) => d.role === "forecastDate");
  const rightData = right.dates.find((d) => d.role === "dataDate");
  const rightForecast = right.dates.find((d) => d.role === "forecastDate");
  const leftData = left.dates.find((d) => d.role === "dataDate");
  if (
    (leftForecast !== undefined && rightData !== undefined) ||
    (rightForecast !== undefined && leftData !== undefined)
  ) {
    return {
      state: "not_comparable",
      reasonCodes: ["forecast-vs-actual"],
    };
  }

  // Gate: different measurement basis → not comparable
  const leftMethod = left.claim.delay?.analysisMethod;
  const rightMethod = right.claim.delay?.analysisMethod;
  if (leftMethod !== undefined && rightMethod !== undefined && leftMethod !== rightMethod) {
    return {
      state: "not_comparable",
      reasonCodes: ["different-measurement-basis"],
    };
  }

  // Gate: entity/event mismatch → not comparable
  const sharedEntities = left.claim.subjectIds.filter((id) => right.claim.subjectIds.includes(id));
  const sharedEvents = left.claim.eventIds.filter((id) => right.claim.eventIds.includes(id));
  const hasEntities = left.claim.subjectIds.length > 0 && right.claim.subjectIds.length > 0;
  const hasEvents = left.claim.eventIds.length > 0 && right.claim.eventIds.length > 0;
  if ((hasEntities && sharedEntities.length === 0) || (hasEvents && sharedEvents.length === 0)) {
    return {
      state: "not_comparable",
      reasonCodes: ["entity-or-event-mismatch"],
    };
  }

  // Gate: insufficient evidence → not comparable
  if (left.claim.evidence === undefined || right.claim.evidence === undefined) {
    return {
      state: "not_comparable",
      reasonCodes: ["insufficient-evidence"],
    };
  }

  // Gate: unresolved source evidence → not comparable
  // (claims with no evidence anchors at all)
  if (left.claim.evidenceBasis.length === 0 && right.claim.evidenceBasis.length === 0) {
    return {
      state: "not_comparable",
      reasonCodes: ["unresolved-source-evidence"],
    };
  }

  // Gate: proven non-conflict — identical values, units, scenario, period, basis, attribution
  // (the "arithmetic, unit, scenario, period, forecast-versus-actual, attribution cases
  // never reach the decision model" acceptance criterion)
  const valueAnswer = answerValueIncompatibility(left, right);
  if (valueAnswer !== null && !valueAnswer.holds && valueAnswer.reason.includes("equivalent")) {
    // Values are equivalent after unit conversion, and no other difference was found
    const hasDifferences = diff.differences.length > 0;
    if (!hasDifferences) {
      return {
        state: "consistent",
        reasonCodes: ["equivalent-values-no-differences"],
      };
    }
  }

  return null;
}

/**
 * Classify a candidate from its answers and unresolved questions.
 *
 * - If any substantive conflict was proven → conflict
 * - If any E-question remains unresolved → unresolved
 * - Otherwise → consistent
 */
function classify(
  candidateId: string,
  _checkId: ConsistencyCheckId,
  diff: ClaimPairDiff,
  answers: readonly EAnswer[],
  unresolved: readonly EUnresolved[],
): DeterministicResolution {
  const substantiveConflict = answers.find(
    (a) => a.question === "E-SUBSTANTIVE-CONFLICT" && a.holds,
  );
  if (substantiveConflict !== undefined) {
    return {
      candidateId,
      checkId: _checkId,
      diff,
      answers,
      unresolved,
      state: "conflict",
      reasonCodes: ["substantive-conflict-proven", substantiveConflict.reason],
    };
  }

  if (unresolved.length > 0) {
    return {
      candidateId,
      checkId: _checkId,
      diff,
      answers,
      unresolved,
      state: "unresolved",
      reasonCodes: unresolved.map((u) => `unresolved:${u.question}`),
    };
  }

  return {
    candidateId,
    checkId: _checkId,
    diff,
    answers,
    unresolved,
    state: "consistent",
    reasonCodes: ["all-questions-answered-no-conflict"],
  };
}

/** Content words from a predicate, for comparability. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$€£\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length > 2);
}
