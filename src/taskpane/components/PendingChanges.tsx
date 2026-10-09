/**
 * PendingChanges — the reviewed changes as cards, with a sticky footer that
 * offers Preview and then Apply.
 *
 * **Why cards and not the five-column table** (spec §17). The table put change
 * type, before, after, risk, source, approval and precondition side by side in a
 * 320px task pane, which left every cell about one word wide; the wrapper
 * scrolled horizontally so the columns stayed legible, and a horizontally
 * scrolling list of changes is a table nobody can read at a glance. The card
 * gives one change the full width, which is the only arrangement in which
 * "program → programme" is legible without a horizontal scrollbar.
 *
 * **Why the footer is sticky.** It carries the two counts and the one button
 * that matters. Scrolled to the bottom of fourteen cards, that is exactly where
 * the user has arrived when they decide, and a button that has been scrolled out
 * of reach is a button that gets missed. It is a `position: sticky` element
 * inside the scrolling pane, not a fixed bar, so it stays inside the section it
 * belongs to.
 *
 * **Preview and Apply are two states of one footer, not two controls.** The
 * footer shows "Preview N changes" until a plan exists and "Apply N with Track
 * Changes" once one does. Offering both at once would invite the user to apply a
 * plan they have not seen, which is the thing §18 forbids.
 *
 * The judgement about what a card says lives in `pendingChangeCards.ts`, which
 * is pure and tested without a DOM. This file only renders.
 */

import React, { useId, useState } from "react";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import type { Finding } from "../../core/domain/Finding";
import ExportChangesButton from "./ExportChangesButton";
import { buildPendingChangeCards, pendingChangeTotals } from "../pendingChangeCards";
import { goToFinding } from "../findingNavigation";

export interface PendingChangesProps {
  plan: ChangePlan | null;
  findings: Finding[];
  onApply?: () => boolean | Promise<boolean>;
  onReject?: () => void;
  /**
   * Build the preview, offered when there is no plan yet.
   *
   * Optional, and the Preview button is absent when it is. The footer must not
   * offer a control that does nothing: the pane auto-previews on a settled scan,
   * so a user who reaches an empty footer has usually hit the case where a
   * preview was declined, and "Preview unavailable" is a better sentence than a
   * live button whose click is ignored.
   */
  onPreview?: () => void;
  /**
   * Withdraw one change from Pending Changes.
   *
   * The card's "Remove" control (spec §17). Removing is not rejecting: it takes
   * one change out of the plan Apply would write and leaves the rest alone.
   */
  onRemove?: (changeId: string) => void;
  /**
   * Why the host cannot accept these changes, supplied by the parent workflow.
   *
   * Computed by the pure `applyReadiness` helper from the same facts the apply
   * gate checks, so a disabled button and a refusing gate cannot disagree. The
   * reason is rendered as the button's accessible description, because a control
   * the user cannot press must always say why.
   */
  applyDisabledReason?: string | null;
  /** Offered beside the reason when the blocker is resolved in Settings. */
  onOpenSettings?: () => void;
  coverage?: {
    complete: boolean;
    unsupported?: readonly string[];
    unprocessed?: readonly string[];
  } | null;
  /**
   * Why the section is empty, in the words its state deserves.
   *
   * Three states produce three different sentences, and they are decided by
   * `reviewedPlan` rather than reconstructed here: no preview built yet, a
   * preview with nothing reviewed, and a reviewed subset. A single "No pending
   * changes" for all three read as a refusal in the middle case, where the real
   * position is a choice the user has not made yet.
   */
  emptyReason?: string | null;
  /** Every change the preview proposed, before the reviewed-only narrowing. */
  totalCount?: number;
  /** The changes actually in this list, all of which the user reviewed. */
  reviewedCount?: number;
  /**
   * The full coverage report, when the caller has one.
   *
   * The `coverage` prop above is a deliberately narrow shape used for the
   * readiness banner, but the export serialiser gates on the whole report. They
   * are separate props rather than one widened type so the readiness UI cannot
   * silently start depending on acquisition diagnostics it does not display.
   */
  exportCoverage?: CoverageReport | null;
}

export default function PendingChanges({
  plan,
  findings,
  onApply,
  onReject,
  onPreview,
  onRemove,
  applyDisabledReason = null,
  onOpenSettings,
  coverage = null,
  exportCoverage = null,
  emptyReason = null,
  totalCount = 0,
  reviewedCount = 0,
}: PendingChangesProps): React.ReactNode {
  const [result, setResult] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [navigationNote, setNavigationNote] = useState<string | null>(null);
  const localReadinessId = useId();
  const cards = buildPendingChangeCards(plan, findings);
  const schemaBlocked = plan?.schemaVersion !== 2;
  const staleBlocked = plan?.stale === true;
  const conflictBlocked = (plan?.conflicts ?? []).length > 0;
  const approvalBlocked =
    plan?.changes.some(
      (change) => change.approvalRequired && change.approvalState !== "approved",
    ) ?? false;
  const preconditionBlocked =
    plan?.changes.some((change) => change.precondition === undefined) ?? false;
  const coverageBlocked = coverage !== null && coverage !== undefined && !coverage.complete;
  const localReadinessReason = schemaBlocked
    ? "This plan is not schema version 2; preview it again."
    : staleBlocked
      ? "This plan is stale; preview it again."
      : conflictBlocked
        ? "Unresolved conflicts block application; preview it again."
        : approvalBlocked
          ? "One or more changes require explicit approval."
          : preconditionBlocked
            ? "One or more changes lack an exact precondition."
            : coverageBlocked
              ? "Coverage is incomplete; apply is blocked."
              : null;
  const canApply =
    onApply !== undefined && applyDisabledReason === null && localReadinessReason === null;
  const describedBy = [
    localReadinessReason === null ? null : localReadinessId,
    applyDisabledReason === null ? null : "pending-apply-readiness",
  ]
    .filter((id): id is string => id !== null)
    .join(" ");
  const totals = pendingChangeTotals(cards.length, totalCount);

  async function handleApply(): Promise<void> {
    setApplying(true);
    setResult(null);
    try {
      const applied = await onApply?.();
      setResult(
        applied ? "Changes applied and verified." : "Apply was refused; no success was reported.",
      );
    } catch (err) {
      setResult(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  }

  function handleReject(): void {
    setResult("Changes rejected.");
    onReject?.();
  }

  /*
   * One navigation per click, through the shared guard.
   *
   * A card that called the host itself would race any other card's navigation,
   * and the outcome a card reported would be the one that happened to finish
   * last rather than the one the user asked for last. `goToFinding` is the single
   * owner of that (see `findingNavigation.ts`).
   */
  async function handleGoTo(finding: Finding): Promise<void> {
    setNavigationNote(null);
    try {
      const outcome = await goToFinding(finding);
      // A superseded attempt says neither success nor failure: it was replaced,
      // and claiming an outcome would contradict what the pane just did.
      if (outcome.superseded) return;
      setNavigationNote(outcome.message);
    } catch (error: unknown) {
      // `goToFinding` resolves with a superseded marker but rejects when the
      // host refuses the range or the selection. Nothing caught that, so the
      // rejection escaped a click handler and the user saw the button reset
      // with no explanation at all. The detail is the host's own message, which
      // is the only thing that says *why* the selection failed.
      const detail = error instanceof Error ? error.message : String(error);
      setNavigationNote(`That change could not be selected: ${detail}`);
    }
  }

  /*
   * An empty list has to say *why* it is empty, or it reads as "nothing to fix".
   *
   * There are two different empties and they need different words: nothing has
   * been proposed at all, versus changes exist but the user has not reviewed
   * any yet. The second is the common case, and "No pending changes" in that
   * situation is a flat denial of work that is sitting right there in Findings.
   */
  if (!plan || cards.length === 0) {
    return (
      <section aria-label="Pending changes">
        <h3>Pending Changes</h3>
        <p>{emptyReason ?? "No changes are ready to apply for this document."}</p>
        {onPreview && (
          <div className="tf-pending-footer">
            <button className="tf-native-button" type="button" onClick={onPreview}>
              Preview {totalCount} change{totalCount === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </section>
    );
  }

  const changes = plan.changes;
  return (
    <section aria-label="Pending changes" className="tf-pending">
      <h3>Pending Changes ({cards.length})</h3>
      {/*
        The three counts, labelled.

        The header above this section counts every change the preview proposed,
        so a header of 5 over a list of 2 is correct but reads as lost work
        unless it is said which is which. Naming them is the difference between
        a deliberate narrowing and an apparent loss.
      */}
      {totalCount > cards.length ? (
        <p className="tf-sub">
          {cards.length} of {totalCount} proposed change
          {totalCount === 1 ? "" : "s"} shown. The rest are waiting for you to review the finding
          they came from.
        </p>
      ) : (
        <p className="tf-sub">
          {reviewedCount} reviewed change{reviewedCount === 1 ? "" : "s"}.
        </p>
      )}

      {(plan.conflicts ?? []).length > 0 && (
        <div className="tf-conflict-list">
          <p>{(plan.conflicts ?? []).length} conflict(s) block application.</p>
          <ul aria-live="polite">
            {(plan.conflicts ?? []).map((conflict, index) => {
              const message = typeof conflict === "string" ? conflict : conflict.message;
              return <li key={index}>{message}</li>;
            })}
          </ul>
        </div>
      )}
      {localReadinessReason !== null && (
        <p id={localReadinessId} aria-live="polite" className="tf-sub">
          {localReadinessReason}
        </p>
      )}
      {applyDisabledReason !== null && (
        <div id="pending-apply-readiness" role="status" aria-live="polite" className="tf-sub">
          <p>{applyDisabledReason}</p>
          {onOpenSettings && (
            <button className="tf-native-button" type="button" onClick={onOpenSettings}>
              Open General Settings
            </button>
          )}
        </div>
      )}
      {coverage && !coverage.complete && (
        <p role="status" aria-live="polite" className="tf-sub">
          Coverage is incomplete; this plan is advisory until the missing scope is understood.
          Unsupported: {(coverage.unsupported ?? []).join(", ") || "none reported"}. Unprocessed:{" "}
          {(coverage.unprocessed ?? []).join(", ") || "none reported"}.
        </p>
      )}

      {/*
        A list of the reviewed changes. A list rather than a table because the
        content is a set of self-contained records — one change's rule, location,
        before, after and state — and a table would imply the records are
        comparable row-wise, which they are not.
      */}
      <ul className="tf-pending-cards" aria-label="Approved changes">
        {cards.map((card) => (
          <li
            key={card.changeId}
            className="tf-pending-card"
            data-testid={`tf-card-${card.changeId}`}
          >
            <h4 className="tf-pending-card-heading">{card.heading}</h4>
            <p className="tf-sub">{card.location}</p>
            {/*
              Before and after stacked, not side by side. The correction is a
              comparison, and a comparison needs one above the other to be read
              in a 320px pane — side by side is the arrangement that made the
              table unreadable.
            */}
            <div className="tf-pending-card-diff">
              <p className="tf-pending-card-label">Before</p>
              <p className="tf-pending-card-value">
                {card.before ?? "Not available for this change"}
              </p>
              <p className="tf-pending-card-label">After</p>
              <p className="tf-pending-card-value">
                {card.after ?? "Not available for this change"}
              </p>
            </div>
            <p className="tf-pending-card-state">
              {card.approval}
              {!card.preconditionHeld && " · no exact precondition"}
            </p>
            <div className="tf-pending-card-actions">
              {/*
                Go to text, only where there is a finding to navigate to. A
                button with no finding behind it would report a navigation the
                pane cannot perform, which is the same class of failure as a
                disabled Apply with no stated reason.
              */}
              {card.canNavigate && card.finding && (
                <button
                  className="tf-native-button"
                  type="button"
                  onClick={() => {
                    void handleGoTo(card.finding as Finding);
                  }}
                >
                  Go to text
                </button>
              )}
              {onRemove && (
                <button
                  className="tf-native-button"
                  type="button"
                  onClick={() => onRemove(card.changeId)}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {navigationNote !== null && (
        <p className="tf-sub" aria-live="polite">
          {navigationNote}
        </p>
      )}

      {/*
        The sticky footer: the counts and the one button that writes.

        Sticky rather than fixed so it stays inside this section, and placed
        after the cards so it is the last thing in the tab order — a control the
        user reaches after reading what it will do, not before.
      */}
      <div className="tf-pending-footer">
        <p className="tf-sub">
          {totals.approved} approved · {totals.awaitingReview} awaiting review
        </p>
        <div className="tf-pending-actions">
          <button
            className="tf-native-button"
            type="button"
            onClick={handleApply}
            disabled={applying || !canApply}
            aria-describedby={canApply ? undefined : describedBy || undefined}
          >
            {applying
              ? "Applying…"
              : canApply
                ? `Apply ${cards.length} with Track Changes`
                : "Apply unavailable"}
          </button>
          <button
            className="tf-native-button"
            type="button"
            onClick={handleReject}
            disabled={applying}
          >
            Reject all
          </button>
          {/*
            A change list a reviewer can hand to a colleague, without granting
            them access to the document. Gated on the same coverage report as
            Apply, because a list drawn from a partial analysis is
            indistinguishable from a complete one once it is a file on someone's
            disk.
          */}
          <ExportChangesButton
            changes={changes}
            findings={findings}
            coverage={exportCoverage ?? null}
          />
        </div>
      </div>

      {result && (
        <p className="tf-detail tf-detail-spaced-2" aria-live="polite">
          {result}
        </p>
      )}
    </section>
  );
}
