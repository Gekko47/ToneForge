/**
 * Approval semantics (spec §15).
 *
 * **What "Review" was, and why it was two things at once.** The single Review
 * button both admitted a correction to Apply and marked the finding done, and
 * the "Reviewed" label then covered every state a finding could be in — queued,
 * declined, or unapprovable. A user could not tell which, so the label told them
 * nothing. Spec §15 separates the two decisions and names them: **Approve** means
 * "include this exact correction in the reviewed plan", and **Skip** means
 * "exclude this occurrence from the current review session".
 *
 * **Skip is not Ignore.** Ignore sets a finding aside permanently — it leaves the
 * list and needs a Restore. Skip leaves the finding exactly where it is, visible
 * and described, and only declines to queue it for this pass. Collapsing them
 * would mean a user who did not want one occurrence queued also lost sight of it.
 *
 * **One decision per occurrence, and the two are mutually exclusive.** An
 * occurrence cannot be approved and skipped, and it cannot hold two approvals —
 * the store keeps the newest decision per identity, and the UI has to agree or
 * the card and the plan disagree about what the user chose. `decide` is the one
 * place that resolves this, so the list, the cards, and the projection cannot
 * each form their own opinion.
 *
 * **Approve is offered only where Apply would accept it.** A finding the planner
 * cannot correct can still be *decided* — skipping it is a real decision — but
 * offering Approve for it produces a card that says "approved" over a change
 * that will never be written. That is the failure the review gate was built to
 * avoid, and it is why the refusal reason travels with the control.
 *
 * Pure: no React, no Office, no storage. Every refusal sentence is testable
 * without a host.
 */

import type { Finding } from "../core/domain/Finding";

/** What the user has decided about one occurrence. */
export type ReviewDecisionKind = "approved" | "skipped";

/**
 * The controls a finding card offers, and why.
 *
 * A discriminated union rather than a bag of booleans because the three states
 * are genuinely different surfaces: undecided offers two choices, approved
 * offers one withdrawal, and skipped offers two different ones. Booleans let a
 * caller render "Approved" beside a live Skip, which is a card claiming two
 * things at once.
 */
export type ApprovalControls =
  | {
      kind: "undecided";
      /** False with a stated reason where Approve cannot lead anywhere. */
      canApprove: boolean;
      approveReason: string | null;
      canSkip: boolean;
    }
  | { kind: "approved"; canSkip: false; approveReason: null }
  | { kind: "skipped"; canApprove: true; approveReason: null };

export interface ApprovalControlInput {
  /** The decision already recorded, or `null` for none. */
  decision: ReviewDecisionKind | null;
  /** Why Approve cannot lead anywhere, or `null` when it can. */
  approveRefusal?: string | null;
}

/**
 * The controls for one occurrence.
 *
 * Approved and skipped are both withdrawable, so the caller always has a way
 * back. What is not offered is Approve for a finding with no correction: the
 * user can still skip it, which is a decision about this review, and the
 * finding stays in the list.
 */
export function approvalControls(input: ApprovalControlInput): ApprovalControls {
  const refusal = input.approveRefusal ?? null;
  if (input.decision === "approved") {
    return { kind: "approved", canSkip: false, approveReason: null };
  }
  if (input.decision === "skipped") {
    // Skipped is not a verdict on the correction — only on queueing it — so
    // Approve stays available. A user who skipped a group of seven by accident
    // must be able to come back and approve the one they meant.
    return { kind: "skipped", canApprove: true, approveReason: null };
  }
  return {
    kind: "undecided",
    canApprove: refusal === null,
    approveReason: refusal,
    canSkip: true,
  };
}

/**
 * Record a decision, replacing any prior one for the same occurrence.
 *
 * Returns a new set rather than mutating, so a caller cannot leave the card and
 * the projection disagreeing by holding a set that only one of them updated. The
 * newest decision wins: a user who approved a finding and then skipped it has
 * made one decision, and a list showing both would depend on how many times they
 * changed their mind.
 */
export function decide(
  current: ReadonlySet<string>,
  identity: string,
  _decision: ReviewDecisionKind,
): Set<string> {
  const next = new Set(current);
  next.add(identity);
  return next;
}

/**
 * Withdraw a decision, so the occurrence can be decided again.
 *
 * Used by "Undo decision" on the card and by expiry: an occurrence that no longer
 * exists in the current document has not been decided, and undecided is the
 * honest state for it.
 */
export function undecide(current: ReadonlySet<string>, identity: string): Set<string> {
  const next = new Set(current);
  next.delete(identity);
  return next;
}

/**
 * The identities that count as approved for the plan.
 *
 * Skipped occurrences are removed here rather than filtered at the call site,
 * because every caller that narrows a plan needs the same answer and a caller
 * that forgets the filter writes a skipped occurrence into the document.
 */
export function approvedIdentities(
  approved: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
): Set<string> {
  return new Set([...approved].filter((identity) => !skipped.has(identity)));
}

/** How many occurrences each decision covers, for the pane's summary. */
export function decisionCounts(input: {
  approved: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
}): { approved: number; skipped: number } {
  const approved = approvedIdentities(input.approved, input.skipped);
  return { approved: approved.size, skipped: input.skipped.size };
}

/**
 * The sentence for a finding the user approved but the planner cannot correct.
 *
 * Spec §14.7's wording is for the *card*; this is the control-level refusal, so
 * it names the consequence of pressing the button rather than repeating the
 * reason already printed above the card.
 */
export function unapprovableReason(finding: Finding): string | null {
  if (finding.actionable === false) {
    return (
      finding.advisoryReason ??
      "this finding is advisory and has no correction to apply, so there is nothing to approve"
    );
  }
  const correctionReason = finding.deterministic?.correctionReason;
  if (finding.deterministic?.correctionAvailable === false) {
    return (
      correctionReason ??
      "Detected, but ToneForge cannot safely correct this property in this Word host."
    );
  }
  return null;
}
