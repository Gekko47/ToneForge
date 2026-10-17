/**
 * The sentences a semantic review failure shows a person, and the control that
 * resolves it.
 *
 * **The words live here, not beside the code that raises the failure.** The engine
 * throws a `SemanticFailureCode`; this table is the only place that decides what a
 * person reads for it, so the pane, the live region and the troubleshooting
 * registry cannot drift into three accounts of the same failure.
 *
 * Two rules govern every entry:
 *
 * 1. **State what failed, then name the next action.** No stack traces, no Zod
 *    paths, no HTTP statuses, no provider text. A failure the user cannot act on is
 *    a dead end, and a dead end is the thing this table exists to prevent.
 * 2. **Say whether the document changed.** Everything up to the write has changed
 *    nothing, and says so; a failure during the write says the write did not
 *    complete, because "nothing happened" and "something may have happened" are
 *    different facts and only one of them is safe to assume.
 */

import {
  type SemanticFailureCode,
  type SemanticStage,
  isSemanticReviewError,
  stageForCode,
} from "../../analysis/semantic/failures";

/** What the user presses to resolve a failure, and where it sends them. */
export type SemanticRecovery =
  | { kind: "open-settings"; label: string }
  | { kind: "open-semantic-style"; label: string }
  | { kind: "read-selection"; label: string }
  | { kind: "retry"; label: string }
  | { kind: "regenerate"; label: string }
  | { kind: "change-selection"; label: string };

export interface SemanticFailureCopy {
  /** The sentence the live region speaks. */
  message: string;
  /** The control rendered beside it. */
  recovery: SemanticRecovery;
}

const OPEN_SETTINGS = (label: string): SemanticRecovery => ({ kind: "open-settings", label });
const RETRY = (label: string): SemanticRecovery => ({ kind: "retry", label });

/**
 * Every code's copy, as a record so a code without an entry does not compile.
 *
 * That exhaustiveness is the point: a new failure added to the taxonomy fails the
 * build here rather than reaching a user as an empty string.
 */
const COPY: Readonly<Record<SemanticFailureCode, SemanticFailureCopy>> = {
  E_INPUT_NO_CONSENT: {
    message: "Semantic review needs your permission before it can send text to a provider.",
    recovery: OPEN_SETTINGS("Open LLM Settings"),
  },
  E_INPUT_NO_PROVIDER: {
    message: "No AI provider is configured, so there is nothing to ask.",
    recovery: OPEN_SETTINGS("Open LLM Settings"),
  },
  E_INPUT_NO_PROFILE: {
    message: "There is no semantic style to review against yet.",
    recovery: { kind: "open-semantic-style", label: "Open Semantic Style" },
  },
  E_INPUT_NO_SELECTION: {
    message: "Select the paragraph or text you want ToneForge to review.",
    recovery: { kind: "read-selection", label: "Use current selection" },
  },
  E_INPUT_SELECTION_TOO_LONG: {
    message: "That selection is longer than a single review allows. Select less of it.",
    recovery: { kind: "change-selection", label: "Use current selection" },
  },
  E_PROMPT_CONSENT_GATE: {
    message: "The review could not be prepared, so nothing was sent.",
    recovery: RETRY("Review selection"),
  },
  E_PROVIDER_AUTH: {
    message: "Your provider rejected the connection. Check your credentials in LLM Settings.",
    recovery: OPEN_SETTINGS("Open LLM Settings"),
  },
  E_PROVIDER_RATE_LIMIT: {
    message: "Your provider is busy. Try again in a moment.",
    recovery: RETRY("Try again"),
  },
  E_PROVIDER_SERVER: {
    message: "Your provider returned an error. Try again.",
    recovery: RETRY("Try again"),
  },
  E_PROVIDER_CONTENT_FILTER: {
    message: "Your provider declined to review this text. Try a different selection.",
    recovery: { kind: "change-selection", label: "Use current selection" },
  },
  E_PROVIDER_UNREACHABLE: {
    message: "Could not reach your provider. Check your connection and try again.",
    recovery: RETRY("Try again"),
  },
  E_PROVIDER_UNCONFIGURED: {
    message: "The provider connection is not usable. Check it in LLM Settings.",
    recovery: OPEN_SETTINGS("Open LLM Settings"),
  },
  E_PROVIDER_CANCELLED: {
    message: "The review was cancelled. Nothing has been changed in the document.",
    recovery: RETRY("Review selection"),
  },
  E_PROVIDER_TRANSIENT: {
    message: "Something went wrong asking your provider. Try again.",
    recovery: RETRY("Try again"),
  },
  E_PROVIDER_OFFLINE: {
    message: "You appear to be offline. Semantic review needs a connection to your provider.",
    recovery: RETRY("Try again"),
  },
  E_RESPONSE_EMPTY: {
    message: "The model returned an empty answer. Nothing has been changed in the document.",
    recovery: RETRY("Try again"),
  },
  E_RESPONSE_SCHEMA_INVALID: {
    message:
      "The model's answer did not match the expected format. Nothing has been changed in the document.",
    recovery: RETRY("Try again"),
  },
  E_PRESERVATION_SPAN_MISMATCH: {
    message:
      "The model's revision did not match the selected text, so it cannot be applied. Nothing has been changed in the document.",
    recovery: { kind: "regenerate", label: "Regenerate review" },
  },
  E_PRESERVATION_FACT_MOVED: {
    message:
      "The revision changes a protected fact — a date, number, name or reference — so it cannot be applied. Nothing has been changed in the document.",
    recovery: { kind: "regenerate", label: "Regenerate review" },
  },
  E_PRESERVATION_MEANING_FLAG: {
    message:
      "The model reports it may not have preserved part of the meaning. Review it carefully before applying.",
    recovery: { kind: "regenerate", label: "Regenerate review" },
  },
  E_APPLY_NOT_ACTIONABLE: {
    message: "This revision cannot be applied. Review the selection again.",
    recovery: { kind: "regenerate", label: "Regenerate review" },
  },
  E_APPLY_TARGET_NOT_FOUND: {
    message:
      "The selected text could not be located in the document, so nothing was written. It may have changed since the review.",
    recovery: { kind: "read-selection", label: "Use current selection" },
  },
  E_APPLY_HOST_UNSUPPORTED: {
    message:
      "This version of Word cannot write a partial-paragraph revision. Select the whole paragraph and review it again.",
    recovery: { kind: "change-selection", label: "Use current selection" },
  },
  E_APPLY_FAILED: {
    message:
      "The revision could not be written, so the write did not finish. Check for a partial tracked change before retrying.",
    recovery: RETRY("Try again"),
  },
};

/** The copy for a code. Total by construction — every code has an entry. */
export function failureCopy(code: SemanticFailureCode): SemanticFailureCopy {
  return COPY[code];
}

/**
 * The copy for whatever was thrown.
 *
 * A known failure carries its code; anything else is reported as a transient
 * provider failure, which is the honest default: an unrecognised throw from this
 * path is a provider or transport problem far more often than anything else, and
 * the alternative — showing the raw message — is the internals leak the taxonomy
 * exists to prevent.
 */
export function failureCopyFor(error: unknown): {
  code: SemanticFailureCode;
  stage: SemanticStage;
  message: string;
  recovery: SemanticRecovery;
} {
  if (isSemanticReviewError(error)) {
    const { message, recovery } = COPY[error.code];
    return { code: error.code, stage: error.stage, message, recovery };
  }
  const fallback = COPY.E_PROVIDER_TRANSIENT;
  return {
    code: "E_PROVIDER_TRANSIENT",
    stage: stageForCode("E_PROVIDER_TRANSIENT"),
    message: fallback.message,
    recovery: fallback.recovery,
  };
}

/** The progress sentence for a stage, shown while the review is running. */
export const STAGE_LABEL: Readonly<Record<SemanticStage, string>> = {
  input_validation: "Checking your selection…",
  prompt_build: "Preparing the review…",
  provider_call: "Asking your provider…",
  response_parse: "Reading the answer…",
  preservation_check: "Checking what changed…",
  apply: "Writing the revision…",
};

/**
 * The progress sentence for a stage, or null for a state that is not one.
 *
 * The page's stage state also carries `idle`, `done` and `failed`, which are not
 * stages and have no sentence — returning null for them keeps the page from
 * claiming that a finished run is "asking your provider".
 */
export function stageLabel(stage: string): string | null {
  return stage in STAGE_LABEL ? STAGE_LABEL[stage as SemanticStage] : null;
}
