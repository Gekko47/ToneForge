/**
 * The stages a semantic review passes through, and the codes a failure carries.
 *
 * **Why a code rather than a message.** A review can fail for two dozen distinct
 * reasons, and the user-facing sentence for each is written once, in the pane,
 * where it can name the control that resolves it. Deciding which sentence belongs
 * to a failure by matching the failure's own text is how a message meant for a log
 * becomes a message shown to a person — and how the two stop agreeing the first
 * time either is reworded. The engine throws a code; the surface owns the words.
 *
 * `classifyProviderFailure` reads fields, never message text, for the same reason.
 * It distinguishes an auth refusal from a rate limit from an unreachable provider
 * by the HTTP status the adapter recorded and by whether the failure was retryable
 * at all — not by looking for "429" inside a string that has been redacted.
 */

import { LlmError } from "../../ai/providers/LlmProvider";

/**
 * The six observable stages, in the order they run.
 *
 * Stages 1-5 run during a review; `apply` runs when the user writes an approved
 * revision. A stage is a promise to the user about what is happening now, so the
 * set is deliberately small enough that each one has a sentence a person would say.
 */
export const SEMANTIC_STAGES = [
  "input_validation",
  "prompt_build",
  "provider_call",
  "response_parse",
  "preservation_check",
  "apply",
] as const;
export type SemanticStage = (typeof SEMANTIC_STAGES)[number];

/**
 * Every way a semantic review or its application can fail.
 *
 * Grouped by the stage that raises them, and exported as data because the
 * troubleshooting registry and the pane's copy table both need to be exhaustive
 * over the set: a code added here without copy is a failure the user sees as
 * nothing at all.
 */
export const SEMANTIC_FAILURE_CODES = [
  // input_validation
  "E_INPUT_NO_CONSENT",
  "E_INPUT_NO_PROVIDER",
  "E_INPUT_NO_PROFILE",
  "E_INPUT_NO_SELECTION",
  "E_INPUT_SELECTION_TOO_LONG",
  // prompt_build
  "E_PROMPT_CONSENT_GATE",
  // provider_call
  "E_PROVIDER_AUTH",
  "E_PROVIDER_RATE_LIMIT",
  "E_PROVIDER_SERVER",
  "E_PROVIDER_CONTENT_FILTER",
  "E_PROVIDER_UNREACHABLE",
  "E_PROVIDER_UNCONFIGURED",
  "E_PROVIDER_CANCELLED",
  "E_PROVIDER_TRANSIENT",
  // response_parse
  "E_RESPONSE_EMPTY",
  "E_RESPONSE_SCHEMA_INVALID",
  // preservation_check
  "E_PRESERVATION_SPAN_MISMATCH",
  "E_PRESERVATION_FACT_MOVED",
  "E_PRESERVATION_MEANING_FLAG",
  // apply
  "E_APPLY_NOT_ACTIONABLE",
  "E_APPLY_TARGET_NOT_FOUND",
  "E_APPLY_HOST_UNSUPPORTED",
  "E_APPLY_FAILED",
] as const;
export type SemanticFailureCode = (typeof SEMANTIC_FAILURE_CODES)[number];

const STAGE_BY_CODE: Readonly<Record<SemanticFailureCode, SemanticStage>> = {
  E_INPUT_NO_CONSENT: "input_validation",
  E_INPUT_NO_PROVIDER: "input_validation",
  E_INPUT_NO_PROFILE: "input_validation",
  E_INPUT_NO_SELECTION: "input_validation",
  E_INPUT_SELECTION_TOO_LONG: "input_validation",
  E_PROMPT_CONSENT_GATE: "prompt_build",
  E_PROVIDER_AUTH: "provider_call",
  E_PROVIDER_RATE_LIMIT: "provider_call",
  E_PROVIDER_SERVER: "provider_call",
  E_PROVIDER_CONTENT_FILTER: "provider_call",
  E_PROVIDER_UNREACHABLE: "provider_call",
  E_PROVIDER_UNCONFIGURED: "provider_call",
  E_PROVIDER_CANCELLED: "provider_call",
  E_PROVIDER_TRANSIENT: "provider_call",
  E_RESPONSE_EMPTY: "response_parse",
  E_RESPONSE_SCHEMA_INVALID: "response_parse",
  E_PRESERVATION_SPAN_MISMATCH: "preservation_check",
  E_PRESERVATION_FACT_MOVED: "preservation_check",
  E_PRESERVATION_MEANING_FLAG: "preservation_check",
  E_APPLY_NOT_ACTIONABLE: "apply",
  E_APPLY_TARGET_NOT_FOUND: "apply",
  E_APPLY_HOST_UNSUPPORTED: "apply",
  E_APPLY_FAILED: "apply",
};

/** The stage a code belongs to, so a caller never restates the pairing. */
export function stageForCode(code: SemanticFailureCode): SemanticStage {
  return STAGE_BY_CODE[code];
}

/**
 * A failure with a machine-readable cause.
 *
 * `detail` is redacted diagnostic context — a status, a count, a stage — never
 * document text, and it exists for the diagnostic report rather than for the
 * user's sentence. The message is kept for the log; the pane does not render it.
 */
export class SemanticReviewError extends Error {
  constructor(
    message: string,
    public readonly code: SemanticFailureCode,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SemanticReviewError";
  }

  get stage(): SemanticStage {
    return stageForCode(this.code);
  }
}

export function isSemanticReviewError(error: unknown): error is SemanticReviewError {
  return error instanceof SemanticReviewError;
}

/**
 * Which provider failure this is, decided from fields rather than message text.
 *
 * `abortedByCaller` is passed in because only the caller knows whether the abort
 * was theirs: an aborted request and a timed-out one both surface as an
 * `AbortError`, and they need different sentences.
 *
 * A status of 400 or 422 is read as the provider declining this request. For a
 * review that means the text, which the user can act on by changing the
 * selection — unlike the same status on a malformed request, which is a bug in
 * the add-in and would be a 500 here. The distinction is recorded rather than
 * guessed at silently.
 */
export function classifyProviderFailure(
  error: unknown,
  abortedByCaller: boolean,
): SemanticFailureCode {
  if (abortedByCaller) return "E_PROVIDER_CANCELLED";
  if (error instanceof DOMException && error.name === "AbortError") return "E_PROVIDER_CANCELLED";
  if (error instanceof LlmError) {
    if (error.status === 401 || error.status === 403) return "E_PROVIDER_AUTH";
    if (error.status === 429) return "E_PROVIDER_RATE_LIMIT";
    if (error.status !== undefined && error.status >= 500) return "E_PROVIDER_SERVER";
    if (error.status === 400 || error.status === 422) return "E_PROVIDER_CONTENT_FILTER";
    // No status at all: the request never reached a provider. A retryable one is
    // a timeout or a network fault; a non-retryable one is a connection this
    // add-in was never given.
    return error.retryable ? "E_PROVIDER_UNREACHABLE" : "E_PROVIDER_UNCONFIGURED";
  }
  return "E_PROVIDER_TRANSIENT";
}
