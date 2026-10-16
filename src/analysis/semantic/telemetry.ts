/**
 * Telemetry for the semantic review.
 *
 * **No endpoint is configured, and none is added here.** `emitTelemetry` records its
 * event through the shared logger, which means the events exist in the developer
 * console and in a support session but leave the machine only if a deployment
 * attaches a sink to the logger. `TELEMETRY_DISABLED` governs sending to an
 * endpoint; there is no endpoint, so there is nothing for it to disable.
 *
 * **No event carries document text.** The fields are identifiers, codes, counts,
 * durations and sizes — the same discipline the diagnostic report follows, for the
 * same reason: telemetry is the easiest place in an application to leak a document
 * by accident, because it is written by the code that already has the text in hand.
 *
 * Deliberate simplification: the digest of a prompt is its **length and identity**
 * (prompt version, profile, domain, selection size) rather than a SHA-256 hash.
 * Browsers expose no synchronous digest, and hashing asynchronously would delay the
 * review's return to compute a value only support reads. If a hash is needed later,
 * upgrade path: `crypto.subtle.digest` after the result is returned, off the
 * critical path.
 */

import type { SemanticFailureCode, SemanticStage } from "./failures";
import { logger } from "../../shared/utils/logger";

/** Which corpus the profile was judged as, as the prompt framed it. */
export type TelemetryDomain = "general" | "constructionExpert";

export interface ReviewStartedEvent {
  event: "review.started";
  runId: string;
  profileId: string;
  profileRevision: number;
  domain: TelemetryDomain;
  selectionChars: number;
  promptVersion: number;
}

export interface ReviewStageCompletedEvent {
  event: "review.stage_completed";
  runId: string;
  stage: SemanticStage;
  durationMs: number;
  /** `ok` unless the stage ended in a refusal or a fault. */
  status: "ok" | "refused" | "failed";
}

export interface ReviewCompletedEvent {
  event: "review.completed";
  runId: string;
  actionable: boolean;
  hasProposal: boolean;
  preservationPassed: boolean;
  totalDurationMs: number;
  attempt: number;
}

export interface ReviewFailedEvent {
  event: "review.failed";
  runId: string;
  stage: SemanticStage;
  failureCode: SemanticFailureCode;
  totalDurationMs: number;
}

export interface ReviewAppliedEvent {
  event: "review.applied";
  applyId: string;
  runId: string | null;
  preservationPassed: boolean;
}

export interface ReviewApplyFailedEvent {
  event: "review.apply_failed";
  applyId: string;
  runId: string | null;
  failureCode: SemanticFailureCode;
}

export interface ReviewCancelledEvent {
  event: "review.cancelled";
  runId: string;
  stage: SemanticStage;
}

export type SemanticReviewTelemetryEvent =
  | ReviewStartedEvent
  | ReviewStageCompletedEvent
  | ReviewCompletedEvent
  | ReviewFailedEvent
  | ReviewAppliedEvent
  | ReviewApplyFailedEvent
  | ReviewCancelledEvent;

/**
 * Record one event.
 *
 * A single function rather than a call per site, so an event that must not carry
 * certain fields has exactly one place to enforce it, and so a deployment that
 * later attaches a sink does not have to find every emit site.
 */
export function emitTelemetry(telemetryEvent: SemanticReviewTelemetryEvent): void {
  logger.info(`semantic telemetry: ${telemetryEvent.event}`, { ...telemetryEvent });
}

/**
 * What a prompt looked like, without the prompt.
 *
 * `promptLength` is the whole size, so a report can say "the prompt was large"
 * without the report carrying it.
 */
export interface PromptDigest {
  promptVersion: number;
  promptLength: number;
  profileId: string;
  profileRevision: number;
  domain: TelemetryDomain;
  selectionChars: number;
}

export interface ResponseDigest {
  responseLength: number;
  parsedSuccessfully: boolean;
  /** The repair steps that ran, in order. Empty when the first answer parsed. */
  repairStepsApplied: readonly string[];
  zodIssueCount: number;
}

export function buildPromptDigest(input: {
  promptVersion: number;
  prompt: string;
  profileId: string;
  profileRevision: number;
  domain: TelemetryDomain;
  selectionChars: number;
}): PromptDigest {
  return {
    promptVersion: input.promptVersion,
    promptLength: input.prompt.length,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    domain: input.domain,
    selectionChars: input.selectionChars,
  };
}

export function buildResponseDigest(input: {
  responseText: string;
  parsedSuccessfully: boolean;
  repairStepsApplied: readonly string[];
  zodIssueCount: number;
}): ResponseDigest {
  return {
    responseLength: input.responseText.length,
    parsedSuccessfully: input.parsedSuccessfully,
    repairStepsApplied: [...input.repairStepsApplied],
    zodIssueCount: input.zodIssueCount,
  };
}
