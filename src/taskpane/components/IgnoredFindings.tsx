/**
 * The ignore list, at the bottom of Deterministic Review.
 *
 * A finding the user set aside has not been resolved, only stopped being
 * shown. Hiding that list made the ignore action irreversible from the UI and
 * left the summary quietly counting a document as clean when it was not, so
 * the list is permanent, not a transient toast, and every row can be restored.
 *
 * Collapsible like its siblings, and collapsed when empty. It renders nothing
 * at all in that case rather than an empty header: a section that is always
 * present and always empty is the same noise this list was built to remove.
 *
 * The entries are stored, not recomputed: after a rescan the finding that was
 * ignored may not reappear at all (it was fixed, or it moved out of the
 * examined scope), and an ignore list rebuilt from the current findings would
 * silently drop those. Persisting what was ignored, keyed by fingerprint, is
 * what makes the action survive a scan that did not re-derive it.
 */

import React from "react";
import type { IgnoredFinding } from "../../core/domain/Finding";

export interface IgnoredFindingsProps {
  entries: readonly IgnoredFinding[];
  /**
   * Restore one occurrence, by its occurrence key.
   *
   * Not the fingerprint. A fingerprint identifies a *rule*, so restoring by it
   * removed every ignored row of that rule at once — the button said "Restore"
   * and the list lost entries the user never asked about. Two hits of one rule
   * are two rows, and each restores itself.
   */
  onRestore: (occurrence: string) => void;
}

function ignoredAtLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "an unknown time";
  return parsed.toISOString().replace("T", " ").slice(0, 16);
}

export default function IgnoredFindings({
  entries,
  onRestore,
}: IgnoredFindingsProps): React.ReactNode {
  // Rows are keyed on the occurrence, not the fingerprint: two ignored rows of
  // the same rule share a fingerprint, and a React key collision there means one
  // row silently replaces the other in the DOM.
  const rows = entries.map((entry) => ({
    entry,
    occurrence: entry.occurrenceKey.length > 0 ? entry.occurrenceKey : entry.fingerprint,
  }));
  const [open, setOpen] = React.useState(false);
  if (entries.length === 0) return null;

  return (
    <section className="tf-collapsible" aria-label="Ignored findings section">
      <button
        type="button"
        className="tf-native-button tf-collapsible-header"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
      >
        Ignored findings <span>{entries.length}</span>
      </button>
      {open && (
        <>
          {/*
            Says "set aside", not "fixed", and says they keep being detected.
            Without that, the count reads as a claim that the problem is gone.
          */}
          <p className="tf-sub">
            These findings were set aside, not fixed. They are excluded from the open count and will
            keep being re-detected until the underlying text changes.
          </p>
          <ul>
            {rows.map(({ entry, occurrence }) => (
              <li key={occurrence} className="tf-published-item">
                <div>
                  <strong>{entry.message}</strong>
                </div>
                <div className="tf-sub">{entry.category}</div>
                <div className="tf-sub">Ignored {ignoredAtLabel(entry.ignoredAt)}</div>
                <button
                  className="tf-native-button"
                  type="button"
                  onClick={() => onRestore(occurrence)}
                >
                  Restore
                  <span className="sr-only"> {entry.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
