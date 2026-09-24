/**
 * FindingCard — displays a single finding with category, source,
 * severity, explanation, actual vs expected, location, and actions.
 */

import React from "react";
import type { Finding } from "../../core/domain/Finding";
import { navigateToFinding } from "../../word/sourceLocator";

export interface FindingCardProps {
  finding: Finding;
  onApply?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
}

export default function FindingCard({
  finding,
  onApply,
  onIgnore,
}: FindingCardProps): React.ReactNode {
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

  function handleGoToText(): void {
    navigateToFinding({ finding });
  }

  function handleApply(): void {
    onApply?.(finding);
  }

  function handleIgnore(): void {
    onIgnore?.(finding.id);
  }

  return (
    <article aria-label={`Finding: ${finding.category}`} className="tf-finding-card">
      <header className="tf-finding-card-header">
        <strong className="tf-finding-category">{finding.category}</strong>
        <span className="tf-finding-meta">
          {sourceLabel} · {finding.source === "ai" ? "Current AI review" : "Document scan"} ·{" "}
          {severityLabel} · Risk: {riskLabel}
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
        <button type="button" onClick={handleGoToText}>
          Go to text
        </button>
        {onApply && (
          <button type="button" onClick={handleApply}>
            Apply
          </button>
        )}
        {onIgnore && (
          <button type="button" onClick={handleIgnore}>
            Ignore
          </button>
        )}
      </nav>
    </article>
  );
}
