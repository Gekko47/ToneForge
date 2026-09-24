/**
 * PendingChanges — displays before/after, risk, source rule,
 * Apply plus Reject, with actual result reporting after verification.
 */

import React, { useState } from "react";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { Finding } from "../../core/domain/Finding";

export interface PendingChangesProps {
  plan: ChangePlan | null;
  findings: Finding[];
  onApply?: () => boolean | Promise<boolean>;
  onReject?: () => void;
}

export default function PendingChanges({
  plan,
  findings,
  onApply,
  onReject,
}: PendingChangesProps): React.ReactNode {
  const [result, setResult] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const canApply = onApply !== undefined;

  async function handleApply(): Promise<void> {
    setApplying(true);
    setResult(null);
    try {
      const applied = await onApply?.();
      setResult(
        applied ? "Changes applied and verified." : "Apply was refused; no success was reported.",
      );
    } catch (err) {
      setResult(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  }

  function handleReject(): void {
    setResult("Changes rejected.");
    onReject?.();
  }

  if (!plan || plan.changes.length === 0) {
    return (
      <section aria-label="Pending changes">
        <h3>Pending Changes</h3>
        <p>No pending changes to review.</p>
      </section>
    );
  }

  return (
    <section aria-label="Pending changes" style={{ marginTop: "1rem" }}>
      <h3>Pending Changes ({plan.changes.length})</h3>

      {plan.conflicts.length > 0 && (
        <div style={{ color: "#a4262c", marginBottom: "0.5rem" }}>
          <p>{plan.conflicts.length} conflict(s) require review before applying.</p>
          <ul aria-live="polite">
            {plan.conflicts.map((conflict, index) => {
              const message = typeof conflict === "string" ? conflict : conflict.message;
              return <li key={index}>{message}</li>;
            })}
          </ul>
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Change
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Risk
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.changes.map((change) => (
            <tr key={change.id}>
              <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                <div>{change.type}</div>
                {findings
                  .filter((finding) => finding.id === change.findingId)
                  .map((finding) => (
                    <div key={finding.id} style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                      <div>Before: {finding.actual ?? "(not supplied)"}</div>
                      <div>After: {finding.expected ?? "(not supplied)"}</div>
                    </div>
                  ))}
              </td>
              <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{change.risk}</td>
              <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{change.source}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={handleApply} disabled={applying || !canApply}>
          {applying ? "Applying…" : canApply ? "Apply" : "Apply unavailable"}
        </button>
        <button type="button" onClick={handleReject} disabled={applying}>
          Reject
        </button>
      </div>

      {result && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }} aria-live="polite">
          {result}
        </p>
      )}
    </section>
  );
}
