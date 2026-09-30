/**
 * Batch approval: the all-or-nothing rule and the four change-level conditions
 * that `groupFindings` cannot check on its own.
 *
 * The refusals are the substance of these tests. `Approve all` is a control
 * that either does exactly what its label says or does nothing; a version that
 * approves the three occurrences it can and reports a partial success is worse
 * than one that refuses, because the user pressed one button and got an outcome
 * they cannot predict from what is on screen.
 */

import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  approveGroup,
  batchApprovalLabel,
  skipGroup,
  undoGroup,
} from "../../../src/taskpane/batchApproval";
import type { Change, ChangePlan, Finding } from "../../../src/core/domain";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { FindingSchema } from "../../../src/core/domain/Finding";
import { reviewIdentity } from "../../../src/taskpane/occurrenceIdentity";
import type { DeterministicFindingGroup } from "../../../src/analysis/deterministic/contracts";
import { DeterministicFindingGroupSchema } from "../../../src/analysis/deterministic/contracts";

const NOW = "2026-09-30T12:00:00.000Z";

/**
 * A finding with a safe batch key, which is what makes a group approvable.
 *
 * `start` moves the occurrence: `reviewIdentity` is fingerprint, node, and both
 * range bounds, so two fixtures that share a range are the *same* occurrence and
 * a test using both would silently assert nothing. Every multi-occurrence test
 * below therefore passes a distinct offset.
 */
function finding(start = 0, overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography.emDash",
    range: { start, end: start + 2, unit: "character" },
    message: "Use em dash instead of double hyphen",
    severity: "warning",
    ruleId: "typography/dashes",
    actual: "--",
    expected: "—",
    precondition: { kind: "text", expectedText: "--" },
    deterministic: {
      profilePath: "typography.emDash",
      expected: "—",
      actual: "--",
      occurrenceGroupKey: "typography.emDash",
      safeBatchKey: "typography.emDash",
      correctionAvailable: true,
    },
    ...overrides,
  });
}

function group(overrides: Partial<DeterministicFindingGroup> = {}): DeterministicFindingGroup {
  return DeterministicFindingGroupSchema.parse({
    id: "typography.emDash",
    category: "typography.emDash",
    ruleId: "typography/dashes",
    expected: "—",
    occurrenceIds: [],
    safeBatchApproval: true,
    ...overrides,
  });
}

/**
 * A change the planner would build for `findingId`.
 *
 * `start` must track the finding's own offset, because `findChangeForFinding`
 * resolves a change through the finding it names and two changes over the same
 * range are a conflict — which is a real refusal, but not the one most of these
 * tests are about.
 */
function change(findingId: string, start = 0, overrides: Partial<Change> = {}): Change {
  return {
    id: uuidv4(),
    type: "replaceText",
    range: { start, end: start + 2 },
    payload: { text: "—" },
    findingId,
    source: "deterministic",
    risk: "none",
    // Required on a schema-version-2 change, and the reason
    // `changeRefusalReason` checks approval state. A deterministic correction
    // needs no human approval of its own — the user approving it in review is
    // the consent — so it is declared not-required rather than left off.
    approvalRequired: false,
    approvalState: "notRequired",
    precondition: { kind: "text", expectedText: "--" },
    ...overrides,
  } as Change;
}

/**
 * A plan whose changes belong to `findings`, as the preview run would build.
 *
 * Built through `createChangePlan` rather than by parsing a literal, so the
 * fixture is a plan the domain accepts. A hand-written literal missing an
 * identity field fails in the fixture and says nothing about the module under
 * test.
 */
function planFor(
  findings: readonly Finding[],
  changes?: readonly Change[],
  schemaVersion: 1 | 2 = 2,
): ChangePlan {
  return createChangePlan(
    "hash-1",
    "document-1",
    [...(changes ?? findings.map((entry) => change(entry.id, entry.range.start)))],
    [...findings],
    { schemaVersion },
  );
}

describe("approveGroup", () => {
  it("records one decision per occurrence for a safe group", () => {
    const findings = [finding(0), finding(9)];
    const outcome = approveGroup({
      group: group({ occurrenceIds: findings.map((entry) => entry.id) }),
      findings,
      plan: planFor(findings),
      planFindings: findings,
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("approved");
    if (outcome.kind !== "approved") return;
    expect(outcome.decisions).toHaveLength(2);
    expect(outcome.decisions.every((entry) => entry.decision === "approved")).toBe(true);
    // The identity is the gate's own, so a decision lands on the occurrence the
    // user looked at rather than on a per-run uuid.
    expect(new Set(outcome.decisions.map((entry) => entry.identity)).size).toBe(2);
  });

  it("refuses a group the engine already refused, and repeats its reason", () => {
    const subject = finding();
    const outcome = approveGroup({
      group: group({
        occurrenceIds: [subject.id],
        safeBatchApproval: false,
        batchRefusalReason: "this rule has not declared these corrections safe",
      }),
      findings: [subject],
      plan: planFor([subject]),
      planFindings: [subject],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    // Not a re-derived verdict: the engine's own words, so the two cannot disagree.
    expect(outcome.reason).toBe("this rule has not declared these corrections safe");
  });

  it("approves every occurrence or none, so a partial batch cannot be recorded", () => {
    // Distinct offsets, so these are three occurrences rather than one: the
    // whole point is that two of them are approvable and the third is not.
    const findings = [finding(0), finding(50), finding(100)];
    // The middle occurrence has no correction in the plan.
    const partial = planFor(findings, [change(findings[0]!.id, 0), change(findings[2]!.id, 100)]);
    const outcome = approveGroup({
      group: group({ occurrenceIds: findings.map((entry) => entry.id) }),
      findings,
      plan: partial,
      planFindings: findings,
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    // It names the occurrence that blocked the batch, so the user knows which
    // one to look at — and that one is the middle, not the first.
    expect(outcome.reason).toContain("the occurrence at character 50");
  });

  it("refuses when a change has no exact precondition, which Apply would reject", () => {
    const subject = finding();
    // No `precondition`, which is what `changeRefusalReason` refuses on. The
    // plan is schema version 1 because version 2 refuses to *contain* such a
    // change — the legacy shape is how one reaches the gate at all, and the
    // gate is the last line that catches it.
    const noPrecondition = planFor(
      [subject],
      [{ ...change(subject.id, subject.range.start), precondition: undefined }],
      1,
    );
    const outcome = approveGroup({
      group: group({ occurrenceIds: [subject.id] }),
      findings: [subject],
      plan: noPrecondition,
      planFindings: [subject],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("cannot be approved");
  });

  it("refuses when the group's own changes overlap each other", () => {
    const findings = [finding(0), finding(1)];
    const overlapping = planFor(findings, [
      change(findings[0]!.id, 0, { range: { start: 0, end: 3 } }),
      change(findings[1]!.id, 1, { range: { start: 1, end: 4 } }),
    ]);
    const outcome = approveGroup({
      group: group({ occurrenceIds: findings.map((entry) => entry.id) }),
      findings,
      plan: overlapping,
      planFindings: findings,
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("overlap");
  });

  it("refuses with no preview, rather than approving corrections nothing has planned", () => {
    const subject = finding();
    const outcome = approveGroup({
      group: group({ occurrenceIds: [subject.id] }),
      findings: [subject],
      plan: null,
      planFindings: [],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("no change has been previewed");
  });

  it("refuses a group whose occurrences are not in this run", () => {
    const stale = finding();
    const outcome = approveGroup({
      group: group({ occurrenceIds: [stale.id, uuidv4()] }),
      findings: [stale],
      plan: planFor([stale]),
      planFindings: [stale],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("no longer in this review");
  });

  it("leaves already-decided occurrences out and does not re-record them", () => {
    const first = finding(0);
    const second = finding(9);
    const findings = [first, second];
    const plan = planFor(findings);
    const firstOutcome = approveGroup({
      group: group({ occurrenceIds: [first.id] }),
      findings,
      plan,
      planFindings: findings,
      decidedAt: NOW,
    });
    expect(firstOutcome.kind).toBe("approved");

    const secondOutcome = approveGroup({
      group: group({ occurrenceIds: [first.id, second.id] }),
      findings,
      plan,
      planFindings: findings,
      alreadyDecided: new Set(
        firstOutcome.kind === "approved" ? [firstOutcome.decisions[0]!.identity] : [],
      ),
      decidedAt: NOW,
    });

    expect(secondOutcome.kind).toBe("approved");
    if (secondOutcome.kind !== "approved") return;
    // One decision, not two: the first occurrence keeps the decision it has.
    expect(secondOutcome.decisions).toHaveLength(1);
  });

  it("refuses when every occurrence in the group is already decided", () => {
    const subject = finding();
    // Settled with the identity the module itself would record, which is the
    // only way this set matches. A placeholder string would miss and the test
    // would pass for the wrong reason.
    const settled = skipGroup({
      group: group({ occurrenceIds: [subject.id] }),
      findings: [subject],
      plan: null,
      planFindings: [],
      decidedAt: NOW,
    });
    expect(settled.kind).toBe("approved");
    if (settled.kind !== "approved") return;

    const outcome = approveGroup({
      group: group({ occurrenceIds: [subject.id] }),
      findings: [subject],
      plan: planFor([subject]),
      planFindings: [subject],
      alreadyDecided: new Set(settled.decisions.map((entry) => entry.identity)),
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("already been decided");
  });
});

describe("skipGroup", () => {
  it("records a skip for every occurrence, and needs no plan", () => {
    // Distinct offsets, so these are two occurrences rather than one. Two
    // findings sharing a range are the *same* occurrence by `reviewIdentity`,
    // and a test that passed only because they collapsed would assert one
    // decision where the reader sees two rows in the panel.
    const findings = [finding(0), finding(30)];
    const outcome = skipGroup({
      group: group({ occurrenceIds: findings.map((entry) => entry.id) }),
      findings,
      plan: null,
      planFindings: [],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("approved");
    if (outcome.kind !== "approved") return;
    // One decision per finding, which is the claim the test exists to make.
    expect(outcome.decisions).toHaveLength(2);
    expect(outcome.decisions.every((entry) => entry.decision === "skipped")).toBe(true);
    expect(new Set(outcome.decisions.map((entry) => entry.identity)).size).toBe(2);
  });

  it("skips a batch the engine refused to approve, because declining is not a correction", () => {
    const subject = finding();
    const outcome = skipGroup({
      group: group({
        occurrenceIds: [subject.id],
        safeBatchApproval: false,
        batchRefusalReason: "these occurrences do not share one correction",
      }),
      findings: [subject],
      plan: null,
      planFindings: [],
      decidedAt: NOW,
    });

    expect(outcome.kind).toBe("approved");
    if (outcome.kind !== "approved") return;
    expect(outcome.decisions[0]?.decision).toBe("skipped");
  });
});

describe("undoGroup", () => {
  it("withdraws the decided occurrences and leaves the undecided ones alone", () => {
    // Distinct offsets: two findings sharing a range are one occurrence, and
    // "leaves the other alone" would then assert nothing.
    const decided = finding(0);
    const untouched = finding(40);
    const findings = [decided, untouched];
    // Only the first is decided. Deciding both and then undoing one would prove
    // less: the group under test would contain nothing undecided to protect.
    const identities = skipGroup({
      group: group({ occurrenceIds: [decided.id] }),
      findings,
      plan: null,
      planFindings: [],
      decidedAt: NOW,
    });
    expect(identities.kind).toBe("approved");
    if (identities.kind !== "approved") return;
    const settled = new Set(identities.decisions.map((entry) => entry.identity));

    const withdrawn = undoGroup({
      group: group({ occurrenceIds: findings.map((entry) => entry.id) }),
      findings,
      plan: null,
      planFindings: [],
      alreadyDecided: settled,
      decidedAt: NOW,
    });

    // Exactly the identity the skip recorded, and nothing else: the occurrence
    // in the same run that was never decided is not collateral.
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toBe(reviewIdentity(decided));
    expect(withdrawn).not.toContain(reviewIdentity(untouched));
  });

  it("returns nothing for a group with no decisions, rather than reporting an error", () => {
    const subject = finding();
    const withdrawn = undoGroup({
      group: group({ occurrenceIds: [subject.id] }),
      findings: [subject],
      plan: null,
      planFindings: [],
      alreadyDecided: new Set<string>(),
      decidedAt: NOW,
    });

    // "Undo" on nothing is a no-op; an error message on screen for a button
    // that correctly did nothing is the confusing direction.
    expect(withdrawn).toEqual([]);
  });
});

describe("batchApprovalLabel", () => {
  it("offers the control for a safe group, with the occurrence count", () => {
    const label = batchApprovalLabel(group({ occurrenceIds: [uuidv4(), uuidv4()] }));
    expect(label).toEqual({ label: "Approve all 2 occurrences", enabled: true });
  });

  it("states the count and the refusal on a group that cannot be batched", () => {
    const label = batchApprovalLabel(
      group({ occurrenceIds: [uuidv4()], safeBatchApproval: false }),
    );
    // A disabled control with no stated reason is the failure the review gate
    // exists to avoid, so the label names what cannot be done.
    expect(label.enabled).toBe(false);
    expect(label.label).toBe("Approve all unavailable for these 1 occurrence");
  });
});
