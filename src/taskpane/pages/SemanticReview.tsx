import React from "react";
import SemanticReviewScope from "../components/semantic/SemanticReviewScope";
import SemanticAssessmentView from "../components/semantic/SemanticAssessmentView";
import SemanticRewriteComparison from "../components/semantic/SemanticRewriteComparison";
import PreservationSummary from "../components/semantic/PreservationSummary";
import { semanticGate, type SemanticGateInput } from "../semantic/gates";
import { deriveSemanticAnnouncement } from "../state/semanticAnnouncement";
import { readSelectionScope, type SelectionScope } from "../../word/selectionScope";
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
  navigation?: TaskpaneNavigation | null;
  /** The session the Dashboard holds, so a navigation does not discard it. */
  session: SemanticReviewSession | null;
  onSession: (session: SemanticReviewSession | null) => void;
  /** Told when a capture succeeds or fails, for the Troubleshooting registry. */
  onSelectionCaptured?: (captured: boolean) => void;
}

export default function SemanticReview({
  onBack,
  onOpenSettings,
  onOpenSemanticStyle,
  navigation,
  session,
  onSession,
  onSelectionCaptured,
}: SemanticReviewProps): React.ReactNode {
  const [scope, setScope] = React.useState<SelectionScope | null>(null);
  const [emptyReason, setEmptyReason] = React.useState<string | null>(null);
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
   * Reading the selection: the only Word call this page makes without a click on
   * a control, and only when the pane was opened from the context menu, where
   * reading the selection is completing the gesture the user started.
   */
  React.useEffect(() => {
    // The arrival, and nothing else, is the dependency: this effect is about
    // what opened the pane, not about the handler it calls.
    if (navigation?.action !== "read-selection") return;
    void readSelection();
  }, [navigation]);

  async function readSelection(): Promise<void> {
    const captured = await readSelectionScope();
    if (captured.status === "ok") {
      setScope(captured.scope);
      setEmptyReason(null);
      setUnavailableReason(null);
      setError(null);
      onSelectionCaptured?.(true);
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
    onSelectionCaptured?.(false);
    if (captured.status === "unavailable") {
      setUnavailableReason(captured.reason);
      setEmptyReason(null);
      setError(null);
    } else {
      setUnavailableReason(null);
      setEmptyReason("Nothing is selected. Select the paragraph you want reviewed.");
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
    preservationPassed: result?.preservation.pass === true,
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
          actionable: isApplicable(liveSession),
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
      onSelectionCaptured?.(false);
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
        <button type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>

      <h1 className="tf-title">Semantic Review</h1>
      <p className="tf-sub">
        Select the text you want checked against your semantic style. The selection is sent to your
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
        <button type="button" onClick={onOpenSemanticStyle}>
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
                  type="button"
                  disabled={!applyGate.allowed || applying}
                  onClick={() => void applyRevision()}
                >
                  {applying ? "Applying…" : "Apply revision"}
                </button>
                <button type="button" disabled={reviewing || applying} onClick={regenerate}>
                  {reviewing ? "Asking again…" : "Regenerate review"}
                </button>
                {/*
                  Keep original, offered with the same weight as Apply.

                  Spec §23 asks for an explicit way to decline. It is a real
                  decision — it records the outcome — and hiding it behind
                  "Regenerate" would leave "do not change this" expressible only by
                  closing the pane.
                */}
                <button type="button" disabled={!keepGate.allowed} onClick={keepOriginal}>
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
