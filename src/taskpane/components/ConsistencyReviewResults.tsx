/**
 * ConsistencyReviewResults — the engine's report, shown as-is.
 *
 * The design rule is that this component may not make the report look better
 * than it is. Concretely:
 *
 * - Coverage is rendered first and unconditionally, including when the result is
 *   empty. "No problems found" over a document that was only partly examined is
 *   a false reassurance, so the limitation sits above the findings, not below.
 * - Every issue shows both statements it compared. A user cannot judge a
 *   cross-report claim without seeing what was actually compared, and the model
 *   supplied the verdict, not the user.
 * - Confidence is shown as a number. Below the actionable threshold the finding
 *   is labelled advisory, because a non-deterministic engine that rewrites prose
 *   without saying so is worse than one that asks.
 * - `usedModel: false` is stated, not hidden. That run had no model judgement in
 *   it and the user is entitled to know.
 */

import React from "react";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  type ConsistencyReport,
} from "../../analysis/consistency";

export interface ConsistencyReviewResultsProps {
  report: ConsistencyReport;
  onReviewFindings: () => void;
  onDismiss: () => void;
}

export default function ConsistencyReviewResults({
  report,
  onReviewFindings,
  onDismiss,
}: ConsistencyReviewResultsProps): React.ReactNode {
  const { coverage, issues } = report;
  return (
    <section aria-label="Consistency review result">
      <h2>Consistency review result</h2>

      {/* Coverage first, and always. */}
      <div aria-label="Consistency review coverage">
        <p role="status">
          {coverage.complete
            ? `Reviewed the whole document: ${coverage.statementsConsidered} statements, ${coverage.comparisonsMade} comparisons.`
            : `Partial review: ${coverage.statementsConsidered} of ${coverage.statementsTotal} statements, ${coverage.comparisonsMade} comparisons. This is not a complete review of the document.`}
        </p>
        <p className="tf-sub">
          {report.usedModel
            ? `${coverage.modelAdjudicated} candidate conflict(s) were judged by a language model.`
            : "No language model was used in this run. Only directly comparable differences were found."}
        </p>
        {coverage.limitations.map((limitation) => (
          <p key={limitation} role="alert">
            {limitation}
          </p>
        ))}
        <details>
          <summary>Checks performed</summary>
          <ul>
            {Object.entries(coverage.perCheck)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([check, count]) => (
                <li key={check}>
                  {check}: {count} candidate(s)
                </li>
              ))}
          </ul>
        </details>
      </div>

      <p role="status">
        {issues.length} possible contradiction(s) found. Nothing has been changed in Word.
      </p>
      {issues.length === 0 && (
        <p>
          No contradictions were found in the part of the document that was reviewed. Check the
          coverage above before treating that as a clean bill of health.
        </p>
      )}

      {issues.map((issue) => (
        <article key={issue.fingerprint} aria-label={`Consistency issue: ${issue.title}`}>
          <h3>
            {issue.title} — {issue.severity}
          </h3>
          <p>{issue.detail}</p>
          {/* Both sides, always. The verdict is about this pair and no other. */}
          <blockquote>
            <p>{issue.evidence.left}</p>
          </blockquote>
          <blockquote>
            <p>{issue.evidence.right}</p>
          </blockquote>
          <p className="tf-sub">
            Sections: {issue.evidence.sectionLeft || "(none)"} /{" "}
            {issue.evidence.sectionRight || "(none)"}
          </p>
          <p>
            Confidence: {Math.round(issue.confidence * 100)}% ·{" "}
            {issue.actionable
              ? "Treated as a real contradiction."
              : `Below ${Math.round(
                  CONSISTENCY_ACTIONABLE_CONFIDENCE * 100,
                )}% — advisory only; this will not change anything on its own.`}
          </p>
        </article>
      ))}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onReviewFindings} disabled={issues.length === 0}>
          Review in Findings
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
