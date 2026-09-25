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
  /** Optional current host-readiness state supplied by the parent workflow. */
  applyDisabledReason?: string | null;
  coverage?: {
    complete: boolean;
    unsupported?: readonly string[];
    unprocessed?: readonly string[];
  } | null;
}

export default function PendingChanges({
  plan,
  findings,
  onApply,
  onReject,
  applyDisabledReason = null,
  coverage = null,
}: PendingChangesProps): React.ReactNode {
  const [result, setResult] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const schemaBlocked = plan?.schemaVersion !== 2;
  const approvalBlocked =
    plan?.changes.some(
      (change) => change.approvalRequired && change.approvalState !== "approved",
    ) ?? false;
  const preconditionBlocked =
    plan?.changes.some((change) => change.precondition === undefined) ?? false;
  const coverageBlocked = coverage !== null && coverage !== undefined && !coverage.complete;
  const localReadinessReason = schemaBlocked
    ? "This plan is not schema version 2; preview it again."
    : approvalBlocked
      ? "One or more changes require explicit approval."
      : preconditionBlocked
        ? "One or more changes lack an exact precondition."
        : coverageBlocked
          ? "Coverage is incomplete; apply is blocked."
          : null;
  const canApply =
    onApply !== undefined && applyDisabledReason === null && localReadinessReason === null;

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

      {(plan.conflicts ?? []).length > 0 && (
        <div style={{ color: "#a4262c", marginBottom: "0.5rem" }}>
          <p>{(plan.conflicts ?? []).length} conflict(s) block application.</p>
          <ul aria-live="polite">
            {(plan.conflicts ?? []).map((conflict, index) => {
              const message = typeof conflict === "string" ? conflict : conflict.message;
              return <li key={index}>{message}</li>;
            })}
          </ul>
        </div>
      )}
      {localReadinessReason !== null && (
        <p aria-live="polite" className="tf-sub">
          {localReadinessReason}
        </p>
      )}
      {applyDisabledReason !== null && (
        <p id="pending-apply-readiness" role="status" aria-live="polite" className="tf-sub">
          {applyDisabledReason}
        </p>
      )}
      {coverage && !coverage.complete && (
        <p role="status" aria-live="polite" className="tf-sub">
          Coverage is incomplete; this plan is advisory until the missing scope is understood.
          Unsupported: {(coverage.unsupported ?? []).join(", ") || "none reported"}. Unprocessed:{" "}
          {(coverage.unprocessed ?? []).join(", ") || "none reported"}.
        </p>
      )}

      <table
        aria-label="Pending change previews"
        style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}
      >
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
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Approval
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Precondition
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.changes.map((change) => {
            const finding = findings.find((item) => item.id === change.findingId);
            const preconditionAvailable = change.precondition !== undefined;
            return (
              <tr key={change.id}>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                  <div>{change.type}</div>
                  <div>Before: {finding?.actual ?? "Unavailable (not supplied)"}</div>
                  <div>After: {finding?.expected ?? "Unavailable (not supplied)"}</div>
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                  {change.risk ?? "unavailable"}
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                  {change.source ?? "unavailable"}
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                  {change.approvalState ?? "unavailable"}
                  {change.approvalRequired ? " (approval required)" : ""}
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>
                  {preconditionAvailable ? change.precondition?.kind : "Unavailable"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || !canApply}
          aria-describedby={canApply ? undefined : "pending-apply-readiness"}
        >
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
