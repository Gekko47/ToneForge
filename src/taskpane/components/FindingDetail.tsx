/**
 * FindingDetail — the body of a finding card, shared by every surface.
 *
 * This exists because a finding was being presented two ways. Document
 * Governance rendered it as a listbox option with a header, a message, the
 * before/after text, a location, and three actions. The Consistency Review
 * rendered a different set of cards with its own header, its own wording, and no
 * actions at all — so a conflict found by an AI review could not be navigated to,
 * reviewed, or ignored, and the two surfaces could drift apart silently.
 *
 * Extracting the body is what makes "one finding format" true rather than
 * aspirational. Both surfaces render the same landmarks, the same location
 * treatment, and the same action set, so a reviewer learns it once.
 *
 * **One shell, two densities (`variant`).** The owner was right that a single
 * slim card discards information the Consistency Review genuinely needs. Rather
 * than splitting the component — which is how the two formats drifted in the first
 * place — the structure is shared and `variant` selects the density:
 *
 * - `consistency` keeps the full header, because on that surface risk and the
 *   review context are the information.
 * - `deterministic` prints a one-line summary and moves source, risk and the
 *   described location into a collapsed detail region. They are *moved*, not
 *   dropped: a reader who wants them opens one control.
 *
 * The variant is passed by the caller and never inferred from `finding.source`.
 * Inferring it would make the density a function of a data field, which is exactly
 * how a surface that knows its own context ends up rendering the wrong one.
 *
 * `evidence` is the one addition. A deterministic finding is about one span of
 * text before and after; a consistency finding is about the distance between two
 * statements, which is a different shape and gets the comparison panel instead of
 * the Actual/Expected pair. Both are optional, and a finding with neither is
 * still a valid finding.
 */

import React, { useState } from "react";
import type { Finding } from "../../core/domain/Finding";
import { goToFinding } from "../findingNavigation";
import { describeFindingLocation } from "../findingLocation";
import { approvalControls } from "../approvalControls";
import EvidenceSplit from "./EvidenceSplit";

/** The two statements a cross-report finding compared. */
export interface FindingEvidence {
  left: string;
  right: string;
  sectionLeft: string;
  sectionRight: string;
  /** How many engine reports this pair produced; 0 when it was reported once. */
  repeats?: number | undefined;
}

/**
 * Which surface is presenting this finding.
 *
 * `consistency` is the richer header; `deterministic` is the slim one. Required
 * rather than defaulted, so a new caller cannot inherit a density by accident.
 */
export type FindingVariant = "deterministic" | "consistency";

export interface FindingDetailProps {
  finding: Finding;
  /** Which density to render. Passed by the caller; never inferred. */
  variant: FindingVariant;
  evidence?: FindingEvidence | undefined;
  /**
   * Replaces the computed location line.
   *
   * A finding the engine could not place has no range, and printing
   * "0–0" would be a location that is wrong rather than one that is absent. The
   * caller knows this; the finding does not carry it, so it is passed in.
   */
  locationNote?: string | undefined;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  /**
   * Approve: include this exact correction in the reviewed plan (spec §15).
   *
   * Named separately from `onSkip` because they are different decisions about
   * different things. Approve is consent to write; Skip is a decision to leave
   * this occurrence out of *this* review while it stays visible in the list. One
   * button doing both is what §15 replaces.
   */
  onSkip?: ((finding: Finding) => void) | undefined;
  /** Undo decision: withdraw whatever was decided, so it can be decided again. */
  onUndo?: ((finding: Finding) => void) | undefined;
  /** True once the finding has been through the review gate. */
  reviewed?: boolean;
  /** True once the finding has been skipped, which is a different decision. */
  skipped?: boolean;
  /**
   * Why Approve cannot lead anywhere, or `null`.
   *
   * Supplied by the caller from `unapprovableReason`, so a finding the planner
   * cannot correct still offers Skip — declining is always available — while
   * Approve is absent rather than present and inert (UX-1).
   */
  approveRefusal?: string | null;
}

export default function FindingDetail({
  finding,
  variant,
  evidence,
  locationNote,
  onReview,
  onIgnore,
  onSkip,
  onUndo,
  reviewed = false,
  skipped = false,
  approveRefusal = null,
}: FindingDetailProps): React.ReactNode {
  const [navigationState, setNavigationState] = useState<
    { status: "idle" } | { status: "working" } | { status: "message"; message: string }
  >({ status: "idle" });
  // Each card owns its status element; a shared id would collapse every card's
  // message onto the first rendered status node for assistive technology.
  const navigationStatusId = `finding-navigation-status-${finding.id}`;
  // Per-card, for the same reason as the navigation status: the same sentence
  // is rendered by every decided card, and a shared id is resolved by assistive
  // technology to the first one in the document rather than to the button that
  // names it.
  const ignoreBlockedId = `finding-ignore-blocked-${finding.id}`;
  const sourceLabel =
    finding.source === "deterministic"
      ? "Deterministic"
      : finding.source === "ai"
        ? "AI"
        : finding.source;
  const reviewContextLabel = finding.source === "ai" ? "Current AI review" : "Document scan";
  const severityLabel = finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1);
  const riskLabel = finding.risk
    ? finding.risk.charAt(0).toUpperCase() + finding.risk.slice(1)
    : "None";
  /*
   * "Reviewed" comes from the gate's own record, not from `finding.status`.
   *
   * The status field is written by the observer, which knows nothing about what
   * the user reviewed, so reading it here made the label depend on a value the
   * pane had to patch back in after every scan.
   */
  const controls = approvalControls({
    decision: reviewed ? "approved" : skipped ? "skipped" : null,
    approveRefusal,
  });
  /*
   * The decision, in words.
   *
   * The old single "Reviewed" label covered every state a finding could be in —
   * queued, declined, or unapprovable — so it told the user none of them. Spec
   * §15 wants the decision named, and this is the sentence on the card.
   */
  const statusLabel =
    controls.kind === "approved"
      ? "Approved"
      : controls.kind === "skipped"
        ? "Skipped"
        : finding.status.charAt(0).toUpperCase() + finding.status.slice(1);

  /*
   * UX-1: this finding is real, and the user has to fix it themselves.
   *
   * `correctionAvailable: false` means the engine found a genuine deviation and
   * declines to write to it. Approve used to render here — disabled — which left
   * the reader unable to distinguish "ToneForge will fix this" from "you must fix
   * this yourself", because both cards had the same action row. Approve is now
   * omitted entirely and the reason is stated in words, while Go to text stays:
   * navigation is exactly what a manual correction needs.
   */
  const manualCorrection = controls.kind === "undecided" && controls.approveReason !== null;

  async function handleGoToText(): Promise<void> {
    setNavigationState({ status: "working" });
    try {
      /*
       * Through the shared guard, not the locator.
       *
       * Every card calling `navigateToFinding` itself meant two quick clicks
       * started two host navigations, and whichever finished last won — so the
       * card that said "selected" was the one that happened to resolve last,
       * not the one the user most recently asked for. `office.run` cannot be
       * cancelled, so the guard supersedes rather than interrupts.
       */
      const result = await goToFinding(finding);
      setNavigationState({
        status: "message",
        message: result.superseded
          ? "A newer request replaced this one; the document was not moved here."
          : result.message,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setNavigationState({
        status: "message",
        message: `Finding ${finding.id} could not be selected: ${detail}`,
      });
    }
  }

  const location = (
    <>
      {locationNote ?? (
        <>
          Location: {describeFindingLocation(finding)}
          {finding.nodeIds.length > 0 && ` · Node: ${finding.nodeIds[0]}`}
        </>
      )}
    </>
  );

  return (
    <div className="tf-finding-detail">
      <header className="tf-finding-card-header">
        <strong className="tf-finding-category">{finding.category}</strong>
        <span className="tf-finding-meta">
          {/*
            Slim on the deterministic surface, full on the consistency one.

            UX-3: for a typography substitution, source, "Document scan" and
            risk are constant — `risk` is `none` for essentially every
            deterministic finding — so they are the noise a twenty-row list is
            mostly made of. They are moved into the detail region below, not
            deleted: a reader who wants them opens one control.
          */}
          {variant === "consistency"
            ? `${sourceLabel} · ${reviewContextLabel} · ${severityLabel} · Risk: ${riskLabel} · ${statusLabel}`
            : `${severityLabel} · ${statusLabel}`}
        </span>
      </header>

      <p className="tf-finding-message">{finding.message}</p>

      {finding.explanation && (
        <p className="tf-finding-explanation">Explanation: {finding.explanation}</p>
      )}

      {evidence ? (
        <EvidenceSplit
          left={evidence.left}
          right={evidence.right}
          sectionLeft={evidence.sectionLeft}
          sectionRight={evidence.sectionRight}
          repeats={evidence.repeats ?? 0}
        />
      ) : finding.actual !== undefined && finding.expected !== undefined ? (
        /*
         * Actual and expected as one before→after (UX-3).

         * Two separate labelled paragraphs made the reader hold both halves in
         * their head to see the substitution. Rendered as a pair only when both
         * exist — a finding with an `expected` and no `actual` (a missing thing,
         * say) is not a substitution, and "→ (nothing)" would misdescribe it.
         */
        <p className="tf-finding-detail-line">
          <span className="tf-finding-actual">{finding.actual}</span>
          <span aria-hidden="true"> → </span>
          <span className="sr-only">should be</span>
          <span className="tf-finding-expected">{finding.expected}</span>
        </p>
      ) : (
        <>
          {finding.actual && (
            <p className="tf-finding-detail-line">
              <strong>Actual:</strong> {finding.actual}
            </p>
          )}
          {finding.expected && (
            <p className="tf-finding-detail-line">
              <strong>Expected:</strong> {finding.expected}
            </p>
          )}
        </>
      )}

      {/*
        The location is described, not printed as raw numbers (UX-3). A table
        finding used to read "Location: 2–3 (section)", because three
        structures shared one `sectionRange` helper;
        `describeFindingLocation` prefers the finding's own target and falls
        back to the range only for a text finding, which is the one thing the
        range alone does describe.

        On the deterministic surface it lives here rather than in a footer: a
        footer on every card is a line of near-constant text under each row, and
        the group header already says where the set is.
      */}
      {variant === "consistency" ? (
        <footer className="tf-finding-location">{location}</footer>
      ) : (
        <details className="tf-finding-detail-region">
          <summary>Details</summary>
          <p className="tf-finding-detail-line">
            {sourceLabel} · {reviewContextLabel} · Risk: {riskLabel}
          </p>
          <p className="tf-finding-detail-line">{location}</p>
        </details>
      )}

      {manualCorrection && (
        <p className="tf-finding-manual">
          <strong>Manual correction required.</strong> {controls.approveReason}
        </p>
      )}

      <nav className="tf-finding-actions" aria-label="Finding actions">
        <button
          className="tf-native-button"
          type="button"
          onClick={() => void handleGoToText()}
          disabled={navigationState.status === "working"}
          aria-describedby={navigationStatusId}
        >
          {navigationState.status === "working" ? "Going to text…" : "Go to text"}
        </button>
        {/*
          Approve, Skip and Undo decision (spec §15).

          Approve is omitted entirely for a finding the planner cannot correct,
          rather than offered and disabled: a greyed-out Approve next to a live
          Skip told the reader the card was actionable. Skip stays available
          there, because declining something is always a real decision. Undo
          replaces both once either has been made, which is the only way back
          once a decision is recorded.
        */}
        {onReview && controls.kind === "undecided" && !manualCorrection && (
          <button className="tf-native-button" type="button" onClick={() => onReview(finding)}>
            Approve
          </button>
        )}
        {onSkip && controls.kind !== "approved" && (
          <button className="tf-native-button" type="button" onClick={() => onSkip(finding)}>
            Skip
          </button>
        )}
        {onUndo && controls.kind !== "undecided" && (
          <button className="tf-native-button" type="button" onClick={() => onUndo(finding)}>
            Undo decision
          </button>
        )}
        {onIgnore && (
          <button
            className="tf-native-button"
            type="button"
            onClick={() => onIgnore(finding.id)}
            /*
             * Disabled once decided, and it has to be: approving admits a change
             * to Apply and ignoring withdraws the finding, so a button offering
             * both is a finding that is simultaneously queued and set aside. The
             * store refuses the ignore as well, so this is not only a UI
             * courtesy — a caller that bypassed it would corrupt the two.
             *
             * The description id carries the finding's own id. A shared one was
             * rendered by every decided card in the list, so `aria-describedby`
             * resolved to whichever appeared first in the document — one card's
             * explanation attached to all the others.
             */
            disabled={controls.kind !== "undecided"}
            aria-describedby={controls.kind === "undecided" ? undefined : ignoreBlockedId}
          >
            Ignore
          </button>
        )}
        {controls.kind !== "undecided" && onIgnore ? (
          <span id={ignoreBlockedId} className="sr-only">
            This finding has already been decided. Undo the decision first if you would rather set
            it aside.
          </span>
        ) : null}
      </nav>
      <p
        id={navigationStatusId}
        className="tf-sub"
        role={navigationState.status === "message" ? "status" : undefined}
        aria-live="polite"
      >
        {navigationState.status === "message" ? navigationState.message : ""}
      </p>
    </div>
  );
}
