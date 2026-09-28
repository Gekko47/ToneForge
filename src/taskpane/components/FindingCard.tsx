/**
 * FindingCard — displays a single finding with category, source,
 * severity, explanation, actual vs expected, location, and actions.
 *
 * The card is an `option` inside the findings listbox, so it carries
 * `aria-selected` and `aria-current` rather than inventing a second selection
 * vocabulary. `selected` is driven by the findings toolbar; before that existed
 * the toolbar advanced a counter with nothing on screen to match it.
 */

import React, { useEffect, useRef, useState } from "react";
import type { Finding } from "../../core/domain/Finding";
import { navigateToFinding } from "../../word/sourceLocator";

export interface FindingCardProps {
  finding: Finding;
  /** True when the findings toolbar currently points at this card. */
  selected?: boolean;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  /**
   * True when this finding has already been sent through the review gate.
   *
   * Passed in rather than read from `finding.status`, because the gate's verdict
   * is a decision the Dashboard makes and the card only renders.
   */
  reviewed?: boolean;
}

export default function FindingCard({
  finding,
  selected = false,
  onReview,
  onIgnore,
  reviewed = false,
}: FindingCardProps): React.ReactNode {
  const [navigationState, setNavigationState] = useState<
    { status: "idle" } | { status: "working" } | { status: "message"; message: string }
  >({ status: "idle" });
  const cardRef = useRef<HTMLElement | null>(null);
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

  /*
   * Scroll only when this card becomes the selected one.
   *
   * `scrollIntoView` is feature-detected because the add-in runs in an Office
   * WebView whose API surface is not guaranteed to match a browser's, and an
   * undefined method here would take down the whole findings list rather than
   * just this convenience.
   */
  useEffect(() => {
    if (!selected) return;
    const element = cardRef.current;
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

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

  function handleReview(): void {
    onReview?.(finding);
  }

  function handleIgnore(): void {
    onIgnore?.(finding.id);
  }

  return (
    <article
      ref={cardRef}
      role="option"
      aria-selected={selected}
      aria-current={selected ? "true" : undefined}
      aria-label={`Finding: ${finding.category}`}
      className={selected ? "tf-finding-card is-selected" : "tf-finding-card"}
    >
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

      {finding.actual && (
        <p className="tf-finding-detail">
          <strong>Actual:</strong> {finding.actual}
        </p>
      )}
      {finding.expected && (
        <p className="tf-finding-detail">
          <strong>Expected:</strong> {finding.expected}
        </p>
      )}

      <footer className="tf-finding-location">
        Location: {finding.range.start}–{finding.range.end} ({finding.range.unit})
        {finding.nodeIds.length > 0 && ` · Node: ${finding.nodeIds[0]}`}
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
          <button type="button" onClick={handleReview} disabled={reviewed}>
            {reviewed ? "Reviewed" : "Review"}
          </button>
        )}
        {onIgnore && (
          <button type="button" onClick={handleIgnore}>
            Ignore
          </button>
        )}
      </nav>
      <p
        id={navigationStatusId}
        className="tf-sub"
        role={navigationState.status === "message" ? "status" : undefined}
        aria-live="polite"
      >
        {navigationState.status === "message" ? navigationState.message : ""}
      </p>
    </article>
  );
}
