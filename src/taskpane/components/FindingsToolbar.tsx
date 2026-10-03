import React from "react";

export interface FindingsToolbarProps {
  label: string;
  nextAction: string;
  total: number;
  selectedIndex: number | null;
  /** Id of the rendered findings list, so the controls point at what they move. */
  listId?: string;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * Task-first status and finding navigation for the findings section.
 *
 * The position is named in each button's accessible name, not only in the
 * adjacent live region: a screen-reader user tabbing the controls hears where
 * they are and where they will land without having to navigate away to the
 * status text and back.
 */
export default function FindingsToolbar({
  label,
  nextAction,
  total,
  selectedIndex,
  listId,
  onPrevious,
  onNext,
}: FindingsToolbarProps): React.ReactNode {
  const current = selectedIndex === null ? 0 : selectedIndex + 1;
  const controls = listId === undefined ? undefined : { "aria-controls": listId };

  return (
    <>
      <p className="tf-sub" role="status">
        {label}. Next: {nextAction}.
      </p>
      {total > 0 && (
        <nav className="tf-finding-actions" aria-label="Finding navigation">
          <button
            className="tf-native-button"
            type="button"
            onClick={onPrevious}
            aria-label={`Previous finding, at ${current} of ${total}`}
            {...controls}
          >
            Previous finding
          </button>
          <button
            className="tf-native-button"
            type="button"
            onClick={onNext}
            aria-label={`Next finding, at ${current} of ${total}`}
            {...controls}
          >
            Next finding
          </button>
          <span className="tf-sub" aria-live="polite">
            {selectedIndex === null ? "No finding selected" : `Finding ${current} of ${total}`}
          </span>
        </nav>
      )}
    </>
  );
}
