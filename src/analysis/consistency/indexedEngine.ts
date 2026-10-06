/**
 * The indexed consistency engine (R0 skeleton).
 *
 * Orchestration per the authoritative plan §6: extraction, evidence
 * validation, canonical resolution, normalisation, indexing, retrieval,
 * deterministic resolution, DecisionPlan compilation, decision adjudication,
 * D-derivation, confidence scoring, and reporting.
 *
 * R0 provides the consent gate, the cancellation and staleness guards, and
 * the report shape. The pipeline stages land in R1–R7; until then a run
 * segments the document, reports what it saw, and resolves nothing — which is
 * the honest skeleton, not a silent stub.
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

function emptyCoverage(
  statementsTotal: number,
  maxAdjudications: number,
  limitations: string[],
): ConsistencyCoverage {
  return ConsistencyCoverageSchema.parse({
    complete: limitations.length === 0,
    statementsConsidered: statementsTotal,
    statementsTotal,
    comparisonsMade: 0,
    blockOverflowSkipped: 0,
    adjudicationsUsed: 0,
    adjudicationsAvailable: maxAdjudications,
    perCheck: {},
    limitations,
    modelAdjudicated: 0,
  });
}

/**
 * Run the review.
 *
 * R0: parses the request (failing closed on consent), segments the document,
 * guards cancellation and staleness, and returns an empty report with honest
 * coverage. R1–R7 fill in the pipeline; the contract — consent first, guards
 * throughout, report tied to its revision — does not change.
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
  void maxPerSubject;
  const limitations = [
    "The indexed pipeline is not yet implemented (R0 skeleton): statements were segmented and counted, but no comparisons were made.",
  ];
  options.onProgress?.({ phase: "done", fraction: 1, message: "Done." });

  return ConsistencyReportSchema.parse({
    revision: request.document.revision,
    issues: [],
    coverage: emptyCoverage(statements.length, maxAdjudications, limitations),
    usedModel: false,
    startedAt,
    finishedAt: now(),
  });
}
