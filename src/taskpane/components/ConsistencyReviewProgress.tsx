/**
 * ConsistencyReviewProgress — live progress for one consistency run.
 *
 * The engine reports a phase and a fraction rather than a batch count, because
 * it has no batches: it segments, compares, adjudicates, and consolidates. The
 * four phases are named rather than numbered so the user can tell a long
 * comparison from a stuck one.
 *
 * A cancelled run is marked partial in an alert, never as a clean finish. The
 * cancelled report is discarded by the engine, but the user still needs to know
 * the run they started did not complete.
 */

import React from "react";
import type { ConsistencyProgress } from "../../analysis/consistency";

export interface ConsistencyReviewProgressProps {
  progress: ConsistencyProgress;
  onCancel: () => void;
  cancelled?: boolean;
}

export default function ConsistencyReviewProgress({
  progress,
  onCancel,
  cancelled = false,
}: ConsistencyReviewProgressProps): React.ReactNode {
  const percent = Math.round(progress.fraction * 100);
  return (
    <section aria-label="Consistency review progress" aria-busy="true">
      <h2>Checking the document for consistency</h2>
      <p role="status" aria-live="polite">
        {progress.message} ({percent}%)
      </p>
      <progress value={progress.fraction} max={1}>
        {percent}%
      </progress>
      {cancelled && (
        <p role="alert">
          Review cancelled. Any results from it are partial and must not be treated as a complete
          review of the document.
        </p>
      )}
      <button type="button" onClick={onCancel}>
        Cancel review
      </button>
    </section>
  );
}
