/**
 * Document observer v1 — watches for Word document changes and runs
 * incremental deterministic rule checks on dirty nodes only.
 *
 * Boundary rule: word/ may import from shared/office, core/domain,
 * shared/utils, rules, formatting, and analysis. Never imports ai or ui.
 * Never mutates Word directly.
 */

import { debounce } from "../shared/utils/debounce";
import { describeError, logger } from "../shared/utils/logger";
import { createRunId } from "../analysis/incrementalCoordinator";
import { checkConsistency } from "../analysis/consistencyChecker";
import { acquireAnalysisContext } from "./analysisAcquisition";
import type { AnalysisCapabilities } from "../analysis/analysisContext";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import { type CoverageReport } from "../core/domain/DocumentSnapshot";
import { type StyleProfile } from "../core/domain/StyleProfile";
import { type Finding } from "../core/domain/Finding";
import type { WordParagraphChange } from "./wordParagraphEvents";

export type DocumentScanPhase =
  "notStarted" | "scanning" | "fresh" | "clean" | "stale" | "incomplete" | "failed";

/**
 * The subset of nodes a scan will examine, or null for the whole document.
 *
 * Held as module state rather than threaded through the debounce so a burst of
 * events collapses into one scope. Events *accumulate* rather than replace:
 * two paragraphs edited inside one debounce window both need examining, and
 * keeping only the second would silently skip the first.
 */
interface ScanScope {
  nodeIds: Set<string>;
}

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
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  coverage: CoverageReport | null;
  error: string | null;
  hostUnavailable: boolean;
  debouncedScan: (() => void) | null;
  /** Nodes the next scan will examine, or null for the whole document. */
  scope: ScanScope | null;
}

const DEFAULT_DEBOUNCE_MS = 300;

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
  onDocumentChanged: (change?: WordParagraphChange) => void;
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
    supportsParagraphResolution: false,
    supportsHighlight: false,
    supportsContextMenu: false,
    hostName: "unknown" as const,
    hostVersion: null,
  };
  /**
   * Decide whether a host event is precise enough to narrow the scan.
   *
   * Four cases force a full rescan, and each is a case where narrowing would
   * produce a confidently wrong report:
   *
   * - `requiresFullRescan` — the host dropped or mangled some ids, so the set is
   *   known to be incomplete.
   * - a deletion — a removed paragraph shifts every index and range after it, and
   *   the event names what went, not what moved.
   * - a remote edit — a collaborator's change may have touched anything.
   * - no ids at all — an event that names nothing names nothing.
   */
  function narrowTo(change: WordParagraphChange | undefined): ScanScope | null {
    if (change === undefined) return null;
    if (change.requiresFullRescan) return null;
    if (change.kind === "deleted") return null;
    if (change.source !== "local") return null;
    if (change.uniqueLocalIds.length === 0) return null;
    return { nodeIds: new Set(change.uniqueLocalIds) };
  }

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
    hostUnavailable: false,
    coverage: null,
    error: null,
    debouncedScan: null,
    scope: null,
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

      // A narrowed scan reports only what it re-derived. Nothing is carried over
      // from the previous run: growing one paragraph shifts every character
      // offset after it, so a retained finding in an untouched paragraph can
      // point at the wrong sentence while looking entirely normal.
      const scope = state.scope;
      state.scope = null;
      const inScope = (nodeId: string): boolean => scope === null || scope.nodeIds.has(nodeId);
      const examinedNodes = scope === null ? full.nodes : full.nodes.filter((node) => inScope(node.nodeId));
      // An event naming ids the host no longer has names nothing we can read;
      // treating that as a narrowing would silently examine less than asked.
      const narrowed =
        scope !== null && examinedNodes.length > 0 && examinedNodes.length < full.nodes.length;
      const examinedNodeIds = (narrowed ? examinedNodes : full.nodes).map((node) => node.nodeId);
      const skippedCount = full.nodes.length - examinedNodeIds.length;
      const context = narrowed ? { ...full, nodes: examinedNodes } : full;
      const report = await checkConsistency({
        context,
        includeRawText: false,
        ...(narrowed
          ? {
              examinedNodeIds,
              incremental: true,
              incrementalReason:
                `Word reported ${skippedCount} changed paragraph(s); this run examined ` +
                `${examinedNodeIds.length} of ${full.nodes.length} acquired nodes. Findings for ` +
                "the rest are not shown until a full scan.",
            }
          : {}),
      });
      if (isObsolete()) return;

      const coverage = report.coverage ?? null;
      state.findings = report.findings;
      state.coverage = coverage;
      state.lastScan = new Date().toISOString();
      state.lastAcceptedRunId = runId;
      state.dirtyCount = examinedNodeIds.length;
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
      state.phase = "failed";
      state.stale = true;
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
        coverage: state.coverage,
        currentRunId: state.runId,
        lastAcceptedRunId: state.lastAcceptedRunId,
        documentVersion: state.documentVersion,
        supersededRuns: state.supersededRuns,
        hostUnavailable: state.hostUnavailable,
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

  /**
   * Called when the document changes.
   *
   * A host event narrows the next scan when it is precise enough to trust; see
   * `narrowTo`. Scopes accumulate across a debounce burst rather than replacing
   * one another: two paragraphs edited inside one window both need examining,
   * and keeping only the most recent would silently skip the first.
   *
   * A full rescan clears any pending narrow scope, so an imprecise event can
   * never be narrowed by a precise one that arrived earlier in the same burst.
   */
  function onDocumentChanged(change?: WordParagraphChange): void {
    const narrowed = narrowTo(change);
    if (narrowed === null) {
      state.scope = null;
    } else if (state.scope !== null) {
      state.scope = { nodeIds: new Set([...state.scope.nodeIds, ...narrowed.nodeIds]) };
    } else {
      state.scope = narrowed;
    }
    scheduleScan();
  }

  return { startObserver, stopObserver, onDocumentChanged };
}
