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
import {
  SemanticReviewError,
  classifyProviderFailure,
  stageForCode,
  type SemanticStage,
} from "./failures";
import { REPAIR_INSTRUCTION, buildSemanticReviewPrompt } from "./reviewPrompt";
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
 * The least time a repair attempt is worth starting in.
 *
 * The repair is a second provider call inside the same stage, so one that cannot
 * finish before the stage deadline would turn a refusal the user can act on into
 * a timeout they cannot. Below this, the first failure is reported as it stands.
 */
const REPAIR_SUB_BUDGET_MS = 5_000;

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
  /**
   * Reported as the engine moves between stages.
   *
   * The engine knows which stage it is in and the surface does not, so without
   * this a progress indicator can only show one sentence for the whole run —
   * which is worse than none, because it claims to know something it does not.
   */
  onStage?: (stage: SemanticStage) => void;
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
  const report = (stage: SemanticStage): void => opts.onStage?.(stage);

  let prompt: string;
  try {
    report("prompt_build");
    prompt = buildSemanticReviewPrompt(request, { includeRawText: opts.includeRawText });
  } catch (error: unknown) {
    /*
     * The builder refuses before a prompt string exists when consent is absent, so
     * this is reachable only if a caller bypassed the literal `true`. The code says
     * which gate was hit, because "nothing was sent" is the fact the user needs and
     * the builder's own sentence is written for a developer.
     */
    logger.warn("Semantic review refused to build a prompt", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new SemanticReviewError(
      "The review could not be prepared, so nothing was sent.",
      "E_PROMPT_CONSENT_GATE",
    );
  }
  const registry = opts.registry ?? createLlmRegistry();
  const clock = opts.now ?? (() => Date.now());
  const started = clock();

  /*
   * One call, and at most one repair.
   *
   * The adapter retries a transient *transport* failure, with backoff and jitter,
   * and it is the only layer that does — three engine attempts across three
   * adapter attempts is nine requests for one user action. An unreadable answer is
   * a different failure: the transport succeeded and the content did not, so
   * retrying it unchanged would only produce the same answer again. The repair
   * re-asks once with the instruction that was missing, and only when it can
   * finish inside the stage, because starting one that cannot would turn a
   * refusal the user can act on into a timeout they cannot.
   */
  let reviewed: { response: LlmResponse; parsed: ParsedResponse };
  try {
    reviewed = await (async (): Promise<{
      response: LlmResponse;
      parsed: ParsedResponse;
    }> => {
      const stage = stageBudget(opts.signal, PROVIDER_STAGE_TIMEOUT_MS, clock);
      try {
        report("provider_call");
        const first = await callProvider(registry, prompt, stage.signal);
        if (first.parsed.success || stage.remainingMs() < REPAIR_SUB_BUDGET_MS) return first;

        logger.warn("Semantic review response could not be read; asking the model to repair it", {
          issues: first.parsed.error.issues.length,
        });
        const repaired = await callProvider(registry, prompt + REPAIR_INSTRUCTION, stage.signal);
        return {
          // Every call this request cost, so the count stays a measurement.
          response: {
            ...repaired.response,
            attempt: (first.response.attempt ?? 1) + (repaired.response.attempt ?? 1),
          },
          parsed: repaired.parsed,
        };
      } finally {
        stage.cancel();
      }
    })();
  } catch (error: unknown) {
    /*
     * A transport failure is given a code here, from the status the adapter
     * recorded and whether the caller aborted — never from the message, which is
     * redacted and written for a log. The message is kept for that log.
     */
    const abortedByCaller = opts.signal?.aborted === true;
    const code = classifyProviderFailure(error, abortedByCaller);
    logger.warn("Semantic review provider call failed", {
      provider: registry.name,
      code,
      abortedByCaller,
    });
    throw new SemanticReviewError(error instanceof Error ? error.message : String(error), code, {
      provider: registry.name,
      stage: stageForCode(code),
      abortedByCaller,
    });
  }

  const { response, parsed } = reviewed;
  report("response_parse");

  if (response.text.trim().length === 0) {
    throw new SemanticReviewError(
      "The model returned an empty answer. Nothing has been changed in the document.",
      "E_RESPONSE_EMPTY",
      { responseLength: 0 },
    );
  }

  if (!parsed.success) {
    logger.warn("Semantic review response failed validation", {
      issues: parsed.error.issues.length,
    });
    throw new SemanticReviewError(
      "The model did not return a usable semantic review. Nothing has been changed in the document.",
      "E_RESPONSE_SCHEMA_INVALID",
      { issues: parsed.error.issues.length },
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
  report("preservation_check");
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

/** What one provider call produced, parsed. */
type ParsedResponse = ReturnType<typeof SemanticReviewResponseSchema.safeParse>;

/**
 * Ask the provider once, and parse what it answered.
 *
 * The repair path calls this twice, so the call and its parse are one unit: two
 * call sites parsing differently would be two implementations of one contract.
 */
async function callProvider(
  registry: LlmSemanticProvider,
  prompt: string,
  signal: AbortSignal,
): Promise<{ response: LlmResponse; parsed: ParsedResponse }> {
  const response = await registry.review({ prompt, signal });
  return { response, parsed: SemanticReviewResponseSchema.safeParse(parseJson(response.text)) };
}

/**
 * A deadline for one stage, combined with the caller's abort.
 *
 * The adapter bounds a single provider call; this bounds the stage that contains
 * the call, the repair, and any retries inside them. `remainingMs` is what lets a
 * caller decide whether another call still fits, and `cancel` clears the timer and
 * the forwarding listener so a finished stage leaves nothing behind to fire later.
 */
function stageBudget(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  now: () => number,
): { signal: AbortSignal; remainingMs: () => number; cancel: () => void } {
  const controller = new AbortController();
  const deadline = now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = (): void => controller.abort();
  if (parent !== undefined) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - now()),
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forward);
    },
  };
}
