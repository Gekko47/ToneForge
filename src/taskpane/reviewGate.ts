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
 * **One identity, used by both halves.** This module previously matched a change
 * with `change.findingId === finding.id`, while `reviewedPlan` matched on a
 * review key. Those are different namespaces: the finding the user clicks comes
 * from the document observer's scan, and the plan comes from the preview run, and
 * the two issue separate uuids for the same problem. So the gate could never
 * find its change, every review reported "the planner proposes no correction",
 * and the reviewed-only list filled only by accident of the other matcher
 * agreeing. A verdict that cannot succeed carries no information, so both halves
 * now resolve through `reviewIdentity` — the same occurrence key, derived
 * identically from either run.
 *
 * **Why a finding may have no change.** Most findings are advisory and the
 * planner has no correction for them: a consistency contradiction has no
 * replacement sentence, and an AI deviation that could not be anchored in the
 * document cannot be rewritten safely. Queueing those would put rows in Pending
 * Changes that Apply would refuse, which is worse than not queueing them — it
 * teaches the user that the list overstates what the tool can do.
 *
 * Pure: no React, no Office, no storage. The caller owns persistence and
 * rendering, which is what makes the refusal reasons testable.
 */

import type { Change } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";
import { reviewIdentity } from "./occurrenceIdentity";

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
 * Resolved through the occurrence identity rather than through `findingId`. The
 * id on a change names a finding from the run that planned it, and the finding in
 * front of the user comes from a different run, so an id match is not merely
 * fragile — it can never succeed across runs.
 *
 * `findings` must therefore be the run that built the plan. It is not optional
 * here: without it there is no way to know which change, if any, this finding
 * produced, and a change nobody can attribute is a change nobody reviewed.
 */
export function findChangeForFinding(
  finding: Finding,
  plan: ChangePlan | null,
  findings: readonly Finding[],
): { change: Change; refusal: string | null } | null {
  if (plan === null) return null;
  const identity = reviewIdentity(finding);
  // Two indexes, because the two sides of the comparison are keyed differently.
  // A change names its finding by **id**, and the finding in front of the user
  // was issued by a different run, so id-to-id is the wrong join. The id index
  // resolves the change to *its* finding; the identity index then decides
  // whether that finding is the one in front of us.
  const byId = new Map(findings.map((entry) => [entry.id, entry]));
  const change = plan.changes.find((candidate) => {
    if (candidate.findingId === undefined) return false;
    const owner = byId.get(candidate.findingId);
    return owner !== undefined && reviewIdentity(owner) === identity;
  });
  if (change === undefined) return null;
  return { change, refusal: changeRefusalReason(change) };
}

/**
 * Decide what reviewing a finding means right now.
 *
 * `plan` is the currently previewed plan and `planFindings` the run that built
 * it. A finding with no plan behind it has no change, and the reason says so
 * rather than implying the tool decided the finding needs no correction.
 */
export function reviewFinding(
  finding: Finding,
  plan: ChangePlan | null,
  planFindings: readonly Finding[] = [],
): ReviewDecision {
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

  const match = findChangeForFinding(finding, plan, planFindings);
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
    change: { findingId: match.change.findingId ?? finding.id, changeId: match.change.id },
    message: "Reviewed. Added to Pending changes.",
  };
}

/** The three things Pending Changes can be showing, stated rather than implied. */
export type PendingProjection =
  | { kind: "no-plan"; plan: null; reason: string }
  | { kind: "nothing-reviewed"; plan: null; reason: string }
  | { kind: "reviewed"; plan: ChangePlan };

/**
 * The plan reduced to the changes the user actually reviewed.
 *
 * Pending Changes used to render, and Apply used to apply, the whole
 * auto-previewed plan. Review was therefore decorative: a user who looked at one
 * finding out of twenty and pressed Apply got all twenty. This is the narrowing
 * that makes the Review button mean something, and it is applied before the plan
 * reaches the reviewer *and* before it reaches the adapter, so there is no path
 * by which an unreviewed change can be written.
 *
 * **It returns a discriminated result rather than `ChangePlan | null`.** The
 * previous signature returned null both when nothing was reviewed and when the
 * reviewed subset was empty, and the caller resolved that with
 * `reviewedPlan(...) ?? fullPlan` — so an empty reviewed set quietly became the
 * *entire unreviewed plan*, and Apply could write changes nobody had looked at.
 * Three states need three answers, and the caller has to be able to tell them
 * apart.
 *
 * `reviewed` is the set of review identities the user has actually made.
 */
export function reviewedPlan(
  plan: ChangePlan | null,
  reviewed: ReadonlySet<string>,
  planFindings: readonly Finding[],
): PendingProjection {
  if (plan === null) {
    return {
      kind: "no-plan",
      plan: null,
      reason: "No preview has been built for this document yet. Scan, or press Re-scan now.",
    };
  }
  if (reviewed.size === 0) {
    return {
      kind: "nothing-reviewed",
      plan: null,
      reason:
        plan.changes.length === 0
          ? "No changes are ready to apply for this document."
          : `${plan.changes.length} change${plan.changes.length === 1 ? " is" : "s are"} ready. ` +
            "Open a finding and choose Review to add it here — nothing is applied until you approve it.",
    };
  }

  const identityByFindingId = new Map(
    planFindings.map((finding) => [finding.id, reviewIdentity(finding)]),
  );
  const changes = plan.changes.filter((change) => {
    if (change.findingId === undefined) return false;
    const identity = identityByFindingId.get(change.findingId);
    return identity !== undefined && reviewed.has(identity);
  });

  if (changes.length === 0) {
    return {
      kind: "nothing-reviewed",
      plan: null,
      reason:
        "The findings you reviewed produced no applicable change. Re-scan, or review a finding " +
        "the planner has a correction for.",
    };
  }

  return { kind: "reviewed", plan: { ...plan, changes, conflicts: [] } };
}

/** Every finding that is already represented by a change the user can apply. */
export function pendingChangesFor(
  findings: readonly Finding[],
  plan: ChangePlan | null,
  planFindings: readonly Finding[] = [],
): ReviewedChange[] {
  if (plan === null) return [];
  return findings.reduce<ReviewedChange[]>((queued, finding) => {
    const match = findChangeForFinding(finding, plan, planFindings);
    if (match !== null && match.refusal === null && match.change.findingId !== undefined) {
      queued.push({ findingId: match.change.findingId, changeId: match.change.id });
    }
    return queued;
  }, []);
}
