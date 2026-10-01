/**
 * The Semantic Review engine.
 *
 * One call, one answer: an assessment of the selection against the profile, and
 * at most one proposed revision. Everything the product knows about whether that
 * revision may be applied is decided here, from checks a reader can audit —
 * never from a number the model reported about its own work.
 *
 * **Three properties are load-bearing, and the third is the one the old engine
 * got wrong.**
 *
 * 1. **Nothing is sent without explicit opt-in.** The prompt builder throws
 *    before a prompt string exists, and this engine has no other route to the
 *    provider.
 * 2. **The proposal must replace the whole selection.** A revision whose `original`
 *    is not the selection, character for character, is refused — not applied to a
 *    range it cannot describe.
 * 3. **`actionable` is computed here.** The old rewrite engine gated on
 *    `confidence >= 0.7`, and a model's confidence in a prose rewrite is evidence
 *    that the model felt sure, not that a number survived. The three checks
 *    below are different in kind:
 *
 *    - **Preservation.** The local validator compares the two texts. A hard
 *      failure means a figure, a date, a reference or a party moved.
 *    - **The model's own meaning flags.** A model that says it may have reversed a
 *      causation is reporting a real risk about its own reasoning. Treated as
 *      evidence and never as proof, and a single `false` disables Apply.
 *    - **The selection is addressed.** The anchor must name a span that exists.
 *
 *    A result can therefore be non-actionable with a confident model and
 *    actionable with a hesitant one, which is the correct relationship: the
 *    question is what the text says, not how sure the model is.
 */

import { v4 as uuidv4 } from "uuid";

import { createLlmRegistry } from "../../ai/providers/registry";
import { LlmError, type LlmSemanticProvider } from "../../ai/providers/LlmProvider";
import { withRetry } from "../../ai/providers/retry";
import { logger } from "../../shared/utils/logger";
import { validatePreservation } from "./preservationValidator";
import { buildSemanticReviewPrompt } from "./reviewPrompt";
import { SemanticReviewResponseSchema } from "./reviewSchema";
import {
  unpreservedFlags,
  type ProviderMetadata,
  type SemanticReviewRequest,
  type SemanticReviewResult,
} from "./contracts";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1000;

export interface SemanticReviewEngineOptions {
  /** Explicit consent to send the selection to the provider. */
  includeRawText: true;
  signal?: AbortSignal;
  registry?: LlmSemanticProvider;
  /** Mints the session id; injectable so a caller can drive the session itself. */
  newSessionId?: () => string;
  /** Injected so latency is a measurement rather than a test artefact. */
  now?: () => number;
}

/**
 * Review `request.selectedText` against the profile in `request.semantic`.
 *
 * Throws on a transport or validation failure — there is no review in that case,
 * and returning an empty assessment would present a failure as a judgement. A
 * model that answered with something that is not a review produces no proposal,
 * and the user is told that rather than shown an empty card.
 */
export async function reviewSemanticSelection(
  request: SemanticReviewRequest,
  opts: SemanticReviewEngineOptions,
): Promise<SemanticReviewResult> {
  const prompt = buildSemanticReviewPrompt(request, {
    includeRawText: opts.includeRawText,
  });
  const registry = opts.registry ?? createLlmRegistry();
  const clock = opts.now ?? (() => Date.now());
  const started = clock();

  let attempt = 0;
  const response = await withRetry(
    async () => {
      attempt += 1;
      return registry.review({ prompt, ...(opts.signal ? { signal: opts.signal } : {}) });
    },
    {
      maxRetries: DEFAULT_MAX_RETRIES,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      isRetryable: (err: unknown) => {
        // A caller-driven abort is not a failure to retry: retrying it would keep
        // a request alive the user just cancelled. Checked before the error's own
        // verdict, because an abort surfaces as an ordinary retryable `LlmError`
        // on some providers.
        if (opts.signal?.aborted === true) return false;
        if (err instanceof LlmError) return err.retryable;
        return true;
      },
    },
  );

  const parsed = SemanticReviewResponseSchema.safeParse(parseJson(response.text));
  if (!parsed.success) {
    logger.warn("Semantic review response failed validation", {
      issues: parsed.error.issues.length,
    });
    throw new Error(
      "The model did not return a usable semantic review. Nothing has been changed in the document.",
    );
  }

  const { assessment, proposedRevision, meaningPreservation } = parsed.data;

  const providerMetadata: ProviderMetadata = {
    provider: registry.name,
    model: response.model,
    latencyMs: Math.max(0, clock() - started),
    attempt,
  };

  const base = {
    reviewSessionId: opts.newSessionId?.() ?? uuidv4(),
    profileId: request.profile.id,
    profileRevision: request.profile.revision,
    assessment,
    meaningPreservation,
    providerMetadata,
    selectionAnchor: request.selectionAnchor,
  };

  /*
   * No proposal is a legitimate answer — the selection may already match — and it
   * is not a failure. The report still describes what was checked, so the pane can
   * show "nothing to change" with the reason rather than an empty card.
   */
  if (proposedRevision === undefined) {
    return {
      ...base,
      preservation: validatePreservation(request.selectedText, request.selectedText),
      actionable: false,
      refusalReason: "The model found no change worth proposing for this selection.",
    };
  }

  /*
   * The revision must replace the selection and nothing else.
   *
   * Compared after trimming, because a model that reproduces the selection with
   * one trailing space has still reproduced it. Compared at all, because a
   * revision scoped to a span the model chose is a change whose extent the user
   * was never shown.
   */
  if (proposedRevision.original.trim() !== request.selectedText.trim()) {
    logger.warn("Semantic review proposed a revision against a different span");
    return {
      ...base,
      preservation: validatePreservation(request.selectedText, proposedRevision.revised),
      actionable: false,
      refusalReason:
        "The model's revision did not match the selected text, so it cannot be applied to this selection. Nothing has been changed in the document.",
    };
  }

  const preservation = validatePreservation(request.selectedText, proposedRevision.revised);
  const unpreserved = unpreservedFlags(meaningPreservation);

  const refusal = !preservation.pass
    ? preservation.summary
    : unpreserved.length > 0
      ? `The model reports that the revision may not have preserved ${unpreserved.join(", ")}. Review it before applying.`
      : preservation.requiresAcknowledgement
        ? "Review carefully: some details this validator could not classify have changed."
        : null;

  const actionable =
    refusal === null || (preservation.requiresAcknowledgement && unpreserved.length === 0);

  return {
    ...base,
    proposedRevision: proposedRevision.revised,
    preservation,
    actionable,
    ...(refusal === null ? {} : { refusalReason: refusal }),
  };
}

/**
 * Parse model output, tolerating a fenced code block.
 *
 * Models routinely wrap JSON in ```json fences despite being told not to, and
 * discarding an otherwise valid review over formatting is a refusal the user
 * cannot act on. Unparseable output is "not a review", not a crash: returning a
 * sentinel lets the schema produce one clear message rather than surfacing a
 * SyntaxError with a character offset in it.
 */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
