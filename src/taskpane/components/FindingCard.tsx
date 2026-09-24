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
    <article
      aria-label={`Finding: ${finding.category}`}
      style={{
        border: "1px solid #ccc",
        borderRadius: "4px",
        padding: "0.75rem",
        marginBottom: "0.5rem",
        backgroundColor: "#fff",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontWeight: "bold", fontSize: "0.9rem" }}>{finding.category}</span>
        <span style={{ fontSize: "0.8rem", color: "#666" }}>
          {sourceLabel} · {severityLabel} · Risk: {riskLabel}
        </span>
      </header>

      <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.85rem" }}>{finding.message}</p>

      {finding.explanation && (
        <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.8rem", color: "#555" }}>
          Explanation: {finding.explanation}
        </p>
      )}

      {finding.actual && (
        <p style={{ margin: "0 0 0.1rem 0", fontSize: "0.8rem" }}>
          <strong>Actual:</strong> {finding.actual}
        </p>
      )}
      {finding.expected && (
        <p style={{ margin: "0 0 0.1rem 0", fontSize: "0.8rem" }}>
          <strong>Expected:</strong> {finding.expected}
        </p>
      )}

      <footer style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#888" }}>
        Location: {finding.range.start}–{finding.range.end} ({finding.range.unit})
        {finding.nodeIds.length > 0 && ` · Node: ${finding.nodeIds[0]}`}
      </footer>

      <nav
        style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}
        aria-label="Finding actions"
      >
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
