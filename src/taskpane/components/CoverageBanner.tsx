/**
 * CoverageBanner — shows document coverage status.
 * Coverage incomplete blocks apply.
 */

import React from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";

export interface CoverageBannerProps {
  coverage: CoverageReport | null;
}

export default function CoverageBanner({ coverage }: CoverageBannerProps): React.ReactNode {
  if (!coverage) {
    return null;
  }

  const incomplete = !coverage.complete;
  const totalProcessed = coverage.processedCharacterCount;
  const totalRevised = coverage.revisedCharacterCount;

  return (
    <section
      aria-label="Coverage"
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: `1px solid ${incomplete ? "#a4262c" : "#0b6a0b"}`,
        borderRadius: "4px",
        backgroundColor: incomplete ? "#fff5f5" : "#f5fff5",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>
        Coverage {incomplete ? "⚠ Incomplete" : "✓ Complete"}
      </h3>
      <p style={{ margin: 0, fontSize: "0.85rem" }}>
        Processed: {totalProcessed.toLocaleString()} characters
        {totalRevised > 0 && ` — Revised: ${totalRevised.toLocaleString()}`}
      </p>
      {coverage.unprocessed.length > 0 && (
        <ul style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
          {coverage.unprocessed.map((reason, index) => (
            <li key={index} style={{ color: "#a4262c" }}>
              {reason}
            </li>
          ))}
        </ul>
      )}
      {coverage.excluded.length > 0 && (
        <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
          {coverage.excluded.length} exclusion(s) applied.
        </p>
      )}
    </section>
  );
}
