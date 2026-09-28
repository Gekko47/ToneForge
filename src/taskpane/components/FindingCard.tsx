/**
 * FindingCard — one finding as a listbox option.
 *
 * The card is an `option` inside the findings listbox, so it carries
 * `aria-selected` and `aria-current` rather than inventing a second selection
 * vocabulary. `selected` is driven by the findings toolbar; before that existed
 * the toolbar advanced a counter with nothing on screen to match it.
 *
 * The body lives in `FindingDetail`, which the Consistency Review also renders.
 * This component is now only the landmark and the selection behaviour, and it
 * stays that thin: the moment a finding's presentation grows a second copy, the
 * two surfaces start disagreeing about what a finding looks like.
 */

import React, { useEffect, useRef } from "react";
import type { Finding } from "../../core/domain/Finding";
import FindingDetail from "./FindingDetail";

export interface FindingCardProps {
  finding: Finding;
  /** True when the findings toolbar currently points at this card. */
  selected?: boolean;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  /**
   * True when this finding has already been sent through the review gate.
   *
   * Passed in rather than read from `finding.status`, because the gate's verdict
   * is a decision the Dashboard makes and the card only renders.
   */
  reviewed?: boolean;
}

export default function FindingCard({
  finding,
  selected = false,
  onReview,
  onIgnore,
  reviewed = false,
}: FindingCardProps): React.ReactNode {
  const cardRef = useRef<HTMLElement | null>(null);

  /*
   * Scroll only when this card becomes the selected one.
   *
   * `scrollIntoView` is feature-detected because the add-in runs in an Office
   * WebView whose API surface is not guaranteed to match a browser's, and an
   * undefined method here would take down the whole findings list rather than
   * just this convenience.
   */
  useEffect(() => {
    if (!selected) return;
    const element = cardRef.current;
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <article
      ref={cardRef}
      role="option"
      aria-selected={selected}
      aria-current={selected ? "true" : undefined}
      aria-label={`Finding: ${finding.category}`}
      className={selected ? "tf-finding-card is-selected" : "tf-finding-card"}
    >
      <FindingDetail
        finding={finding}
        onReview={onReview}
        onIgnore={onIgnore}
        reviewed={reviewed}
      />
    </article>
  );
}
