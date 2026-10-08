/**
 * DecisionPlan compiler (R5, original §17, §18).
 *
 * Compiles unresolved candidates into a typed DecisionPlan with:
 * - Only unresolved E-questions (deterministic answers removed)
 * - Only relevant projected state per check profile
 * - Exact evidence for the claims in scope
 * - Budget enforcement (maxQuestions, maxExpansions)
 * - Redaction toggle honoured (D13)
 */

import type { ConsistencyCandidate, ConsistencyCheckId } from "../contracts";
import type { NormalisedClaim } from "../normalisation";
import type { DecisionPlan, DecisionQuestion } from "../contracts/plan";
import type {
  EAnswer,
  EUnresolved,
  DeterministicResolution,
} from "../comparison/deterministicEvaluationResolver";
import { evaluationProfile } from "../comparison/evaluationProfiles";
import { QUESTION_REGISTRY } from "./questionRegistry";
import { contextRequestsForQuestion } from "./systemOne/SystemOneContextPolicy";
import { type ClaimPairDiff } from "../comparison/claimPairDiff";
import { attributionKey } from "../checks/primitives";

/** Projected state for one claim in a DecisionPlan. */
export interface ProjectedClaimState {
  readonly claimId: string;
  readonly predicate: string;
  readonly subjectIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly programmeIds: readonly string[];
  readonly values: readonly {
    raw: string;
    normalized: number | undefined;
    unit: string | undefined;
  }[];
  readonly dates: readonly { role: string; date: { iso: string; raw: string; coarse: boolean } }[];
  readonly scope: { kind: string };
  readonly scenario: { type: string } | undefined;
  readonly attribution: string | undefined;
  readonly qualifiers: readonly string[];
  readonly evidence: { exactText: string; paragraphId: string } | undefined;
  readonly evidenceBasis: readonly { anchorId: string; role: string }[];
}

/** Projected state for a candidate pair. */
export interface ProjectedCandidateState {
  readonly candidateId: string;
  readonly checkId: ConsistencyCheckId;
  readonly left: ProjectedClaimState;
  readonly right: ProjectedClaimState;
  readonly diff: ClaimPairDiff;
  readonly deterministicAnswers: readonly EAnswer[];
  readonly unresolvedQuestions: readonly EUnresolved[];
}

/** Project a claim to only the required facts for a check. */
function projectClaim(
  claim: NormalisedClaim,
  requiredFacts: readonly string[],
): ProjectedClaimState {
  const required = new Set(requiredFacts);

  return {
    claimId: claim.claim.id,
    predicate: claim.claim.predicate.text,
    subjectIds: required.has("entity") ? claim.claim.subjectIds : [],
    eventIds: required.has("event") ? claim.claim.eventIds : [],
    programmeIds: required.has("programme") ? claim.claim.programmeIds : [],
    values:
      required.has("value") || required.has("metric") || required.has("unit")
        ? claim.values.map((v) => ({ raw: v.raw, normalized: v.normalized, unit: v.unit }))
        : [],
    dates:
      required.has("period") || required.has("temporal")
        ? claim.dates.map((d) => ({
            role: d.role,
            date: { iso: d.date.iso ?? "", raw: d.date.raw, coarse: d.date.coarse },
          }))
        : [],
    scope: required.has("scope") ? claim.claim.scope : { kind: "unknown" },
    scenario: required.has("scenario") ? claim.claim.scenario : undefined,
    attribution: required.has("attribution") ? attributionKey(claim.claim) : undefined,
    qualifiers: required.has("qualifiers") ? claim.claim.qualifiers.map((q) => q.text) : [],
    evidence:
      claim.claim.evidence !== undefined
        ? {
            exactText: claim.claim.evidence.exactText,
            paragraphId: claim.claim.evidence.paragraphId,
          }
        : undefined,
    evidenceBasis: claim.claim.evidenceBasis.map((eb) => ({
      anchorId: eb.anchorId,
      role: eb.role ?? "primary",
    })),
  };
}

/**
 * Compile a DecisionPlan with full candidate context.
 * This is the version the engine will call.
 */
export function compileDecisionPlanWithCandidates(
  resolutions: readonly DeterministicResolution[],
  candidates: readonly ConsistencyCandidate[],
  claims: readonly NormalisedClaim[],
  options: {
    revision: string;
    maxQuestions: number;
    maxExpansions: number;
    allowUnredacted: boolean;
  },
): DecisionPlan {
  const byId = new Map(claims.map((c) => [c.claim.id, c]));
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  // Filter to only unresolved candidates
  const unresolvedResolutions = resolutions.filter((r) => r.state === "unresolved");

  // Build projected state for each unresolved candidate
  const projectedStates: ProjectedCandidateState[] = [];
  for (const resolution of unresolvedResolutions) {
    const candidate = candidateMap.get(resolution.candidateId);
    if (candidate === undefined) continue;

    const claimIds = candidate.claimIds;
    const claimObjs = claimIds
      .map((id) => byId.get(id))
      .filter((c): c is NormalisedClaim => c !== undefined);

    if (claimObjs.length < 2) continue;

    const left = claimObjs[0]!;
    const right = claimObjs[1]!;
    const profile = evaluationProfile(resolution.checkId);

    // Build projected state with only required facts for this check
    const leftProjected = projectClaim(left, profile.requiredFacts);
    const rightProjected = projectClaim(right, profile.requiredFacts);

    projectedStates.push({
      candidateId: resolution.candidateId,
      checkId: resolution.checkId,
      left: leftProjected,
      right: rightProjected,
      diff: resolution.diff ?? { matches: [], differences: [], unknowns: [] },
      deterministicAnswers: resolution.answers,
      unresolvedQuestions: resolution.unresolved,
    });
  }

  // Compile questions from unresolved E-questions
  const questions: DecisionQuestion[] = [];
  let questionCount = 0;

  for (const state of projectedStates) {
    if (questionCount >= options.maxQuestions) break;

    const profile = evaluationProfile(state.checkId);
    const registry = QUESTION_REGISTRY;

    for (const unresolved of state.unresolvedQuestions) {
      if (questionCount >= options.maxQuestions) break;

      // Only include questions that are relevant to this check
      if (!profile.relevantEQuestions.includes(unresolved.question)) continue;

      const decisionQuestion = registry.getQuestion(unresolved.question, state.checkId);
      if (decisionQuestion === undefined) continue;

      // Make the question ID unique per candidate by prefixing with candidateId
      const uniqueId = `${state.candidateId}:${decisionQuestion.id}`;

      // Fill in the subjectId and the context this question may ask for. The
      // context is declared up front so the engine knows what a single
      // expansion pass would retrieve before it spends a model call.
      const questionWithSubject: DecisionQuestion = {
        ...decisionQuestion,
        id: uniqueId,
        subjectId: state.candidateId,
        requestedContext: [...contextRequestsForQuestion(unresolved.question)],
      };

      questions.push(questionWithSubject);
      questionCount++;
    }
  }

  return {
    revision: options.revision,
    questions,
    projectedStates: projectedStates as unknown as DecisionPlan["projectedStates"],
    budget: {
      maxQuestions: options.maxQuestions,
      maxExpansions: options.maxExpansions,
    },
    allowUnredacted: options.allowUnredacted,
    // The first pass carries no expanded context; the engine fills this in for
    // the single rerun of unanswered questions.
    expandedContext: [],
  };
}
