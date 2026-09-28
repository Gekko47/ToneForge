import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { reviewFinding, reviewedPlan } from "../../../src/taskpane/reviewGate";
import { reviewIdentity } from "../../../src/taskpane/occurrenceIdentity";
import { createTestPlan } from "../../fixtures/changePlans";
import type { Change } from "../../../src/core/domain/Change";
import type { ChangePlan } from "../../../src/core/domain/ChangePlan";
import type { Finding } from "../../../src/core/domain/Finding";

function findingAt(start: number, actual: string): Finding {
  return {
    id: uuidv4(),
    kind: "formatting",
    category: "typography.doubleQuotes",
    message: `Use straight quotes instead of ${actual}`,
    severity: "warning",
    confidence: 1,
    status: "new",
    actual,
    expected: '"',
    range: { start, end: start + 1, unit: "character" },
    nodeIds: [`node-${start}`],
  } as unknown as Finding;
}

function changeFor(finding: Finding): Change {
  return {
    id: uuidv4(),
    type: "replaceText",
    range: finding.range,
    payload: { text: '"' },
    findingId: finding.id,
    precondition: { kind: "text", expectedText: finding.actual },
    approvalRequired: false,
    approvalState: "notRequired",
    risk: "none",
    source: "deterministic",
  } as Change;
}

function planOf(findings: Finding[]): { plan: ChangePlan; changes: Change[] } {
  const changes = findings.map(changeFor);
  return { plan: createTestPlan("hash", "base", changes), changes };
}

/** The plan inside a `reviewed` projection, or a failure that names the state. */
function reviewed(result: ReturnType<typeof reviewedPlan>): ChangePlan {
  if (result.kind !== "reviewed") {
    throw new Error(`expected a reviewed projection, got "${result.kind}"`);
  }
  return result.plan;
}

describe("reviewedPlan", () => {
  it("carries only the changes whose findings were reviewed", () => {
    const first = findingAt(10, "“");
    const second = findingAt(50, "”");
    const { plan, changes } = planOf([first, second]);

    const result = reviewedPlan(plan, new Set([reviewIdentity(first)]), [first, second]);

    expect(reviewed(result).changes).toHaveLength(1);
    expect(reviewed(result).changes[0]?.id).toBe(changes[0]?.id);
  });

  it("matches across runs that issued different ids for the same problem", () => {
    /*
     * The whole reason the identity exists. The observer's scan and the plan's
     * run are separate, so the finding the user clicked is never the finding the
     * plan references. Matching on the id would leave the list permanently empty
     * and the Apply button permanently dead — safe, and useless.
     */
    const clickedByUser = findingAt(10, "“");
    const foundByPlanRun = findingAt(10, "“");
    expect(clickedByUser.id).not.toBe(foundByPlanRun.id);
    const { plan } = planOf([foundByPlanRun]);

    const result = reviewedPlan(plan, new Set([reviewIdentity(clickedByUser)]), [foundByPlanRun]);

    expect(reviewed(result).changes).toHaveLength(1);
  });

  it("does not let one review cover a different occurrence of the same rule", () => {
    // The em-dash case. A document with ninety em-dashes produces ninety
    // findings sharing one fingerprint, so the position half of the identity is
    // what keeps reviewing the first from queuing the other eighty-nine.
    const first = findingAt(10, "“");
    const second = findingAt(400, "“");
    const { plan } = planOf([first, second]);

    const result = reviewedPlan(plan, new Set([reviewIdentity(first)]), [first, second]);

    expect(reviewed(result).changes).toHaveLength(1);
  });

  it("drops the review when the document moves the finding, rather than carrying it", () => {
    // A review was given for specific text in a specific plan. Carrying it onto a
    // plan built from different text would apply something nobody looked at.
    const { plan } = planOf([findingAt(10, "“")]);
    const shifted = findingAt(300, "“");

    expect(reviewedPlan(plan, new Set([reviewIdentity(shifted)]), [shifted]).plan).toBeNull();
  });

  it("distinguishes no plan from nothing reviewed", () => {
    /*
     * The distinction the old signature could not express. Both used to return
     * `null`, and the caller resolved that with `?? fullPlan` — so a user who had
     * reviewed nothing was handed the entire unreviewed plan as pending changes.
     */
    const { plan } = planOf([findingAt(10, "“")]);

    expect(reviewedPlan(null, new Set(), []).kind).toBe("no-plan");
    expect(reviewedPlan(plan, new Set(), [findingAt(10, "“")]).kind).toBe("nothing-reviewed");
  });

  it("says why it is empty rather than showing a bare refusal", () => {
    const { plan } = planOf([findingAt(10, "“")]);
    const result = reviewedPlan(plan, new Set(), []);

    expect(result.plan).toBeNull();
    expect(result.kind === "nothing-reviewed" ? result.reason : "").not.toBe("");
  });

  it("never restores the full plan when the reviewed subset is empty", () => {
    // The regression this shape exists to prevent: `reviewedPlan(...) ?? plan`.
    const { plan } = planOf([findingAt(10, "“"), findingAt(80, "”")]);
    const unrelated = new Set(["some-other-occurrence"]);

    const result = reviewedPlan(plan, unrelated, [findingAt(10, "“"), findingAt(80, "”")]);

    expect(result.plan).toBeNull();
  });

  it("never carries a change with no finding behind it", () => {
    // A change nobody can attribute to a reviewed finding was not reviewed. The
    // plan is built with no findings at all, which is the shape of a plan whose
    // run has not been paired with its own findings.
    const orphan = changeFor(findingAt(10, "“"));
    const plan = createTestPlan("hash", "base", [orphan]);
    const reviewed = findingAt(10, "“");

    expect(reviewedPlan(plan, new Set([reviewIdentity(reviewed)]), [reviewed]).plan).toBeNull();
  });
});

describe("reviewFinding", () => {
  it("admits a change for a finding the user clicked in a different run", () => {
    /*
     * The defect this module was rewritten for. The gate used to match
     * `change.findingId === finding.id`, and the id in front of the user is
     * issued by the observer's scan while the change names a finding from the
     * preview. The match could never succeed, so every review reported "the
     * planner proposes no correction" for a finding that had one — and the pane
     * looked broken rather than wrong.
     */
    const clickedByUser = findingAt(10, "“");
    const foundByPlanRun = findingAt(10, "“");
    const { plan } = planOf([foundByPlanRun]);

    const decision = reviewFinding(clickedByUser, plan, [foundByPlanRun]);

    expect(decision.kind).toBe("pending");
    expect(decision.kind === "pending" ? decision.change.changeId : null).toBe(
      plan.changes[0]?.id ?? null,
    );
  });

  it("agrees with the projection about the same finding", () => {
    /*
     * The gate and the projection used to answer through different identities,
     * so they could disagree about one decision: the gate said "not a pending
     * change" while the table listed the change. One identity, one answer.
     */
    const clickedByUser = findingAt(10, "“");
    const foundByPlanRun = findingAt(10, "“");
    const { plan } = planOf([foundByPlanRun]);

    const decision = reviewFinding(clickedByUser, plan, [foundByPlanRun]);
    const projection = reviewedPlan(plan, new Set([reviewIdentity(clickedByUser)]), [
      foundByPlanRun,
    ]);

    expect(decision.kind === "pending").toBe(projection.kind === "reviewed");
  });

  it("still refuses a change Apply would reject", () => {
    /*
     * Approval, not precondition. A precondition-less change cannot be expressed
     * at schema version 2 — `ChangePlanSchema` refuses it — so a version-2 plan
     * carrying one would be a fixture that does not parse, not a case the gate
     * has to survive. Approval is the refusal that a real plan can carry, and it
     * is the one Apply enforces before writing.
     */
    const finding = findingAt(10, "“");
    const change = {
      ...changeFor(finding),
      approvalRequired: true,
      approvalState: "pending",
    } as Change;
    const plan = createTestPlan("hash", "base", [change]);

    expect(reviewFinding(finding, plan, [finding]).kind).toBe("no-change");
  });
});
