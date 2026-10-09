/**
 * The indexed consistency engine (R0–R6).
 *
 * Orchestration per the authoritative plan §6: extraction, evidence
 * validation, canonical resolution, normalisation, indexing, retrieval,
 * deterministic resolution, DecisionPlan compilation, decision adjudication,
 * D-derivation, confidence scoring, and reporting.
 *
 * R0 provides the consent gate, the cancellation and staleness guards, and
 * the report shape. R2 lands extraction: when a provider is configured and
 * the run has opted out of redaction, the document is batched by its
 * section hierarchy, claims are extracted in two passes, and every claim's
 * evidence is proven against the document before it may enter the pipeline.
 * R3 lands the deterministic stages after it: the accepted claims are
 * normalised, the nine indices are built, and each of the ten checks
 * retrieves its plausible subjects — with the per-subject cap applied and
 * counted. R4 lands deterministic resolution and pre-model gates. R5 lands
 * DecisionPlan compilation, decision adjudication, and bounded context expansion.
 * R6 lands D-derivation, post-model gates, and confidence with intervals.
 */

import type { LlmProvider } from "../../ai/providers/LlmProvider";
import type { DecisionFallbackPolicy } from "../../core/domain/LlmRole";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS,
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  CONSISTENCY_STORE_VERSION,
  ConsistencyCoverageSchema,
  ConsistencyReportSchema,
  parseConsistencyReviewRequest,
  type ConsistencyCoverage,
  type ConsistencyIssue,
  type ConsistencyReport,
  type ConsistencyStatement,
} from "./contracts";
import type { DOutcome } from "./contracts";
import {
  buildExtractionBatches,
  extractClaims,
  resolveCanonicalClaims,
  type ExtractionResult,
} from "./extraction";
import { buildAliasIndex, collectAliasEntries, normaliseClaims } from "./normalisation";
import { buildIndices } from "./indices";
import { retrieveCandidates } from "./candidates";
import {
  resolveCandidate,
  runPreModelGates,
  runPostModelGates,
  deriveDOutcome,
  buildEvaluationVector,
  computeConfidence,
  meetsReviewThreshold,
  meetsPresentationThreshold,
  getDerivationReasonCodes,
  type DeterministicResolution,
} from "./comparison";
import { buildIssue } from "./issues";
import { compileDecisionPlanWithCandidates } from "./decision/DecisionPlanCompiler";
import { SystemOneDecisionProvider } from "./decision/systemOne/SystemOneDecisionProvider";
import { unansweredQuestions } from "./decision/systemOne/SystemOneContextPolicy";
import { expandContext, resolveContextParameters } from "./decision/contextExpansion";
import type { DecisionPlan } from "./contracts/plan";
import type { ConsistencyDecisionEvaluation } from "./decision/ConsistencyDecisionProvider";
import { buildAuditRecord, buildProvenance, type ConsistencySessionStore } from "./persistence";

/** Thrown when the run is cancelled or the document moved underneath it. */
export class ConsistencyRunCancelled extends Error {
  constructor(
    public readonly reason: "cancelled" | "stale",
    message?: string,
  ) {
    super(message ?? `Consistency run ${reason}`);
    this.name = "ConsistencyRunCancelled";
  }
}

export interface ConsistencyRunOptions {
  /**
   * The general role's provider: extraction and the pre-model gates.
   *
   * This is the only provider that ever sees the document for extraction. The
   * decision role is a separate binding (see `decisionProvider`) so a run can
   * extract with one model and adjudicate with another.
   */
  provider?: LlmProvider;
  /**
   * The decision role's provider: bounded-ambiguity adjudication only.
   *
   * When omitted, `decisionFallbackPolicy` decides what happens to the
   * resolver's unresolved residue: `unresolved` leaves it unresolved (the
   * default, and the honest answer), while `general_model` reuses `provider`.
   * There is no silent cross-role fallback — the policy is explicit.
   */
  decisionProvider?: LlmProvider;
  /** What to do when no decision provider is bound. Defaults to `unresolved`. */
  decisionFallbackPolicy?: DecisionFallbackPolicy;
  /** The general role's model, for provenance. Falls back to the request model. */
  generalModel?: string;
  /** The decision role's model, for provenance. Falls back to the request model. */
  decisionModel?: string;
  signal?: AbortSignal;
  onProgress?: (progress: {
    phase:
      | "segmenting"
      | "extracting"
      | "normalising"
      | "indexing"
      | "comparing"
      | "adjudicating"
      | "consolidating"
      | "done";
    fraction: number;
    message: string;
  }) => void;
  currentRevision?: () => Promise<string>;
  now?: () => string;
  /**
   * When supplied, the finished run is persisted as an encrypted audit record
   * (R7, original §30–§31). The engine never persists a credential, and the
   * store holds ciphertext only.
   */
  store?: ConsistencySessionStore;
}

function assertNotCancelled(options: ConsistencyRunOptions): void {
  if (options.signal?.aborted === true) {
    throw new ConsistencyRunCancelled("cancelled");
  }
}

async function assertCurrent(options: ConsistencyRunOptions, revision: string): Promise<void> {
  assertNotCancelled(options);
  if (options.currentRevision === undefined) return;
  const current = await options.currentRevision();
  if (current !== revision) {
    throw new ConsistencyRunCancelled("stale", "The document changed during the run.");
  }
}

/**
 * Split text into statements for the preflight count.
 *
 * Deliberately the same coarse sentence split the old engine used: the
 * preflight counts what the run will segment, and a smarter splitter here
 * than in the run would count a different document than the one reviewed.
 */
export function previewStatements(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Segment the document into statements with stable ids.
 *
 * Ids are `s-<index>`: stable within a session, assigned after segmentation,
 * and the only statement-level identity the engine produces.
 */
export function segmentDocument(text: string, sections: readonly string[]): ConsistencyStatement[] {
  const sentences = previewStatements(text);
  return sentences.map((sentence, index) => ({
    id: `s-${index}`,
    text: sentence,
    section: sections[0] ?? "",
    index,
  }));
}

/**
 * What a run covered, and what it did not.
 *
 * `complete` is a discovery claim, not a type requirement (ADR-0066): it is
 * true only when nothing was skipped and nothing was left unreviewed. A run
 * that hit a budget cap reports `complete: false` with the skipped counts in
 * `limitations`, and the UI renders the limitation rather than a clean bill
 * of health.
 */
function coverage(
  statementsTotal: number,
  maxAdjudications: number,
  blockers: string[],
  quarantinedClaims: number,
  retrieval: {
    comparisonsMade: number;
    blockOverflowSkipped: number;
    perCheck: Readonly<Record<string, number>>;
  } = { comparisonsMade: 0, blockOverflowSkipped: 0, perCheck: {} },
  work: {
    deterministicResolved: number;
    decisionAdjudicated: number;
    unresolved: number;
    gated: number;
    reviewBandSuppressed: number;
    budgetExceeded: number;
    adjudicationsUsed: number;
    modelAdjudicated: number;
    decisionParseFailed: boolean;
  } = {
    deterministicResolved: 0,
    decisionAdjudicated: 0,
    unresolved: 0,
    gated: 0,
    reviewBandSuppressed: 0,
    budgetExceeded: 0,
    adjudicationsUsed: 0,
    modelAdjudicated: 0,
    decisionParseFailed: false,
  },
): ConsistencyCoverage {
  return ConsistencyCoverageSchema.parse({
    // `complete` is a discovery claim (ADR-0066): true only when nothing was
    // skipped and nothing was left unreviewed. Informational summaries are
    // notes, not limitations, so they must not force `complete` false — only a
    // genuine blocker, unresolved work, a hit budget, a skipped comparison, or
    // a quarantined claim does.
    complete:
      blockers.length === 0 &&
      work.unresolved === 0 &&
      work.budgetExceeded === 0 &&
      retrieval.blockOverflowSkipped === 0 &&
      quarantinedClaims === 0,
    statementsConsidered: statementsTotal,
    statementsTotal,
    comparisonsMade: retrieval.comparisonsMade,
    blockOverflowSkipped: retrieval.blockOverflowSkipped,
    adjudicationsUsed: work.adjudicationsUsed,
    adjudicationsAvailable: maxAdjudications,
    perCheck: { ...retrieval.perCheck },
    limitations: [...blockers],
    modelAdjudicated: work.modelAdjudicated,
    quarantinedClaims,
    deterministicResolved: work.deterministicResolved,
    decisionAdjudicated: work.decisionAdjudicated,
    unresolved: work.unresolved,
    gated: work.gated,
    reviewBandSuppressed: work.reviewBandSuppressed,
    budgetExceeded: work.budgetExceeded,
    decisionParseFailed: work.decisionParseFailed,
  });
}

/**
 * Map a derived D-outcome to the candidate's final state.
 *
 * Only D-CONFLICT is a contradiction. Every D-DIFFERENT-* outcome is a
 * legitimate difference — a different basis, period, scenario, attribution,
 * scope, or measurement basis — which is not a conflict and must not be
 * reported as one. That is the false positive the 16-outcome derivation exists
 * to prevent, so the default is `not_comparable`, never `conflict`.
 */
function stateForDOutcome(
  dOutcome: DOutcome,
): "consistent" | "conflict" | "not_comparable" | "unresolved" {
  switch (dOutcome) {
    case "D-CONFLICT":
      return "conflict";
    case "D-CONSISTENT":
      return "consistent";
    case "D-NOT-COMPARABLE":
      return "not_comparable";
    case "D-INSUFFICIENT-EVIDENCE":
    case "D-AMBIGUOUS":
      return "unresolved";
    default:
      // D-DIFFERENT-*, D-QUALIFIED-POSITION, D-UPDATED-POSITION: a real
      // difference, not a contradiction.
      return "not_comparable";
  }
}

/**
 * Run the review.
 *
 * R0: parses the request (failing closed on consent), segments the document,
 * guards cancellation and staleness, and returns an empty report with honest
 * coverage. R2 extracts and validates claims when a provider runs with the
 * redaction opt-out. R3 normalises what was accepted, builds the nine
 * indices, and retrieves each check's plausible subjects. R4–R7 fill in the
 * comparison, adjudication, and D-derivation stages; the contract — consent
 * first, guards throughout, report tied to its revision — does not change.
 */
export async function runConsistencyReview(
  rawRequest: unknown,
  options: ConsistencyRunOptions = {},
): Promise<ConsistencyReport> {
  const request = parseConsistencyReviewRequest(rawRequest);
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  assertNotCancelled(options);

  const statements = segmentDocument(request.document.text, request.document.sections);
  options.onProgress?.({ phase: "segmenting", fraction: 0.2, message: "Reading the document…" });
  await assertCurrent(options, request.document.revision);

  const maxPerSubject = request.maxPerSubject ?? CONSISTENCY_DEFAULT_MAX_PER_SUBJECT;
  const maxAdjudications = request.maxAdjudications ?? CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS;

  // The decision role is a distinct binding. It is only ever the general
  // provider when the fallback policy explicitly says so — never by default,
  // because a silent cross-role fallback would adjudicate with a model the user
  // did not choose for that purpose.
  const decisionProvider: LlmProvider | undefined =
    options.decisionProvider ??
    (options.decisionFallbackPolicy === "general_model" ? options.provider : undefined);

  // Genuine limitations that make the run incomplete.
  const blockers: string[] = [];
  const issues: ConsistencyIssue[] = [];
  const evidenceHashes = new Set<string>();
  let quarantinedClaims = 0;
  let usedModel = false;
  let retrieval = {
    comparisonsMade: 0,
    blockOverflowSkipped: 0,
    perCheck: {} as Record<string, number>,
  };
  // Coverage V3 (original §34): the work separated by how it was settled.
  const work = {
    deterministicResolved: 0,
    decisionAdjudicated: 0,
    unresolved: 0,
    gated: 0,
    reviewBandSuppressed: 0,
    budgetExceeded: 0,
    adjudicationsUsed: 0,
    modelAdjudicated: 0,
    decisionParseFailed: false,
  };

  if (options.provider === undefined) {
    blockers.push(
      "No provider was configured for the run, so no claims were extracted and nothing was compared.",
    );
  } else if (!request.allowUnredacted) {
    blockers.push(
      "Extraction was skipped: the run did not opt out of redaction, so document text was not sent to the provider and nothing was compared.",
    );
  } else {
    options.onProgress?.({
      phase: "extracting",
      fraction: 0.4,
      message: "Extracting claims…",
    });
    await assertCurrent(options, request.document.revision);
    const batches = buildExtractionBatches(request.document);
    let extraction: ExtractionResult;
    try {
      extraction = await extractClaims(
        options.provider,
        batches,
        {
          documentId: request.document.revision,
          text: request.document.text,
          reviewSessionId: request.document.revision,
        },
        {
          now,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch (err) {
      if (options.signal?.aborted === true) {
        throw new ConsistencyRunCancelled("cancelled");
      }
      throw err;
    }
    await assertCurrent(options, request.document.revision);
    const resolved = resolveCanonicalClaims({
      documentId: request.document.revision,
      text: request.document.text,
      claims: extraction.claims,
    });
    quarantinedClaims = resolved.registry.quarantined.length + extraction.quarantined.length;
    Object.values(resolved.registry.anchors).forEach((anchor) => {
      evidenceHashes.add(anchor.evidenceHash);
    });
    usedModel = true;

    options.onProgress?.({
      phase: "normalising",
      fraction: 0.55,
      message: "Normalising claims…",
    });
    await assertCurrent(options, request.document.revision);
    const normalised = normaliseClaims(resolved.claims);
    const aliases = buildAliasIndex(collectAliasEntries(resolved.claims));

    options.onProgress?.({
      phase: "indexing",
      fraction: 0.65,
      message: "Building indices…",
    });
    await assertCurrent(options, request.document.revision);
    const indices = buildIndices(normalised);

    options.onProgress?.({
      phase: "comparing",
      fraction: 0.75,
      message: "Retrieving candidates…",
    });
    await assertCurrent(options, request.document.revision);
    const retrieved = retrieveCandidates({
      indices,
      aliases,
      maxPerSubject,
      // The request's check selection, honoured rather than parsed and dropped.
      checks: request.checks,
    });
    retrieval = {
      comparisonsMade: retrieved.candidates.length,
      blockOverflowSkipped: retrieved.blockOverflowSkipped,
      perCheck: { ...retrieved.perCheck },
    };

    // R4: deterministic resolution and pre-model gates
    options.onProgress?.({
      phase: "comparing",
      fraction: 0.8,
      message: "Running deterministic resolution…",
    });
    await assertCurrent(options, request.document.revision);

    // Build a claim lookup once — O(C) — instead of filtering all claims per
    // candidate — O(C×N). The same Map serves both the gate loop and the
    // adjudication loop below.
    const claimsById = new Map<string, (typeof normalised)[number]>();
    normalised.forEach((nc) => claimsById.set(nc.claim.id, nc));
    const candidateById = new Map(retrieved.candidates.map((c) => [c.id, c]));

    const resolutions = retrieved.candidates.map((candidate) =>
      resolveCandidate(candidate, normalised),
    );

    // Apply pre-model gates and count outcomes. A candidate a gate settles
    // never reaches the model; a candidate the resolver settles is counted as
    // deterministic work; only the resolver's unresolved residue is queued for
    // the decision model.
    let consistentCount = 0;
    let conflictCount = 0;
    let notComparableCount = 0;
    let unresolvedCount = 0;
    const pendingModel: DeterministicResolution[] = [];

    resolutions.forEach((resolution, i) => {
      const candidate = retrieved.candidates[i]!;
      const claimsForCandidate = candidate.claimIds
        .map((id) => claimsById.get(id))
        .filter((nc) => nc !== undefined);
      const gateResult = runPreModelGates(
        claimsForCandidate,
        resolution.checkId,
        resolution.diff ?? { matches: [], differences: [], unknowns: [] },
      );
      if (!gateResult.proceedToModel) {
        work.gated++;
        if (gateResult.state === "consistent") consistentCount++;
        else if (gateResult.state === "not_comparable") notComparableCount++;
        return;
      }
      if (resolution.state === "unresolved") {
        pendingModel.push(resolution);
        return;
      }
      work.deterministicResolved++;
      if (resolution.state === "conflict") {
        conflictCount++;
        // A proven conflict is a D-CONFLICT: the resolver proved the values
        // disagree, so no model call is needed to name the outcome.
        const deterministicAnswers = resolution.answers.map((a) => ({
          question: a.question,
          holds: a.holds,
          reason: a.reason,
        }));
        const vector = buildEvaluationVector(deterministicAnswers, []);
        const dOutcome: DOutcome = "D-CONFLICT";
        const confidence = computeConfidence(
          resolution.checkId,
          vector,
          [],
          deterministicAnswers,
          dOutcome,
        );
        if (meetsPresentationThreshold(confidence)) {
          const issue = buildIssue({
            candidate,
            checkId: resolution.checkId,
            claims: normalised,
            dOutcome,
            confidence,
            deterministicAnswers,
            modelAnswers: [],
            reasonCodes: resolution.reasonCodes,
            actionable: confidence.point >= CONSISTENCY_ACTIONABLE_CONFIDENCE,
          });
          if (issue !== null) issues.push(issue);
        } else if (meetsReviewThreshold(confidence)) {
          work.reviewBandSuppressed++;
        }
      } else if (resolution.state === "consistent") {
        consistentCount++;
      } else {
        notComparableCount++;
      }
    });

    retrieval.comparisonsMade =
      consistentCount + conflictCount + notComparableCount + pendingModel.length;

    // R5: DecisionPlan compilation and decision adjudication
    if (pendingModel.length > 0 && decisionProvider !== undefined) {
      options.onProgress?.({
        phase: "adjudicating",
        fraction: 0.85,
        message: "Compiling DecisionPlan and adjudicating…",
      });
      await assertCurrent(options, request.document.revision);

      const systemOne = new SystemOneDecisionProvider(decisionProvider);
      const plan = compileDecisionPlanWithCandidates(
        resolutions,
        retrieved.candidates,
        normalised,
        {
          revision: request.document.revision,
          maxQuestions: maxAdjudications,
          maxExpansions: 20,
          allowUnredacted: request.allowUnredacted,
        },
      );

      if (plan.questions.length > 0) {
        usedModel = true;
        work.adjudicationsUsed = plan.questions.length;
        let evaluation: ConsistencyDecisionEvaluation | null = null;
        try {
          evaluation = await systemOne.evaluate(plan, options.signal);
        } catch {
          if (options.signal?.aborted === true) {
            throw new ConsistencyRunCancelled("cancelled");
          }
          blockers.push("Decision adjudication failed: the decision provider threw an error.");
        }

        // The first pass's parse-failure flag is captured before the expansion
        // rerun, which replaces `evaluation` with merged answers. Whether the
        // rerun resolved the failure is decided from its question-level results,
        // not from the first pass's provider metadata.
        const firstPassParseFailed = evaluation?.providerMetadata.parseFailed === true;
        let rerunPlan: DecisionPlan | null = null;
        let rerunSucceeded = false;

        // One bounded expansion pass (original §23): rerun only the questions
        // the model left unanswered, and only with the context those questions
        // asked for. There is no loop — a second pass that still comes back
        // unclear is insufficient evidence, not another call. Expansion
        // retrieves document text, so it is gated on the same redaction opt-out
        // as extraction: with redaction on, the residue stays unresolved.
        if (evaluation !== null && request.allowUnredacted && plan.budget.maxExpansions > 0) {
          const unanswered = unansweredQuestions(plan, evaluation.answers);
          // Resolve each requested kind's parameters from the candidate's own
          // claims, and drop any request whose required key cannot be resolved:
          // a parameterless request can only answer "No … provided", so issuing
          // it would spend a rerun on a question that cannot be settled.
          const requests = unanswered.flatMap((question) =>
            question.requestedContext.flatMap((kind) => {
              const parameters = resolveContextParameters(
                kind,
                question.subjectId,
                retrieved.candidates,
                normalised,
              );
              return parameters === null
                ? []
                : [{ type: kind, candidateId: question.subjectId, parameters }];
            }),
          );
          if (requests.length > 0) {
            const expanded = expandContext(
              requests,
              indices,
              normalised,
              retrieved.candidates,
              request.document.text,
            );
            rerunPlan = {
              ...plan,
              questions: unanswered,
              expandedContext: expanded.map((result) => ({
                candidateId: result.request.candidateId,
                kind: result.request.type,
                content: result.content,
              })),
            };
            try {
              const rerun = await systemOne.evaluate(rerunPlan, options.signal);
              const merged = new Map(evaluation.answers.map((a) => [a.question, a]));
              rerun.answers.forEach((answer) => merged.set(answer.question, answer));
              evaluation = { ...evaluation, answers: [...merged.values()] };
              rerunSucceeded = true;
            } catch {
              if (options.signal?.aborted === true) {
                throw new ConsistencyRunCancelled("cancelled");
              }
              // A failed expansion pass is not fatal: the first pass's answers
              // stand, and the questions it left unclear stay unresolved.
            }
          }
        }

        // Record whether the decision model's output was unreadable. The first
        // pass's metadata is authoritative, unless a successful expansion rerun
        // answered every question the first pass left unanswered — then the
        // parse failure is resolved and the flag clears. A first pass that threw
        // leaves the flag false.
        if (evaluation !== null) {
          const resolvedByRerun =
            rerunSucceeded &&
            rerunPlan !== null &&
            unansweredQuestions(rerunPlan, evaluation.answers).length === 0;
          work.decisionParseFailed = firstPassParseFailed && !resolvedByRerun;
        }

        // R6: D-derivation, post-model gates, and confidence with intervals
        options.onProgress?.({
          phase: "consolidating",
          fraction: 0.9,
          message: "Deriving outcomes and computing confidence…",
        });
        await assertCurrent(options, request.document.revision);

        const adjudicated = new Set(plan.questions.map((q) => q.subjectId));

        for (const resolution of pendingModel) {
          if (evaluation === null) {
            unresolvedCount++;
            continue;
          }
          const candidate = candidateById.get(resolution.candidateId);
          if (candidate === undefined) continue;

          const claimsForCandidate = candidate.claimIds
            .map((id) => claimsById.get(id))
            .filter((nc) => nc !== undefined);
          if (claimsForCandidate.length < 2) {
            unresolvedCount++;
            continue;
          }

          // A candidate the budget left unasked is unresolved, and counted as
          // budget-exceeded rather than silently dropped.
          if (!adjudicated.has(resolution.candidateId)) {
            work.budgetExceeded++;
            unresolvedCount++;
            continue;
          }

          work.decisionAdjudicated++;
          work.modelAdjudicated++;

          // Find model answers for this candidate
          const candidateQuestions = plan.questions.filter(
            (q) => q.subjectId === resolution.candidateId,
          );
          // Map by question ID, not index: candidateQuestions is a filtered
          // subset of plan.questions, so evaluation.answers[idx] would use the
          // wrong answer when a candidate's questions are not at the start of
          // the plan.
          const answersByQuestionId = new Map(evaluation.answers.map((a) => [a.question, a]));
          const modelAnswers = candidateQuestions
            .map((q) => {
              const answer = answersByQuestionId.get(q.id);
              if (answer?.answer === "unclear") return null;
              // Strip the candidate prefix to get the E-question name for derivation lookups.
              const eQuestion = q.id.slice(resolution.candidateId.length + 1);
              return {
                question: eQuestion,
                holds:
                  answer?.answer === true ||
                  answer?.answer === "conflict" ||
                  answer?.answer === "incompatible" ||
                  answer?.answer === "contradicts",
                confidence: answer?.confidence ?? 0,
                reason: answer?.reasoning ?? "",
              };
            })
            .filter((a): a is NonNullable<typeof a> => a !== null);

          const deterministicAnswers = resolution.answers.map((a) => ({
            question: a.question,
            holds: a.holds,
            reason: a.reason,
          }));

          // Build E-vector
          const vector = buildEvaluationVector(deterministicAnswers, modelAnswers);

          // Run post-model gates
          const postGateResult = runPostModelGates(
            claimsForCandidate,
            resolution.checkId,
            modelAnswers,
            deterministicAnswers,
          );

          let finalState: "consistent" | "conflict" | "not_comparable" | "unresolved";
          let reasonCodes: string[] = [];
          let dOutcome: DOutcome;

          if (!postGateResult.accept) {
            // Post-model gate rejected the model's answers
            finalState = postGateResult.overrideState ?? "unresolved";
            reasonCodes = [...postGateResult.reasonCodes];
            dOutcome = "D-AMBIGUOUS"; // Gate rejection means we can't determine
          } else {
            // Derive D-outcome
            dOutcome = deriveDOutcome(
              resolution.checkId,
              vector,
              modelAnswers,
              deterministicAnswers,
            );
            reasonCodes = getDerivationReasonCodes(resolution.checkId, vector, dOutcome);
            finalState = stateForDOutcome(dOutcome);
          }

          // Compute confidence
          const confidence = computeConfidence(
            resolution.checkId,
            vector,
            modelAnswers,
            deterministicAnswers,
            dOutcome,
          );

          // Count outcomes
          if (finalState === "consistent") consistentCount++;
          else if (finalState === "conflict") conflictCount++;
          else if (finalState === "not_comparable") notComparableCount++;
          else unresolvedCount++;

          if (finalState === "unresolved") continue;

          // Only above-presentation candidates become issues; the review band
          // (at or above review, below presentation) is retained as advisory.
          if (meetsPresentationThreshold(confidence)) {
            const issue = buildIssue({
              candidate,
              checkId: resolution.checkId,
              claims: normalised,
              dOutcome,
              confidence,
              deterministicAnswers,
              modelAnswers,
              reasonCodes,
              actionable: confidence.point >= CONSISTENCY_ACTIONABLE_CONFIDENCE,
            });
            if (issue !== null) issues.push(issue);
          } else if (meetsReviewThreshold(confidence)) {
            work.reviewBandSuppressed++;
          }
        }
      } else {
        // No question compiled: the residue stays unresolved, honestly.
        pendingModel.forEach(() => {
          unresolvedCount++;
        });
      }
    } else {
      // No decision provider bound and the policy is `unresolved`: the residue
      // stays unresolved, and the run says so rather than reporting a clean
      // bill of health it did not earn.
      if (pendingModel.length > 0) {
        blockers.push(
          "Decision adjudication was skipped: no decision model is bound and the fallback policy is 'unresolved', so the unresolved comparisons were left unresolved.",
        );
      }
      pendingModel.forEach(() => {
        unresolvedCount++;
      });
    }

    work.unresolved = unresolvedCount;
  }

  options.onProgress?.({ phase: "done", fraction: 1, message: "Done." });

  const report = ConsistencyReportSchema.parse({
    revision: request.document.revision,
    issues,
    coverage: coverage(
      statements.length,
      maxAdjudications,
      blockers,
      quarantinedClaims,
      retrieval,
      work,
    ),
    usedModel,
    startedAt,
    finishedAt: now(),
  });

  // R7: persist the audit record when a store is supplied. The record is what
  // makes a run reproducible — provenance, coverage, issues, and the evidence
  // hashes an exception rests on. No credential is ever part of it.
  if (options.store !== undefined) {
    const provenance = buildProvenance({
      documentFingerprint: request.document.revision,
      claimGraphSchemaVersion: String(CONSISTENCY_STORE_VERSION),
      extractionPromptVersion: "extraction-v1",
      // Provenance keeps the two roles separate: which model extracted, and
      // which provider/model adjudicated. A run that fell back to the general
      // model records the general provider's name here, so the audit trail
      // never claims a decision model that was not consulted.
      generalModel: options.generalModel ?? request.model,
      decisionProvider: decisionProvider?.name ?? "none",
      // A run with no decision provider consulted no decision model, so the
      // provenance says "none" rather than borrowing the extraction model's
      // name — the audit trail must not claim a decision model that was never
      // asked.
      decisionModel:
        decisionProvider === undefined ? "none" : (options.decisionModel ?? request.model),
      questionSetVersion: "1.0",
      confidenceProfileVersion: "1.0",
      createdAt: startedAt,
    });
    const record = buildAuditRecord(report, provenance, [...evidenceHashes]);
    await options.store.save(record, now());
  }

  return report;
}
