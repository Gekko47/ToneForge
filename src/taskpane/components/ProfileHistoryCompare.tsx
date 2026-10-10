import React from "react";
import { diffProfiles } from "../../style/versioning";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import { DiffCardList } from "./common/DiffCardList";

export interface ProfileHistoryCompareProps {
  left: StyleProfile;
  right: StyleProfile;
  leftLabel: string;
  rightLabel: string;
}

function render(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Side-by-side profile history comparison. Human-readable field changes are
 * always visible; the raw technical field diff sits behind progressive
 * disclosure so it never competes with the semantic summary.
 *
 * The comparison is a card list, not a table (plan §2.3/§33): a three-column
 * table in a 320px pane is one word per cell and scrolls sideways.
 */
export default function ProfileHistoryCompare({
  left,
  right,
  leftLabel,
  rightLabel,
}: ProfileHistoryCompareProps): React.ReactNode {
  const diff = diffProfiles(left, right);
  const changes = diff.changes;

  return (
    <section aria-label="Profile history comparison">
      <h3>Side-by-side comparison</h3>
      {changes.length === 0 ? (
        <p className="tf-sub">These versions are equivalent.</p>
      ) : (
        <DiffCardList
          caption={`${changes.length} field change(s) between ${leftLabel} and ${rightLabel}`}
          leftLabel={leftLabel}
          rightLabel={rightLabel}
          changes={changes.map((change) => ({
            field: change.field,
            from: render(change.from),
            to: render(change.to),
          }))}
        />
      )}
      <details>
        <summary>Technical field diff</summary>
        <pre>{JSON.stringify(changes, null, 2)}</pre>
      </details>
    </section>
  );
}
