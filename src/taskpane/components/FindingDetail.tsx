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
 * aspirational. Both surfaces now render the same header, the same location
 * line, and the same action set, so a reviewer learns it once.
 *
 * The caller supplies the landmark. `FindingCard` wraps this in
 * `<article role="option">` because it is a listbox option; the consistency
 * results wrap it in a plain `<article>`. Keeping the wrapper outside is what
 * stops the two surfaces inventing a second selection vocabulary.
 *
 * `evidence` is the one addition. A deterministic finding is about one span of
 * text before and after; a consistency finding is about the distance between two
 * statements, which is a different shape and gets the comparison panel instead of
 * the Actual/Expected pair. Both are optional, and a finding with neither is
 * still a valid finding.
 */

import React, { useState } from "react";
import type { Finding } from "../../core/domain/Finding";
import { navigateToFinding } from "../../word/sourceLocator";
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

export interface FindingDetailProps {
  finding: Finding;
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
  /** True once the finding has been through the review gate. */
  reviewed?: boolean;
}

export default function FindingDetail({
  finding,
  evidence,
  locationNote,
  onReview,
  onIgnore,
  reviewed = false,
}: FindingDetailProps): React.ReactNode {
  const [navigationState, setNavigationState] = useState<
    { status: "idle" } | { status: "working" } | { status: "message"; message: string }
  >({ status: "idle" });
  // Each card owns its status element; a shared id would collapse every card's
  // message onto the first rendered status node for assistive technology.
  const navigationStatusId = `finding-navigation-status-${finding.id}`;
  const sourceLabel =
    finding.source === "deterministic"
      ? "Deterministic"
      : finding.source === "ai"
        ? "AI"
        : finding.source;
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
  const statusLabel = reviewed
    ? "Reviewed"
    : finding.status.charAt(0).toUpperCase() + finding.status.slice(1);

  async function handleGoToText(): Promise<void> {
    setNavigationState({ status: "working" });
    try {
      const result = await navigateToFinding({ finding });
      setNavigationState({ status: "message", message: result.message });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setNavigationState({
        status: "message",
        message: `Finding ${finding.id} could not be selected: ${detail}`,
      });
    }
  }

  return (
    <div className="tf-finding-detail">
      <header className="tf-finding-card-header">
        <strong className="tf-finding-category">{finding.category}</strong>
        <span className="tf-finding-meta">
          {sourceLabel} · {finding.source === "ai" ? "Current AI review" : "Document scan"} ·{" "}
          {severityLabel} · Risk: {riskLabel} · {statusLabel}
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

      <footer className="tf-finding-location">
        {locationNote ?? (
          <>
            Location: {finding.range.start}–{finding.range.end} ({finding.range.unit})
            {finding.nodeIds.length > 0 && ` · Node: ${finding.nodeIds[0]}`}
          </>
        )}
      </footer>

      <nav className="tf-finding-actions" aria-label="Finding actions">
        <button
          type="button"
          onClick={() => void handleGoToText()}
          disabled={navigationState.status === "working"}
          aria-describedby={navigationStatusId}
        >
          {navigationState.status === "working" ? "Going to text…" : "Go to text"}
        </button>
        {onReview && (
          <button type="button" onClick={() => onReview(finding)} disabled={reviewed}>
            {reviewed ? "Reviewed" : "Review"}
          </button>
        )}
        {onIgnore && (
          <button
            type="button"
            onClick={() => onIgnore(finding.id)}
            /*
             * Disabled once reviewed, and it has to be: reviewing admits a change
             * to Apply and ignoring withdraws the finding, so a button offering
             * both is a finding that is simultaneously queued and set aside. The
             * store refuses the ignore as well, so this is not only a UI
             * courtesy — a caller that bypassed it would corrupt the two.
             */
            disabled={reviewed}
            aria-describedby={reviewed ? "finding-ignore-blocked" : undefined}
          >
            {reviewed ? "Reviewed" : "Ignore"}
          </button>
        )}
        {reviewed && onIgnore ? (
          <span id="finding-ignore-blocked" className="sr-only">
            This finding is already reviewed and waiting in Pending changes. Set it aside by
            rejecting the change instead.
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
