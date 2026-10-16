import React from "react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@fluentui/react-components";
import SemanticReviewScope from "../components/semantic/SemanticReviewScope";
import { Breadcrumb } from "../shell";
import { parentRoute } from "../routes";
import SemanticAssessmentView from "../components/semantic/SemanticAssessmentView";
import SemanticRewriteComparison from "../components/semantic/SemanticRewriteComparison";
import PreservationSummary from "../components/semantic/PreservationSummary";
import { semanticGate, type SemanticGateInput } from "../semantic/gates";
import { deriveSemanticAnnouncement } from "../state/semanticAnnouncement";
import { readSelectionScope, type SelectionScope } from "../../word/selectionScope";
import { stopWatchingDocumentSelection, watchDocumentSelection } from "../../word/selectionWatcher";
import { watchTaskpaneVisibility } from "../../shared/office/taskpaneVisibility";
import { reviewSemanticSelection } from "../../analysis/semantic/semanticReviewEngine";
import {
  advanceSession,
  createSemanticReviewSession,
  currentSession,
  isApplicable,
  type SessionContext,
} from "../../analysis/semantic/session";
import {
  reviewDomainFor,
  type SemanticReviewResult,
  type StageTimings,
} from "../../analysis/semantic/contracts";
import {
  SemanticReviewError,
  isSemanticReviewError,
  type SemanticFailureCode,
  type SemanticStage,
} from "../../analysis/semantic/failures";
import { failureCopyFor, stageLabel, type SemanticRecovery } from "../semantic/failureCopy";
import { applyConcernFor } from "../semantic/applyConcern";
import { buildDiagnosticReport } from "../semantic/diagnosticReport";
import { emitTelemetry } from "../../analysis/semantic/telemetry";
import type { SemanticReviewSession } from "../../core/domain/SemanticReviewSession";
import { applyApprovedSemanticRevision } from "../../reformat/semanticApply";
import {
  loadSemanticProfileRecord,
  loadState,
  saveSemanticReviewOutcome,
} from "../../core/state/persistence";
import { effectiveProfile } from "../../core/domain/ProfileRecord";
import { generalRegistryFromState, isGeneralRoleConfigured } from "../settings/providerComposition";
import { env } from "../../core/config/env";
import type { TaskpaneNavigation } from "../../shared/office/taskpaneNavigation";
import type { LlmAttemptTiming } from "../../ai/providers/LlmProvider";

/**
 * Semantic Review: the selection, the assessment, the comparison, the decision.
 *
 * **Review-first, not rewrite-first.** The old tab led with "Propose rewrite" and
 * treated the assessment as decoration on the result. The order here is the order
 * the decision is made in — what you pointed at, how it reads against your style,
 * what would change, what the local check found — and only then the three
 * controls. A user who reads only the first three sections can already decide, and
 * "Keep original" is as available as "Apply".
 *
 * **Nothing happens without a click.** The selection is read only when the user
 * presses *Use current selection* or arrives from the context menu with
 * `read-selection`; the provider is called only from *Review selection*; and no
 * effect here watches the document. The old pane was re-reading the selection on
 * navigation and offering a button whose state depended on when it had last been
 * asked.
 *
 * **The session is owned above this page** by the Dashboard, so navigating away
 * and back does not discard a review the user has paid for. What this page owns is
 * the actions.
 */
export interface SemanticReviewProps {
  onBack: () => void;
  onOpenSettings: () => void;
  /** Opens the Semantic Style destination, for the "no profile" remedy. */
  onOpenSemanticStyle: () => void;
  /**
   * Accepted and deliberately **not consulted**.
   *
   * It used to carry `read-selection`, and an effect fired on it. That worked
   * while the context menu was a *function* command that could write an
   * instruction; it is a **task pane command** now (ADR-0107), so no JavaScript
   * of ours runs when the user picks it and nothing is written for this page to
   * receive. The pane reads the selection when it is summoned instead \u2014 on mount,
   * and on `onVisibilityModeChanged` for a pane already open.
   *
   * The prop stays so the Dashboard's arrival mapping still has one shape, and so
   * a ribbon route that does write an instruction keeps working. Removing it
   * would mean the two dashboards \u2014 profiled and not \u2014 diverge again for no gain.
   */
  navigation?: TaskpaneNavigation | null;
  /** The session the Dashboard holds, so a navigation does not discard it. */
  session: SemanticReviewSession | null;
  onSession: (session: SemanticReviewSession | null) => void;
  /**
   * Told what the page currently holds, for the Troubleshooting registry.
   *
   * One callback carrying both facts, reported from an effect rather than from
   * each mutation site: the registry has to explain a selection that is *too
   * long* (a size, which a boolean cannot say) and a revision the local check
   * refused (which is not visible until the user has navigated away from the
   * page that said why). Two callbacks would be two places to forget to call,
   * and a diagnostic that reports a stale answer is worse than one that reports
   * none.
   *
   * `heldChars: null` is "nothing read", which the registry keeps distinct from
   * "the page was never opened" — that distinction is the whole of one check.
   */
  onReviewStatus?: (status: {
    heldChars: number | null;
    preservationRefused: boolean;
    /** The failure code the run ended on, for the troubleshooting registry. */
    failureCode: SemanticFailureCode | null;
  }) => void;
}

/**
 * The provider line of a diagnostic report.
 *
 * A completed run names the provider and the model that answered. A failed one
 * names only the provider: the engine puts its name on the error, and nothing else
 * about it exists to report. The unknowns are left off, so the report states them
 * as null rather than as a zero that reads like a measurement.
 */
function providerOfferFor(
  result: SemanticReviewResult | null,
  detail: Record<string, unknown> | null,
): { provider: string; model?: string; attempt?: number; latencyMs?: number } | null {
  if (result !== null) {
    return {
      provider: result.providerMetadata.provider,
      model: result.providerMetadata.model,
      attempt: result.providerMetadata.attempt,
      latencyMs: result.providerMetadata.latencyMs,
    };
  }
  const provider = detail?.provider;
  if (typeof provider !== "string") return null;
  // A failure *after* the provider answered knows the model and the attempt count,
  // so the report states them instead of leaving the provider half-described.
  const model = detail?.model;
  const attempts = detail?.attempts;
  return {
    provider,
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof attempts === "number" ? { attempt: attempts } : {}),
  };
}

/** The per-stage timings a failed run carried on its error, if it carried any. */
function stageTimingsFromDetail(detail: Record<string, unknown> | null): StageTimings | null {
  const value = detail?.stageTimings;
  // The engine writes a `StageTimings` object here; the guard is against a detail
  // that predates the field, and the cast is the price of a loose detail record.
  return typeof value === "object" && value !== null ? (value as StageTimings) : null;
}

/** The provider attempts a failed run carried on its error, if it carried any. */
function attemptsFromDetail(detail: Record<string, unknown> | null): LlmAttemptTiming[] | null {
  const value = detail?.providerAttempts;
  return Array.isArray(value) ? (value as LlmAttemptTiming[]) : null;
}

/** The field paths a response failed validation on, if that is what failed. */
function responseIssuesFromDetail(
  detail: Record<string, unknown> | null,
): { path: string; code: string }[] | null {
  const value = detail?.issueSummary;
  return Array.isArray(value) ? (value as { path: string; code: string }[]) : null;
}

export default function SemanticReview({
  onBack,
  onOpenSettings,
  onOpenSemanticStyle,
  navigation: _navigation,
  session,
  onSession,
  onReviewStatus,
}: SemanticReviewProps): React.ReactNode {
  const [scope, setScope] = React.useState<SelectionScope | null>(null);
  const [emptyReason, setEmptyReason] = React.useState<string | null>(null);
  /** Whether the host fires selection events at all, for the disclosure below. */
  const [trackingSelection, setTrackingSelection] = React.useState(false);
  const [unavailableReason, setUnavailableReason] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SemanticReviewResult | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * The stage currently running, reported by the engine.
   *
   * The engine is the only thing that knows which stage it is in, so the pane asks
   * rather than guesses — a progress line that showed one sentence for the whole
   * run would claim to know something it does not.
   */
  const [stage, setStage] = React.useState<SemanticStage | "idle" | "done" | "failed">("idle");
  /** The failure and the control that resolves it. */
  const [failure, setFailure] = React.useState<ReturnType<typeof failureCopyFor> | null>(null);
  /** Identifies this attempt, so a diagnostic report can be joined to a log line. */
  const [runId, setRunId] = React.useState<string | null>(null);
  /**
   * The context the engine attached to a failure — the provider and the stages that
   * ran before it died.
   *
   * Kept separately from `result`, which a failure never sets: a report built from
   * `result` alone arrives with no provider and no timings, which are the two fields
   * a support report exists to carry.
   */
  const [failureDetail, setFailureDetail] = React.useState<Record<string, unknown> | null>(null);
  /** Cancels an in-flight review when the user asks, or replaces it on a retry. */
  const reviewController = React.useRef<AbortController | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  /**
   * The session, mirrored locally from the prop the Dashboard holds.
   *
   * The Dashboard owns it so a navigation does not discard a paid-for review, and
   * this page keeps a copy so its own actions — Keep original, Apply — do not
   * depend on a parent that happens to be rendering them. Reading the prop alone
   * meant that pressing Keep original did nothing whenever the parent had not yet
   * stored the session, which is exactly the state a user reaches it in.
   */
  const [localSession, setLocalSession] = React.useState(session);
  React.useEffect(() => {
    setLocalSession(session);
  }, [session]);

  /*
   * What the Troubleshooting panel is told, in one place.
   *
   * Derived rather than pushed, so it cannot be stale: the two facts come from
   * `scope` and `result`, which are already state, and an effect is the only way
   * to report them without a call at every site that clears one of them. Three
   * sites currently clear a scope, and a fourth added later would have been the
   * one that forgot.
   */
  const heldChars = scope?.anchor.selectedText.length ?? null;
  const preservationRefused = result !== null && !result.preservation.pass;
  const failureCode = failure?.code ?? null;
  React.useEffect(() => {
    onReviewStatus?.({ heldChars, preservationRefused, failureCode });
  }, [onReviewStatus, heldChars, preservationRefused, failureCode]);
  const commitSession = (next: SemanticReviewSession | null): void => {
    setLocalSession(next);
    onSession(next);
  };

  const state = loadState();
  const settings = state.settings;
  const activeSemanticId = state.activeSemanticProfileId;
  const record = activeSemanticId === null ? null : loadSemanticProfileRecord(activeSemanticId);
  const profile = record === null ? null : effectiveProfile(record);

  /**
   * Reading the selection when the pane is summoned, with no button press.
   *
   * The context menu is a **task pane command** (ADR-0107), so no JavaScript runs
   * when the user picks it and nothing can be told which page to show. What the
   * user did do, with the right-click, is point at some text \u2014 and reading that
   * text is completing the gesture they started, not starting work they did not
   * ask for.
   *
   * Two arrivals, because there are two states the pane can be in:
   *
   * 1. **A fresh pane**, which happens when none was open. Its mount *is* the
   *    arrival, so it reads once here.
   * 2. **A pane already open**, which Office re-raises rather than recreating
   *    (Microsoft: commands sharing a `TaskpaneId` keep "the pane container
   *    remain open"). Its `onVisibilityModeChanged` is the arrival, and it is the
   *    only signal that fires here \u2014 a task pane command writes no instruction
   *    and no channel is involved, which matters because `localStorage` is blocked
   *    on the host that reported the problem (ADR-0106).
   *
   * Both call the same `readSelection` as **Use current selection**, which
   * already handles a dragged selection and a caret expanded to its paragraph
   * (ADR-0105, verified in a real Word). This is that working code invoked at the
   * right moment \u2014 not new capability.
   *
   * **A paid-for review is never discarded to satisfy an arrival.** If a proposal
   * is on screen the re-read is skipped, for the same reason the caret watcher
   * skips it.
   */
  React.useEffect(() => {
    void readSelection();
    // Mount only. Re-running on every render would read the document on a
    // render the user did not ask for.
  }, []);

  React.useEffect(() => {
    let active = true;
    let removeVisibilityHandler: (() => Promise<void>) | null = null;

    void watchTaskpaneVisibility(() => {
      // A paid-for review is never discarded to satisfy an arrival, for the same
      // reason the caret watcher skips it below.
      if (!active || heldResult.current !== null) return;
      void readSelection();
    }).then((remove) => {
      // `null` means the host has no such event, so there is nothing to remove.
      if (!active) void remove?.();
      else removeVisibilityHandler = remove;
    });

    return () => {
      active = false;
      void removeVisibilityHandler?.();
    };
  }, []);

  /**
   * Whether a review is currently on screen, readable from a stale closure.
   *
   * The watcher's callback is captured once, at subscription, so it cannot see
   * `result` from the render it was created in. A ref is the only way to ask
   * "is the user holding a paid-for proposal right now" without re-subscribing
   * on every state change.
   */
  const heldResult = React.useRef<SemanticReviewResult | null>(null);
  heldResult.current = result;

  /**
   * Follow the caret while nothing is being decided.
   *
   * **It stops the moment a review is on screen.** Reading on every caret move
   * would replace the proposal the user is reading with a new one for the
   * paragraph they just clicked into, silently discarding work they paid for.
   * Staleness is already the page's answer to "this no longer describes what is
   * on screen" (`currentSession`), so tracking is not needed to detect it.
   *
   * The subscription is optional by design: a host with no
   * `documentSelectionChanged` keeps the manual "Use current selection" control,
   * which is the behaviour this product shipped with (ADR-0094).
   */
  React.useEffect(() => {
    let active = true;
    void watchDocumentSelection(() => {
      if (!active || heldResult.current !== null) return;
      void readSelection();
    }).then((subscribed) => {
      if (!active) void stopWatchingDocumentSelection();
      else setTrackingSelection(subscribed);
    });
    return () => {
      active = false;
      void stopWatchingDocumentSelection();
    };
  }, []);

  async function readSelection(): Promise<void> {
    const captured = await readSelectionScope();
    if (captured.status === "ok") {
      setScope(captured.scope);
      setEmptyReason(null);
      setUnavailableReason(null);
      setError(null);
      /*
       * A proposal belongs to the text it was written for.
       *
       * Reading a *new* selection leaves the old proposal on screen, and the old
       * revision's `original` is a different paragraph — so Apply would pair the
       * new scope with a revision describing the previous one. The acknowledgement
       * goes with it for the same reason: it was given for that comparison.
       */
      setResult(null);
      setAcknowledged(false);
      return;
    }
    /*
     * A failed read clears what was held.
     *
     * Reporting `false` while the previous paragraph stayed on screen is a state
     * this page cannot represent: Troubleshooting would say no selection is held
     * while Apply is still offered for the old one, which is a proposal about text
     * that was never read.
     */
    setScope(null);
    setResult(null);
    if (captured.status === "unavailable") {
      setUnavailableReason(captured.reason);
      setEmptyReason(null);
      setError(null);
    } else {
      setUnavailableReason(null);
      setEmptyReason(
        "There is nothing to review here. Click inside a paragraph, or select the text you want checked.",
      );
    }
  }

  const sessionContext: SessionContext | null =
    scope === null || profile === null
      ? null
      : {
          selectionHash: scope.anchor.selectionHash,
          profileId: profile.id,
          profileRevision: profile.revision,
        };

  /**
   * The session as it should be shown: staleness applied, so Apply cannot be
   * offered for a proposal that no longer describes what is on screen.
   */
  const liveSession =
    localSession !== null && sessionContext !== null
      ? currentSession(localSession, sessionContext, new Date().toISOString())
      : localSession;

  const providerConfigured = isGeneralRoleConfigured(state);
  /*
   * What stops the proposal on screen from being applied, split into D6's two
   * tiers. `hard` disables Apply with no override; a soft concern needs one
   * acknowledgement. Computed once here, so the button and the sentence beside it
   * read the same answer.
   */
  const applyConcern = result === null ? null : applyConcernFor(result);
  const gateInput: SemanticGateInput = {
    consent: settings.semanticOptIn === true,
    providerConfigured,
    hasProfile: profile !== null,
    hasSelection: scope !== null,
    reviewing,
    applying,
    hasProposal: result !== null,
    /*
     * `hard` only.
     *
     * Keying this on the engine's `actionable` conflated three different
     * refusals — a factual change, a revision written for a different span, and a
     * meaning flag the model reported false — and disabled Apply for all of them
     * with no override. The last is a soft concern the user may accept, so it must
     * not reach this flag; `applyConcernFor` is where the three are told apart.
     */
    preservationPassed: applyConcern === null || !applyConcern.hard,
    /*
     * Required only when there is something to acknowledge. Passing the raw
     * checkbox state meant a clean proposal — with no checkbox to tick — was
     * blocked with a sentence about warnings that did not exist.
     */
    warningsAcknowledged:
      applyConcern === null || !applyConcern.acknowledgementRequired || acknowledged,
    selectionChars: scope?.anchor.selectedText.length ?? 0,
  };

  const reviewGate = semanticGate(gateInput, "review");
  const applyGate = semanticGate(gateInput, "apply");
  const keepGate = semanticGate(gateInput, "keep-original");

  async function runReview(): Promise<void> {
    if (scope === null || profile === null || sessionContext === null) return;
    /*
     * Refuse an offline review before anything is sent, and without waiting for a
     * timeout. `navigator.onLine` is a hint rather than a fact, so it is read only to
     * skip a request that cannot arrive: a false "offline" costs one attempt the user
     * can make again, while a false "online" costs them the whole deadline.
     */
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const view = failureCopyFor(
        new SemanticReviewError("The add-in is offline", "E_PROVIDER_OFFLINE"),
      );
      setFailureDetail(null);
      setFailure(view);
      setError(view.message);
      setStage("failed");
      return;
    }
    // Abort a run already in flight before starting another, so two reviews cannot
    // race to set the same result.
    reviewController.current?.abort();
    const controller = new AbortController();
    reviewController.current = controller;
    setReviewing(true);
    setError(null);
    setStatus(null);
    setFailure(null);
    setFailureDetail(null);
    setAcknowledged(false);
    setStage("input_validation");
    // One id for the attempt, shared by the engine, the telemetry and the report, so
    // a support report and a log line name the same run.
    const attemptId = uuidv4();
    setRunId(attemptId);
    try {
      const reviewed = await reviewSemanticSelection(
        {
          selectedText: scope.anchor.selectedText,
          selectionAnchor: scope.anchor,
          profile: { id: profile.id, revision: profile.revision },
          semantic: profile.semantic,
          includeRawText: true,
          domain: reviewDomainFor(profile.semantic),
        },
        {
          includeRawText: true,
          registry: generalRegistryFromState(state),
          signal: controller.signal,
          onStage: setStage,
          runId: attemptId,
          // Both budgets come from deployment configuration, because the right
          // value depends on the model: a free preview model can take ninety
          // seconds to write a review a larger one finishes in five.
          stageTimeoutMs: env.SEMANTIC_STAGE_TIMEOUT_MS,
          maxTokens: env.SEMANTIC_REVIEW_MAX_TOKENS,
        },
      );
      setResult(reviewed);
      /*
       * The session is created *after* the call, from the metadata the provider
       * actually returned. Creating it first meant naming a model from settings,
       * which for a non-OpenAI provider is unset — and a session whose `model` is
       * a guess records a guess about which model answered. There is no proposal
       * to invalidate before the call returns, so there is nothing lost by waiting.
       */
      const now = new Date().toISOString();
      commitSession(
        advanceSession(
          createSemanticReviewSession(
            sessionContext,
            scope.anchor,
            {
              provider: reviewed.providerMetadata.provider,
              model: reviewed.providerMetadata.model,
            },
            now,
            reviewed.reviewSessionId,
          ),
          reviewed.proposedRevision === undefined ? "kept_original" : "proposed",
          now,
        ),
      );
      setStage("done");
      setStatus(
        reviewed.proposedRevision === undefined
          ? "The model found nothing to change in this selection."
          : "Review ready. Compare the two columns and decide.",
      );
    } catch (error: unknown) {
      // The sentence comes from the taxonomy, keyed on the code the engine threw,
      // so the pane cannot invent a second account of a failure it did not classify.
      const view = failureCopyFor(error);
      setResult(null);
      setFailure(view);
      // The engine attaches the provider and the stages that ran to its error, and
      // this is the only place they survive: `result` is set only on success, so a
      // report built from it would carry neither.
      setFailureDetail(isSemanticReviewError(error) ? error.detail : null);
      setError(view.message);
      setStage("failed");
      commitSession(null);
    } finally {
      reviewController.current = null;
      setReviewing(false);
    }
  }

  async function applyRevision(): Promise<void> {
    if (scope === null || result?.proposedRevision === undefined || liveSession === null) return;
    const applyId = uuidv4();
    setApplying(true);
    setError(null);
    setStatus(null);
    setFailure(null);
    setFailureDetail(null);
    setStage("apply");
    try {
      const outcome = await applyApprovedSemanticRevision({
        revision: {
          original: scope.anchor.selectedText,
          revised: result.proposedRevision,
          anchor: scope.anchor,
          coversWholeParagraph: scope.coversWholeParagraph,
          rationale: result.rationale,
          // The gate's hard verdict and the session's applicability are both
          // required, so the revision that reaches the adapter carries the same
          // answer the Apply button was gated on. A soft concern the user has
          // acknowledged is not carried: it was never a reason to refuse the write.
          actionable: applyConcern !== null && !applyConcern.hard && isApplicable(liveSession),
          ...(result.refusalReason === undefined ? {} : { refusalReason: result.refusalReason }),
        },
      });
      saveSemanticReviewOutcome({
        sessionId: liveSession.id,
        profileId: liveSession.profileId,
        profileRevision: liveSession.profileRevision,
        outcome: outcome.refusal === null ? "applied" : "refused",
        at: new Date().toISOString(),
        preservationPassed: outcome.preservation.pass,
        selectionWordCount: scope.wordCount,
      });
      if (outcome.refusal !== null) {
        setError(outcome.refusal);
        return;
      }
      /*
       * The proposal described text that no longer exists, so it must not survive
       * the write: pressing Apply again would re-apply it. The message is outside
       * the proposal card, because the card is about to be cleared.
       */
      emitTelemetry({
        event: "review.applied",
        applyId,
        runId,
        preservationPassed: outcome.preservation.pass,
      });
      setResult(null);
      setScope(null);
      commitSession(advanceSession(liveSession, "applied", new Date().toISOString()));
      setStatus("The revision was written as a tracked change. Reject it in Word to undo it.");
    } catch (error: unknown) {
      // A throw is a fault, not a refusal, and says so. Collapsing the two is what
      // left the old flow with a button that failed silently. The sentence still
      // comes from the taxonomy, and still says nothing was written.
      const view = failureCopyFor(error);
      emitTelemetry({
        event: "review.apply_failed",
        applyId,
        runId,
        failureCode: view.code,
      });
      setFailure(view);
      setFailureDetail(isSemanticReviewError(error) ? error.detail : null);
      setError(view.message);
      setStage("failed");
    } finally {
      setApplying(false);
    }
  }

  function keepOriginal(): void {
    if (liveSession === null) return;
    saveSemanticReviewOutcome({
      sessionId: liveSession.id,
      profileId: liveSession.profileId,
      profileRevision: liveSession.profileRevision,
      outcome: "kept_original",
      at: new Date().toISOString(),
      preservationPassed: result?.preservation.pass ?? false,
      selectionWordCount: scope?.wordCount ?? 0,
    });
    setResult(null);
    setAcknowledged(false);
    commitSession(advanceSession(liveSession, "kept_original", new Date().toISOString()));
    setStatus("Kept your original. Nothing was written to the document.");
  }

  /**
   * Regenerate: the same selection and the same profile, asked again.
   *
   * There is no new prompt and no new selection — `runReview` closes over the
   * captured `scope` — so pressing this sends exactly what the previous press sent.
   * "Regenerate" that quietly re-read the selection, or prompted differently, would
   * be a second request the user did not ask for and could not reproduce.
   */
  function regenerate(): void {
    setAcknowledged(false);
    void runReview();
  }

  /**
   * Cancel: stop waiting on a provider the user has given up on.
   *
   * Only the review is cancellable. A write is not, because stopping one midway is
   * the one outcome worse than waiting — the adapter verifies before it writes, and
   * an abort after that point would leave a partial change with no report.
   */
  function cancelReview(): void {
    reviewController.current?.abort();
    if (runId !== null) {
      emitTelemetry({
        event: "review.cancelled",
        runId,
        stage: stage === "idle" || stage === "done" || stage === "failed" ? "provider_call" : stage,
      });
    }
    setStatus("Cancelling the review. Nothing has been changed in the document.");
  }

  /** Do what a failure's recovery button says. */
  function runRecovery(recovery: SemanticRecovery): void {
    switch (recovery.kind) {
      case "open-settings":
        onOpenSettings();
        return;
      case "open-semantic-style":
        onOpenSemanticStyle();
        return;
      case "read-selection":
      case "change-selection":
        void readSelection();
        return;
      case "retry":
      case "regenerate":
        void runReview();
        return;
    }
  }

  /**
   * Copy the redacted diagnostic report.
   *
   * The report is built from the taxonomy's code and the metadata that already
   * exists — never from the failure's message, which is a log line — so what lands
   * on the clipboard is a set of identifiers and counts rather than document text.
   */
  async function copyDiagnosticReport(): Promise<void> {
    if (failure === null) return;
    const report = buildDiagnosticReport({
      runId: runId ?? "unknown",
      failure: { code: failure.code, stage: failure.stage },
      provider: providerOfferFor(result, failureDetail),
      stageTimings: result?.stageTimings ?? stageTimingsFromDetail(failureDetail),
      providerAttempts: attemptsFromDetail(failureDetail),
      responseIssues: responseIssuesFromDetail(failureDetail),
      selectionChars: scope?.anchor.selectedText.length ?? null,
      at: new Date().toISOString(),
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setStatus("Diagnostic report copied. It contains no document text.");
    } catch {
      setStatus("The diagnostic report could not be copied to the clipboard.");
    }
  }

  const progress = reviewing ? stageLabel(stage) : null;

  const announcement = deriveSemanticAnnouncement({
    status,
    error,
    selection: scope === null ? null : `${scope.wordCount} words selected`,
  });

  return (
    <div data-page="semantic-review">
      <Breadcrumb parent={parentRoute("semantic-review")} onBack={onBack} />

      {/*
        This page's one live region (ADR-0062). Blockers are rendered as ordinary
        text beside their control rather than in a region, so the pane does not
        announce its own opening state before the user has done anything.
      */}
      <p
        role={announcement?.assertive === true ? "alert" : "status"}
        className={announcement?.assertive === true ? "tf-error" : "tf-sub"}
      >
        {announcement?.text ?? ""}
      </p>

      {/*
        Progress is visible text, not a second live region.

        ADR-0062 allows one live region per pane, and this page's is the paragraph
        above. A stage sentence that announced itself on every step would talk over
        the outcome the user is waiting to hear.
      */}
      {progress !== null && (
        <p className="tf-sub" data-stage={stage}>
          {progress}
        </p>
      )}

      {reviewing && (
        <div className="tf-actions">
          <Button onClick={cancelReview}>Cancel</Button>
        </div>
      )}

      {failure !== null && (
        <section aria-labelledby="tf-semantic-failure" className="tf-error">
          <h2 id="tf-semantic-failure">Review failed</h2>
          <p>{failure.message}</p>
          <div className="tf-actions">
            <Button appearance="primary" onClick={() => runRecovery(failure.recovery)}>
              {failure.recovery.label}
            </Button>
            {/*
              Diagnostic only, and labelled as such: it is not a fix and it is not
              the first thing the user should reach for. Offered after a failure,
              never during one, because a report of a run still in flight is a
              report of nothing.
            */}
            <Button onClick={() => void copyDiagnosticReport()}>Copy diagnostic report</Button>
          </div>
        </section>
      )}

      {liveSession?.state === "stale" && result !== null && (
        <p className="tf-debug-warning">
          This review no longer describes what is on screen. Review the selection again.
        </p>
      )}

      <SemanticReviewScope
        scope={scope}
        tracking={trackingSelection}
        emptyReason={emptyReason}
        unavailableReason={unavailableReason}
        reviewing={reviewing}
        reviewGate={reviewGate}
        readGate={semanticGate(gateInput, "read-selection")}
        onReadSelection={() => void readSelection()}
        onReview={() => void runReview()}
        onOpenSettings={onOpenSettings}
        onOpenSemanticStyle={onOpenSemanticStyle}
      />

      <div className="tf-actions">
        <Button onClick={onOpenSemanticStyle}>Semantic Style</Button>
      </div>

      {result !== null && (
        <>
          <SemanticAssessmentView assessment={result.assessment} />

          {result.proposedRevision === undefined ? (
            <section aria-labelledby="tf-semantic-nothing">
              <h2 id="tf-semantic-nothing">Nothing to change</h2>
              <p className="tf-sub">{result.refusalReason ?? "The model proposed no revision."}</p>
            </section>
          ) : (
            <>
              <SemanticRewriteComparison
                original={scope?.anchor.selectedText ?? ""}
                revised={result.proposedRevision}
                unchanged={
                  result.proposedRevision.trim() === (scope?.anchor.selectedText ?? "").trim()
                }
              />

              <PreservationSummary
                report={result.preservation}
                meaning={result.meaningPreservation}
                acknowledged={acknowledged}
                onAcknowledge={setAcknowledged}
              />

              {result.refusalReason !== undefined && (
                <p className="tf-debug-warning">{result.refusalReason}</p>
              )}

              <div className="tf-pending-actions">
                <Button
                  appearance="primary"
                  disabled={!applyGate.allowed || applying}
                  onClick={() => void applyRevision()}
                >
                  {applying ? "Applying…" : "Apply revision"}
                </Button>
                <Button disabled={reviewing || applying} onClick={regenerate}>
                  {reviewing ? "Asking again…" : "Regenerate review"}
                </Button>
                {/*
                  Keep original, offered with the same weight as Apply.

                  Spec §23 asks for an explicit way to decline. It is a real
                  decision — it records the outcome — and hiding it behind
                  "Regenerate" would leave "do not change this" expressible only by
                  closing the pane.
                */}
                <Button disabled={!keepGate.allowed} onClick={keepOriginal}>
                  Keep original
                </Button>
              </div>

              {!applyGate.allowed && applyGate.blocker !== null && (
                <p className="tf-sub">{applyGate.blocker}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
