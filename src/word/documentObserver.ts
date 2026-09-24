/**
 * Document observer v1 — watches for Word document changes and runs
 * incremental deterministic rule checks on dirty nodes only.
 *
 * Boundary rule: word/ may import from shared/office, core/domain,
 * shared/utils, rules, formatting, and analysis. Never imports ai or ui.
 * Never mutates Word directly.
 */

import { debounce } from "../shared/utils/debounce";
import { logger } from "../shared/utils/logger";
import { mergeFindings, createRunId } from "../analysis/incrementalCoordinator";
import { checkConsistency } from "../analysis/consistencyChecker";
import { getDocumentSnapshot, getStructuredSnapshot } from "./documentReader";
import { getFormattingSnapshot } from "./formattingReader";
import { buildCoverage } from "../analysis/coverage";
import { type CoverageReport } from "../core/domain/DocumentSnapshot";
import { type StyleProfile } from "../core/domain/StyleProfile";
import { type Finding } from "../core/domain/Finding";

export type DocumentScanPhase =
  "notStarted" | "scanning" | "fresh" | "clean" | "stale" | "incomplete" | "failed";

export interface DocumentObserverStatus {
  phase: DocumentScanPhase;
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  findings: Finding[];
  coverage: CoverageReport | null;
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
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  coverage: CoverageReport | null;
  error: string | null;
  debouncedScan: (() => void) | null;
}

const DEFAULT_DEBOUNCE_MS = 300;

/** Create a document observer that watches for changes and runs
 *  incremental deterministic checks. */
export function createDocumentObserver(options: DocumentObserverOptions): {
  startObserver: () => void;
  stopObserver: () => void;
  onDocumentChanged: () => void;
} {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, onStatus, profile } = options;
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
    lastScan: null,
    dirtyCount: 0,
    stale: false,
    coverage: null,
    error: null,
    debouncedScan: null,
  };

  const debouncedScan = debounce(() => {
    performScan().catch((err: unknown) => {
      logger.warn("Document observer scan failed", { error: String(err) });
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
      // Get the document snapshot
      const snapshot = await getDocumentSnapshot();
      if (isObsolete()) return;
      const structuredSnapshot = await getStructuredSnapshot();
      if (isObsolete()) return;
      const formattingSnapshot = await getFormattingSnapshot();
      if (isObsolete()) return;

      // The host currently supplies a full document snapshot rather than a
      // reliable changed-range event. Run one canonical consistency analysis
      // over the same text, nodes, and formatting snapshot that safe reformat
      // previews use. This prevents governance and findings from diverging.
      const nodes = structuredSnapshot.nodes;
      const fullText = snapshot.text;
      const dirtyNodeIds = nodes.map((node) => node.nodeId);
      const report = await checkConsistency({
        text: fullText,
        profile,
        snapshot: formattingSnapshot,
        nodes,
        ...(snapshot.hash ? { docHash: snapshot.hash } : {}),
        includeRawText: false,
      });
      if (isObsolete()) return;

      const mergedFindings = mergeFindings([], dirtyNodeIds, () => report.findings);
      const coverage = report.coverage ?? buildCoverage({ nodes, text: fullText });
      state.findings = mergedFindings;
      state.coverage = coverage;
      state.lastScan = new Date().toISOString();
      state.lastAcceptedRunId = runId;
      state.dirtyCount = dirtyNodeIds.length;
      state.stale = false;
      state.error = null;
      const coverageComplete = coverage?.complete !== false;
      state.phase = !coverageComplete
        ? "incomplete"
        : mergedFindings.length === 0
          ? "clean"
          : "fresh";
      emitStatus();
    } catch (err) {
      if (!isCurrent()) return;
      logger.warn("Document observer scan failed during processing", { error: String(err) });
      if (err instanceof Error && err.message.includes("Office")) {
        logger.warn("Office unavailable during document scan", { error: err.message });
        state.phase = "failed";
        state.stale = true;
        state.error = "Office is unavailable. Re-scan when Word is ready.";
        emitStatus();
        return;
      }
      state.phase = "failed";
      state.stale = true;
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
        coverage: state.coverage,
        currentRunId: state.runId,
        lastAcceptedRunId: state.lastAcceptedRunId,
        documentVersion: state.documentVersion,
        supersededRuns: state.supersededRuns,
        error: state.error,
      });
    }
  }

  /** Schedule a scan, replacing an obsolete run only once per debounce burst. */
  function scheduleScan(): void {
    if (!state.running) return;
    if (state.scanInFlight && state.replacementPending) {
      debouncedScan();
      return;
    }
    if (state.scanInFlight) state.replacementPending = true;
    if (state.scanScheduled) {
      debouncedScan();
      return;
    }
    const next = createRunId(state.documentVersion || "pending");
    state.runId = next.runId;
    state.documentVersion = next.documentVersion;
    state.scanScheduled = true;
    state.stale = state.lastAcceptedRunId !== null;
    if (state.stale) state.phase = "stale";
    debouncedScan();
  }

  /** Start observing document changes. */
  function startObserver(): void {
    state.running = true;
    state.stale = false;
    scheduleScan();
    logger.info("Document observer started");
  }

  /** Stop observing document changes. */
  function stopObserver(): void {
    state.running = false;
    state.scanInFlight = false;
    state.scanScheduled = false;
    state.replacementPending = false;
    if (state.debouncedScan) {
      state.debouncedScan = debounce(() => {}, debounceMs);
    }
    logger.info("Document observer stopped");
  }

  /** Called when the document changes (e.g., from Word's change events). */
  function onDocumentChanged(): void {
    scheduleScan();
  }

  return { startObserver, stopObserver, onDocumentChanged };
}
