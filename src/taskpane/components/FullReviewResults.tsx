import React from "react";
import type { Finding } from "../../core/domain/Finding";
import type { ChangePlan } from "../../core/domain/ChangePlan";

export interface FullReviewResultsProps {
  findings: readonly Finding[];
  plan: ChangePlan;
  onReviewFindings: () => void;
  onCreatePlan: () => void;
}

export default function FullReviewResults({
  findings,
  plan,
  onReviewFindings,
  onCreatePlan,
}: FullReviewResultsProps): React.ReactNode {
  const categories = findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <section aria-label="Full-document review results">
      <h2>Full-document review results</h2>
      <p>
        {findings.length} finding(s) across {Object.keys(categories).length} categor(ies).
      </p>
      <ul aria-label="Finding category counts">
        {Object.entries(categories).map(([category, count]) => (
          <li key={category}>
            {category}: {count}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onReviewFindings}>
        Review findings
      </button>
      <button type="button" onClick={onCreatePlan} disabled={plan.changes.length === 0}>
        Create change plan
      </button>
    </section>
  );
}
