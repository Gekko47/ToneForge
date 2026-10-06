import { describe, expect, it } from "vitest";
import {
  consistencyCategory,
  summarizeReport,
  toFinding,
  toFindings,
} from "../../../../src/analysis/consistency/bridge";
import type {
  ConsistencyIssue,
  ConsistencyReport,
} from "../../../../src/analysis/consistency/contracts";

/**
 * R0 skeleton tests: the bridge preserves kind and confidence, gates
 * actionability on a named side, and explains itself when there is none.
 */
function issue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    checkId: "C1",
    fingerprint: "C1:a|b",
    title: "Terminology drift",
    detail: "Same term, two ways.",
    severity: "warning",
    confidence: 0.9,
    actionable: true,
    nodeIds: ["s-0", "s-1"],
    ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
    evidence: { left: "A", right: "B", sectionLeft: "", sectionRight: "" },
    suggestedNodeId: "s-1",
    ...overrides,
  };
}

function report(issues: ConsistencyIssue[] = []): ConsistencyReport {
  return {
    revision: "r1",
    issues,
    coverage: {
      complete: true,
      statementsConsidered: 2,
      statementsTotal: 2,
      comparisonsMade: 1,
      blockOverflowSkipped: 0,
      adjudicationsUsed: 0,
      adjudicationsAvailable: 60,
      perCheck: {},
      limitations: [],
      modelAdjudicated: 0,
      quarantinedClaims: 0,
    },
    usedModel: false,
    startedAt: "2026-10-06T00:00:00.000Z",
    finishedAt: "2026-10-06T00:00:01.000Z",
  };
}

describe("consistency bridge", () => {
  it("preserves kind and confidence across the boundary", () => {
    const finding = toFinding(issue(), () => "00000000-0000-4000-8000-000000000000");
    expect(finding.kind).toBe("consistency");
    expect(finding.confidence).toBe(0.9);
    expect(finding.ruleId).toBe("consistency:C1");
  });

  it("points at the named side and carries both statements for navigation", () => {
    const finding = toFinding(issue(), () => "00000000-0000-4000-8000-000000000000");
    expect(finding.actionable).toBe(true);
    expect(finding.nodeIds).toEqual(["s-0", "s-1"]);
  });

  it("marks a finding advisory when no side was named", () => {
    const finding = toFinding(
      issue({ suggestedNodeId: undefined }),
      () => "00000000-0000-4000-8000-000000000000",
    );
    expect(finding.actionable).toBe(false);
    expect(finding.advisoryReason).toMatch(/no statement was identified as wrong/i);
  });

  it("names the check in the category", () => {
    expect(consistencyCategory(issue())).toMatch(/^consistency\./);
  });

  it("converts a whole report and summarizes it", () => {
    expect(
      toFindings(report([issue()]), () => "00000000-0000-4000-8000-000000000000"),
    ).toHaveLength(1);
    expect(summarizeReport(report())).toMatch(/no cross-section conflicts/i);
    expect(summarizeReport(report([issue()]))).toMatch(/1 possible conflict/);
  });
});
