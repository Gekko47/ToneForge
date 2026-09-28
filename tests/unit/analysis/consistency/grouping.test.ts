import { describe, expect, it } from "vitest";
import {
  collapsedCount,
  groupConsistencyIssues,
  isLocatable,
  issueGroupKey,
  type ConsistencyIssue,
} from "../../../../src/analysis/consistency";

function issue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    checkId: "C1",
    fingerprint: "C1:fp-a",
    title: "Terminology drift",
    detail: "The same term is used two ways.",
    severity: "warning",
    confidence: 0.9,
    actionable: true,
    nodeIds: ["n1", "n2"],
    ranges: { left: { start: 10, end: 20 }, right: { start: 90, end: 100 } },
    evidence: {
      left: "The onboarding flow is manual.",
      right: "Onboarding is fully automated.",
      sectionLeft: "Intro",
      sectionRight: "Appendix",
    },
    ...overrides,
  };
}

describe("issueGroupKey", () => {
  it("is the same for the same pair of statements", () => {
    expect(issueGroupKey(issue())).toBe(issueGroupKey(issue({ fingerprint: "other" })));
  });

  it("does not depend on which statement the engine reported first", () => {
    /*
     * The engine can reach either statement first, and the two are the same
     * conflict. A key that changed with order would turn one disagreement into
     * two rows.
     */
    const forward = issue({
      evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
    });
    const reversed = issue({
      evidence: { left: "beta", right: "alpha", sectionLeft: "", sectionRight: "" },
    });
    expect(issueGroupKey(forward)).toBe(issueGroupKey(reversed));
  });

  it("separates the same statements under different checks", () => {
    const terminology = issue({ checkId: "C1" });
    const numeric = issue({ checkId: "C2" });
    expect(issueGroupKey(terminology)).not.toBe(issueGroupKey(numeric));
  });

  it("separates different statement pairs that share a check", () => {
    const first = issue({
      evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
    });
    const second = issue({
      evidence: { left: "alpha", right: "gamma", sectionLeft: "", sectionRight: "" },
    });
    expect(issueGroupKey(first)).not.toBe(issueGroupKey(second));
  });
});

describe("isLocatable", () => {
  it("is true when a node is named and both statements carry a range", () => {
    expect(isLocatable(issue({ suggestedNodeId: "n2" }))).toBe(true);
  });

  it("is false when the engine named no faulty statement", () => {
    expect(isLocatable(issue())).toBe(false);
  });

  it("is false without ranges, however the node is named", () => {
    expect(isLocatable(issue({ suggestedNodeId: "n1", ranges: undefined }))).toBe(false);
  });

  it("is false when the named node is neither of the two statements", () => {
    expect(isLocatable(issue({ suggestedNodeId: "n9" }))).toBe(false);
  });

  it("is false when the range is inverted", () => {
    const inverted = issue({
      suggestedNodeId: "n1",
      ranges: { left: { start: 40, end: 5 }, right: { start: 0, end: 1 } },
    });
    expect(isLocatable(inverted)).toBe(false);
  });
});

describe("groupConsistencyIssues", () => {
  it("returns nothing for an empty report", () => {
    expect(groupConsistencyIssues([])).toEqual([]);
    expect(collapsedCount([])).toBe(0);
  });

  it("collapses repeats of one disagreement into a single row", () => {
    /*
     * The cross-section checks pair statements by shared vocabulary, so one real
     * drift surfaces once per pair that shares the term. The user must see one
     * conflict, not nine rows about it.
     */
    const repeats = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((tag) =>
      issue({ fingerprint: `C1:${tag}` }),
    );

    const groups = groupConsistencyIssues(repeats);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.issues).toHaveLength(9);
    expect(collapsedCount(groups)).toBe(8);
  });

  it("keeps genuinely different conflicts apart", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a" }),
      issue({
        fingerprint: "b",
        evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(collapsedCount(groups)).toBe(0);
  });

  it("reports zero collapsed when nothing was collapsed, so the clause is omitted", () => {
    const groups = groupConsistencyIssues([issue({ fingerprint: "a" })]);
    expect(collapsedCount(groups)).toBe(0);
  });

  it("takes the worst severity in a group rather than the first issue's", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a", severity: "info" }),
      issue({ fingerprint: "b", severity: "error" }),
    ]);

    expect(groups[0]?.worstSeverity).toBe("error");
  });

  it("orders by severity, then check, so two runs of one document compare", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a", checkId: "C3", severity: "info" }),
      issue({ fingerprint: "b", checkId: "C1", severity: "error" }),
      issue({ fingerprint: "c", checkId: "C2", severity: "error" }),
    ]);

    expect(groups.map((group) => group.checkId)).toEqual(["C1", "C2", "C3"]);
  });

  it("marks a group locatable when any member of it can be pointed at", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a", suggestedNodeId: undefined }),
      issue({ fingerprint: "b", suggestedNodeId: "n1" }),
    ]);

    expect(groups[0]?.locatable).toBe(true);
  });

  it("marks a group unlocatable when no member of it can be pointed at", () => {
    const groups = groupConsistencyIssues([
      issue({ fingerprint: "a", suggestedNodeId: undefined }),
      issue({ fingerprint: "b", suggestedNodeId: "n9" }),
    ]);

    expect(groups[0]?.locatable).toBe(false);
  });
});
