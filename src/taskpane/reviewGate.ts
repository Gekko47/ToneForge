/**
 * The review gate: a finding becomes a pending change, or it is reviewed and
 * the pane says why it cannot become one.
 *
 * **Why a gate and not a label.** `markForReview` used to set a `status` field
 * and persist a fingerprint. That was inert — the status label was the only
 * visible effect, and it carried the same rule-versus-occurrence collision the
 * ignore path had, so one click marked every finding of that kind. Review now
 * decides something: it either puts a real change in front of the user, or it
 * says in words why there is nothing to apply.
 *
 * **Why a finding may have no change.** Most findings are advisory and the
 * planner has no correction for them: a consistency contradiction has no
 * replacement sentence, and an AI deviation that could not be anchored in the
 * document cannot be rewritten safely. Queueing those would put rows in Pending
 * Changes that Apply would refuse, which is worse than not queueing them — it
 * teaches the user that the list overstates what the tool can do.
 *
 * Identity is the finding **id**, not the fingerprint. The fingerprint is the
 * identity of a rule, so matching on it would admit every occurrence of a
 * reviewed rule into the gate.
 *
 * Pure: no React, no Office, no storage. The caller owns persistence and
 * rendering, which is what makes the refusal reasons testable.
 */

import type { Change } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";
import { reviewKey } from "./reviewKey";

/** The change a reviewed finding contributes, when it has one. */
export interface ReviewedChange {
  findingId: string;
  changeId: string;
}

export type ReviewDecision =
  | { kind: "pending"; change: ReviewedChange; message: string }
  | { kind: "no-change"; reason: string; message: string };

/**
 * Whether a change can be applied at all, and why not when it cannot.
 *
 * These are the conditions `applyPendingPlan` already enforces, checked here so
 * a finding is never announced as pending when Apply would refuse it. A change
 * that is queued and then rejected at the Apply button is the failure this
 * avoids.
 */
export function changeRefusalReason(change: Change): string | null {
  if (change.precondition === undefined) {
    return "the change has no exact precondition, so ToneForge cannot prove the text it replaced";
  }
  if (change.approvalRequired === true && change.approvalState !== "approved") {
    return "the change still needs approval";
  }
  return null;
}

/**
 * Find the change a finding produced, if the plan carries one.
 *
 * Matches on `findingId`. A change with no `findingId` cannot be attributed to
 * a finding, so it is not offered here even though it is in the plan: Pending
 * Changes shows what the user reviewed, and a change nobody reviewed is not
 * that.
 */
export function findChangeForFinding(
  finding: Finding,
  plan: ChangePlan | null,
): { change: Change; refusal: string | null } | null {
  if (plan === null) return null;
  const change = plan.changes.find((candidate) => candidate.findingId === finding.id);
  if (change === undefined) return null;
  return { change, refusal: changeRefusalReason(change) };
}

/**
 * Decide what reviewing a finding means right now.
 *
 * `plan` is the currently previewed plan. A finding with no plan behind it has
 * no change, and the reason says so rather than implying the tool decided the
 * finding needs no correction.
 */
export function reviewFinding(finding: Finding, plan: ChangePlan | null): ReviewDecision {
  /*
   * A finding that declares itself non-actionable carries the reason itself.
   *
   * Preferring the engine's own words over a generic message matters: the
   * deviation engine sets `advisoryReason` to explain precisely why it declined
   * to write — an unanchored span, an ambiguous quote — and paraphrasing that
   * into "the planner proposes no correction" would throw away the only
   * information the user has about what to do next.
   */
  if (finding.actionable === false) {
    const reason =
      finding.advisoryReason ?? "this finding is advisory and has no correction to apply";
    return {
      kind: "no-change",
      reason,
      message: `Reviewed. Not a pending change: ${reason}.`,
    };
  }

  if (plan === null) {
    const reason = "no change has been previewed for this document yet";
    return {
      kind: "no-change",
      reason,
      message: `Reviewed. Not a pending change: ${reason}.`,
    };
  }

  const match = findChangeForFinding(finding, plan);
  if (match === null) {
    const reason = "the planner proposes no correction for this finding";
    return {
      kind: "no-change",
      reason,
      message: `Reviewed. Not a pending change: ${reason}.`,
    };
  }

  if (match.refusal !== null) {
    return {
      kind: "no-change",
      reason: match.refusal,
      message: `Reviewed. Not a pending change: ${match.refusal}.`,
    };
  }

  return {
    kind: "pending",
    change: { findingId: finding.id, changeId: match.change.id },
    message: "Reviewed. Added to Pending changes.",
  };
}

/**
 * The plan reduced to the changes the user actually reviewed.
 *
 * Pending Changes used to render, and Apply used to apply, the whole
 * auto-previewed plan. Review was therefore decorative: a user who looked at
 * one finding out of twenty and pressed Apply got all twenty. This is the
 * narrowing that makes the Review button mean something, and it is applied
 * before the plan reaches the reviewer *and* before it reaches the adapter, so
 * there is no path by which an unreviewed change can be written.
 *
 * `findings` must be the run that built the plan. A change's `findingId` names a
 * finding from its own run, so passing the observer's list would match nothing
 * and the result would be an empty plan — a refusal to apply anything, which is
 * at least safe but would look like a broken button.
 *
 * Returns `null` when nothing was reviewed, so the caller can distinguish "no
 * reviews yet" from "reviewed, and the plan is empty", which are different
 * things to show a user.
 */
export function reviewedPlan(
  plan: ChangePlan | null,
  reviewedKeys: ReadonlySet<string>,
  findings: readonly Finding[],
): ChangePlan | null {
  if (plan === null || reviewedKeys.size === 0) return null;
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const changes = plan.changes.filter((change) => {
    const finding = change.findingId === undefined ? undefined : byId.get(change.findingId);
    // A change with no finding behind it cannot have been reviewed, so it is not
    // carried. Same rule as `findChangeForFinding`: Pending Changes shows what
    // the user looked at.
    return finding !== undefined && reviewedKeys.has(reviewKey(finding));
  });
  if (changes.length === 0) return null;
  return { ...plan, changes, conflicts: [] };
}

/** Every finding that is already represented by a change the user can apply. */
export function pendingChangesFor(
  findings: readonly Finding[],
  plan: ChangePlan | null,
): ReviewedChange[] {
  if (plan === null) return [];
  return findings.reduce<ReviewedChange[]>((queued, finding) => {
    const match = findChangeForFinding(finding, plan);
    if (match !== null && match.refusal === null) {
      queued.push({ findingId: finding.id, changeId: match.change.id });
    }
    return queued;
  }, []);
}
