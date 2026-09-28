import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  changeRefusalReason,
  findChangeForFinding,
  pendingChangesFor,
  reviewFinding,
  type ReviewDecision,
} from "../../../src/taskpane/reviewGate";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";
import type { Change } from "../../../src/core/domain/Change";
import type { ChangePlan } from "../../../src/core/domain/ChangePlan";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { createTestPlan } from "../../fixtures/changePlans";

/**
 * Review is a gate now, not a label.
 *
 * Before this, the Review button set a `status` field and persisted a
 * fingerprint, and the status label was the only visible effect â€” so the control
 * appeared to do nothing. It also matched on the *fingerprint*, which is the
 * identity of a rule rather than of an occurrence, so one click would have
 * marked every finding of that kind reviewed.
 *
 * The gate has to be honest in both directions. A finding with an applicable
 * change becomes a pending change the user can act on. A finding without one
 * must say why, because the alternative â€” queueing changes Apply will refuse â€”
 * teaches the user that the list overstates what the tool can do.
 */

/**
 * A deterministic finding.
 *
 * The default range is derived from the call counter rather than fixed, so two
 * findings built with the same overrides are still two *occurrences*. The review
 * identity is rule plus node plus position and deliberately carries no id, so
 * three fixtures that differed only by their generated uuid would be one
 * occurrence to it — which is the correct reading and a useless fixture.
 */
let fixtureSequence = 0;

function finding(overrides: Record<string, unknown> = {}): Finding {
  fixtureSequence += 1;
  const start = 10 + fixtureSequence * 100;
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography",
    message: "An em dash was found.",
    severity: "warning",
    range: { start, end: start + 10 },
    nodeIds: ["n1"],
    ruleId: "typography.em-dash",
    source: "deterministic",
    confidence: 1,
    evidence: "a â€” b",
    reversible: true,
    ...overrides,
  });
}

/**
 * A schema-2 change.
 *
 * Built on the shared `createTestPlan` rather than a hand-rolled plan so the
 * precondition and approval metadata the gate reads are the same ones Apply
 * reads. A fixture that omitted them would let the gate pass on a plan the
 * pane would later reject.
 */
function change(overrides: Partial<Change> = {}): Change {
  return {
    id: uuidv4(),
    type: "insertText",
    range: { start: 0, end: 11, unit: "character" },
    payload: { text: "hello world" },
    source: "deterministic",
    ...overrides,
  };
}

function plan(changes: readonly Change[]): ChangePlan {
  return createTestPlan("abc123", "doc-1", [...changes]);
}

/**
 * A schema-1 plan, which is the only way a precondition-less change can exist.
 *
 * `ChangePlanSchema` refuses to represent that case at version 2, and a legacy
 * plan is exactly how it reaches the pane â€” so this is the real shape of the
 * input the gate has to refuse, not a synthetic one.
 */
function legacyPlan(changes: readonly Change[]): ChangePlan {
  return createChangePlan("abc123", "doc-1", [...changes], [], { schemaVersion: 1 });
}

/**
 * Narrow a refusal for assertion.
 *
 * `expect(...).toBe(...)` does not narrow a discriminated union, so without
 * this the reason is unreachable at the type level and the test would have to
 * cast. Throwing keeps the test honest: if the gate ever starts queueing a
 * finding it should not, the reason is never read.
 */
function refusalOf(decision: ReviewDecision): string {
  if (decision.kind !== "no-change") {
    throw new Error(`expected a refusal, got ${decision.kind}: ${decision.message}`);
  }
  return decision.reason;
}

describe("reviewFinding", () => {
  it("sends a finding with an applicable change to Pending Changes", () => {
    const subject = finding();
    const drafted = change({ findingId: subject.id, ruleId: "typography.em-dash" });

    const decision = reviewFinding(subject, plan([drafted]), [subject]);

    expect(decision.kind).toBe("pending");
    expect(decision.message).toBe("Reviewed. Added to Pending changes.");
    if (decision.kind !== "pending") throw new Error("expected a pending decision");
    expect(decision.change).toEqual({ findingId: subject.id, changeId: drafted.id });
  });

  it("refuses a finding the planner has no correction for, and says why", () => {
    // The consistency checker is the real case: it reports a contradiction and
    // deliberately never suggests a replacement, so no change is ever planned.
    const decision = reviewFinding(finding({ source: "ai" }), plan([]), []);

    expect(decision.kind).toBe("no-change");
    expect(refusalOf(decision)).toBe("the planner proposes no correction for this finding");
    expect(decision.message).toContain("Not a pending change");
  });

  it("refuses when no plan has been previewed, without blaming the finding", () => {
    // The reason must not imply the tool decided this finding needs no
    // correction â€” nothing has been analysed yet.
    const decision = reviewFinding(finding(), null, []);

    expect(decision.kind).toBe("no-change");
    expect(refusalOf(decision)).toBe("no change has been previewed for this document yet");
  });

  it("refuses a change with no precondition, because Apply would refuse it", () => {
    // The whole point of the gate: never announce as pending something the
    // Apply button is going to reject. A version 1 plan is used deliberately â€”
    // `ChangePlanSchema` refuses to represent this case at version 2, and a
    // legacy plan is exactly how it reaches the pane.
    const subject = finding();
    const drafted = change({ findingId: subject.id, precondition: undefined });

    const decision = reviewFinding(subject, legacyPlan([drafted]), [subject]);

    expect(decision.kind).toBe("no-change");
    expect(refusalOf(decision)).toContain("no exact precondition");
  });

  it("uses the engine's own advisory reason when the finding declares one", () => {
    // The deviation engine explains precisely why it declined to write â€” an
    // unanchored span, an ambiguous quote. Paraphrasing that into a generic
    // message would discard the only guidance the user has.
    const subject = finding({
      actionable: false,
      advisoryReason: "the quoted anchor was not found in the document",
    });

    const decision = reviewFinding(subject, plan([]), [subject]);

    expect(refusalOf(decision)).toBe("the quoted anchor was not found in the document");
    expect(decision.message).toContain("the quoted anchor was not found in the document");
  });

  it("refuses a non-actionable finding even when a plan does carry a change for it", () => {
    // A change attributed to a finding that declared itself non-actionable is a
    // contradiction. Trusting the declaration keeps the gate from queueing
    // something the engine already said it would not stand behind.
    const subject = finding({ actionable: false, advisoryReason: "advisory only" });
    const drafted = change({ findingId: subject.id });

    expect(reviewFinding(subject, plan([drafted]), [subject]).kind).toBe("no-change");
  });

  it("refuses a change that is still pending approval", () => {
    const subject = finding();
    const drafted = change({
      findingId: subject.id,
      approvalRequired: true,
      approvalState: "pending",
    });

    expect(reviewFinding(subject, plan([drafted]), [subject]).kind).toBe("no-change");
  });

  it("admits a change that requires no approval", () => {
    // The inverse of the test above: an unconditional `approvalRequired` check
    // would refuse these and the gate would stop working.
    const subject = finding();
    const drafted = change({ findingId: subject.id, approvalRequired: false });

    expect(reviewFinding(subject, plan([drafted]), [subject]).kind).toBe("pending");
  });

  it("matches on the occurrence, not the rule, so one finding cannot mark another", () => {
    // Two em dashes produce two findings with the same ruleId. Reviewing one
    // must not queue the other, and the position is what tells them apart.
    const first = finding({ ruleId: "typography.em-dash" });
    const second = finding({ ruleId: "typography.em-dash", range: { start: 90, end: 100 } });
    expect(first.ruleId).toBe(second.ruleId);
    const drafted = change({ findingId: first.id, ruleId: "typography.em-dash" });

    expect(reviewFinding(first, plan([drafted]), [first]).kind).toBe("pending");
    expect(reviewFinding(second, plan([drafted]), [first]).kind).toBe("no-change");
  });

  it("admits a finding whose plan came from a different run", () => {
    /*
     * The cross-run case, and the reason the gate resolves by occurrence rather
     * than by id. The finding in front of the user comes from the observer's
     * scan; the change names a finding from the preview. Matching on the id could
     * never succeed, so every review reported "the planner proposes no
     * correction" for a finding that had one.
     *
     * The two fixtures share an explicit range, because the occurrence is the
     * range and rule: same problem, different uuid — which is exactly the shape
     * two separate runs produce.
     */
    const clickedByUser = finding({ range: { start: 500, end: 510 } });
    const foundByPlanRun = finding({ range: { start: 500, end: 510 } });
    expect(clickedByUser.id).not.toBe(foundByPlanRun.id);
    const drafted = change({ findingId: foundByPlanRun.id });

    expect(reviewFinding(clickedByUser, plan([drafted]), [foundByPlanRun]).kind).toBe("pending");
  });

  it("does not attribute a change that carries no finding id", () => {
    // A change nobody reviewed is not something the user gated into Pending
    // Changes, so it must not appear as if they had.
    const subject = finding();
    const decision = reviewFinding(subject, plan([change()]), [subject]);

    expect(decision.kind).toBe("no-change");
  });
});

describe("changeRefusalReason", () => {
  it("gives no reason for an applicable change", () => {
    const [first] = plan([change()]).changes;
    if (first === undefined) throw new Error("expected a change");
    expect(changeRefusalReason(first)).toBeNull();
  });
});

describe("findChangeForFinding", () => {
  it("returns the refusal reason alongside the change it found", () => {
    const subject = finding();
    const drafted = change({ findingId: subject.id });
    const parsed = plan([drafted]);

    const match = findChangeForFinding(subject, parsed, [subject]);

    expect(match?.change.id).toBe(drafted.id);
    expect(match?.refusal).toBeNull();
  });
});

describe("pendingChangesFor", () => {
  it("collects only the changes the user could actually apply", () => {
    const plannable = finding();
    const advisory = finding();
    const unapproved = finding();
    const drafted = plan([
      change({ findingId: plannable.id }),
      change({ findingId: unapproved.id, approvalRequired: true, approvalState: "pending" }),
    ]);

    const queued = pendingChangesFor([plannable, advisory, unapproved], drafted, [
      plannable,
      advisory,
      unapproved,
    ]);

    expect(queued).toHaveLength(1);
    expect(queued[0]?.findingId).toBe(plannable.id);
  });

  it("returns nothing when there is no plan", () => {
    expect(pendingChangesFor([finding()], null)).toEqual([]);
  });
});
