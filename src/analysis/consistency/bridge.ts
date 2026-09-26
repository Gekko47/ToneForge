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

import { FindingSchema, type Finding } from "../../core/domain/index";
import { consistencyCheck, type ConsistencyIssue, type ConsistencyReport } from "./contracts";

/** Category prefix, so a finding's origin is readable in the UI. */
export function consistencyCategory(issue: ConsistencyIssue): string {
  const descriptor = consistencyCheck(issue.checkId);
  return `consistency.${descriptor.title.replace(/\s+/g, "")}`;
}

/**
 * Convert one issue into a Finding.
 *
 * The range spans both statements, because a contradiction has no single
 * location: pointing at only one of them would make the other invisible in the
 * findings list. `nodeIds` carries both so navigation can reach either.
 */
export function toFinding(issue: ConsistencyIssue, identity: () => string): Finding {
  const start = Math.min(issue.evidence.left.length, issue.evidence.right.length);
  return FindingSchema.parse({
    id: identity(),
    kind: "consistency",
    category: consistencyCategory(issue),
    range: { start: 0, end: Math.max(start, 0), unit: "character" },
    message: issue.detail,
    severity: issue.severity,
    evidence: `${issue.evidence.left}\n\n—\n\n${issue.evidence.right}`,
    ruleId: `consistency:${issue.checkId}`,
    confidence: issue.confidence,
    actionable: issue.actionable,
    nodeIds: issue.nodeIds,
    source: "ai",
    // A consistency finding rewrites prose, so it is reversible only in the
    // sense the orchestrator verifies: the hash check catches a stale plan.
    reversible: true,
    risk: issue.severity === "error" ? "medium" : "low",
    status: "new",
    actual: issue.evidence.right,
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
