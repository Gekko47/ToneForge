import React, { useState } from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import { isTrackedEditingEnabled, prepareReformatHost } from "../../reformat";
import { formatDiagnostics, probeOfficeRuntime } from "../../shared/office/diagnostics";
import { loadState } from "../../core/state/persistence";
import { isRemoteProviderConfigured } from "../settings/providerComposition";
import { diagnoseSituation, type TroubleshootingInput } from "../troubleshooting/checks";

/**
 * Re-exported for the surface that renders these, so a caller does not have to
 * know that the registry moved out of this component.
 */
export type { TroubleshootingNote } from "../troubleshooting/checks";

interface DebuggingPanelProps {
  onBack: () => void;
  coverage?: CoverageReport | null;
  /** Pending and reviewed counts, so the Apply blocker can be reported here too. */
  plannedCount?: number;
  reviewedCount?: number;
  /**
   * How much of the document the last Consistency Review actually compared.
   *
   * Passed in rather than derived here because the report belongs to the
   * Dashboard and is shared with the Deterministic Review findings list. Reading
   * it a second time in this panel would produce a second copy of a report the
   * user can already see on the other tab, and could disagree with it.
   */
  consistency?: {
    usedModel: boolean;
    complete: boolean;
    limitations: readonly string[];
  } | null;
  /**
   * Whether the Semantic tab is holding a paragraph to rewrite, `null` if it
   * has not been opened. Held by the Dashboard for the same reason.
   */
  semanticSelectionCaptured?: boolean | null;
}

/**
 * Read the current state once, in the shape the registry takes.
 *
 * Collected here rather than in the registry so `checks.ts` stays pure and can
 * be called from a surface that already holds this state — Apply and the
 * semantic rewrite both know their own blockers, and neither should have to
 * re-derive them to explain themselves.
 */
function currentInput(input: {
  trackedEditing: boolean;
  coverage: CoverageReport | null;
  plannedCount: number;
  reviewedCount: number;
  consistency: { usedModel: boolean; complete: boolean; limitations: readonly string[] } | null;
  semanticSelectionCaptured: boolean | null;
  contextMenuApi: boolean | null;
}): TroubleshootingInput {
  const state = loadState();
  return {
    autoScan: state.settings.autoScan,
    trackedEditing: input.trackedEditing,
    coverage: input.coverage,
    semanticProfileActive: state.activeSemanticProfileId !== null,
    providerConfigured: isRemoteProviderConfigured(state.settings, state.providerConnections),
    rawTextConsent: state.settings.semanticOptIn,
    plannedCount: input.plannedCount,
    reviewedCount: input.reviewedCount,
    consistency: input.consistency,
    semanticSelectionCaptured: input.semanticSelectionCaptured,
    contextMenuApi: input.contextMenuApi,
  };
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
  plannedCount = 0,
  reviewedCount = 0,
  consistency = null,
  semanticSelectionCaptured = null,
}: DebuggingPanelProps): React.ReactNode {
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof prepareReformatHost>
  > | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [trackedEditing, setTrackedEditing] = useState(isTrackedEditingEnabled);
  const [busy, setBusy] = useState(false);
  /*
   * Which diagnostic the user ran last, not which outputs happen to be on
   * screen. Both outputs persist side by side, so deciding the announcement
   * from "is there a probe result" named the wrong result the moment a second
   * action ran — running the runtime diagnosis after the probe announced the
   * probe, which is the opposite of what happened.
   */
  const [lastAction, setLastAction] = useState<"probe" | "diagnose" | null>(null);

  async function probeCapabilities(): Promise<void> {
    setBusy(true);
    setDiagnostics(null);
    try {
      setCapabilities(await prepareReformatHost());
      setLastAction("probe");
    } catch {
      setCapabilities(null);
      setLastAction("diagnose");
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

  const notes = diagnoseSituation(
    currentInput({
      trackedEditing,
      coverage,
      plannedCount,
      reviewedCount,
      consistency,
      semanticSelectionCaptured,
      // From this panel's own probe rather than passed in: the probe has not
      // run at this point in most sessions, and `null` is the honest answer —
      // "not yet established" rather than "the host does not have it".
      contextMenuApi: capabilities === null ? null : capabilities.supportsContextMenuApi,
    }),
  );

  return (
    <div className="tf-card" data-page="debugging">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Deterministic Review
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
          onClick={() => {
            setDiagnostics(formatDiagnostics(probeOfficeRuntime()));
            setLastAction("diagnose");
          }}
        >
          Diagnose Office runtime
        </button>
        {/*
          One live region, not one per output. Probing and then diagnosing
          leaves both blocks on screen, and two polite regions updating in one
          session read in DOM order rather than in the order they were run —
          the same defect ADR-0062 fixed on the Dashboard. The text therefore
          follows `lastAction`, so the announcement names the run that
          actually happened last.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {lastAction === "probe"
            ? "Capability probe finished. The result is below."
            : lastAction === "diagnose"
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

        The section is titled for the question, not for a control: this is the one
        place every surface's blockers are collected, so the user has somewhere
        to look that is not the surface refusing them. The title was "What to
        check", which named an action rather than the answer to the question.
      */}
      <section aria-label="Why something may not be working" className="tf-debug-section">
        <h2>Why something may not be working</h2>
        <p className="tf-sub">
          Everything the other pages would refuse to do, and the setting behind each one. Only
          situations that are true right now are listed.
        </p>
        {notes.length === 0 ? (
          /*
           * Enumerated rather than "nothing is wrong", because this registry
           * only sees what it is given and a run of unchecked situations reads
           * as a clean bill of health. Every situation below has a check above;
           * adding one here is the cost of a new input field.
           */
          <p className="tf-sub">
            Nothing is currently standing in the way: automatic scanning is on, tracked editing is
            enabled, a semantic profile is active, a provider is configured, sending your text to
            that provider is allowed, every finding waiting to be applied has been reviewed, the
            Semantic tab is holding a paragraph if one was wanted, any consistency review that has
            run compared everything it set out to compare, the host exposes the context-menu API,
            and any analysis that has run covered the whole document.
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
                {/*
                  The target, on its own labelled line. Folding it into the
                  remedy prose meant the one actionable part was indistinguishable
                  from the explanation around it.
                */}
                <p>
                  <span className="tf-sub">Change this: </span>
                  {note.remedyTarget.label}
                </p>
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
