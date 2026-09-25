import React from "react";
import { diffProfiles } from "../../style/versioning";
import type { StyleProfile } from "../../core/domain/StyleProfile";

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
        <table>
          <caption className="tf-sub">
            {changes.length} field change(s) between {leftLabel} and {rightLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">{leftLabel}</th>
              <th scope="col">{rightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.field}>
                <th scope="row">{change.field}</th>
                <td>{render(change.from)}</td>
                <td>{render(change.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary>Technical field diff</summary>
        <pre>{JSON.stringify(changes, null, 2)}</pre>
      </details>
    </section>
  );
}
