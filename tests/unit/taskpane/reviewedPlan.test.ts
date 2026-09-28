import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { reviewedPlan } from "../../../src/taskpane/reviewGate";
import { reviewKey } from "../../../src/taskpane/reviewKey";
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

describe("reviewedPlan", () => {
  it("carries only the changes whose findings were reviewed", () => {
    const first = findingAt(10, "“");
    const second = findingAt(50, "”");
    const { plan, changes } = planOf([first, second]);

    const reviewed = reviewedPlan(plan, new Set([reviewKey(first)]), [first, second]);

    expect(reviewed?.changes).toHaveLength(1);
    expect(reviewed?.changes[0]?.id).toBe(changes[0]?.id);
  });

  it("matches across runs that issued different ids for the same problem", () => {
    /*
     * The whole reason the key exists. The observer's scan and the plan's run
     * are separate, so the finding the user clicked is never the finding the
     * plan references. Matching on the id would leave the list permanently empty
     * and the Apply button permanently dead — safe, and useless.
     */
    const clickedByUser = findingAt(10, "“");
    const foundByPlanRun = findingAt(10, "“");
    expect(clickedByUser.id).not.toBe(foundByPlanRun.id);
    const { plan } = planOf([foundByPlanRun]);

    const reviewed = reviewedPlan(plan, new Set([reviewKey(clickedByUser)]), [foundByPlanRun]);

    expect(reviewed?.changes).toHaveLength(1);
  });

  it("does not let one review cover a different occurrence of the same rule", () => {
    // The em-dash case. A document with ninety em-dashes produces ninety
    // findings sharing one fingerprint, so the position half of the key is what
    // keeps reviewing the first from queuing the other eighty-nine.
    const first = findingAt(10, "“");
    const second = findingAt(400, "“");
    const { plan } = planOf([first, second]);

    expect(reviewedPlan(plan, new Set([reviewKey(first)]), [first, second])?.changes).toHaveLength(
      1,
    );
  });

  it("drops the review when the document moves the finding, rather than carrying it", () => {
    // A review was given for specific text in a specific plan. Carrying it onto a
    // plan built from different text would apply something nobody looked at.
    const { plan } = planOf([findingAt(10, "“")]);
    const shifted = findingAt(300, "“");

    expect(reviewedPlan(plan, new Set([reviewKey(shifted)]), [shifted])).toBeNull();
  });

  it("returns null when nothing has been reviewed", () => {
    const { plan } = planOf([findingAt(10, "“")]);
    expect(reviewedPlan(plan, new Set(), [])).toBeNull();
  });

  it("never carries a change with no finding behind it", () => {
    // A change nobody can attribute to a reviewed finding was not reviewed. The
    // plan is built with no findings at all, which is the shape of a plan whose
    // run has not been paired with its own findings.
    const orphan = changeFor(findingAt(10, "“"));
    const plan = createTestPlan("hash", "base", [orphan]);
    const reviewed = findingAt(10, "“");

    expect(reviewedPlan(plan, new Set([reviewKey(reviewed)]), [reviewed])).toBeNull();
  });
});
