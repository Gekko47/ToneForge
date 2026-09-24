import React from "react";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { Finding } from "../../core/domain/Finding";

export interface AiReviewResultProps {
  findings: readonly Finding[];
  plan: ChangePlan;
  provider: string;
  onPreview: () => void;
  onDismiss: () => void;
}

export default function AiReviewResult({
  findings,
  plan,
  provider,
  onPreview,
  onDismiss,
}: AiReviewResultProps): React.ReactNode {
  return (
    <section aria-label="AI review result" style={{ marginTop: "1rem" }}>
      <h3>AI review result</h3>
      <p role="status">
        {findings.length} finding(s) from {provider}. Nothing has been changed in Word.
      </p>
      {findings.length === 0 && <p>No justified editorial changes were returned.</p>}
      {findings.map((finding) => (
        <article key={finding.id} aria-label={`AI finding: ${finding.category}`}>
          <h4>{finding.category}</h4>
          <p>{finding.explanation ?? finding.message}</p>
          {finding.actual && <p>Evidence: {finding.actual}</p>}
          {finding.expected && <p>Suggested revision: {finding.expected}</p>}
          <p>
            Risk: {finding.risk} · Confidence: {Math.round(finding.confidence * 100)}%
          </p>
        </article>
      ))}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onPreview} disabled={plan.changes.length === 0}>
          Preview changes
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
