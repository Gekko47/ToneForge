/**
 * ConsistencyReviewPreflight — the disclosure shown before a run starts.
 *
 * This is the last point at which a user can change their mind without having
 * sent anything. It states, in the user's terms, the four things that are
 * otherwise easy to be surprised by:
 *
 * - the whole document is sent, not a selection;
 * - a language model judges part of the answer and can be wrong;
 * - the comparison is pairwise, so a very long document is bounded and may not
 *   be covered in full;
 * - nothing in Word is changed.
 *
 * The "partial" line matters most. A cross-report check that quietly examined
 * half a document and reported nothing is indistinguishable from one that
 * examined all of it and found nothing, so the bound is stated here rather than
 * discovered afterwards.
 */

import React from "react";

export interface ConsistencyReviewPreflightProps {
  approximateWords: number;
  statementCount: number;
  maxStatements: number;
  providerName: string;
  onStart: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function ConsistencyReviewPreflight({
  approximateWords,
  statementCount,
  maxStatements,
  providerName,
  onStart,
  onCancel,
  disabled = false,
}: ConsistencyReviewPreflightProps): React.ReactNode {
  const truncated = statementCount > maxStatements;
  return (
    <section aria-label="Consistency review preflight">
      <h2>Consistency review — please confirm</h2>
      <p>
        Scope: the whole document, about {approximateWords} words. Unlike the other reviews, this
        one always sends the entire document to {providerName} and cannot be limited to a selection.
      </p>
      <p>
        A language model is used to judge the comparisons the direct check cannot settle on its own.
        Its answers can be wrong, so every result below shows what it compared and how confident it
        was.
      </p>
      {truncated ? (
        <p role="alert">
          This document splits into {statementCount} statements, and a single run compares at most{" "}
          {maxStatements} of them. The rest will not be examined in this run, so a clean result
          would not mean the whole document is consistent.
        </p>
      ) : (
        <p>
          The document splits into {statementCount} statements and all of them will be compared.
        </p>
      )}
      <p>Nothing in your document is changed by this review.</p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onStart} disabled={disabled}>
          Start consistency review
        </button>
        <button type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </section>
  );
}
