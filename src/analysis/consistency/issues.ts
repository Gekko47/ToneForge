/**
 * Issue construction (R7, original §27 and §33).
 *
 * Turns a resolved candidate into a `ConsistencyIssue`. The explanation is
 * built from what the engine actually knows — the retrieval reason, the diff,
 * the E-answers, and the derived D-outcome — never from a model's prose. The
 * why-confidence list is the same E-answers rendered for a reader, each tagged
 * with whether a proven fact or a model judgement produced it.
 *
 * The engine never names a faulty side: fault is a user adjudication, not
 * something a comparison can prove. So `suggestedNodeId` is left unset and the
 * bridge marks the finding advisory — shown and explained, but never applied.
 */

import {
  consistencyCheck,
  type ConsistencyCheckId,
  type ConsistencyIssue,
  type ConsistencyVerdict,
  type DOutcome,
} from "./contracts";
import type { ConfidenceProfile } from "./contracts";
import type { ConsistencyCandidate } from "./contracts";
import type { NormalisedClaim } from "./normalisation";

/** One E-answer, from either the resolver or the decision model. */
export interface IssueAnswer {
  readonly question: string;
  readonly holds: boolean;
  readonly reason: string;
  /** Present for model answers; absent for deterministic ones. */
  readonly confidence?: number;
}

export interface IssueInput {
  readonly candidate: ConsistencyCandidate;
  readonly checkId: ConsistencyCheckId;
  readonly claims: readonly NormalisedClaim[];
  readonly dOutcome: DOutcome;
  readonly confidence: ConfidenceProfile;
  readonly deterministicAnswers: readonly IssueAnswer[];
  readonly modelAnswers: readonly IssueAnswer[];
  readonly reasonCodes: readonly string[];
  /** True when the confidence clears the review threshold. */
  readonly actionable: boolean;
}

/**
 * Human labels for the E-questions, in the user's terms (original §33).
 *
 * A question with no label is not shown in why-confidence: an internal code
 * rendered raw would be noise, and the list is meant to be read.
 */
const E_LABELS: Readonly<Record<string, string>> = {
  "E-ENTITY-SAME": "Same entity",
  "E-EVENT-SAME": "Same event",
  "E-PREDICATE-COMPARABLE": "Comparable statements",
  "E-SCOPE-SAME": "Same scope",
  "E-SCENARIO-SAME": "Same scenario",
  "E-ATTRIBUTION-COMPATIBLE": "Compatible attribution",
  "E-MODALITY-COMPATIBLE": "Compatible modality",
  "E-TEMPORAL-COMPARABLE": "Comparable dates",
  "E-BASIS-SAME": "Same contractual basis",
  "E-VALUE-INCOMPATIBLE": "Values incompatible",
  "E-QUALIFIER-RECONCILES": "Qualifiers reconcile",
  "E-EVIDENCE-SUFFICIENT": "Enough evidence",
  "E-UPDATE-SUPERSEDES": "Updated position",
  "E-PROGRAMME-BASIS-SAME": "Same programme basis",
  "E-DATA-DATE-COMPARABLE": "Comparable data dates",
  "E-ANALYSIS-WINDOW-SAME": "Same analysis window",
  "E-CRITICALITY-INCOMPATIBLE": "Criticality incompatible",
  "E-CONCURRENCY-RECONCILES": "Concurrency reconciles",
  "E-MEASUREMENT-BASIS-SAME": "Same measurement basis",
  "E-VALUATION-PERIOD-SAME": "Same valuation period",
  "E-CURRENCY-COMPATIBLE": "Compatible currency",
  "E-INCLUSIONS-SAME": "Same inclusions",
  "E-DEFINITION-INCOMPATIBLE": "Definition incompatible",
  "E-REFERENCE-SUPPORTS-CLAIM": "Reference supports claim",
  "E-STATUS-MUTUALLY-EXCLUSIVE": "Statuses mutually exclusive",
  "E-SECTION-FULFILS-PROMISE": "Section fulfils promise",
  "E-SCOPE-EXCEPTION": "Scope exception",
  "E-SUBSTANTIVE-CONFLICT": "Substantive conflict",
};

/** How strongly a facet holds, in the user's terms. */
function strengthOf(answer: IssueAnswer): string {
  if (answer.confidence === undefined) {
    return answer.holds ? "Proven · deterministic" : "Disproven · deterministic";
  }
  const pct = Math.round(answer.confidence * 100);
  return `${answer.holds ? "Holds" : "Does not hold"} · decision model (${pct}%)`;
}

/** The why-confidence list, deterministic answers first. */
export function buildWhyConfidence(
  deterministicAnswers: readonly IssueAnswer[],
  modelAnswers: readonly IssueAnswer[],
): ConsistencyIssue["whyConfidence"] {
  const rows = [
    ...deterministicAnswers.map((answer) => ({
      label: E_LABELS[answer.question] ?? answer.question,
      strength: strengthOf(answer),
      provenance: "deterministic" as const,
    })),
    ...modelAnswers.map((answer) => ({
      label: E_LABELS[answer.question] ?? answer.question,
      strength: strengthOf(answer),
      provenance: "system_one" as const,
    })),
  ];
  return rows.length > 0 ? rows : undefined;
}

/** The verdict a D-outcome implies, for the issue's own record. */
function verdictOf(dOutcome: DOutcome): ConsistencyVerdict {
  if (dOutcome === "D-CONFLICT") return "contradiction";
  if (dOutcome === "D-NOT-COMPARABLE" || dOutcome === "D-CONSISTENT") return "notAConflict";
  return "unclear";
}

/** The two claims a candidate compared, in document order. */
function pairOf(
  candidate: ConsistencyCandidate,
  claims: readonly NormalisedClaim[],
): [NormalisedClaim, NormalisedClaim] | null {
  const byId = new Map(claims.map((claim) => [claim.claim.id, claim]));
  const ordered = candidate.claimIds
    .map((id) => byId.get(id))
    .filter((claim): claim is NormalisedClaim => claim !== undefined);
  const left = ordered[0];
  const right = ordered[1];
  if (left === undefined || right === undefined) return null;
  return [left, right];
}

/** A one-line explanation built from what the engine proved, not from prose. */
function explain(input: IssueInput): string {
  const descriptor = consistencyCheck(input.checkId);
  const parts: string[] = [descriptor.question];
  if (input.reasonCodes.length > 0) {
    parts.push(`Reason: ${input.reasonCodes.join(", ")}.`);
  }
  const proven = input.deterministicAnswers
    .filter((answer) => answer.holds)
    .map((answer) => E_LABELS[answer.question] ?? answer.question);
  if (proven.length > 0) {
    parts.push(`Proven: ${proven.join(", ")}.`);
  }
  parts.push(`Outcome: ${input.dOutcome}.`);
  return parts.join(" ");
}

/**
 * Build one issue from a resolved candidate.
 *
 * Returns null when the candidate does not have two locatable claims: an issue
 * with nothing to show is not an issue, and inventing evidence for it would be
 * worse than dropping it.
 */
export function buildIssue(input: IssueInput): ConsistencyIssue | null {
  const pair = pairOf(input.candidate, input.claims);
  if (pair === null) return null;
  const [left, right] = pair;
  const descriptor = consistencyCheck(input.checkId);
  const whyConfidence = buildWhyConfidence(input.deterministicAnswers, input.modelAnswers);

  return {
    checkId: input.checkId,
    fingerprint: input.candidate.fingerprint,
    title: descriptor.title,
    detail: explain(input),
    severity: descriptor.severity,
    confidence: input.confidence.point,
    actionable: input.actionable,
    nodeIds: [left.claim.id, right.claim.id],
    ranges: {
      left: { start: left.claim.evidence.startOffset, end: left.claim.evidence.endOffset },
      right: { start: right.claim.evidence.startOffset, end: right.claim.evidence.endOffset },
    },
    evidence: {
      left: left.claim.evidence.exactText,
      right: right.claim.evidence.exactText,
      sectionLeft: left.claim.evidence.sectionPath.at(-1) ?? left.claim.evidence.sectionId ?? "",
      sectionRight: right.claim.evidence.sectionPath.at(-1) ?? right.claim.evidence.sectionId ?? "",
    },
    verdict: verdictOf(input.dOutcome),
    outcome: input.dOutcome,
    reason: input.reasonCodes.join(", "),
    ...(whyConfidence === undefined ? {} : { whyConfidence }),
  };
}
