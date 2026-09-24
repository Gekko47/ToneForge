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

  it("rejects changes that remove preserved literals", () => {
    const finding = FindingSchema.parse({
      id: uuidv4(),
      kind: "semantic",
      category: "editorial.clarity",
      range: { start: 0, end: 20, unit: "character" },
      message: "Preserve the date",
      severity: "warning",
      evidence: "Meet on 2026-09-24",
      actual: "Meet on 2026-09-24",
      expected: "Meet soon",
      source: "ai",
      confidence: 0.8,
    });
    const planned = change({ findingId: finding.id });
    const plan = createChangePlan("hash", "doc", [planned], [finding]);
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
