/**
 * ConsistencyReviewPreflight — the disclosure shown before a run starts.
 *
 * This is the last point at which a user can change their mind without having
 * sent anything. It states, in the user's terms, the four things that are
 * otherwise easy to be surprised by:
 *
 * - the whole document is sent, not a selection;
 * - a language model judges part of the answer and can be wrong;
 * - the comparison is pairwise, so a very long document is split into windows;
 * - nothing in Word is changed.
 *
 * The windowing line matters most, and its wording changed with the engine. A
 * long document used to be *truncated* — the tail was never read — so the
 * disclosure said so. Now every statement is examined and the gap is between
 * windows, which is a weaker and more specific limitation. Saying "the rest
 * will not be examined" would now be false, and saying nothing would let a
 * reader infer full pairwise coverage they are not getting.
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
  const windows = Math.max(1, Math.ceil(statementCount / Math.max(1, maxStatements)));
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
      {windows > 1 ? (
        <p role="alert">
          This document splits into {statementCount} statements, which are compared in {windows}{" "}
          windows of about {maxStatements}. Every statement is examined, but a contradiction between
          two statements in different windows is not looked for, so a clean result would not mean
          the whole document is consistent. The report states how many comparisons were skipped.
        </p>
      ) : (
        <p>
          The document splits into {statementCount} statements and all of them will be compared
          against each other.
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
