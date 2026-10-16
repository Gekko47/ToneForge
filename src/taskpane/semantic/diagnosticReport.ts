/**
 * The diagnostic report a person can copy after a failure.
 *
 * **No document text, no prompt text, no provider text.** Only identifiers, codes,
 * counts and timings, so the report can be pasted into a support ticket or a GitHub
 * issue without carrying the document out of the add-in. That is the whole reason
 * it is built here rather than assembled from whatever happened to be in scope at
 * the failure: a report assembled ad hoc is one `error.message` away from being a
 * leak, and the message is exactly the field a developer reaches for.
 *
 * The shape is versioned (`schema`) because it is pasted into places where it is
 * read by someone who did not write it.
 */

import type { ProviderMetadata, StageTimings } from "../../analysis/semantic/contracts";
import type { SemanticFailureCode, SemanticStage } from "../../analysis/semantic/failures";

export interface DiagnosticReportInput {
  /** Identifies the attempt, so a report and a log line can be joined. */
  runId: string;
  failure: { code: SemanticFailureCode; stage: SemanticStage };
  providerMetadata: ProviderMetadata | null;
  /** How much was under review, which is a size and not the text. */
  selectionChars: number | null;
  /** Per-stage durations, so a slow run is attributed to a stage. */
  stageTimings: StageTimings | null;
  /** When the report was produced, ISO 8601. */
  at: string;
}

export interface DiagnosticReport {
  schema: "toneforge.semantic-review-diagnostic/v1";
  runId: string;
  failureCode: SemanticFailureCode;
  stage: SemanticStage;
  provider: {
    provider: string;
    model: string;
    attempt: number;
    latencyMs: number;
  } | null;
  /** Only the stages that ran, so an absent stage stays distinguishable from a fast one. */
  stageTimingsMs: Record<string, number>;
  selectionChars: number | null;
  timestamp: string;
}

export function buildDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
  return {
    schema: "toneforge.semantic-review-diagnostic/v1",
    runId: input.runId,
    failureCode: input.failure.code,
    stage: input.failure.stage,
    provider:
      input.providerMetadata === null
        ? null
        : {
            provider: input.providerMetadata.provider,
            model: input.providerMetadata.model,
            attempt: input.providerMetadata.attempt,
            latencyMs: input.providerMetadata.latencyMs,
          },
    stageTimingsMs: { ...(input.stageTimings ?? {}) },
    selectionChars: input.selectionChars,
    timestamp: input.at,
  };
}
