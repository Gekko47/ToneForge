import React from "react";

export interface FullReviewPreflightProps {
  nodeCount: number;
  approximateWords: number;
  protectedCount: number;
  providerName: string;
  onStart: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function FullReviewPreflight({
  nodeCount,
  approximateWords,
  protectedCount,
  providerName,
  onStart,
  onCancel,
  disabled = false,
}: FullReviewPreflightProps): React.ReactNode {
  return (
    <section aria-label="Full-document review preflight">
      <h2>Full-document review</h2>
      <p>
        Review scope: {nodeCount} editable node(s), approximately {approximateWords} words.
      </p>
      <p>
        {protectedCount} protected node(s) will be excluded and will not be sent to {providerName}.
      </p>
      <p>Review runs in bounded batches. A partial result is not a complete review.</p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onStart} disabled={disabled}>
          Start review
        </button>
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </section>
  );
}
