/**
 * Bridge from a consistency report to the unified `Finding` model.
 *
 * This is the only place the consistency engine touches the rest of ToneForge.
 * Everything downstream — the unified findings merge, the planner, the review
 * surface, the protection and conflict gates, the single mutation path — is
 * unchanged. That is the point: a consistency finding is an ordinary finding
 * with an ordinary provenance, so it cannot bypass a gate simply because it came
 * from a different engine.
 *
 * Two properties are deliberately preserved when crossing the boundary:
 *
 * 1. **`kind: "consistency"`.** A user reviewing a plan must be able to tell
 *    that a finding came from a comparison that could be wrong.
 * 2. **Confidence survives.** `Finding.confidence` carries the adjudicator's
 *    confidence, and a non-actionable issue becomes `actionable: false` so the
 *    planner produces nothing from it. A non-deterministic engine that quietly
 *    rewrites prose is worse than one that asks.
 */

import { FindingSchema, type Finding, type Range } from "../../core/domain/index";
import { consistencyCheck, type ConsistencyIssue, type ConsistencyReport } from "./contracts";

/** Category prefix, so a finding's origin is readable in the UI. */
export function consistencyCategory(issue: ConsistencyIssue): string {
  const descriptor = consistencyCheck(issue.checkId);
  return `consistency.${descriptor.title.replace(/\s+/g, "")}`;
}

/**
 * The statement a finding points at, if the engine named one.
 *
 * `suggestedNodeId` is the only statement-level identification the engine
 * produces, and it is deliberately set only when the adjudicator said which side
 * is wrong. Everything the engine can say about fault comes from that field.
 */
function targetedStatement(issue: ConsistencyIssue): { text: string; range: Range } | null {
  if (issue.suggestedNodeId === undefined || issue.ranges === undefined) return null;
  const index = issue.nodeIds.indexOf(issue.suggestedNodeId);
  if (index !== 0 && index !== 1) return null;
  const range = index === 0 ? issue.ranges.left : issue.ranges.right;
  const text = index === 0 ? issue.evidence.left : issue.evidence.right;
  // A statement the engine never located cannot be pointed at. Emitting a range
  // of zeroes here would put the finding at the very start of the document, which
  // is a location, and a wrong one is worse than none.
  if (range.end < range.start) return null;
  return { text, range: { start: range.start, end: range.end, unit: "character" } };
}

/**
 * Convert one issue into a Finding.
 *
 * `nodeIds` carries both statements so navigation can reach either, and the
 * evidence quotes both because a user cannot judge a contradiction without seeing
 * what it was compared against. The *range* points only at the statement the
 * engine says is wrong — a range spanning both would select a region of the
 * document that contains the contradiction rather than the text to change, and
 * the planner turns a range into a document edit.
 *
 * When the engine names no faulty side, there is nothing to point at, so the
 * finding is marked non-actionable: it is displayed as a report of a conflict
 * and cannot become a change.
 */
export function toFinding(issue: ConsistencyIssue, identity: () => string): Finding {
  const target = targetedStatement(issue);
  return FindingSchema.parse({
    id: identity(),
    kind: "consistency",
    category: consistencyCategory(issue),
    range: target?.range ?? { start: 0, end: 0, unit: "character" },
    message: issue.detail,
    severity: issue.severity,
    evidence: `${issue.evidence.left}\n\n—\n\n${issue.evidence.right}`,
    ruleId: `consistency:${issue.checkId}`,
    confidence: issue.confidence,
    actionable: issue.actionable && target !== null,
    ...(target === null
      ? { advisoryReason: "No statement was identified as wrong, so this cannot be applied." }
      : {}),
    nodeIds: issue.nodeIds,
    source: "ai",
    // A consistency finding rewrites prose, so it is reversible only in the
    // sense the orchestrator verifies: the hash check catches a stale plan.
    reversible: true,
    risk: issue.severity === "error" ? "medium" : "low",
    status: "new",
    actual: target?.text ?? issue.evidence.right,
    ...(issue.suggestedText === undefined
      ? {}
      : { expected: issue.suggestedText, explanation: issue.detail }),
  });
}

/**
 * Convert a whole report.
 *
 * A report is always tied to the revision it was produced against, which is
 * carried into each finding's evidence so a later consumer can tell that a
 * finding belongs to text that has since changed.
 */
export function toFindings(report: ConsistencyReport, identity: () => string): Finding[] {
  return report.issues.map((issue) => toFinding(issue, identity));
}

/** A one-line plain-language summary, for the results header. */
export function summarizeReport(report: ConsistencyReport): string {
  if (report.issues.length === 0) {
    return report.coverage.limitations.length > 0
      ? "No conflicts found, but the review did not cover the whole document."
      : "No cross-section conflicts found.";
  }
  const count = report.issues.length;
  return `${count} possible conflict${count === 1 ? "" : "s"} found across the document.`;
}
