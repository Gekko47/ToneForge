import React, { useState } from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import { isTrackedEditingEnabled, prepareReformatHost } from "../../reformat";
import { formatDiagnostics, probeOfficeRuntime } from "../../shared/office/diagnostics";

interface DebuggingPanelProps {
  onBack: () => void;
  coverage?: CoverageReport | null;
}

/**
 * Technical troubleshooting surface, intentionally separate from the normal workflow.
 *
 * This panel inspects; it does not configure. The tracked-editing control used to
 * live here, which put an ordinary user decision behind a diagnostics page and —
 * because its enable path never persisted the flag before probing — made the
 * toggle impossible to arm. It is now a Settings section; this panel reports the
 * current armed state so the two surfaces cannot disagree.
 */
export default function DebuggingPanel({
  onBack,
  coverage = null,
}: DebuggingPanelProps): React.ReactNode {
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof prepareReformatHost>
  > | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [trackedEditing, setTrackedEditing] = useState(isTrackedEditingEnabled);
  const [busy, setBusy] = useState(false);

  async function probeCapabilities(): Promise<void> {
    setBusy(true);
    setDiagnostics(null);
    try {
      setCapabilities(await prepareReformatHost());
    } catch {
      setCapabilities(null);
      setDiagnostics(
        "Capability probe did not complete. Confirm the add-in is running inside a supported Word host.",
      );
    } finally {
      // Re-read rather than assuming: the flag may have changed on the Settings
      // page, and a diagnostics panel that reports a stale value is worse than
      // one that reports none.
      setTrackedEditing(isTrackedEditingEnabled());
      setBusy(false);
    }
  }

  return (
    <div className="tf-card" data-page="debugging">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Document Governance
        </button>
      </nav>
      <h1 className="tf-title">Troubleshooting & diagnostics</h1>
      <p className="tf-sub">
        Technical inspection for the current Word host. These checks are not required for normal
        document governance and do not change the document.
      </p>
      <section aria-label="Host inspection" className="tf-debug-section">
        <h2>Host inspection</h2>
        <button type="button" onClick={() => void probeCapabilities()} disabled={busy}>
          {busy ? "Probing capabilities…" : "Probe Word capabilities"}
        </button>
        <button
          type="button"
          onClick={() => setDiagnostics(formatDiagnostics(probeOfficeRuntime()))}
        >
          Diagnose Office runtime
        </button>
        {capabilities && (
          <pre className="tf-debug-output" aria-live="polite">
            {JSON.stringify(capabilities, null, 2)}
          </pre>
        )}
        {diagnostics && (
          <pre className="tf-debug-output" aria-live="polite">
            {diagnostics}
          </pre>
        )}
      </section>
      <section aria-label="Analysis coverage diagnostics" className="tf-debug-section">
        <h2>Analysis coverage diagnostics</h2>
        {coverage ? (
          <pre className="tf-debug-output" aria-live="polite">
            {JSON.stringify(
              {
                complete: coverage.complete,
                processedCharacterCount: coverage.processedCharacterCount,
                examinedNodeCount: coverage.examinedNodeIds.length,
                unsupported: coverage.unsupported,
                unprocessed: coverage.unprocessed,
                excluded: coverage.excluded,
                acquisition: coverage.acquisition ?? null,
              },
              null,
              2,
            )}
          </pre>
        ) : (
          <p className="tf-sub">No analysis coverage has been recorded in this session.</p>
        )}
      </section>
      <section aria-label="Mutation readiness" className="tf-debug-section">
        <h2>Mutation readiness</h2>
        <p>
          Tracked editing is currently <strong>{trackedEditing ? "enabled" : "disabled"}</strong>.
          Change it in Settings, where the host probe runs as part of the change.
        </p>
        <p>
          Apply performs a fresh host probe and checks every operation in the plan. Track Changes
          can never be bypassed.
        </p>
      </section>
    </div>
  );
}
