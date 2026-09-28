/**
 * EvidenceSplit — the two statements a consistency finding compared.
 *
 * A cross-report conflict is not one span of text, it is a claim about the
 * distance between two. Stacking the two statements vertically makes the reader
 * scroll down, remember the first, scroll to the second, and diff them
 * mentally — which is the one thing a contradiction should not ask of anyone.
 * Putting them side by side makes the disagreement the thing you *see* rather
 * than the thing you reconstruct.
 *
 * Structure, not table, on purpose. These are two pieces of prose, and a table
 * would both misrepresent them as tabular data and force horizontal scrolling
 * in a narrow task pane. A `role="group"` with two labelled children reflows to
 * a single column instead, which is the same information in a 320px pane.
 *
 * The connector between the panes is decorative: the relationship is already
 * carried by the group's accessible name, so a screen reader is not made to
 * announce a glyph to learn what it already said.
 */

import React from "react";

export interface EvidenceSplitProps {
  /** The earlier statement. */
  left: string;
  /** The later statement. */
  right: string;
  /** Document section each statement came from, when the engine knew one. */
  sectionLeft: string;
  sectionRight: string;
  /** Grouped into one card, this is how many reports the pair produced. */
  readonly repeats?: number | undefined;
}

function Statement({
  text,
  section,
  side,
}: {
  text: string;
  section: string;
  side: "left" | "right";
}): React.ReactNode {
  return (
    <div className="tf-evidence-pane" data-side={side}>
      {/*
        The section is a label for the pane, not decoration: a reader deciding
        whether a conflict matters often needs to know which of two sections is
        the summary and which is the detail. An empty section says "(none)"
        rather than being hidden, so a missing section is visibly missing.
      */}
      <p className="tf-evidence-section">{section || "(no section)"}</p>
      <p className="tf-evidence-text">{text}</p>
    </div>
  );
}

export default function EvidenceSplit({
  left,
  right,
  sectionLeft,
  sectionRight,
  repeats = 0,
}: EvidenceSplitProps): React.ReactNode {
  return (
    <div
      className="tf-evidence-split"
      role="group"
      aria-label={`Compared statements${repeats > 0 ? `, reported ${repeats + 1} times` : ""}`}
    >
      <Statement text={left} section={sectionLeft} side="left" />
      <span className="tf-evidence-connector" aria-hidden="true">
        ⇄
      </span>
      <Statement text={right} section={sectionRight} side="right" />
    </div>
  );
}
