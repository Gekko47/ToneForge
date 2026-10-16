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

import type { StageTimings } from "../../analysis/semantic/contracts";
import type { LlmAttemptTiming } from "../../ai/providers/LlmProvider";
import type { SemanticFailureCode, SemanticStage } from "../../analysis/semantic/failures";

/**
 * One provider attempt's timing, in the report's own words.
 *
 * `headersMs` and `bodyMs` are `null` rather than absent when they are unknown, so
 * the same keys appear every time and a missing value cannot be mistaken for a zero
 * — the same discipline the rest of the report follows.
 */
export interface DiagnosticProviderAttempt {
  durationMs: number;
  waitMs: number;
  outcome: "ok" | "error";
  /** Milliseconds until the response headers arrived, or null if none did. */
  headersMs: number | null;
  /** Milliseconds to read and parse the body, or null if none arrived. */
  bodyMs: number | null;
  /** The HTTP status a response carried, or null when no response arrived. */
  status: number | null;
}

/**
 * What a report may say about the provider.
 *
 * A completed run knows every field. A failed one knows only the name: the request
 * never produced a model, a latency or an attempt count, and writing zeros there
 * would read as measurements. The unknowns are stated as null so "not known" stays
 * distinguishable from "was zero".
 */
export interface DiagnosticProviderOffer {
  provider: string;
  model?: string;
  attempt?: number;
  latencyMs?: number;
}

export interface DiagnosticReportInput {
  /** Identifies the attempt, so a report and a log line can be joined. */
  runId: string;
  failure: { code: SemanticFailureCode; stage: SemanticStage };
  /**
   * The provider, when the run knew it. A failure names the provider even though
   * the rest is unknown, because "which provider" is the first question a run that
   * never answered raises.
   */
  provider: DiagnosticProviderOffer | null;
  /**
   * The provider's own attempts, when the failure came from one.
   *
   * A request that hangs until each of its own deadlines shows as several equal,
   * long attempts with no `bodyMs`. That shape is the diagnosis, and a single
   * summary duration cannot express it.
   */
  providerAttempts: readonly LlmAttemptTiming[] | null;
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
  /** Null only when no provider was ever resolved; otherwise the name at least. */
  provider: {
    provider: string;
    model: string | null;
    attempt: number | null;
    latencyMs: number | null;
  } | null;
  /** Only the stages that ran, so an absent stage stays distinguishable from a fast one. */
  stageTimingsMs: Record<string, number>;
  /** One entry per provider attempt, when the run made any; null when it made none. */
  providerAttempts: readonly DiagnosticProviderAttempt[] | null;
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
      input.provider === null
        ? null
        : {
            provider: input.provider.provider,
            model: input.provider.model ?? null,
            attempt: input.provider.attempt ?? null,
            latencyMs: input.provider.latencyMs ?? null,
          },
    stageTimingsMs: { ...(input.stageTimings ?? {}) },
    providerAttempts:
      input.providerAttempts === null
        ? null
        : input.providerAttempts.map((attempt) => ({
            durationMs: attempt.durationMs,
            waitMs: attempt.waitMs,
            outcome: attempt.outcome,
            headersMs: attempt.headersMs ?? null,
            bodyMs: attempt.bodyMs ?? null,
            status: attempt.status ?? null,
          })),
    selectionChars: input.selectionChars,
    timestamp: input.at,
  };
}
