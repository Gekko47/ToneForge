/**
 * FindingsList — displays a list of FindingCard components.
 *
 * A listbox rather than a plain section, because the toolbar above announces
 * "Finding 4 of 12" as the user steps through it. That announcement had nothing
 * to anchor to until the list exposed an option role and the selected card
 * exposed `aria-current`: the position changed and nothing on screen did.
 */

import React from "react";
import type { Finding } from "../../core/domain/Finding";
import { reviewKey } from "../reviewKey";
import FindingCard from "./FindingCard";

export interface FindingsListProps {
  findings: Finding[];
  pageSize?: number;
  /** Rendered as the listbox id so the toolbar can point `aria-controls` at it. */
  id?: string;
  /** Index the findings toolbar currently points at, or `null` for none. */
  selectedIndex?: number | null;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  /**
   * Review keys the user has already produced.
   *
   * Keys rather than finding ids, and the reason is load-bearing: the id issued
   * by the observer's run never reappears in the plan's, so an id-keyed set could
   * never line up with what Apply writes. See `reviewKey`.
   *
   * A set rather than a boolean: the gate records one decision per finding, and
   * a single flag would mark every card at once.
   */
  reviewedKeys?: ReadonlySet<string>;
}

export default function FindingsList({
  findings,
  pageSize = 50,
  id,
  selectedIndex = null,
  onReview,
  onIgnore,
  reviewedKeys,
}: FindingsListProps): React.ReactNode {
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  if (findings.length === 0) {
    return <p className="tf-empty">No findings detected.</p>;
  }

  return (
    <section aria-label="Findings list">
      <h3 className="tf-sub">{findings.length} finding(s)</h3>
      {/*
        The visible window is a slice, not a filter: a selected finding beyond it
        would otherwise be reported as selected while not being rendered. The
        window is widened to include the selection instead of dropping it.
      */}
      <div id={id} role="listbox" aria-label="Findings" aria-orientation="vertical">
        {findings
          .slice(0, Math.max(visibleCount, (selectedIndex ?? 0) + 1))
          .map((finding, index) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              selected={index === selectedIndex}
              onReview={onReview}
              onIgnore={onIgnore}
              reviewed={reviewedKeys?.has(reviewKey(finding)) === true}
            />
          ))}
      </div>
      {visibleCount < findings.length && (
        <button type="button" onClick={() => setVisibleCount((count) => count + pageSize)}>
          Show more findings ({findings.length - visibleCount} remaining)
        </button>
      )}
    </section>
  );
}
