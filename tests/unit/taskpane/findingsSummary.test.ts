import { describe, expect, it } from "vitest";
import { describeOpenFindings, summarizeOpenFindings } from "../../../src/taskpane/findingsSummary";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";
import { v4 as uuidv4 } from "uuid";

function finding(severity: Finding["severity"]): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography",
    message: `A ${severity} problem.`,
    severity,
    range: { start: 0, end: 4 },
    nodeIds: [],
  });
}

describe("summarizeOpenFindings", () => {
  it("splits findings into the three consequences the rules already distinguish", () => {
    const summary = summarizeOpenFindings([
      finding("error"),
      finding("error"),
      finding("warning"),
      finding("info"),
    ]);

    expect(summary).toEqual({
      mandatory: 2,
      advisory: 1,
      informational: 1,
      total: 4,
    });
  });

  it("excludes ignored findings from every count, not just the total", () => {
    // The failure this guards: a user ignores the only error, and the summary
    // still reports one mandatory finding they can no longer see or act on.
    const ignored = finding("error");
    const summary = summarizeOpenFindings(
      [ignored, finding("warning")],
      (candidate) => candidate.id === ignored.id,
    );

    expect(summary).toEqual({ mandatory: 0, advisory: 1, informational: 0, total: 1 });
  });

  it("never reports a total that disagrees with its parts", () => {
    const summary = summarizeOpenFindings([
      finding("error"),
      finding("warning"),
      finding("info"),
      finding("info"),
    ]);

    expect(summary.mandatory + summary.advisory + summary.informational).toBe(summary.total);
  });

  it("counts nothing for an empty list rather than defaulting to a claim", () => {
    expect(summarizeOpenFindings([])).toEqual({
      mandatory: 0,
      advisory: 0,
      informational: 0,
      total: 0,
    });
  });

  it("does not mutate the findings it is given", () => {
    const findings = [finding("error")];
    const before = findings.map((item) => ({ ...item }));
    summarizeOpenFindings(findings);
    expect(findings).toEqual(before);
  });
});

describe("describeOpenFindings", () => {
  it("says no open findings without claiming the document is clean", () => {
    // "Clean" is a claim about the whole document and would need the coverage
    // report to agree. This function cannot consult it, so it must not say it.
    const text = describeOpenFindings(summarizeOpenFindings([]));
    expect(text).toBe("No open findings");
    expect(text.toLowerCase()).not.toContain("clean");
  });

  it("names both counts the user acts on", () => {
    const text = describeOpenFindings(
      summarizeOpenFindings([finding("error"), finding("error"), finding("warning")]),
    );

    expect(text).toContain("Mandatory: 2");
    expect(text).toContain("Advisory: 1");
  });

  it("omits the informational count when there are none", () => {
    const text = describeOpenFindings(summarizeOpenFindings([finding("error")]));
    expect(text).toContain("Mandatory: 1");
    expect(text).toContain("Advisory: 0");
    expect(text).not.toContain("Informational");
  });

  it("still reports advisory findings as a real count, not as nothing", () => {
    // Zero is information: it is the difference between "nothing left" and
    // "nothing found yet". Omitting it would hide which one this is.
    const text = describeOpenFindings(summarizeOpenFindings([finding("info")]));
    expect(text).toContain("Advisory: 0");
    expect(text).toContain("Informational: 1");
  });
});
