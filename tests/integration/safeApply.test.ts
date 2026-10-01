import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { ChangeSchema, type Change } from "../../src/core/domain/Change";
import { createChangePlan } from "../../src/core/domain/ChangePlan";
import { FindingSchema } from "../../src/core/domain/Finding";
import { validatePlanBeforeApply } from "../../src/word/revisionAdapter";
import { DocumentNodeSchema } from "../../src/core/domain/DocumentSnapshot";

function change(overrides: Partial<Change> = {}): Change {
  return ChangeSchema.parse({
    id: uuidv4(),
    type: "replaceText",
    range: { start: 0, end: 4 },
    payload: { text: "safe" },
    rationale: "test",
    reversible: true,
    source: "ai",
    risk: "low",
    approvalRequired: true,
    dependsOn: [],
    ...overrides,
  });
}

describe("safe application validation", () => {
  it("rejects missing dependencies", () => {
    const planned = change({ dependsOn: [uuidv4()] });
    const plan = createChangePlan("hash", "doc", [planned]);
    expect(validatePlanBeforeApply(plan)).toContainEqual(expect.stringContaining("missing change"));
  });

  /*
   * The check reads the Change (D4).
   *
   * It used to read `finding.actual`/`finding.expected`, guarded by
   * `change.findingId`, so it fired on the finding and never on the change — which
   * meant a change with no finding, or a finding with no `actual`, skipped the
   * check entirely. The precondition is where the text the document is expected to
   * hold actually lives, so the case is expressed through it.
   */
  it("rejects a change whose replacement drops a preserved literal", () => {
    const planned = change({
      approvalState: "approved",
      precondition: { kind: "text", expectedText: "Meet on 2026-09-24" },
      payload: { text: "Meet soon" },
    });
    const plan = createChangePlan("hash", "doc", [planned], [], { schemaVersion: 2 });
    expect(validatePlanBeforeApply(plan)).toContainEqual(
      expect.stringContaining("preserved content"),
    );
  });

  it("reads the node precondition's expected text too, so a paragraph write cannot slip past", () => {
    const planned = change({
      approvalState: "approved",
      range: { start: 0, end: 1, unit: "paragraph" },
      precondition: {
        kind: "node",
        nodeId: "word-paragraph-p1",
        expectedText: "Meet on 2026-09-24",
      },
      payload: { text: "Meet soon" },
    });
    const plan = createChangePlan("hash", "doc", [planned], [], { schemaVersion: 2 });
    expect(validatePlanBeforeApply(plan)).toContainEqual(
      expect.stringContaining("preserved content"),
    );
  });

  it("rejects a change linked to a protected node", () => {
    const protectedNodeId = uuidv4();
    const finding = FindingSchema.parse({
      id: uuidv4(),
      kind: "semantic",
      category: "editorial.clarity",
      range: { start: 0, end: 4, unit: "character" },
      message: "Protected",
      severity: "warning",
      evidence: "text",
      nodeIds: [protectedNodeId],
      source: "ai",
    });
    const planned = change({ findingId: finding.id });
    const plan = createChangePlan("hash", "doc", [planned], [finding]);
    const nodes = [
      DocumentNodeSchema.parse({
        nodeId: protectedNodeId,
        type: "paragraph",
        text: "quoted",
        sourcePath: "body/paragraph/0",
        editable: false,
        includedInGovernance: true,
        includedInAIReview: true,
        protectionReason: "quote",
      }),
    ];
    expect(validatePlanBeforeApply(plan, false, nodes)).toContainEqual(
      expect.stringContaining("protected range"),
    );
  });
});
