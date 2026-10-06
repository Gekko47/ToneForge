import { describe, expect, it } from "vitest";
import {
  collapsedCount,
  groupConsistencyIssues,
  isLocatable,
  issueGroupKey,
} from "../../../../src/analysis/consistency/grouping";
import type { ConsistencyIssue } from "../../../../src/analysis/consistency/contracts";

/**
 * R0 skeleton tests: repeats collapse by comparison, locatability needs a
 * named side, and the collapsed count is stated.
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

describe("consistency grouping", () => {
  it("keys a group by the comparison, not the report", () => {
    const left = issue({ fingerprint: "one" });
    const right = issue({ fingerprint: "two" });
    expect(issueGroupKey(left)).toBe(issueGroupKey(right));
    expect(
      issueGroupKey(
        issue({ evidence: { left: "X", right: "Y", sectionLeft: "", sectionRight: "" } }),
      ),
    ).not.toBe(issueGroupKey(left));
  });

  it("collapses repeats and counts what was folded in", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a" }),
      issue({ fingerprint: "b" }),
      issue({ fingerprint: "c" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(collapsedCount(groups)).toBe(2);
  });

  it("keeps different comparisons apart", () => {
    const groups = groupConsistencyIssues([
      issue({
        fingerprint: "one",
        evidence: { left: "A", right: "B", sectionLeft: "", sectionRight: "" },
      }),
      issue({
        fingerprint: "two",
        evidence: { left: "A", right: "C", sectionLeft: "", sectionRight: "" },
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(collapsedCount(groups)).toBe(0);
  });

  it("needs a named faulty side to locate, not just ranges", () => {
    expect(isLocatable(issue())).toBe(true);
    expect(isLocatable(issue({ suggestedNodeId: undefined }))).toBe(false);
    expect(isLocatable(issue({ ranges: undefined }))).toBe(false);
    expect(isLocatable(issue({ suggestedNodeId: "s-9" }))).toBe(false);
  });

  it("marks a group locatable when any member is", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a", suggestedNodeId: undefined }),
      issue({ fingerprint: "b" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.locatable).toBe(true);
  });
});
