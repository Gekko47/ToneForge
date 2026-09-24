/**
 * FindingsList — displays a list of FindingCard components.
 */

import React from "react";
import type { Finding } from "../../core/domain/Finding";
import FindingCard from "./FindingCard";

export interface FindingsListProps {
  findings: Finding[];
  pageSize?: number;
  onApply?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
}

export default function FindingsList({
  findings,
  onApply,
  onIgnore,
  pageSize = 50,
}: FindingsListProps): React.ReactNode {
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  if (findings.length === 0) {
    return <p style={{ color: "#0b6a0b" }}>No findings detected.</p>;
  }

  return (
    <section aria-label="Findings list">
      <h3 style={{ marginBottom: "0.5rem" }}>{findings.length} finding(s)</h3>
      {findings.slice(0, visibleCount).map((finding) => (
        <FindingCard key={finding.id} finding={finding} onApply={onApply} onIgnore={onIgnore} />
      ))}
      {visibleCount < findings.length && (
        <button type="button" onClick={() => setVisibleCount((count) => count + pageSize)}>
          Show more findings ({findings.length - visibleCount} remaining)
        </button>
      )}
    </section>
  );
}
