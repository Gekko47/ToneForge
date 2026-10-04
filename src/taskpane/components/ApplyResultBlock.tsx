/**
 * ApplyResultBlock — what happened, per change, and what is left.
 *
 * Spec §19. The Dashboard used to say one sentence: "Applied and verified 4
 * change(s)", or one error string. Both are answers to a question nobody asked.
 * A user who pressed Apply on four changes needs to know, for each of them,
 * whether the write landed — because under Track Changes a partly-applied plan
 * leaves four revisions in the document and the user has to decide per revision
 * whether to keep it.
 *
 * **Why a block rather than a banner.** It is not a transient notification: it
 * stays until the next scan, because the decision it supports — keep or reject
 * these revisions — outlives the moment of applying. A toast that vanished would
 * be gone before the user opened the Reviewing pane to act on it.
 *
 * The remaining findings are a *fresh review*, not a subtraction from the list
 * that was acted on. A correction can produce a finding the original did not
 * have: applying a style to a paragraph can leave it out of compliance with a
 * paragraph standard the style was not configured for. Subtracting would have
 * reported a clean document.
 */

import React from "react";
import type { ApplyOutcome } from "../../reformat/orchestrator";

export interface ApplyResultBlockProps {
  outcome: ApplyOutcome | null;
  /** Whether the per-change detail is expanded. */
  open: boolean;
  onToggle: () => void;
  /**
   * Opens the findings list filtered to the remaining issues.
   *
   * Rendered only when there *is* a refreshed report with findings in it. A
   * control that navigates to an empty list is a control that does nothing, and
   * §15's rule is that such a control must say why rather than exist.
   */
  onReviewRemaining?: () => void;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export default function ApplyResultBlock({
  outcome,
  open,
  onToggle,
  onReviewRemaining,
}: ApplyResultBlockProps): React.ReactNode {
  if (outcome === null) return null;

  const { verifiedCount, unverifiedCount, failedCount, changes, remainingFindings } = outcome;
  const total = changes.length;
  const problems = unverifiedCount + failedCount;
  /*
   * "All verified" only when something was verified.
   *
   * A preview that changed nothing and a plan whose four writes all failed both
   * produce a zero here, and they are opposite events. The second is the one
   * that needs attention, so the verdict is computed from the *problem* count
   * and the total rather than from the success count.
   */
  const clean = total > 0 && verifiedCount === total;
  const verdict = clean
    ? `${verifiedCount} of ${total} ${plural(total, "change")} verified`
    : problems === 0 && verifiedCount === 0
      ? "Nothing was applied"
      : `${problems} of ${total} ${plural(total, "change")} did not complete`;

  return (
    <section className="tf-collapsible" aria-label="Apply result">
      <button
        type="button"
        className="tf-native-button tf-collapsible-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Apply result: ${verdict}`}
      >
        Apply result <span>{verdict}</span>
      </button>
      {open && (
        <div className={clean ? "tf-apply-result" : "tf-apply-result tf-apply-result-partial"}>
          {/*
            The counts, before the list. A reader who wants the summary gets it
            without opening a per-change table, and a reader who wants the
            detail scrolls past a sentence rather than a wall.
          */}
          <p className="tf-detail">
            {verifiedCount} verified
            {unverifiedCount > 0 && `, ${unverifiedCount} written but not confirmed`}
            {failedCount > 0 && `, ${failedCount} not applied`}.
          </p>

          {changes.length > 0 && (
            <ul className="tf-apply-result-list">
              {changes.map((entry) => (
                <li
                  key={entry.changeId}
                  className={entry.verified ? "tf-apply-result-ok" : "tf-apply-result-bad"}
                >
                  {/*
                    The change id is the identity the user has no other way to
                    reach, and it is what Pending Changes shows for the same
                    change — so the two are joinable by eye. It is a UUID, which
                    is not readable, and that is the honest state: naming the
                    finding it came from would need a reverse index this result
                    does not carry, and inventing a shorter label would be a
                    different id that joins to nothing.
                   */}
                  <code>{entry.changeId}</code>
                  {entry.verified ? " — verified" : ` — ${entry.error}`}
                </li>
              ))}
            </ul>
          )}

          {outcome.remainingFindingsError !== undefined && (
            <p className="tf-apply-result-bad" role="status">
              {outcome.remainingFindingsError}
            </p>
          )}

          {/*
            The remaining findings. `null` and `[]` are different answers and
            neither is "all good": the first is "we could not look", the second
            is "we looked and there is nothing left". Only the second renders the
            reassurance, and only the first renders the error above.
          */}
          {remainingFindings !== null && (
            <p className="tf-detail tf-detail-spaced-1">
              {remainingFindings.summary.total === 0
                ? "No deviations remain in the parts of the document this review covers."
                : `${remainingFindings.summary.total} ${plural(remainingFindings.summary.total, "issue")} still ${remainingFindings.summary.total === 1 ? "stands" : "stand"} after Apply.`}
              {remainingFindings.summary.total > 0 && onReviewRemaining !== undefined && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="tf-native-button tf-coverage-action"
                    onClick={() => onReviewRemaining?.()}
                  >
                    Review the {remainingFindings.summary.total} remaining
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
