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
  const totalRevised = coverage.revisedCharacterCount;

  return (
    <section
      aria-label="Coverage"
      /*
       * Tokens, not literals.
       *
       * The hardcoded pair was a light-theme palette pasted into a component
       * that renders in both: in dark mode the banner painted a near-white
       * panel with dark-green text, which is both a theme violation and an
       * unreadable block at night. `--tf-danger` and `--tf-success` already
       * carry a per-theme value; the tints do not, so the panel uses the
       * theme's own surfaces and the border carries the verdict.
       */
      className={
        incomplete ? "tf-coverage tf-coverage-incomplete" : "tf-coverage tf-coverage-complete"
      }
    >
      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>
        Coverage {incomplete ? "⚠ Incomplete" : "✓ Complete"}
      </h3>
      <p style={{ margin: 0, fontSize: "0.85rem" }}>
        {totalRevised > 0
          ? `${totalRevised.toLocaleString()} characters changed in the current workflow.`
          : "The requested in-scope content was examined."}
      </p>
      {coverage.unsupported.length > 0 && (
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
          Unsupported scope: {coverage.unsupported.join(", ")}
        </p>
      )}
      {coverage.unprocessed.length > 0 && (
        <ul style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
          {coverage.unprocessed.map((reason, index) => (
            <li key={index} className="tf-coverage-reason">
              {reason}
            </li>
          ))}
        </ul>
      )}
      {coverage.excluded.length > 0 && (
        <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
          {coverage.excluded.length} protected or excluded area(s) were not checked.
        </p>
      )}
      <p className="tf-sub">Technical coverage details are available in Troubleshooting.</p>
    </section>
  );
}
