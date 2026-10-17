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

import { PROMPT_VERSION } from "./reviewPrompt";
import { emitTelemetry } from "./telemetry";

import { createLlmRegistry } from "../../ai/providers/registry";
import {
  LlmError,
  type LlmAttemptTiming,
  type LlmSemanticProvider,
  type LlmResponse,
} from "../../ai/providers/LlmProvider";
import { logger } from "../../shared/utils/logger";
import { normalizeLineEndings, stripParagraphMark } from "../../shared/utils/text";
import { validatePreservation } from "./preservationValidator";
import {
  SemanticReviewError,
  classifyProviderFailure,
  stageForCode,
  type SemanticFailureCode,
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
  type StageTimings,
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
  /**
   * Identifies this attempt, so a telemetry event and a diagnostic report share a
   * key. Minted here when the caller does not supply one.
   */
  runId?: string;
  /**
   * The provider stage's own deadline.
   *
   * Overridable so a test can drive the boundary — a deadline that fires is a
   * failure mode worth asserting, and waiting the real ninety seconds for it is not.
   */
  stageTimeoutMs?: number;
  /**
   * The most tokens one review may generate, passed to the provider.
   *
   * A review is a bounded object, so an unbounded completion buys nothing but time.
   * A live run wrote about 9.5k tokens for a review of an 882-character selection and
   * took 83-96 seconds doing it. Absent means the provider's own default.
   */
  maxTokens?: number;
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
  const runId = opts.runId ?? uuidv4();

  /*
   * Stage bookkeeping in one place.
   *
   * Each `begin` closes the stage before it, so durations come from the gaps
   * between transitions rather than from a matching `end` at every exit — of which
   * there are several, and one of them is an exception. A stage that never began is
   * absent from the timings rather than present as a zero.
   */
  const stageTimings: StageTimings = {};
  let openStage: SemanticStage | null = null;
  // Set by the first `begin`, and never read before it: the first close has nothing
  // open to close. Kept out of the clock's declaration order on purpose, because the
  // prompt is built before the clock exists.
  let openStageAt = 0;

  const closeOpenStage = (): void => {
    if (openStage === null) return;
    const durationMs = Math.max(0, clock() - openStageAt);
    stageTimings[openStage] = durationMs;
    emitTelemetry({
      event: "review.stage_completed",
      runId,
      stage: openStage,
      durationMs,
      // A stage that ended any other way is reported once, as `review.failed` with
      // its own stage, rather than twice with two accounts of itself.
      status: "ok",
    });
    openStage = null;
  };

  const begin = (stage: SemanticStage): void => {
    closeOpenStage();
    openStage = stage;
    openStageAt = clock();
    opts.onStage?.(stage);
  };

  /** Closes the last stage and reports the outcome. */
  const finish = (result: SemanticReviewResult): SemanticReviewResult => {
    closeOpenStage();
    emitTelemetry({
      event: "review.completed",
      runId,
      actionable: result.actionable,
      hasProposal: result.proposedRevision !== undefined,
      preservationPassed: result.preservation.pass,
      totalDurationMs: Math.max(0, clock() - started),
      attempt: result.providerMetadata.attempt,
    });
    return result;
  };

  emitTelemetry({
    event: "review.started",
    runId,
    profileId: request.profile.id,
    profileRevision: request.profile.revision,
    domain: request.domain,
    selectionChars: request.selectedText.length,
    promptVersion: PROMPT_VERSION,
  });

  // The clock comes first: the stage helpers above time against it, so the prompt
  // cannot be built — and its stage timed — before it exists.
  const registry = opts.registry ?? createLlmRegistry();
  const clock = opts.now ?? (() => Date.now());
  const started = clock();

  /**
   * Throw a coded failure, carrying what the engine already knows.
   *
   * The stage in progress is timed before the throw, and the timings collected so
   * far ride on the error. Without this, a diagnostic report built from a rejected
   * call arrives with an empty `stageTimingsMs` and no provider name — the two
   * fields a slow or mis-routed failure turns on — because everything downstream
   * sees only that the call failed, not the attempt the engine threw away. `detail`
   * is redacted context, never document text.
   */
  const fail: (
    message: string,
    code: SemanticFailureCode,
    detail?: Record<string, unknown>,
  ) => never = (message, code, detail = {}) => {
    if (openStage !== null) {
      stageTimings[openStage] = Math.max(0, clock() - openStageAt);
      openStage = null;
    }
    emitTelemetry({
      event: "review.failed",
      runId,
      stage: stageForCode(code),
      failureCode: code,
      totalDurationMs: Math.max(0, clock() - started),
    });
    throw new SemanticReviewError(message, code, {
      ...detail,
      provider: registry.name,
      stage: stageForCode(code),
      stageTimings,
    });
  };

  let prompt: string;
  try {
    begin("prompt_build");
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
    fail("The review could not be prepared, so nothing was sent.", "E_PROMPT_CONSENT_GATE");
  }

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
  // Whether the provider stage ran out of its own deadline, so the abort it caused
  // is not later mistaken for a caller cancellation.
  let stageBudgetExpired = false;
  let reviewed: { response: LlmResponse; parsed: ParsedResponse };
  try {
    reviewed = await (async (): Promise<{
      response: LlmResponse;
      parsed: ParsedResponse;
    }> => {
      const stage = stageBudget(
        opts.signal,
        opts.stageTimeoutMs ?? PROVIDER_STAGE_TIMEOUT_MS,
        clock,
      );
      try {
        begin("provider_call");
        const first = await callProvider(registry, prompt, stage.signal, opts.maxTokens);
        if (first.parsed.success || stage.remainingMs() < REPAIR_SUB_BUDGET_MS) return first;

        /*
         * The decision to repair is logged, with the first call's cost, before the
         * second call starts — so the line survives a repair that throws.
         */
        logger.warn("Semantic review response could not be read; asking the model to repair it", {
          issues: first.parsed.error.issues.length,
          firstCallAttempts: first.response.attemptTimings?.length,
          firstCallMs: first.response.attemptTimings?.reduce(
            (total, attempt) => total + attempt.durationMs,
            0,
          ),
        });
        const repaired = await callProvider(
          registry,
          prompt + REPAIR_INSTRUCTION,
          stage.signal,
          opts.maxTokens,
        ).catch((error: unknown) => {
          /*
           * The repair threw, so there is no merged response to return — but the
           * first call still happened and is still a cost of this request. Its
           * attempts ride on the error, because the engine's catch builds
           * `providerAttempts` from the error and would otherwise report only the
           * repair. A live run showed three upstream requests against two reported
           * attempts for exactly this reason: a 200 whose body could not be read,
           * then a repair that timed out and retried.
           */
          throw withFirstCallAttempts(error, first.response.attemptTimings);
        });
        return {
          // Every call this request cost, so the count stays a measurement.
          response: {
            ...repaired.response,
            attempt: (first.response.attempt ?? 1) + (repaired.response.attempt ?? 1),
            ...mergedAttemptTimings(first.response, repaired.response),
          },
          parsed: repaired.parsed,
        };
      } finally {
        stageBudgetExpired = stage.timedOut();
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
    /*
     * A deadline the stage set for itself is not a cancellation. The adapter sees the
     * stage signal abort and reports it as "aborted by caller" — non-retryable, with
     * no status — which the classifier would read as a configuration fault. A
     * provider that did not answer in time is a timeout, so it is reported as
     * unreachable instead. A caller abort still wins, because that one is the user's.
     */
    const code =
      stageBudgetExpired && !abortedByCaller
        ? "E_PROVIDER_UNREACHABLE"
        : classifyProviderFailure(error, abortedByCaller);
    // The classifier's catch-all (`E_PROVIDER_TRANSIENT`) means it could not name
    // the failure. Record the error's *type* — never its message, which is redacted
    // — because that name is the one clue that turns an unclassified failure into a
    // known one on the next report.
    const errorName = error instanceof Error ? error.name : typeof error;
    // The per-attempt timing the adapter recorded, when the failure came from one.
    // A request that hung until each of its own deadlines has a shape — several
    // equal, long attempts — and this is the only place that shape survives the
    // throw, so it is what the diagnostic report is built from.
    const providerAttempts = error instanceof LlmError ? error.attemptTimings : undefined;
    logger.warn("Semantic review provider call failed", {
      provider: registry.name,
      code,
      abortedByCaller,
      errorName,
      ...(providerAttempts === undefined ? {} : { providerAttempts }),
    });
    // The stage that was running is reported as failed rather than completed, so a
    // failed run appears once in the telemetry with the stage it died in.
    // The `fail()` helper emits `review.failed` for every coded failure, so this
    // catch must not emit it again — each failed run emits the event exactly once.
    fail(error instanceof Error ? error.message : String(error), code, {
      abortedByCaller,
      errorName,
      ...(providerAttempts === undefined ? {} : { providerAttempts }),
    });
  }

  const { response, parsed } = reviewed;
  // The send/receive split per attempt, so a slow review that *succeeded* can be
  // attributed to the provider answering or to the body being read, without a
  // debugger. Logged rather than returned: it is a measurement, not a result.
  if (response.attemptTimings !== undefined) {
    logger.info("Semantic review provider timing", {
      provider: registry.name,
      attempts: response.attemptTimings.length,
      attemptTimings: response.attemptTimings,
    });
  }
  /*
   * What the provider call cost, for a failure that happens *after* it succeeded.
   *
   * A response that cannot be read is exactly the case where "which model, how many
   * calls and how long" matters, and all three are known here — so they ride on the
   * failure rather than being discarded with the call that worked.
   */
  const providerContext = {
    model: response.model,
    attempts: response.attempt ?? 1,
    ...(response.attemptTimings === undefined ? {} : { providerAttempts: response.attemptTimings }),
  };
  begin("response_parse");

  if (response.text.trim().length === 0) {
    fail(
      "The model returned an empty answer. Nothing has been changed in the document.",
      "E_RESPONSE_EMPTY",
      { responseLength: 0, ...providerContext },
    );
  }

  if (!parsed.success) {
    /*
     * The path and code of each issue — never Zod's message.
     *
     * A message can quote the value the model produced, and that value is derived
     * from the document. The path and the code say which field was wrong and how,
     * which is what a fix needs, and echo none of the text. Without this a schema
     * failure reports only a count, which cannot be diagnosed.
     */
    const responseIssues = parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      code: issue.code,
    }));
    logger.warn("Semantic review response failed validation", { issues: responseIssues });
    fail(
      "The model did not return a usable semantic review. Nothing has been changed in the document.",
      "E_RESPONSE_SCHEMA_INVALID",
      { issues: responseIssues.length, issueSummary: responseIssues, ...providerContext },
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
  begin("preservation_check");
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
    runId,
    stageTimings,
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
    return finish({
      ...base,
      preservation: validatePreservation(request.selectedText, request.selectedText),
      actionable: false,
      refusalReason: "The model found no change worth proposing for this selection.",
    });
  }

  /*
   * The revision must replace the selection and nothing else.
   *
   * Compared after removing only Word's own artefacts — the paragraph terminator
   * and line-ending differences — never after trimming. Trimming would treat a
   * selection that genuinely starts or ends with a space as equal to one that does
   * not, so the write would replace a span whose surrounding spaces differ and
   * silently add or remove them. Removing the trailing paragraph mark is faithful:
   * `Paragraph.text` carries it and a `Selection`'s text does not, and both name
   * the same span (`shared/utils/text.stripParagraphMark` is the same helper the
   * selection capture and the change preconditions already use).
   */
  if (!sameSpan(proposedRevision.original, request.selectedText)) {
    logger.warn("Semantic review proposed a revision against a different span");
    return finish({
      ...base,
      preservation: validatePreservation(request.selectedText, proposedRevision.revised),
      actionable: false,
      spanMatch: false,
      refusalReason:
        "The model's revision did not match the selected text, so it cannot be applied to this selection. Nothing has been changed in the document.",
    });
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

  return finish({
    ...base,
    proposedRevision: proposedRevision.revised,
    preservation,
    actionable,
    ...(refusal === null ? {} : { refusalReason: refusal }),
  });
}

/**
 * Whether the model's `original` names the same span as the selection.
 *
 * Line endings are unified and a single trailing paragraph mark is dropped, so a
 * faithful copy is not refused because Word returned `\r` and JSON carried `\n`.
 * Nothing else is removed: internal and leading/trailing whitespace is part of
 * the span, so a revision that adds, drops or reshapes a space is a different
 * span and stays refused.
 */
function sameSpan(original: string, selected: string): boolean {
  return (
    stripParagraphMark(normalizeLineEndings(original)) ===
    stripParagraphMark(normalizeLineEndings(selected))
  );
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
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  Array.from({ length: text.length - start }, (_, k) => start + k).some((i) => {
    const char = text[i]!;
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
        end = i;
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
  maxTokens: number | undefined,
): Promise<{ response: LlmResponse; parsed: ParsedResponse }> {
  const response = await registry.review({
    prompt,
    signal,
    // Omitted rather than defaulted here, so a provider that has no such limit
    // keeps its own behaviour instead of being told a number we invented.
    ...(maxTokens === undefined ? {} : { maxTokens }),
  });
  return { response, parsed: SemanticReviewResponseSchema.safeParse(parseJson(response.text)) };
}

/**
 * One request's per-attempt timings across its two provider calls.
 *
 * Returns an object to spread, and `{}` when neither call recorded any, so the key
 * stays absent rather than becoming `[]` — "no timings were recorded" and "the
 * request made no attempts" are different statements. The repair replaces the
 * response, so spreading only the repair's timings dropped the first call from the
 * record and left a summed `attempt` count with nothing behind its entries.
 */
function mergedAttemptTimings(
  first: LlmResponse,
  repaired: LlmResponse,
): { attemptTimings?: LlmAttemptTiming[] } {
  const merged: LlmAttemptTiming[] = [
    ...(first.attemptTimings ?? []),
    ...(repaired.attemptTimings ?? []),
  ];
  return merged.length === 0 ? {} : { attemptTimings: merged };
}

/**
 * Attach the first call's attempts to a repair failure.
 *
 * A repair that throws discards the merged response, so the only place the first
 * call's cost can survive is the error the engine's catch reads. An error that is
 * not an `LlmError`, or carries no attempts of its own to merge into, is returned
 * untouched — a second representation of the same throw would be a lie about what
 * was recorded.
 */
function withFirstCallAttempts(
  error: unknown,
  first: readonly LlmAttemptTiming[] | undefined,
): unknown {
  if (!(error instanceof LlmError) || first === undefined || first.length === 0) return error;
  return new LlmError(
    error.message,
    error.provider,
    error.retryable,
    error.status,
    error.retryAfterMs,
    [...first, ...(error.attemptTimings ?? [])],
  );
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
): { signal: AbortSignal; remainingMs: () => number; timedOut: () => boolean; cancel: () => void } {
  const controller = new AbortController();
  const deadline = now() + timeoutMs;
  // Whether *this* budget's timer fired, as opposed to the caller aborting: the
  // engine needs the difference to classify a timeout apart from a cancellation.
  let timerFired = false;
  const timer = setTimeout(() => {
    timerFired = true;
    controller.abort();
  }, timeoutMs);
  const forward = (): void => controller.abort();
  if (parent !== undefined) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - now()),
    timedOut: () => timerFired,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forward);
    },
  };
}
