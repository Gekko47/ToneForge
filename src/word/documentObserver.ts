/**
 * Document observer v1 — watches for Word document changes and runs
 * a full deterministic rule check on the whole document.
 *
 * Boundary rule: word/ may import from shared/office, core/domain,
 * shared/utils, rules, formatting, and analysis. Never imports ai or ui.
 * Never mutates Word directly.
 */

import { debounce } from "../shared/utils/debounce";
import { describeError, logger } from "../shared/utils/logger";
import { createRunId } from "../analysis/incrementalCoordinator";
import { runDeterministicReview } from "../analysis/deterministic/deterministicReviewEngine";
import { buildCoverage } from "../analysis/coverage";
import { acquireAnalysisContext } from "./analysisAcquisition";
import type { AnalysisCapabilities } from "../analysis/analysisContext";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import { type CoverageReport } from "../core/domain/DocumentSnapshot";
import type {
  DeterministicCoverage,
  DeterministicFindingGroup,
} from "../analysis/deterministic/contracts";
import { type StyleProfile } from "../core/domain/StyleProfile";
import { type Finding } from "../core/domain/Finding";
import type { ReviewSessionIdentity } from "../core/domain/ReviewSession";

export type DocumentScanPhase =
  "notStarted" | "scanning" | "fresh" | "clean" | "stale" | "incomplete" | "failed";

export interface DocumentObserverStatus {
  phase: DocumentScanPhase;
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  /**
   * True when the last failure was the host going away, not the document moving.
   *
   * These are different facts with different remedies — waiting for Word versus
   * re-scanning — and reporting a host outage as stale findings told the user to
   * re-scan a document that had not changed (ADR-0058).
   */
  hostUnavailable: boolean;
  findings: Finding[];
  /**
   * The occurrence groups this same run produced, for the batch controls.
   *
   * From *this* run, not from the preview's report. The two runs issue separate
   * uuids for the same problem, so a group joined to the other run's findings
   * names occurrences that do not exist in the list beside it — the same
   * id-to-id join the review gate already had to be repaired for. Since these
   * findings and these groups come out of one `runDeterministicReview` call,
   * `group.occurrenceIds` addresses `findings` exactly.
   */
  groups: DeterministicFindingGroup[];
  /**
   * The shared coverage report, for the diagnostics the coverage banner and
   * the Troubleshooting panel read.
   *
   * Kept alongside `deterministicCoverage` rather than replaced by it: the
   * shared report carries the per-node-type counts and the acquisition
   * diagnostics, and the deterministic projection carries the requested-versus-
   * -examined distinction spec §9 needs. Collapsing them would lose one or the
   * other, and the two are read by different surfaces for different questions.
   */
  coverage: CoverageReport | null;
  /** The deterministic review's own account of what it did and did not check. */
  deterministicCoverage: DeterministicCoverage | null;
  /** Identity that approvals for the accepted deterministic report bind to. */
  reviewSessionIdentity: ReviewSessionIdentity | null;
  currentRunId: string | null;
  lastAcceptedRunId: string | null;
  documentVersion: string;
  supersededRuns: number;
  error: string | null;
}

export type DocumentObserverCallback = (status: DocumentObserverStatus) => void;

export interface DocumentObserverOptions {
  debounceMs?: number;
  onStatus?: DocumentObserverCallback;
  profile: StyleProfile;
  policy?: GovernanceProfile;
  capabilities?: AnalysisCapabilities;
}

interface ObserverState {
  running: boolean;
  documentVersion: string;
  runId: string | null;
  lastAcceptedRunId: string | null;
  scanInFlight: boolean;
  scanScheduled: boolean;
  replacementPending: boolean;
  supersededRuns: number;
  phase: DocumentScanPhase;
  findings: Finding[];
  groups: DeterministicFindingGroup[];
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  coverage: CoverageReport | null;
  deterministicCoverage: DeterministicCoverage | null;
  reviewSessionIdentity: ReviewSessionIdentity | null;
  error: string | null;
  hostUnavailable: boolean;
  debouncedScan: (() => void) | null;
  /** The registered selection handler, kept so it can be removed by reference. */
  eventHandler: (() => void) | null;
}

/**
 * How long the pane waits after the last change before it re-reads the document.
 *
 * 300ms was far too short for the work that follows. A re-scan re-reads the whole
 * body and rebuilds a plan from it, so firing three hundred milliseconds into a
 * sentence means re-reading the document several times while one is still being
 * typed — and showing the user a findings list that is replaced again a moment
 * later. A second is long enough to mean "they have stopped", and short enough
 * that the list still feels live while someone works.
 */
const DEFAULT_DEBOUNCE_MS = 1200;

/**
 * Create a document observer that rescans on a debounced document change.
 *
 * The change payload is optional and its absence is the safe case: a full
 * rescan. When the host reports a paragraph event with complete local ids, only
 * those nodes are examined — but *only* the changed nodes, with nothing retained
 * from the previous run.
 *
 * That last part is the whole design. Retaining findings for nodes this run did
 * not re-derive would mean presenting ranges and text that the edit may have
 * moved: growing one paragraph shifts every character offset after it, so a
 * retained finding in an unedited paragraph can point at the wrong sentence
 * while looking entirely normal. A partial scan that reports a partial scope is
 * fast and correct; a partial scan that retains is fast and quietly wrong.
 */
export function createDocumentObserver(options: DocumentObserverOptions): {
  startObserver: () => void;
  stopObserver: () => void;
  onDocumentChanged: (immediate?: boolean) => void;
} {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, onStatus, profile } = options;
  const capabilities = options.capabilities ?? {
    supportsInsertText: false,
    supportsReplaceText: false,
    supportsInsertParagraph: false,
    supportsInsertBreak: false,
    supportsStyles: false,
    supportsParagraphFormat: false,
    supportsCharacterFormat: false,
    supportsResetCharacterFormatting: false,
    supportsListLevel: false,
    supportsRevisions: false,
    supportsSelection: false,
    supportsRangedReplacement: false,
    supportsParagraphResolution: false,
    supportsHighlight: false,
    supportsContextMenuApi: false,
    supportsTables: false,
    supportsHeadersFooters: false,
    supportsSections: false,
    hostName: "unknown" as const,
    hostVersion: null,
  };
  const state: ObserverState = {
    running: false,
    documentVersion: "",
    runId: null,
    lastAcceptedRunId: null,
    scanInFlight: false,
    scanScheduled: false,
    replacementPending: false,
    supersededRuns: 0,
    phase: "notStarted",
    findings: [],
    groups: [],
    lastScan: null,
    dirtyCount: 0,
    stale: false,
    hostUnavailable: false,
    coverage: null,
    deterministicCoverage: null,
    reviewSessionIdentity: null,
    error: null,
    debouncedScan: null,
    eventHandler: null,
  };

  const debouncedScan = debounce(() => {
    performScan().catch((err: unknown) => {
      logger.warn("Document observer scan failed", describeError(err));
    });
  }, debounceMs);

  state.debouncedScan = debouncedScan;

  /** Perform the actual scan: get snapshot, find dirty nodes, run rules. */
  async function performScan(): Promise<void> {
    if (!state.running || !state.runId) return;

    const runId = state.runId;
    state.scanScheduled = false;
    state.scanInFlight = true;
    state.replacementPending = false;
    const wasStale = state.phase === "stale";
    state.phase = "scanning";
    state.stale = wasStale;
    state.error = null;
    emitStatus();

    const isCurrent = (): boolean => state.runId === runId && state.running;
    const isObsolete = (): boolean => {
      if (isCurrent()) return false;
      state.supersededRuns += 1;
      logger.info("Superseded document scan result discarded", { runId });
      return true;
    };

    try {
      // Acquire one immutable scope. The full document is always read; the scope
      // only decides which of those nodes are *examined* this run.
      const full = await acquireAnalysisContext({
        profile,
        capabilities,
        ...(options.policy ? { policy: options.policy } : {}),
      });
      if (isObsolete()) return;

      const report = await runDeterministicReview({ context: full });
      if (isObsolete()) return;

      /*
       * The scan has now read the document, so its content hash is the version
       * the pane keys its preview on. Without this, `documentVersion` stayed the
       * constant set when the scan was scheduled, `decidePreview` saw the same
       * hash on every scan, and the plan was built once and never rebuilt until
       * a manual Re-scan cleared the recorded hash — which is why the pane only
       * updated on manual scans and add-in loads.
       */
      state.documentVersion = report.documentIdentity.contentHash;

      const coverage = buildCoverage({
        nodes: full.nodes,
        text: full.text,
        acquisition: full.acquisition,
      });
      state.findings = report.findings;
      /*
       * Groups travel with the findings they were computed from.
       *
       * The engine already builds them; dropping them here is what left the whole
       * batch-approval module unreachable (ND-7) and `report.groups` read by
       * nothing (ND-9). Holding a group from a *previous* run would be worse than
       * holding none — its occurrence ids would name text that has moved — so this
       * is replaced on every accepted scan alongside the findings themselves.
       */
      state.groups = report.groups;
      state.coverage = coverage;
      state.deterministicCoverage = report.coverage;
      state.reviewSessionIdentity = {
        documentId: report.documentIdentity.documentId,
        documentVersion: report.documentIdentity.documentVersion,
        contentHash: report.documentIdentity.contentHash,
        structuralHash: report.documentIdentity.structuralHash,
        profileId: report.profileId,
        profileRevision: report.profileRevision,
        governancePolicyRevision: full.policy.version,
        coverageFingerprint: report.coverage.coverageFingerprint,
      };
      state.lastScan = new Date().toISOString();
      state.lastAcceptedRunId = runId;
      state.dirtyCount = full.nodes.length;
      state.stale = false;
      // A successful scan clears an earlier host outage: the two are not
      // concurrent, and leaving the outage set would keep reporting a host that
      // is demonstrably answering again.
      state.hostUnavailable = false;
      state.error = null;
      state.phase =
        coverage?.complete === false
          ? "incomplete"
          : report.findings.length === 0
            ? "clean"
            : "fresh";
      emitStatus();
    } catch (err) {
      if (!isCurrent()) return;
      // A host rejection after the text-only retry means the runtime itself is
      // gone, not that the document is unreadable. Those two are reported
      // separately now: the document did not change, so claiming stale findings
      // sent the user to re-scan a document that had not moved.
      const detail = describeError(err);
      logger.warn("Document observer scan failed during processing", detail);
      if (err instanceof Error && err.message.includes("Office")) {
        logger.warn("Office unavailable during document scan", detail);
        state.phase = "failed";
        state.stale = false;
        state.hostUnavailable = true;
        state.error = "Office is unavailable. Scan again when Word is ready.";
        emitStatus();
        return;
      }
      // The genuine stale case: a refresh over a document that already had
      // findings accepted did not happen. Before anything has been accepted
      // there is nothing to be stale *relative to* — the first scan simply
      // failed — and reporting it as "stale" pointed the user at a re-scan
      // while the empty result looked like a clean document.
      const hasAcceptedFindings = state.lastAcceptedRunId !== null;
      state.phase = hasAcceptedFindings ? "stale" : "failed";
      state.stale = hasAcceptedFindings;
      state.hostUnavailable = false;
      state.error = err instanceof Error ? err.message : String(err);
      emitStatus();
    } finally {
      if (state.runId === runId) state.scanInFlight = false;
    }
  }

  /** Emit the current status to the callback. */
  function emitStatus(): void {
    if (onStatus) {
      onStatus({
        phase: state.phase,
        lastScan: state.lastScan,
        dirtyCount: state.dirtyCount,
        stale:
          state.phase === "stale"
            ? true
            : state.phase === "fresh" || state.phase === "clean"
              ? false
              : state.stale,
        findings: state.findings,
        groups: state.groups,
        coverage: state.coverage,
        deterministicCoverage: state.deterministicCoverage,
        reviewSessionIdentity: state.reviewSessionIdentity,
        currentRunId: state.runId,
        lastAcceptedRunId: state.lastAcceptedRunId,
        documentVersion: state.documentVersion,
        supersededRuns: state.supersededRuns,
        hostUnavailable: state.hostUnavailable,
        error: state.error,
      });
    }
  }

  /**
   * Schedule a scan, replacing an obsolete run only once per debounce burst.
   *
   * The findings are *not* marked stale here. They used to be, on the first
   * change event, which meant "Findings are stale" appeared the instant a
   * keystroke landed and vanished a fraction of a second later when the scan
   * caught up — a flash on every character. It is a true statement at the wrong
   * moment: a refresh is already scheduled and is about to answer it.
   *
   * Stale now means what a user would act on — the document changed and the
   * refresh did not happen, or the last one failed. That is set where it is
   * earned, in the failure path, and nowhere else.
   */
  function scheduleScan(immediate = false): void {
    if (!state.running) return;
    /*
     * An immediate scan is for a programmatic write, which fires no selection
     * event, so the debounce that coalesces keystrokes only delays the refreshed
     * findings the user is waiting on. It never overlaps a read already running
     * or pending — those coalesce through the debounce as usual.
     */
    const runNow = immediate && !state.scanInFlight && !state.scanScheduled;
    if (state.scanInFlight && state.replacementPending) {
      debouncedScan();
      return;
    }
    if (state.scanInFlight) state.replacementPending = true;
    if (state.scanScheduled) {
      debouncedScan();
      return;
    }
    /*
     * Only a completed scan may set the version (in `performScan`). Scheduling a
     * scan must not overwrite it with a placeholder, or `decidePreview` would
     * see a hash that no longer describes the document it is holding a plan for.
     */
    const next = createRunId(state.documentVersion);
    state.runId = next.runId;
    state.scanScheduled = true;
    if (runNow) {
      performScan().catch((err: unknown) => {
        logger.warn("Document observer scan failed", describeError(err));
      });
      return;
    }
    debouncedScan();
  }

  /** Start observing document changes. */
  function startObserver(): void {
    state.running = true;
    state.stale = false;
    state.eventHandler = null;
    scheduleScan();
    subscribeToDocumentChanges();
    logger.info("Document observer started");
  }

  /** Stop observing document changes. */
  function stopObserver(): void {
    state.running = false;
    state.scanInFlight = false;
    state.scanScheduled = false;
    state.replacementPending = false;
    unsubscribeFromDocumentChanges();
    if (state.debouncedScan) {
      state.debouncedScan = debounce(() => {}, debounceMs);
    }
    logger.info("Document observer stopped");
  }

  /**
   * Subscribe to the Office document-selection event.
   *
   * Word has no document-level content-change event, but `documentSelectionChanged`
   * fires on every keystroke and caret movement. The observer debounces these events,
   * so typing produces one scan when the user stops rather than one per character.
   *
   * A host without the event degrades to manual scans only — the Re-scan button
   * and the initial scan still work.
   */
  function subscribeToDocumentChanges(): void {
    /*
     * `Office.context.document.addHandlerAsync` — on the Document object, not on
     * `Office.context` — and it returns `void`: it is callback-style, not a
     * promise. Registering on `Office.context` always read as absent, so this
     * never subscribed; calling `.then` on the real return value crashed the pane.
     */
    const office = (globalThis as { Office?: { context?: Office.Context } }).Office;
    const hostDocument = office?.context?.document ?? null;
    if (hostDocument === null || typeof hostDocument.addHandlerAsync !== "function") {
      logger.info("This host exposes no document-selection event; auto-scan is manual only");
      return;
    }
    const handler = (): void => {
      scheduleScan();
    };
    state.eventHandler = handler;
    try {
      hostDocument.addHandlerAsync("documentSelectionChanged", handler);
      /*
       * Temporary diagnostic (remove after host verification): confirms in the
       * console that the selection event actually subscribed, since a silent
       * failure here is exactly what left auto-scan dead.
       */
      console.warn("document selection subscription registered (auto-scan live)");
    } catch (error: unknown) {
      state.eventHandler = null;
      console.warn(
        "document selection subscription REFUSED " +
          JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
      );
      logger.warn("Word refused the document-selection subscription", {
        verificationResult: "refused",
        refusalCategory: "selection_event_refused",
      });
    }
  }

  /** Remove the document-selection event handler, if one was registered. */
  function unsubscribeFromDocumentChanges(): void {
    const handler = state.eventHandler;
    state.eventHandler = null;
    if (handler === null) return;
    const office = (globalThis as { Office?: { context?: Office.Context } }).Office;
    const hostDocument = office?.context?.document ?? null;
    if (hostDocument === null || typeof hostDocument.removeHandlerAsync !== "function") {
      return;
    }
    try {
      /*
       * Removed by handler reference: the Document event API has no message id to
       * remove by, and passing one would remove nothing.
       */
      hostDocument.removeHandlerAsync("documentSelectionChanged", { handler });
    } catch {
      logger.warn("Word refused to remove the document-selection subscription", {
        verificationResult: "refused",
        refusalCategory: "selection_event_unsubscribe_failed",
      });
    }
  }

  /**
   * Ask the observer for a scan.
   *
   * `immediate` skips the typing debounce for a programmatic write that fires no
   * selection event — an applied change — so the refreshed findings arrive as
   * soon as the write lands. The default keeps the debounce, so the selection
   * handler and the narrow-scope follow-up still coalesce.
   */
  function onDocumentChanged(immediate = false): void {
    scheduleScan(immediate);
  }

  return { startObserver, stopObserver, onDocumentChanged };
}
