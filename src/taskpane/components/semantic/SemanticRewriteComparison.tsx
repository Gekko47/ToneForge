import React from "react";

/**
 * The user's own words and the model's, side by side.
 *
 * Two paragraphs of someone's writing, and the decision is whether the second says
 * what they meant. That is a comparison a reader cannot hold in their head from a
 * before/after table, and it is why this is a two-column split rather than a
 * diff: the point is to read both, not to spot the edit.
 *
 * The original is the captured selection and the revision is the model's
 * replacement — neither is derived here, so what the user compares is exactly what
 * was captured and exactly what would be written.
 */
export interface SemanticRewriteComparisonProps {
  original: string;
  revised: string;
  /** True when the revision equals the original, which is worth saying plainly. */
  unchanged: boolean;
}

export default function SemanticRewriteComparison({
  original,
  revised,
  unchanged,
}: SemanticRewriteComparisonProps): React.ReactNode {
  return (
    <section aria-labelledby="tf-semantic-comparison" className="tf-card">
      <h2 id="tf-semantic-comparison">Your paragraph and the proposed revision</h2>
      {unchanged && (
        <p className="tf-sub">
          The model proposed no change to this text. Apply would write the same words back.
        </p>
      )}
      <div className="tf-evidence-split">
        <div>
          {/* No `tf-sub` on either: these are headings, and a body class
              rendered them at body size. */}
          <h3>Yours</h3>
          <p>{original}</p>
        </div>
        <div>
          <h3>Proposed</h3>
          <p>{revised}</p>
        </div>
      </div>
    </section>
  );
}
