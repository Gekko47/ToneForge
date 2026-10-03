import { MessageBar, MessageBarType } from "@fluentui/react";
import React, { useId, useState } from "react";
import { toRevisionsCsv } from "../../changes/exportAdapter";
import type { Change } from "../../core/domain/Change";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import type { Finding } from "../../core/domain/Finding";

export interface ExportChangesButtonProps {
  changes: readonly Change[];
  findings: readonly Finding[];
  coverage: CoverageReport | null;
}

/**
 * Download the planned changes as CSV.
 *
 * This is the only place that touches `Blob`, `URL.createObjectURL`, or the DOM
 * to trigger a download. `toRevisionsCsv` stays a pure serialiser, which is not
 * merely tidiness: `changes/` may import only `core/domain` and `shared/utils`
 * (see eslint.config.mjs), so the browser APIs cannot live beside it.
 *
 * The object URL is revoked as soon as the click has been dispatched. Leaking one
 * per export pins the whole document's worth of change text in memory for the
 * lifetime of the pane.
 */
export default function ExportChangesButton({
  changes,
  findings,
  coverage,
}: ExportChangesButtonProps): React.ReactNode {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();
  // Coverage gates the export as hard as it gates Apply. A change list drawn
  // from a partial analysis is indistinguishable from a complete one once it is
  // a file on someone's disk.
  const blocked = coverage !== null && coverage.complete === false;
  const disabled = blocked || changes.length === 0;

  function download(): void {
    if (coverage === null) {
      setError("Export needs a recorded coverage report for this plan.");
      return;
    }
    try {
      const csv = toRevisionsCsv(changes, findings, coverage);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "toneforge-revisions.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked immediately after the click is dispatched, not after a timeout:
      // the download has already captured the blob by then.
      URL.revokeObjectURL(url);
      setError(null);
      setStatus(`Exported ${changes.length} change(s) as CSV.`);
    } catch (caught: unknown) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="tf-export">
      <button
        className="tf-native-button"
        type="button"
        onClick={download}
        disabled={disabled}
        aria-describedby={blocked ? statusId : undefined}
      >
        Export changes as CSV
      </button>
      {blocked && (
        <p id={statusId} className="tf-sub" role="status" aria-live="polite">
          Export is unavailable until analysis coverage is complete. Unsupported:{" "}
          {(coverage?.unsupported ?? []).join(", ") || "none reported"}. Unprocessed:{" "}
          {(coverage?.unprocessed ?? []).join(", ") || "none reported"}.
        </p>
      )}
      {status !== null && (
        <MessageBar messageBarType={MessageBarType.success} role="status" aria-live="polite">
          {status}
        </MessageBar>
      )}
      {error !== null && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {error}
        </MessageBar>
      )}
    </div>
  );
}
