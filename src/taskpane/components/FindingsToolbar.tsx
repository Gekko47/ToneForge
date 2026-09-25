import React from "react";

export interface FindingsToolbarProps {
  label: string;
  nextAction: string;
  total: number;
  selectedIndex: number | null;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * Task-first status and finding navigation for the findings section.
 *
 * Kept as its own component so the Dashboard JSX gains a single element
 * instead of another nested `{cond && ( ... )}` expression block.
 */
export default function FindingsToolbar({
  label,
  nextAction,
  total,
  selectedIndex,
  onPrevious,
  onNext,
}: FindingsToolbarProps): React.ReactNode {
  return (
    <>
      <p className="tf-sub" role="status">
        {label}. Next: {nextAction}.
      </p>
      {total > 0 && (
        <nav className="tf-finding-actions" aria-label="Finding navigation">
          <button type="button" onClick={onPrevious}>
            Previous finding
          </button>
          <button type="button" onClick={onNext}>
            Next finding
          </button>
          <span className="tf-sub" aria-live="polite">
            {selectedIndex === null
              ? "No finding selected"
              : `Finding ${selectedIndex + 1} of ${total}`}
          </span>
        </nav>
      )}
    </>
  );
}
