/**
 * CoverageBanner — shows document coverage status.
 * Coverage incomplete blocks apply.
 *
 * Collapsible, like Findings and Pending changes, because the verdict is
 * reference information most of the time and detail most of the time is what
 * makes a page unreadable. The verdict itself stays visible in the collapsed
 * header, so collapsing hides the reasoning and never the conclusion.
 */

import React from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";

export interface CoverageBannerProps {
  coverage: CoverageReport | null;
  /** Whether the detail is expanded. */
  open: boolean;
  onToggle: () => void;
}

export default function CoverageBanner({
  coverage,
  open,
  onToggle,
}: CoverageBannerProps): React.ReactNode {
  if (!coverage) {
    return null;
  }

  const incomplete = !coverage.complete;
  const totalRevised = coverage.revisedCharacterCount;
  const verdict = incomplete ? "Incomplete" : "Complete";

  return (
    <section className="tf-collapsible" aria-label="Coverage section">
      {/*
        A real button rather than a heading: Findings and Pending changes are
        both operable, and three siblings where one is not is the inconsistency
        the user noticed.
      */}
      <button
        type="button"
        className="tf-collapsible-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Coverage ${verdict}`}
      >
        Coverage <span>{verdict}</span>
      </button>
      {/*
        The panel keeps its own border and background so the verdict is
        visible at a glance even when the detail is collapsed. The border
        carries the verdict through the theme's own tokens; the panel uses the
        theme's surface so it can never disagree with the page it sits on.
      */}
      {open && (
        <div className={incomplete ? "tf-coverage tf-coverage-incomplete" : "tf-coverage"}>
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
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
              {coverage.excluded.length} protected or excluded area(s) were not checked.
            </p>
          )}
          <p className="tf-sub">Technical coverage details are available in Troubleshooting.</p>
        </div>
      )}
    </section>
  );
}
