import React from "react";
import SemanticReviewScope from "../components/semantic/SemanticReviewScope";
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
import type { SemanticReviewResult } from "../../analysis/semantic/contracts";
import type { SemanticReviewSession } from "../../core/domain/SemanticReviewSession";
import { applyApprovedSemanticRevision } from "../../reformat/semanticApply";
import {
  loadSemanticProfileRecord,
  loadState,
  saveSemanticReviewOutcome,
} from "../../core/state/persistence";
import { effectiveProfile } from "../../core/domain/ProfileRecord";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import type { TaskpaneNavigation } from "../../shared/office/taskpaneNavigation";

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
  onReviewStatus?: (status: { heldChars: number | null; preservationRefused: boolean }) => void;
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
  React.useEffect(() => {
    onReviewStatus?.({ heldChars, preservationRefused });
  }, [onReviewStatus, heldChars, preservationRefused]);
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

  const providerConfigured = isRemoteProviderConfigured(settings, state.providerConnections);
  const gateInput: SemanticGateInput = {
    consent: settings.semanticOptIn === true,
    providerConfigured,
    hasProfile: profile !== null,
    hasSelection: scope !== null,
    reviewing,
    applying,
    hasProposal: result !== null,
    /*
     * Both signals, not one.
     *
     * `preservation.pass` is the local protected-fact check; `actionable` is the
     * engine's own verdict, which also accounts for meaning preservation and the
     * anchor. A proposal the engine refused is not applyable however clean the
     * local check was, and gating on the local check alone offered Apply for it.
     */
    preservationPassed: result?.preservation.pass === true && result.actionable,
    warningsAcknowledged: acknowledged,
    selectionChars: scope?.anchor.selectedText.length ?? 0,
  };

  const reviewGate = semanticGate(gateInput, "review");
  const applyGate = semanticGate(gateInput, "apply");
  const keepGate = semanticGate(gateInput, "keep-original");

  async function runReview(): Promise<void> {
    if (scope === null || profile === null || sessionContext === null) return;
    setReviewing(true);
    setError(null);
    setStatus(null);
    setAcknowledged(false);
    try {
      const reviewed = await reviewSemanticSelection(
        {
          selectedText: scope.anchor.selectedText,
          selectionAnchor: scope.anchor,
          profile: { id: profile.id, revision: profile.revision },
          semantic: profile.semantic,
          includeRawText: true,
          domain: "constructionExpert",
        },
        {
          includeRawText: true,
          registry: createRegistryFromSettings(settings, state.providerConnections),
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
      setStatus(
        reviewed.proposedRevision === undefined
          ? "The model found nothing to change in this selection."
          : "Review ready. Compare the two columns and decide.",
      );
    } catch (failure: unknown) {
      setResult(null);
      setError(failure instanceof Error ? failure.message : String(failure));
      commitSession(null);
    } finally {
      setReviewing(false);
    }
  }

  async function applyRevision(): Promise<void> {
    if (scope === null || result?.proposedRevision === undefined || liveSession === null) return;
    setApplying(true);
    setError(null);
    setStatus(null);
    try {
      const outcome = await applyApprovedSemanticRevision({
        revision: {
          original: scope.anchor.selectedText,
          revised: result.proposedRevision,
          anchor: scope.anchor,
          coversWholeParagraph: scope.coversWholeParagraph,
          rationale: result.assessment.summary,
          // The engine's refusal and the session's applicability are both required,
          // so the revision that reaches the adapter carries the same answer the
          // Apply button was gated on.
          actionable: result.actionable && isApplicable(liveSession),
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
      setResult(null);
      setScope(null);
      commitSession(advanceSession(liveSession, "applied", new Date().toISOString()));
      setStatus("The revision was written as a tracked change. Reject it in Word to undo it.");
    } catch (failure: unknown) {
      // A throw is a fault, not a refusal, and says so. Collapsing the two is what
      // left the old flow with a button that failed silently.
      setError(
        `The revision could not be written: ${
          failure instanceof Error ? failure.message : String(failure)
        }. Nothing has been changed.`,
      );
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

  const announcement = deriveSemanticAnnouncement({
    status,
    error,
    selection: scope === null ? null : `${scope.wordCount} words selected`,
  });

  return (
    <div className="tf-card" data-page="semantic-review">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>

      <h1 className="tf-title">Semantic Review</h1>
      <p className="tf-sub">
        Click into the paragraph you want checked, or select text. What is read here is sent to your
        configured provider only when you press Review, and nothing is written until you press
        Apply.
      </p>

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
        <button className="tf-native-button" type="button" onClick={onOpenSemanticStyle}>
          Semantic Style
        </button>
      </div>

      {result !== null && (
        <>
          <SemanticAssessmentView assessment={result.assessment} />

          {result.proposedRevision === undefined ? (
            <section aria-labelledby="tf-semantic-nothing" className="tf-card">
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
                <button
                  className="tf-native-button"
                  type="button"
                  disabled={!applyGate.allowed || applying}
                  onClick={() => void applyRevision()}
                >
                  {applying ? "Applying…" : "Apply revision"}
                </button>
                <button
                  className="tf-native-button"
                  type="button"
                  disabled={reviewing || applying}
                  onClick={regenerate}
                >
                  {reviewing ? "Asking again…" : "Regenerate review"}
                </button>
                {/*
                  Keep original, offered with the same weight as Apply.

                  Spec §23 asks for an explicit way to decline. It is a real
                  decision — it records the outcome — and hiding it behind
                  "Regenerate" would leave "do not change this" expressible only by
                  closing the pane.
                */}
                <button
                  className="tf-native-button"
                  type="button"
                  disabled={!keepGate.allowed}
                  onClick={keepOriginal}
                >
                  Keep original
                </button>
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
