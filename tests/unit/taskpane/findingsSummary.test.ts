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

/**
 * A formatting finding, built through the schema.
 *
 * The schema rather than a spread, because `{ ...finding(), kind: "formatting" }`
 * widens `kind` to `string` and the object stops being a `Finding`. The build
 * cost is nothing and the type stays narrowed at every call site.
 */
function formatting(severity: Finding["severity"], category: string): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "formatting",
    category,
    message: `A ${severity} formatting problem.`,
    severity,
    range: { start: 0, end: 4, unit: "paragraph" },
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
      // Spec §22: the same four, counted by review group. All four are
      // `deterministic` findings, so all four are language.
      byGroup: { language: 4, formatting: 0, structure: 0 },
    });
  });

  it("splits the same findings by review group as well as by severity", () => {
    /*
     * Severity and group answer different questions. "How bad" tells a reader
     * whether to stop reading; "what kind" tells them where to start. A document
     * with four hundred spacing findings and twenty structural ones cannot be
     * triaged from the first number alone, which is why both are counted over
     * the same filtered list rather than by two passes that could disagree.
     */
    const summary = summarizeOpenFindings([
      finding("warning"),
      formatting("warning", "formatting.bodyStyle"),
      formatting("warning", "formatting.headingStyle"),
      formatting("info", "formatting.emptyHeading"),
    ]);

    expect(summary.byGroup).toEqual({ language: 1, formatting: 1, structure: 2 });
  });

  it("leaves an ignored finding out of the group counts too", () => {
    const ignored = formatting("warning", "formatting.bodyStyle");
    const summary = summarizeOpenFindings(
      [ignored, finding("error")],
      (candidate) => candidate.id === ignored.id,
    );
    expect(summary.byGroup).toEqual({ language: 1, formatting: 0, structure: 0 });
  });

  it("excludes ignored findings from every count, not just the total", () => {
    // The failure this guards: a user ignores the only error, and the summary
    // still reports one mandatory finding they can no longer see or act on.
    const ignored = finding("error");
    const summary = summarizeOpenFindings(
      [ignored, finding("warning")],
      (candidate) => candidate.id === ignored.id,
    );

    expect(summary).toEqual({
      mandatory: 0,
      advisory: 1,
      informational: 0,
      total: 1,
      byGroup: { language: 1, formatting: 0, structure: 0 },
    });
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
      byGroup: { language: 0, formatting: 0, structure: 0 },
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
