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
 * - Repeats are collapsed, and the count of what was collapsed is stated. The
 *   cross-section checks pair statements by shared vocabulary, so one real drift
 *   between two sections arrives many times over; a list of nine rows about one
 *   disagreement reads as nine problems, and a count of nine is a claim about the
 *   document that is not true.
 * - A conflict the engine could not place in this document says so. An empty
 *   location line looks like a rendering fault, and a reader who cannot tell the
 *   difference will assume the finding is located at the top of the file.
 */

import React from "react";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  collapsedCount,
  groupConsistencyIssues,
  type ConsistencyIssueGroup,
  type ConsistencyReport,
} from "../../analysis/consistency";

export interface ConsistencyReviewResultsProps {
  report: ConsistencyReport;
  onReviewFindings: () => void;
  onDismiss: () => void;
}

/** One collapsed conflict, in the order the groups were ranked. */
function ConflictCard({ group }: { group: ConsistencyIssueGroup }): React.ReactNode {
  const lead = group.issues[0];
  if (lead === undefined) return null;
  const repeats = group.issues.length - 1;

  return (
    <article aria-label={`Consistency issue: ${group.title}`}>
      <h3>
        {group.title} — {group.worstSeverity}
      </h3>
      <p>{lead.detail}</p>
      {/* Both sides, always. The verdict is about this pair and no other. */}
      <blockquote>
        <p>{lead.evidence.left}</p>
      </blockquote>
      <blockquote>
        <p>{lead.evidence.right}</p>
      </blockquote>
      <p className="tf-sub">
        Sections: {lead.evidence.sectionLeft || "(none)"} / {lead.evidence.sectionRight || "(none)"}
      </p>
      {/*
        Located or not, stated either way. A conflict the engine could not anchor
        is still a true report of a conflict — it just is not a place in this
        document, and pretending otherwise with a blank location would invite the
        reader to go looking for text that is not there.
      */}
      <p className={group.locatable ? "tf-sub" : "tf-debug-warning"}>
        {group.locatable
          ? "This conflict is located in the document."
          : "This conflict cannot be located in the document: the engine could not place either statement in the text it read, so there is nothing to jump to. The report above is what it saw."}
      </p>
      {repeats > 0 && (
        <p className="tf-sub">
          Reported {group.issues.length} times for this same pair of statements; shown once.
        </p>
      )}
      <p>
        Confidence: {Math.round(Math.max(...group.issues.map((issue) => issue.confidence)) * 100)}%
        ·{" "}
        {group.issues.some((issue) => issue.actionable)
          ? "Treated as a real contradiction."
          : `Below ${Math.round(
              CONSISTENCY_ACTIONABLE_CONFIDENCE * 100,
            )}% — advisory only; this will not change anything on its own.`}
      </p>
    </article>
  );
}

export default function ConsistencyReviewResults({
  report,
  onReviewFindings,
  onDismiss,
}: ConsistencyReviewResultsProps): React.ReactNode {
  const { coverage, issues } = report;
  const groups = groupConsistencyIssues(issues);
  const collapsed = collapsedCount(groups);

  return (
    <section aria-label="Consistency review result">
      <h2>Consistency review result</h2>

      {/* Coverage first, and always. */}
      <div aria-label="Consistency review coverage">
        <p role="status">
          {coverage.complete
            ? `Reviewed the whole document: ${coverage.statementsConsidered} statements, ${coverage.comparisonsMade} comparisons.`
            : // Every statement is examined; the gap is between windows. Saying
              // "X of Y statements" here would be a claim truncation is no longer
              // true of, and it would hide the much narrower real limitation.
              `Partial review: all ${coverage.statementsConsidered} statements were examined across ${coverage.windowsExamined} windows, and ${coverage.comparisonsMade} comparisons were made. ${coverage.crossWindowPairsSkipped} comparison(s) between statements in different windows were not made, so this is not a complete review of the document.`}
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
        {groups.length === 1
          ? "1 possible contradiction"
          : `${groups.length} possible contradictions`}{" "}
        found.{" "}
        {collapsed > 0
          ? `${issues.length} reports collapsed into ${groups.length}, because the same pair of statements matched more than once.`
          : "Nothing has been changed in Word."}
      </p>
      {groups.length === 0 && (
        <p>
          No contradictions were found in the part of the document that was reviewed. Check the
          coverage above before treating that as a clean bill of health.
        </p>
      )}

      {groups.map((group) => (
        <ConflictCard key={group.key} group={group} />
      ))}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={onReviewFindings} disabled={groups.length === 0}>
          Review in Findings
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
