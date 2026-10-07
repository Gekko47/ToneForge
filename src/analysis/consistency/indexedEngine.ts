/**
 * The indexed consistency engine (R0–R5).
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
 */

import type { LlmProvider } from "../../ai/providers/LlmProvider";
import {
  CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS,
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  ConsistencyCoverageSchema,
  ConsistencyReportSchema,
  parseConsistencyReviewRequest,
  type ConsistencyCoverage,
  type ConsistencyReport,
  type ConsistencyStatement,
} from "./contracts";
import {
  buildExtractionBatches,
  extractClaims,
  resolveCanonicalClaims,
  type ExtractionResult,
} from "./extraction";
import { buildAliasIndex, collectAliasEntries, normaliseClaims } from "./normalisation";
import { buildIndices } from "./indices";
import { retrieveCandidates } from "./candidates";
import { resolveCandidate, runPreModelGates } from "./comparison";
import { compileDecisionPlanWithCandidates } from "./decision/DecisionPlanCompiler";
import { SystemOneDecisionProvider } from "./decision/systemOne/SystemOneDecisionProvider";

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
  provider?: LlmProvider;
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
  limitations: string[],
  quarantinedClaims: number,
  retrieval: {
    comparisonsMade: number;
    blockOverflowSkipped: number;
    perCheck: Readonly<Record<string, number>>;
  } = { comparisonsMade: 0, blockOverflowSkipped: 0, perCheck: {} },
): ConsistencyCoverage {
  return ConsistencyCoverageSchema.parse({
    complete: limitations.length === 0,
    statementsConsidered: statementsTotal,
    statementsTotal,
    comparisonsMade: retrieval.comparisonsMade,
    blockOverflowSkipped: retrieval.blockOverflowSkipped,
    adjudicationsUsed: 0,
    adjudicationsAvailable: maxAdjudications,
    perCheck: { ...retrieval.perCheck },
    limitations,
    modelAdjudicated: 0,
    quarantinedClaims,
  });
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

  const limitations: string[] = [];
  let quarantinedClaims = 0;
  let usedModel = false;
  let retrieval = {
    comparisonsMade: 0,
    blockOverflowSkipped: 0,
    perCheck: {} as Record<string, number>,
  };

  if (options.provider === undefined) {
    limitations.push(
      "No provider was configured for the run, so no claims were extracted and nothing was compared.",
    );
  } else if (!request.allowUnredacted) {
    limitations.push(
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

    const resolutions = retrieved.candidates.map((candidate) =>
      resolveCandidate(candidate, normalised),
    );

    // Apply pre-model gates and count outcomes
    let consistentCount = 0;
    let conflictCount = 0;
    let notComparableCount = 0;
    let unresolvedCount = 0;

    resolutions.forEach((resolution, i) => {
      const candidate = retrieved.candidates[i]!;
      const gateResult = runPreModelGates(
        normalised.filter((nc) => candidate.claimIds.includes(nc.claim.id)),
        resolution.checkId,
        resolution.diff ?? { matches: [], differences: [], unknowns: [] },
      );
      if (!gateResult.proceedToModel) {
        if (gateResult.state === "consistent") consistentCount++;
        else if (gateResult.state === "not_comparable") notComparableCount++;
      } else {
        if (resolution.state === "conflict") conflictCount++;
        else if (resolution.state === "consistent") consistentCount++;
        else if (resolution.state === "not_comparable") notComparableCount++;
        else unresolvedCount++;
      }
    });

    const totalResolved = consistentCount + conflictCount + notComparableCount + unresolvedCount;
    retrieval.comparisonsMade = totalResolved;

    // R5: DecisionPlan compilation and decision adjudication
    const unresolvedResolutions = resolutions.filter((r) => r.state === "unresolved");
    if (unresolvedResolutions.length > 0 && options.provider !== undefined) {
      options.onProgress?.({
        phase: "adjudicating",
        fraction: 0.85,
        message: "Compiling DecisionPlan and adjudicating…",
      });
      await assertCurrent(options, request.document.revision);

      const decisionProvider = new SystemOneDecisionProvider(options.provider);
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
        const evaluation = await decisionProvider.evaluate(plan, options.signal);

        // Apply post-model gates and count adjudicated outcomes
        let adjudicatedConsistent = 0;
        let adjudicatedConflict = 0;
        const adjudicatedNotComparable = 0;
        let adjudicatedUnresolved = 0;

        evaluation.answers.forEach((answer, i) => {
          const question = plan.questions[i];
          if (answer === undefined || question === undefined) return;
          // Find the resolution this question belongs to
          const resolution = unresolvedResolutions.find(
            (r) => r.candidateId === question.subjectId,
          );
          if (resolution === undefined) return;

          // Simple classification based on answer
          if (answer.answer === "unclear" || answer.confidence === 0) {
            adjudicatedUnresolved++;
          } else if (typeof answer.answer === "boolean" && answer.answer === true) {
            // For binary questions, true means the proposition holds
            if (answer.question.includes("CONFLICT") || answer.question.includes("INCOMPATIBLE")) {
              adjudicatedConflict++;
            } else {
              adjudicatedConsistent++;
            }
          } else if (typeof answer.answer === "string") {
            if (
              answer.answer === "conflict" ||
              answer.answer === "incompatible" ||
              answer.answer === "contradicts"
            ) {
              adjudicatedConflict++;
            } else if (
              answer.answer === "consistent" ||
              answer.answer === "compatible" ||
              answer.answer === "supports" ||
              answer.answer === "fulfils"
            ) {
              adjudicatedConsistent++;
            } else {
              adjudicatedUnresolved++;
            }
          } else {
            adjudicatedUnresolved++;
          }
        });

        consistentCount += adjudicatedConsistent;
        conflictCount += adjudicatedConflict;
        notComparableCount += adjudicatedNotComparable;
        unresolvedCount += adjudicatedUnresolved;

        limitations.push(
          `Decision adjudication complete: ${adjudicatedConsistent} consistent, ${adjudicatedConflict} conflict, ${adjudicatedNotComparable} not comparable, ${adjudicatedUnresolved} unresolved.`,
        );
      } else {
        limitations.push("No unresolved questions to adjudicate.");
      }
    }

    limitations.push(
      `Deterministic resolution complete: ${consistentCount} consistent, ${conflictCount} conflict, ${notComparableCount} not comparable, ${unresolvedCount} unresolved.`,
    );
  }

  options.onProgress?.({ phase: "done", fraction: 1, message: "Done." });

  return ConsistencyReportSchema.parse({
    revision: request.document.revision,
    issues: [],
    coverage: coverage(
      statements.length,
      maxAdjudications,
      limitations,
      quarantinedClaims,
      retrieval,
    ),
    usedModel,
    startedAt,
    finishedAt: now(),
  });
}
