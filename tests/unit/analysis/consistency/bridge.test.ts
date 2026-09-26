import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  consistencyCategory,
  summarizeReport,
  toFinding,
  toFindings,
  type ConsistencyIssue,
  type ConsistencyReport,
} from "../../../../src/analysis/consistency";
import { planChanges } from "../../../../src/changes/planner";

/**
 * The bridge is the only place the consistency engine touches the rest of the
 * product. These tests are about what survives the crossing: a consistency
 * finding must be an ordinary finding, carry its own kind, keep its confidence,
 * and still be subject to the planner rather than bypassing it.
 */

function issue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    checkId: "C2",
    fingerprint: "C2:s0|s1",
    title: "Numeric contradiction",
    detail: "The same quantity is given two different values.",
    severity: "error",
    confidence: 0.95,
    actionable: true,
    nodeIds: ["s0", "s1"],
    ranges: { left: { start: 12, end: 54 }, right: { start: 70, end: 112 } },
    evidence: {
      left: "The quarterly revenue target is 4 million.",
      right: "The quarterly revenue target is 5 million.",
      sectionLeft: "Summary",
      sectionRight: "Detail",
    },
    suggestedNodeId: "s0",
    ...overrides,
  };
}

let counter = 0;
/** `FindingSchema` requires a UUID id, so the counter is folded into the shape. */
function identity(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function report(overrides: Partial<ConsistencyReport> = {}): ConsistencyReport {
  return {
    revision: "r1",
    issues: [issue()],
    usedModel: true,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: "2026-09-26T00:00:01.000Z",
    coverage: {
      complete: true,
      statementsConsidered: 10,
      statementsTotal: 10,
      comparisonsMade: 45,
      perCheck: {},
      limitations: [],
      modelAdjudicated: 1,
    },
    ...overrides,
  };
}

function plan(findings: ReturnType<typeof toFindings>): ReturnType<typeof planChanges> {
  return planChanges({ findings, docHash: "hash-1", baseDocId: "doc-1" });
}

describe("crossing into the finding model", () => {
  it("carries the consistency kind so a reviewer can tell where it came from", () => {
    expect(toFinding(issue(), identity).kind).toBe("consistency");
  });

  it("records which check produced it in the rule id", () => {
    expect(toFinding(issue(), identity).ruleId).toBe("consistency:C2");
  });

  it("carries the adjudicator's confidence rather than rounding it to a verdict", () => {
    expect(toFinding(issue({ confidence: 0.42 }), identity).confidence).toBe(0.42);
  });

  it("marks a sub-threshold issue as not actionable", () => {
    // The single most important property on this path. A non-deterministic
    // engine that quietly rewrites prose is worse than one that asks.
    const finding = toFinding(
      issue({ confidence: CONSISTENCY_ACTIONABLE_CONFIDENCE - 0.1, actionable: false }),
      identity,
    );
    expect(finding.actionable).toBe(false);
  });

  it("keeps both statements in the evidence, not just the one it blames", () => {
    // Pointing at only one side would make the other invisible, and the user
    // cannot judge a contradiction without seeing what it was compared against.
    const evidence = toFinding(issue(), identity).evidence;
    expect(evidence).toMatch(/4 million/);
    expect(evidence).toMatch(/5 million/);
  });

  it("names the category after the check", () => {
    expect(consistencyCategory(issue())).toBe("consistency.Numericcontradiction");
  });

  it("omits a suggested revision when the engine was not confident", () => {
    const finding = toFinding(
      issue({ actionable: false, suggestedText: undefined, suggestedNodeId: undefined }),
      identity,
    );
    expect(finding.expected).toBeUndefined();
  });

  it("points its range at the statement the engine says is wrong", () => {
    // Not at the start of the document, and not across both statements: a range
    // becomes a document edit, so it has to land on the text in dispute.
    const finding = toFinding(issue(), identity);
    expect(finding.range).toEqual({ start: 12, end: 54, unit: "character" });
    expect(finding.actual).toBe("The quarterly revenue target is 4 million.");
  });

  it("follows the adjudicator to the right-hand statement when that is the faulty side", () => {
    const finding = toFinding(issue({ suggestedNodeId: "s1" }), identity);
    expect(finding.range).toEqual({ start: 70, end: 112, unit: "character" });
    expect(finding.actual).toBe("The quarterly revenue target is 5 million.");
  });

  it("is not actionable when no statement was identified as wrong", () => {
    // Nothing to edit and nowhere to edit it, so it is shown and not applied.
    const finding = toFinding(issue({ suggestedNodeId: undefined }), identity);
    expect(finding.actionable).toBe(false);
  });

  it("is not actionable when the engine reported no offsets for its statements", () => {
    const finding = toFinding(issue({ ranges: undefined }), identity);
    expect(finding.actionable).toBe(false);
  });

  it("gives every finding a distinct id from the supplied identity", () => {
    const findings = toFindings(
      report({ issues: [issue(), issue({ fingerprint: "C2:s2|s3" })] }),
      identity,
    );
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(2);
  });
});

describe("planning from consistency findings", () => {
  it("produces no change for a non-actionable issue", () => {
    const findings = toFindings(
      report({
        issues: [
          issue({
            confidence: 0.3,
            actionable: false,
            suggestedText: undefined,
            suggestedNodeId: undefined,
          }),
        ],
      }),
      identity,
    );
    expect(plan(findings).changes).toHaveLength(0);
  });

  it("routes an actionable consistency finding through the planner rather than around it", () => {
    // The consistency engine gains no privileged path to the document: its
    // findings are planned exactly like every other finding's.
    const planResult = plan(toFindings(report(), identity));
    expect(planResult.schemaVersion).toBe(2);
    expect(planResult.docHash).toBe("hash-1");
  });

  it("produces no change from a consistency finding, because it names no correction", () => {
    // The engine reports that two statements disagree; it does not supply the
    // sentence that should replace either of them. Planning one anyway would
    // rewrite a statement with the other statement's text.
    const findings = toFindings(report(), identity);
    expect(plan(findings).changes).toHaveLength(0);
  });
});

describe("summarizing a report", () => {
  it("reports the count plainly", () => {
    expect(summarizeReport(report())).toMatch(/1/);
  });

  it("does not present a bounded run with no findings as a clean result", () => {
    // The summary is a one-liner a user reads instead of the panel. It must not
    // be able to say "no conflicts" over a run that did not cover the document.
    const summary = summarizeReport(
      report({
        issues: [],
        coverage: {
          complete: false,
          statementsConsidered: 400,
          statementsTotal: 900,
          comparisonsMade: 79800,
          perCheck: {},
          limitations: ["Compared the first 400 of 900 statements."],
          modelAdjudicated: 0,
        },
      }),
    );
    expect(summary).toMatch(/did not cover the whole document/i);
  });

  it("says plainly when a complete run found nothing", () => {
    expect(summarizeReport(report({ issues: [] }))).toMatch(/no cross-section conflicts/i);
  });
});
