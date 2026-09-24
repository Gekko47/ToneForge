/**
 * GovernanceDashboard — plain-language governance overview.
 *
 * It deliberately shows counts by rule category and status rather than a
 * single compliance score. Colour is never the only carrier of meaning.
 */

import React from "react";
import type { Finding } from "../../core/domain/Finding";

export interface GovernanceDashboardProps {
  findings: readonly Finding[];
  lastScan: string | null;
  stale: boolean;
  onViewFindings: () => void;
  onRescan: () => void;
}

function categoryLabel(category: string): string {
  const [group, detail] = category.split(".");
  const groupText =
    group === "houseStyle"
      ? "House style"
      : group === "typography"
        ? "Typography"
        : group === "formatting"
          ? "Formatting"
          : group === "semantic"
            ? "Semantic"
            : (group ?? "Other");
  return detail ? `${groupText} — ${detail}` : groupText;
}

function countCategories(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  findings.forEach((finding) => {
    if (finding.status === "ignored" || finding.status === "accepted") return;
    const label = categoryLabel(finding.category);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return counts;
}

export default function GovernanceDashboard({
  findings,
  lastScan,
  stale,
  onViewFindings,
  onRescan,
}: GovernanceDashboardProps): React.ReactNode {
  const openFindings = findings.filter(
    (finding) =>
      finding.status === "new" || finding.status === "reviewed" || finding.status === "deferred",
  );
  const mandatory = openFindings.filter(
    (finding) => finding.severity === "error" || finding.source === "profile",
  ).length;
  const advisory = openFindings.length - mandatory;
  const counts = Array.from(countCategories(findings).entries());

  return (
    <section aria-label="Document Governance" style={{ marginTop: "1rem" }}>
      <h2>Document Governance</h2>
      <p role="status" aria-live="polite">
        {stale
          ? "Findings need a fresh scan before changes can be reviewed."
          : openFindings.length === 0
            ? "No open governance findings."
            : `${openFindings.length} open finding(s) require review.`}
      </p>
      <p style={{ fontSize: "0.85rem" }}>
        Last scan: {lastScan ? new Date(lastScan).toLocaleString() : "never"}
      </p>

      <dl aria-label="Governance counts">
        <div>
          <dt style={{ fontWeight: 600 }}>Mandatory</dt>
          <dd>{mandatory} open finding(s)</dd>
        </div>
        <div>
          <dt style={{ fontWeight: 600 }}>Advisory</dt>
          <dd>{advisory} open finding(s)</dd>
        </div>
      </dl>

      {counts.length > 0 && (
        <section aria-label="Findings by category" style={{ marginTop: "0.75rem" }}>
          <h3>By category</h3>
          <ul>
            {counts.map(([category, count]) => (
              <li key={category}>
                {category}: {count}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button type="button" onClick={onViewFindings} disabled={openFindings.length === 0}>
          View findings
        </button>
        <button type="button" onClick={onRescan}>
          Scan now
        </button>
      </div>
    </section>
  );
}
