import React, { useState } from "react";
import { Toggle } from "@fluentui/react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import {
  isTrackedEditingEnabled,
  prepareReformatHost,
  prepareTrackedEditing,
  setTrackedEditingEnabled,
} from "../../reformat";
import { formatDiagnostics, probeOfficeRuntime } from "../../shared/office/diagnostics";

interface DebuggingPanelProps {
  onBack: () => void;
  coverage?: CoverageReport | null;
}

/** Technical troubleshooting surface, intentionally separate from the normal workflow. */
export default function DebuggingPanel({
  onBack,
  coverage = null,
}: DebuggingPanelProps): React.ReactNode {
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof prepareReformatHost>
  > | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [editingEnabled, setEditingEnabled] = useState(isTrackedEditingEnabled);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
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
      setBusy(false);
    }
  }

  async function changeEditingEnabled(_event: unknown, checked: boolean): Promise<void> {
    setEditingEnabled(checked);
    setEditingMessage(null);
    if (!checked) {
      setTrackedEditingEnabled(false);
      setCapabilities(null);
      setEditingMessage(
        "Tracked editing is disabled. Preview remains available, but Apply is blocked.",
      );
      return;
    }

    setBusy(true);
    try {
      const preparation = await prepareTrackedEditing([]);
      setCapabilities(preparation.capabilities);
      if (preparation.error) {
        setTrackedEditingEnabled(false);
        setEditingEnabled(false);
        setEditingMessage(preparation.error);
      } else {
        setEditingMessage(
          "Tracked editing is enabled and the Word host passed its capability probe.",
        );
      }
    } catch {
      setTrackedEditingEnabled(false);
      setEditingEnabled(false);
      setEditingMessage(
        "Tracked editing could not be prepared. Review host diagnostics and retry.",
      );
    } finally {
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
        <Toggle
          label="Enable tracked editing"
          checked={editingEnabled}
          disabled={busy}
          onChange={(_event, checked) => void changeEditingEnabled(_event, checked ?? false)}
          onText="Enabled"
          offText="Disabled"
        />
        <p>
          Apply automatically performs a fresh host probe and checks every operation in the plan.
          Turning this off immediately disarms mutation while keeping preview and review available.
          Track Changes can never be bypassed.
        </p>
        {editingMessage && (
          <p className={editingEnabled ? "tf-debug-warning" : "tf-sub"} role="status">
            {editingMessage}
          </p>
        )}
      </section>
    </div>
  );
}
