import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { FindingSchema } from "../../../src/core/domain/Finding";
import { findingFingerprint } from "../../../src/taskpane/findingFingerprint";

function finding(id: string) {
  return FindingSchema.parse({
    id,
    kind: "deterministic",
    category: "typography.emDash",
    ruleId: "typography.emDash",
    range: { start: 4, end: 6, unit: "character" },
    message: "Use an em dash.",
    severity: "warning",
    evidence: "--",
    actual: "--",
    expected: "—",
    nodeIds: ["word-paragraph-2", "word-paragraph-1"],
  });
}

describe("findingFingerprint", () => {
  it("is stable when generated UUIDs and node ordering change", () => {
    const first = finding(uuidv4());
    const second = { ...finding(uuidv4()), nodeIds: [...first.nodeIds].reverse() };

    expect(findingFingerprint(second)).toBe(findingFingerprint(first));
  });

  it("changes when the remediation identity changes", () => {
    const first = finding(uuidv4());
    const second = { ...finding(uuidv4()), expected: "double hyphen" };

    expect(findingFingerprint(second)).not.toBe(findingFingerprint(first));
  });
});
