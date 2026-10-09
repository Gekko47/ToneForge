import React from "react";
import type { SelectionScope } from "../../../word/selectionScope";
import type { SemanticGate } from "../../semantic/gates";

/**
 * What the pane knows about the user's selection, and the control that reads it.
 *
 * **This is the whole of §19's selection-aware surface.** The specification asks
 * for a card that shows the selected text and its word count with a Review button
 * beside it, that never sends text when the selection changes, and never runs a
 * review on its own. All three are structural here: nothing in this component
 * sends anything, the review button's handler belongs to the page, and the page
 * only calls the provider from an explicit click.
 *
 * The gate is passed in rather than computed here, because `taskpane/semantic/gates`
 * is the single source for it and a second decision inside a component is how the
 * button and the sentence beside it came to disagree in the old tab.
 */
export interface SemanticReviewScopeProps {
  scope: SelectionScope | null;
  /**
   * Whether the host fires selection events and the pane is following them.
   *
   * Stated rather than implied, because "the pane did not update when I clicked
   * elsewhere" is indistinguishable from a frozen pane unless the page says it is
   * listening.
   */
  tracking: boolean;
  /** Why nothing is held, when the read succeeded and found nothing. */
  emptyReason: string | null;
  /** Why a read is impossible on this host, which is a different sentence. */
  unavailableReason: string | null;
  /** True between a click and the review that follows it. */
  reviewing: boolean;
  /** The gate for the review button, and for reading a selection. */
  reviewGate: SemanticGate;
  readGate: SemanticGate;
  onReadSelection: () => void;
  onReview: () => void;
  onOpenSettings: () => void;
  onOpenSemanticStyle: () => void;
}

export default function SemanticReviewScope({
  scope,
  tracking,
  emptyReason,
  unavailableReason,
  reviewing,
  reviewGate,
  readGate,
  onReadSelection,
  onReview,
  onOpenSettings,
  onOpenSemanticStyle,
}: SemanticReviewScopeProps): React.ReactNode {
  return (
    <section aria-labelledby="tf-semantic-scope" className="tf-card">
      <h2 id="tf-semantic-scope">Selection</h2>

      {scope === null ? (
        <p className="tf-sub">
          {unavailableReason ?? emptyReason ?? "Select the paragraph or text you want reviewed."}
        </p>
      ) : (
        <>
          <blockquote className="tf-evidence-quote">
            <p>{scope.anchor.selectedText}</p>
          </blockquote>
          <p className="tf-sub">
            {scope.wordCount} {scope.wordCount === 1 ? "word" : "words"}
            {/*
              Which text this is, because a caret review is a judgement made for
              the user. They clicked once to place the cursor and ToneForge chose
              the paragraph; saying "48 words" alone would let them believe they
              had selected it.
            */}
            {scope.source === "caret-paragraph" &&
              " · the paragraph the cursor is in, not a selection you made"}
            {/*
              How far the anchor could be verified, stated rather than implied.

              A host that names its paragraphs gives a target that can be re-found
              by identity; one that does not leaves offsets plus the captured text,
              which is still safe — the adapter compares that text against the live
              document before writing — but is a weaker claim and Troubleshooting
              reports it as unverified.
            */}
            {scope.verification === "offsets-and-text" &&
              " · this host did not name the paragraph, so the target is held by its text"}
            {scope.coversWholeParagraph && " · whole paragraph"}
          </p>
        </>
      )}

      <div className="tf-actions">
        <button
          className="tf-native-button"
          type="button"
          onClick={onReadSelection}
          disabled={!readGate.allowed}
        >
          Use current selection
        </button>
        <button
          className="tf-native-button"
          type="button"
          onClick={onReview}
          disabled={!reviewGate.allowed || reviewing}
        >
          {reviewing ? "Reviewing…" : "Review selection"}
        </button>
      </div>

      <p className="tf-sub" data-testid="tf-semantic-tracking">
        {tracking
          ? "This pane follows the cursor. Click into any paragraph and it is read here."
          : "This Word build does not report cursor movement, so press Use current selection to read it."}
      </p>

      {/*
        The blocker, beside the control it explains.

        Rendered only when something is actually blocked, and never in a live
        region: it is present on mount, and a region that speaks the pane's opening
        state before the user has done anything is noise (ADR-0062).
      */}
      {!reviewGate.allowed && reviewGate.blocker !== null && (
        <p className="tf-debug-warning">
          {reviewGate.blocker}
          {reviewGate.remedy?.destination === "llm-settings" && (
            <>
              {" "}
              <button className="tf-native-button" type="button" onClick={onOpenSettings}>
                {reviewGate.remedy.label}
              </button>
            </>
          )}
          {reviewGate.remedy?.destination === "semantic-style" && (
            <>
              {" "}
              <button className="tf-native-button" type="button" onClick={onOpenSemanticStyle}>
                {reviewGate.remedy.label}
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
