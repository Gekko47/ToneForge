import React from "react";

export interface FullReviewProgressProps {
  completed: number;
  total: number;
  partial: boolean;
  onCancel: () => void;
}

export default function FullReviewProgress({
  completed,
  total,
  partial,
  onCancel,
}: FullReviewProgressProps): React.ReactNode {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <section aria-label="Full-document review progress" aria-busy="true">
      <h2>Reviewing document</h2>
      <p role="status" aria-live="polite">
        {completed} of {total} batches complete ({percent}%).
      </p>
      <progress value={completed} max={total || 1}>
        {percent}%
      </progress>
      {partial && (
        <p role="alert">
          Review cancelled. Results are partial and must not be treated as complete.
        </p>
      )}
      <button type="button" onClick={onCancel}>
        Cancel review
      </button>
    </section>
  );
}
