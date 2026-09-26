/**
 * PendingChanges — displays before/after, risk, source rule,
 * Apply plus Reject, with actual result reporting after verification.
 */

import React, { useId, useState } from "react";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { Finding } from "../../core/domain/Finding";

export interface PendingChangesProps {
  plan: ChangePlan | null;
  findings: Finding[];
  onApply?: () => boolean | Promise<boolean>;
  onReject?: () => void;
  /**
   * Why the host cannot accept these changes, supplied by the parent workflow.
   *
   * Computed by the pure `applyReadiness` helper from the same facts the apply
   * gate checks, so a disabled button and a refusing gate cannot disagree. The
   * reason is rendered as the button's accessible description, because a control
   * the user cannot press must always say why.
   */
  applyDisabledReason?: string | null;
  /** Offered beside the reason when the blocker is resolved in Settings. */
  onOpenSettings?: () => void;
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
  onOpenSettings,
  coverage = null,
}: PendingChangesProps): React.ReactNode {
  const [result, setResult] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const localReadinessId = useId();
  const schemaBlocked = plan?.schemaVersion !== 2;
  const staleBlocked = plan?.stale === true;
  const conflictBlocked = (plan?.conflicts ?? []).length > 0;
  const approvalBlocked =
    plan?.changes.some(
      (change) => change.approvalRequired && change.approvalState !== "approved",
    ) ?? false;
  const preconditionBlocked =
    plan?.changes.some((change) => change.precondition === undefined) ?? false;
  const coverageBlocked = coverage !== null && coverage !== undefined && !coverage.complete;
  const localReadinessReason = schemaBlocked
    ? "This plan is not schema version 2; preview it again."
    : staleBlocked
      ? "This plan is stale; preview it again."
      : conflictBlocked
        ? "Unresolved conflicts block application; preview it again."
        : approvalBlocked
          ? "One or more changes require explicit approval."
          : preconditionBlocked
            ? "One or more changes lack an exact precondition."
            : coverageBlocked
              ? "Coverage is incomplete; apply is blocked."
              : null;
  const canApply =
    onApply !== undefined && applyDisabledReason === null && localReadinessReason === null;
  const describedBy = [
    localReadinessReason === null ? null : localReadinessId,
    applyDisabledReason === null ? null : "pending-apply-readiness",
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

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
        <div className="tf-conflict-list">
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
        <p id={localReadinessId} aria-live="polite" className="tf-sub">
          {localReadinessReason}
        </p>
      )}
      {applyDisabledReason !== null && (
        <div id="pending-apply-readiness" role="status" aria-live="polite" className="tf-sub">
          <p>{applyDisabledReason}</p>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          )}
        </div>
      )}
      {coverage && !coverage.complete && (
        <p role="status" aria-live="polite" className="tf-sub">
          Coverage is incomplete; this plan is advisory until the missing scope is understood.
          Unsupported: {(coverage.unsupported ?? []).join(", ") || "none reported"}. Unprocessed:{" "}
          {(coverage.unprocessed ?? []).join(", ") || "none reported"}.
        </p>
      )}

      {/*
        The table scrolls rather than squeezing. Five columns in a 320px pane
        left every cell one word wide; the scroll container keeps the columns
        readable and the caption plus `scope` keep it navigable.
      */}
      <div className="tf-pending-table-scroll">
        <table className="tf-pending-table">
          <caption className="sr-only">
            Proposed Word changes: before and after text, risk, originating rule, approval state,
            and precondition.
          </caption>
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">Risk</th>
              <th scope="col">Source</th>
              <th scope="col">Approval</th>
              <th scope="col">Precondition</th>
            </tr>
          </thead>
          <tbody>
            {plan.changes.map((change) => {
              const finding = findings.find((item) => item.id === change.findingId);
              const preconditionAvailable = change.precondition !== undefined;
              return (
                <tr key={change.id}>
                  <td>
                    <div>{change.type}</div>
                    <div>Before: {finding?.actual ?? "Unavailable (not supplied)"}</div>
                    <div>After: {finding?.expected ?? "Unavailable (not supplied)"}</div>
                  </td>
                  <td>{change.risk ?? "unavailable"}</td>
                  <td>{change.source ?? "unavailable"}</td>
                  <td>
                    {change.approvalState ?? "unavailable"}
                    {change.approvalRequired ? " (approval required)" : ""}
                  </td>
                  <td>{preconditionAvailable ? change.precondition?.kind : "Unavailable"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tf-pending-actions">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || !canApply}
          aria-describedby={canApply ? undefined : describedBy || undefined}
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
