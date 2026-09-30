/**
 * Batch approval (spec §13, §15).
 *
 * **What "Approve all" means here.** It records the user's decision for every
 * occurrence in a group, against the review session T14 established. It does not
 * build a plan and does not apply anything. It is also not just `reviewFinding`
 * called N times: the difference is the all-or-nothing rule below, which is the
 * whole reason this module exists rather than a loop in the Dashboard.
 *
 * **All or nothing.** A group of seven occurrences where three can be approved
 * and four cannot is a group where the obvious implementation records three
 * decisions and reports a partial success. The user pressed one control
 * expecting one outcome, and a partial success is a control whose effect depends
 * on data they cannot see. So the whole group is refused and the reason names the
 * occurrence that blocked it. The user then approves the three individually,
 * which is a decision they are making with the list in front of them.
 *
 * **Why this is separate from `groupFindings`.** Grouping answers "are these
 * equivalent?" and computes the batch-safety verdict from the findings
 * themselves — same rule, same correction, no protected target, declared
 * semantically neutral. That is three of §13's seven conditions and the only
 * three checkable without a plan. The remaining four (every occurrence has a
 * valid precondition, no conflicts, risk within policy, semantically neutral)
 * are properties of the *changes*, so this module joins the groups to the
 * previewed plan and answers the rest before recording anything. A group the
 * engine declared safe can still be refused here, and the reason says which
 * condition failed rather than restating the verdict.
 *
 * **Why it lives in `taskpane/` and not `changes/`.** It needs `reviewGate` and
 * `reviewIdentity` — the same identity the gate uses — and the ESLint scope over
 * `src/changes/**` forbids importing `taskpane` (ADR-0006, docs/architecture.md).
 * Placing it here keeps it beside the gate whose conditions it enforces, which is
 * also why `findChangeForFinding` is reused rather than reimplemented: two
 * implementations of "which change does this finding own" would eventually
 * disagree, and a batch that approves a different set than Apply writes is the
 * failure that produces.
 *
 * Pure: no React, no Office, no storage. It returns the decisions to record and
 * the caller persists them, which is what makes every refusal reason testable
 * without a host.
 */

import type { Change } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";
import type { ReviewDecision } from "../core/domain/ReviewSession";
import { detectConflicts } from "../changes/conflictDetector";
import { findChangeForFinding } from "./reviewGate";
import { reviewIdentity } from "./occurrenceIdentity";
import type { DeterministicFindingGroup } from "../analysis/deterministic/contracts";

/** What batch approval of one group produced. */
export type BatchApprovalOutcome =
  | {
      kind: "approved";
      /** One decision per occurrence, in document order. */
      decisions: ReviewDecision[];
      message: string;
    }
  | { kind: "refused"; reason: string; message: string };

export interface BatchApprovalOptions {
  group: DeterministicFindingGroup;
  /** The findings this run produced, which the group's ids refer to. */
  findings: readonly Finding[];
  /** The previewed plan whose changes the approval would queue. */
  plan: ChangePlan | null;
  /** The run that built the plan, whose finding ids its changes name. */
  planFindings: readonly Finding[];
  /** Occurrence identities already decided, so a batch never double-records. */
  alreadyDecided?: ReadonlySet<string>;
  /** The timestamp to stamp on the decisions. Supplied so it is testable. */
  decidedAt: string;
}

/**
 * Approve every occurrence in a group, or none of them.
 *
 * The order of the checks is the order of the failure modes. A group the engine
 * refused is refused without touching the plan, because re-deriving a verdict the
 * engine already reached would risk the two disagreeing. Only a group the engine
 * called safe reaches the change-level checks.
 */
export function approveGroup(options: BatchApprovalOptions): BatchApprovalOutcome {
  const { group, plan, planFindings, decidedAt } = options;

  if (!group.safeBatchApproval) {
    return refuse(
      group.batchRefusalReason ?? "these occurrences cannot be approved together in this document",
    );
  }

  const undecided = undecidedOccurrences(options);
  if (undecided.kind === "refused") return refuse(undecided.reason);
  const occurrences = undecided.occurrences;

  if (plan === null) {
    return refuse("no change has been previewed for this document yet");
  }

  /*
   * Every occurrence must resolve to a change Apply would accept.
   *
   * Checked one at a time so the refusal can name the occurrence that blocked
   * it. A group where nine of ten are fine is still a group the user has to look
   * at, and the sentence they get should point at the one that is not.
   */
  const changes: Change[] = [];
  for (const finding of occurrences) {
    const match = findChangeForFinding(finding, plan, planFindings);
    if (match === null) {
      return refuse(`ToneForge has no correction for ${describe(finding)}`);
    }
    if (match.refusal !== null) {
      return refuse(`${describe(finding)} cannot be approved: ${match.refusal}`);
    }
    changes.push(match.change);
  }

  /*
   * Conflicts among the batch's own changes.
   *
   * Checked on the batch alone rather than against the whole plan, because the
   * question is whether *these* changes can be applied together. The
   * reviewed-only projection narrows to the approved set before the plan reaches
   * the adapter, and the adapter re-runs the check anyway — so this is the
   * early, specific refusal rather than the last-resort one.
   */
  const conflicts = detectConflicts(changes);
  if (conflicts.length > 0) {
    return refuse(`these occurrences overlap each other: ${conflicts[0]}`);
  }

  return {
    kind: "approved",
    decisions: occurrences.map<ReviewDecision>((finding) =>
      decision(finding, "approved", decidedAt),
    ),
    message:
      occurrences.length === 1
        ? "Approved 1 occurrence. It is in Pending changes."
        : `Approved ${occurrences.length} occurrences. They are in Pending changes.`,
  };
}

/**
 * Skip every occurrence in a group, for the same all-or-nothing reason.
 *
 * Skipping needs no plan and no preconditions — the user is declining, not
 * consenting — so the only refusals are the two that would misdescribe what the
 * button did: a group whose occurrences have moved on, and a group with nothing
 * left to decide. A group the engine refused to *approve as a batch* can still
 * be skipped as a batch, because skipping twenty banned terms together is not a
 * correction and carries no risk.
 */
export function skipGroup(options: BatchApprovalOptions): BatchApprovalOutcome {
  const { decidedAt } = options;
  const undecided = undecidedOccurrences(options);
  if (undecided.kind === "refused") return refuse(undecided.reason);
  const occurrences = undecided.occurrences;

  return {
    kind: "approved",
    decisions: occurrences.map<ReviewDecision>((finding) =>
      decision(finding, "skipped", decidedAt),
    ),
    message:
      occurrences.length === 1
        ? "Skipped 1 occurrence."
        : `Skipped ${occurrences.length} occurrences. They stay in the document unchanged.`,
  };
}

/**
 * The identities in a group whose decision should be withdrawn, so the
 * occurrences can be reviewed again (spec §15, "Undo decision").
 *
 * Returns identities rather than performing the write, so the caller records
 * the same set it displays. A group with nothing decided returns an empty list
 * rather than a refusal: "undo" on a group with no decisions is a no-op, and
 * reporting it as an error would put a message on screen for a button that
 * correctly did nothing.
 */
export function undoGroup(options: BatchApprovalOptions): string[] {
  const { group, findings } = options;
  const settled = options.alreadyDecided ?? new Set<string>();
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return group.occurrenceIds.flatMap((id) => {
    const finding = byId.get(id);
    if (finding === undefined) return [];
    const identity = reviewIdentity(finding);
    return settled.has(identity) ? [identity] : [];
  });
}

/**
 * The `Approve all` control's own state, read without pressing it.
 *
 * A disabled control with no stated reason is the failure the review gate was
 * built to avoid, so the label says *why* in the user's terms: how many
 * occurrences, and that the whole set cannot be approved at once. The reason
 * itself is carried on the group and shown beside the control.
 */
export function batchApprovalLabel(group: DeterministicFindingGroup): {
  label: string;
  enabled: boolean;
} {
  const count = group.occurrenceIds.length;
  const occurrences = `${count} occurrence${count === 1 ? "" : "s"}`;
  if (group.safeBatchApproval) {
    return { label: `Approve all ${occurrences}`, enabled: true };
  }
  return { label: `Approve all unavailable for these ${occurrences}`, enabled: false };
}

/**
 * The occurrences of a group that have no decision yet.
 *
 * Resolved from the ids the group carries rather than trusted, because a group
 * whose ids no longer match the current findings is a group from a previous run,
 * and approving "every occurrence" from a stale list would record decisions about
 * text that is no longer there.
 */
function undecidedOccurrences(
  options: BatchApprovalOptions,
): { kind: "ok"; occurrences: Finding[] } | { kind: "refused"; reason: string } {
  const { group, findings } = options;
  const alreadyDecided = options.alreadyDecided ?? new Set<string>();
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const occurrences = group.occurrenceIds.flatMap((id) => {
    const finding = byId.get(id);
    return finding === undefined ? [] : [finding];
  });
  if (occurrences.length !== group.occurrenceIds.length) {
    return { kind: "refused", reason: "some of these occurrences are no longer in this review" };
  }
  const undecided = occurrences.filter((finding) => !alreadyDecided.has(reviewIdentity(finding)));
  if (undecided.length === 0) {
    return { kind: "refused", reason: "every occurrence in this group has already been decided" };
  }
  return { kind: "ok", occurrences: undecided };
}

function decision(
  finding: Finding,
  kind: ReviewDecision["decision"],
  decidedAt: string,
): ReviewDecision {
  return {
    identity: reviewIdentity(finding),
    ruleId: finding.ruleId ?? finding.category,
    category: finding.category,
    decision: kind,
    // What the user saw on the card, not a re-derivation from the plan. The
    // decision records the moment of consent, and the plan may be rebuilt
    // between pressing the button and pressing Apply.
    expected: finding.expected ?? null,
    decidedAt,
  };
}

function refuse(reason: string): BatchApprovalOutcome {
  return { kind: "refused", reason, message: `Nothing was approved: ${reason}.` };
}

/** A short, user-facing name for the occurrence that blocked a batch. */
function describe(finding: Finding): string {
  return `the occurrence at character ${finding.range.start}`;
}
