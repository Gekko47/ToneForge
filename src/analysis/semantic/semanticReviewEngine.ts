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
import { type LlmResponse, type LlmSemanticProvider } from "../../ai/providers/LlmProvider";
import { logger } from "../../shared/utils/logger";
import { validatePreservation } from "./preservationValidator";
import { buildSemanticReviewPrompt } from "./reviewPrompt";
import { SemanticReviewResponseSchema } from "./reviewSchema";
import {
  MeaningPreservationAssessmentSchema,
  unpreservedFlags,
  type MeaningPreservationAssessment,
  type ProviderMetadata,
  type SemanticAssessment,
  type SemanticReviewRequest,
  type SemanticReviewResult,
} from "./contracts";

/**
 * The whole provider stage's budget, retries included.
 *
 * The adapter's own deadline bounds a single call; this bounds the stage around
 * it, so a provider that answers slowly three times over cannot hold the review
 * open indefinitely. It is deliberately longer than the adapter's largest
 * per-request timeout, so it fires only when the stage as a whole is stuck.
 */
const PROVIDER_STAGE_TIMEOUT_MS = 90_000;

/**
 * All five flags preserved — the value used when the model states none.
 *
 * Derived from the schema rather than written out, so the "all preserved" state
 * has one definition: the same one a partial assessment fills into.
 */
const DEFAULT_MEANING_PRESERVATION: MeaningPreservationAssessment =
  MeaningPreservationAssessmentSchema.parse({});

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

  /*
   * One call, and no retry here.
   *
   * The adapter retries a transient failure, with backoff and jitter, and it is
   * the only layer that does. Three engine attempts across three adapter attempts
   * is nine requests for one user action, and the outer layer only delayed the
   * failure the user was already waiting for. The stage budget still bounds the
   * whole thing, so a provider that hangs cannot keep the review open forever.
   */
  const stage = stageBudget(opts.signal, PROVIDER_STAGE_TIMEOUT_MS);
  let response: LlmResponse;
  try {
    response = await registry.review({ prompt, signal: stage.signal });
  } finally {
    stage.cancel();
  }

  const parsed = SemanticReviewResponseSchema.safeParse(parseJson(response.text));
  if (!parsed.success) {
    logger.warn("Semantic review response failed validation", {
      issues: parsed.error.issues.length,
    });
    throw new Error(
      "The model did not return a usable semantic review. Nothing has been changed in the document.",
    );
  }

  const { assessment: reported, proposedRevision, rationale: reportedRationale } = parsed.data;

  /*
   * The two fields the model may omit are filled here, not refused.
   *
   * An omitted flag is not a claim that the meaning was lost, and an omitted
   * rationale can be replaced by a sentence about the same selection. Neither is
   * a reason to discard a review the user has paid for, and both are logged so a
   * prompt that quietly stopped asking for them stays visible.
   */
  const assessment = withDefaultObservation(reported);
  const meaningPreservation = parsed.data.meaningPreservation ?? DEFAULT_MEANING_PRESERVATION;
  if (parsed.data.meaningPreservation === undefined) {
    logger.warn("Semantic review omitted its meaning-preservation flags; assuming preserved");
  }

  const providerMetadata: ProviderMetadata = {
    provider: registry.name,
    model: response.model,
    latencyMs: Math.max(0, clock() - started),
    // The adapter reports the calls it actually made; a provider that reports
    // nothing made one.
    attempt: response.attempt ?? 1,
  };

  const base = {
    reviewSessionId: opts.newSessionId?.() ?? uuidv4(),
    profileId: request.profile.id,
    profileRevision: request.profile.revision,
    assessment,
    rationale: reportedRationale ?? assessment.summary,
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
 * Guarantee the assessment names at least one dimension.
 *
 * The schema accepts an empty list so a model that answers with an assessment but
 * no dimension detail is not refused outright. The surface still needs a row, and
 * one that says plainly that nothing specific was named is honest about what the
 * model actually did.
 */
function withDefaultObservation(assessment: SemanticAssessment): SemanticAssessment {
  if (assessment.observations.length > 0) return assessment;
  logger.warn("Semantic review returned no observations; substituting a placeholder");
  return {
    ...assessment,
    observations: [
      {
        dimension: "tone",
        alignment: "aligned",
        explanation: "The model named no specific deviations.",
      },
    ],
  };
}

/**
 * Parse model output, tolerating a fence or surrounding prose.
 *
 * Models routinely wrap JSON in ```json fences despite being told not to, and
 * sometimes prefix it with a sentence or trail one after it. Discarding an
 * otherwise valid review over either is a refusal the user cannot act on.
 * Unparseable output is "not a review", not a crash: returning a sentinel lets
 * the schema produce one clear message rather than surfacing a SyntaxError with a
 * character offset in it.
 */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const braced = outermostObject(body);
  const candidates = braced === null || braced === body ? [body] : [body, braced];
  const parsed = candidates
    .map((candidate) => {
      try {
        return { ok: true as const, value: JSON.parse(candidate) as unknown };
      } catch {
        // The next candidate is tried; a parse failure here is not fatal yet.
        return { ok: false as const, value: null };
      }
    })
    .find((attempt) => attempt.ok);
  return parsed?.ok === true ? parsed.value : null;
}

/**
 * The outermost `{ ... }` in the text, or null when there is none.
 *
 * Scans to the matching brace rather than taking the last `}`: a response with an
 * object followed by prose has both an opening and a closing brace, and a nested
 * object closes more than once. String contents are skipped so a brace inside a
 * quoted value is not counted.
 */
function outermostObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const chars = Array.from(text.slice(start));
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  chars.some((char, offset) => {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      return false;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = start + offset;
        return true;
      }
    }
    return false;
  });
  return end === -1 ? null : text.slice(start, end + 1);
}

/**
 * A deadline for one stage, combined with the caller's abort.
 *
 * The adapter bounds a single provider call; this bounds the stage that contains
 * the call and any retries inside it. `cancel` clears the timer and the forwarding
 * listener, so a finished stage leaves nothing behind to fire later.
 */
function stageBudget(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = (): void => controller.abort();
  if (parent !== undefined) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forward);
    },
  };
}
