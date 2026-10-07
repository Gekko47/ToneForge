/**
 * ConsistencyReviewPreflight — the disclosure shown before a run starts.
 *
 * This is the last point at which a user can change their mind without having
 * sent anything. It states, in the user's terms, the four things that are
 * otherwise easy to be surprised by:
 *
 * - the whole document is sent, not a selection;
 * - a language model judges part of the answer and can be wrong;
 * - the comparison is bounded, so a very long document is not exhaustively
 *   compared — the report states how many pairs were skipped;
 * - nothing in Word is changed.
 *
 * The bounding line changed with the engine. A long document used to be split
 * into *windows*, and a contradiction between two statements in different
 * windows was never looked for. That is now false: every statement is indexed
 * and a pair is examined when the two share a subject, not when they happen to
 * sit in the same window. What remains bounded is the work per subject — a
 * subject with more statements than the cap contributes the cap and reports the
 * rest as skipped. Saying "the rest will not be examined" would now be false,
 * and saying nothing would let a reader infer full pairwise coverage they are
 * not getting.
 */

import React from "react";
import { redactionListFor } from "../../analysis/consistency";

export interface ConsistencyReviewPreflightProps {
  approximateWords: number;
  statementCount: number;
  /** The per-subject cap the run will honour, shown so the user can see the bound. */
  maxPerSubject: number;
  providerName: string;
  /**
   * The storage line, in the user's terms (original §32). Measured by
   * `buildPreflight`, not guessed here.
   */
  storageNote?: string | undefined;
  /**
   * The per-run redaction opt-out (D13). Default off, so the run redacts unless
   * the user turns it on here. The redaction list below is derived from this
   * value, so the disclosure and the run can never disagree about what is sent.
   */
  allowUnredacted?: boolean | undefined;
  onAllowUnredactedChange?: ((value: boolean) => void) | undefined;
  onStart: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function ConsistencyReviewPreflight({
  approximateWords,
  statementCount,
  maxPerSubject,
  providerName,
  storageNote,
  allowUnredacted = false,
  onAllowUnredactedChange,
  onStart,
  onCancel,
  disabled = false,
}: ConsistencyReviewPreflightProps): React.ReactNode {
  const redactionList = redactionListFor(allowUnredacted);
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
      <p>
        The document splits into {statementCount} statements. Statements are compared when they
        share a subject, not when they sit next to each other, so no statement is left out for being
        far away. The work per subject is capped at {maxPerSubject} statements: a subject with more
        statements than that contributes the first {maxPerSubject} and reports the rest as skipped.
        The report states how many comparisons were skipped, so a clean result would not mean the
        whole document is consistent.
      </p>
      <div aria-label="What is withheld from the provider">
        <p>What is withheld before anything is sent:</p>
        <ul>
          {redactionList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      {onAllowUnredactedChange !== undefined ? (
        <label className="tf-inline-row">
          <input
            className="tf-native"
            type="checkbox"
            checked={allowUnredacted}
            onChange={(event) => onAllowUnredactedChange(event.target.checked)}
            disabled={disabled}
          />
          Allow unredacted evidence for this run — exact statement text will be sent to{" "}
          {providerName}.
        </label>
      ) : null}
      {storageNote !== undefined ? <p className="tf-sub">Storage: {storageNote}</p> : null}
      <p>Nothing in your document is changed by this review.</p>
      <div className="tf-inline-row">
        <button className="tf-native-button" type="button" onClick={onStart} disabled={disabled}>
          Start consistency review
        </button>
        <button className="tf-native-button" type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </section>
  );
}
