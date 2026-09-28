import React, { useState } from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import { isTrackedEditingEnabled, prepareReformatHost } from "../../reformat";
import { formatDiagnostics, probeOfficeRuntime } from "../../shared/office/diagnostics";
import { loadState } from "../../core/state/persistence";

interface DebuggingPanelProps {
  onBack: () => void;
  coverage?: CoverageReport | null;
}

/** One situation the pane is actually in, with what to do about it. */
export interface TroubleshootingNote {
  id: string;
  situation: string;
  cause: string;
  remedy: string;
}

/**
 * The situations a user is most likely to be in, derived from current state.
 *
 * The panel used to answer "what does this host support" and nothing else, so a
 * user whose Apply was being refused had to already know that tracked editing
 * was the cause. This reads the same state the panes act on, so each note names
 * a reason the user can act on rather than a setting they have to go looking for.
 *
 * Only true situations are returned. Listing every possible symptom on a page
 * people arrive at *because something is wrong* would make the one line that
 * matters indistinguishable from the four that do not apply.
 */
export function diagnoseSituation(input: {
  autoScan: boolean;
  trackedEditing: boolean;
  coverage: CoverageReport | null;
}): TroubleshootingNote[] {
  const notes: TroubleshootingNote[] = [];
  if (input.autoScan === false) {
    notes.push({
      id: "auto-scan-off",
      situation: "Findings stop updating while I type",
      cause:
        "Automatic scanning is switched off in Settings. ToneForge is not watching the document for changes.",
      remedy:
        "Turn auto-scan back on in Settings, or press Re-scan now on Document Governance — the manual scan is not affected by this setting.",
    });
  }
  if (input.trackedEditing === false) {
    notes.push({
      id: "tracked-editing-off",
      situation: "Apply is refused, or the host banner says tracked changes are unavailable",
      cause:
        "Tracked editing is not enabled for this host. ToneForge will not write a change it cannot record as a reviewable Word revision.",
      remedy:
        "Enable tracked editing in Settings, where the host probe runs as part of the change.",
    });
  }
  if (input.coverage !== null && input.coverage.complete === false) {
    notes.push({
      id: "coverage-incomplete",
      situation: "There are fewer findings than I expected",
      cause:
        "Only part of this document could be checked. The findings shown are an unknown subset of the problems present, not a shorter list of them.",
      remedy:
        "Open Analysis coverage below for exactly which parts were skipped and why, and try again in a host that supports them.",
    });
  }
  return notes;
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

  const notes = diagnoseSituation({
    autoScan: loadState().settings.autoScan,
    trackedEditing,
    coverage,
  });

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
        {/*
          One live region, not one per output. Probing and then diagnosing
          leaves both blocks on screen, and two polite regions updating in one
          session read in DOM order rather than in the order they were run — the
          same defect ADR-0062 fixed on the Dashboard.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {capabilities
            ? "Capability probe finished. The result is below."
            : diagnostics
              ? "Office runtime diagnosis finished. The result is below."
              : ""}
        </p>
        {capabilities && (
          <pre className="tf-debug-output">{JSON.stringify(capabilities, null, 2)}</pre>
        )}
        {diagnostics && <pre className="tf-debug-output">{diagnostics}</pre>}
      </section>

      {/*
        What is actually wrong right now. Above this point the panel answers
        "what does this host support"; this answers "why is the pane not doing
        what I expect", which is the question a person arrives here with.
      */}
      <section aria-label="What to check" className="tf-debug-section">
        <h2>What to check</h2>
        {notes.length === 0 ? (
          <p className="tf-sub">
            Nothing is currently standing between this document and a scan: automatic scanning is
            on, tracked editing is enabled, and any analysis that has run covered the whole
            document.
          </p>
        ) : (
          <ul className="tf-troubleshooting-list">
            {notes.map((note) => (
              <li key={note.id}>
                <p>
                  <strong>{note.situation}</strong>
                </p>
                <p>{note.cause}</p>
                <p>{note.remedy}</p>
              </li>
            ))}
          </ul>
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
