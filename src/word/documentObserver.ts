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
import {
  mergeFindings,
  shouldFullRescan,
  cancelStaleRun,
  createRunId,
} from "../analysis/incrementalCoordinator";
import { getDocumentSnapshot, getStructuredSnapshot } from "./documentReader";
import { getFormattingSnapshot } from "./formattingReader";
import { findTypographyIssues } from "../rules/typography";
import { findHouseStyleIssues } from "../rules/houseStyle";
import { findFormattingIssues } from "../formatting/analyzer";
import { buildCoverage } from "../analysis/coverage";
import { type DocumentNode, type CoverageReport } from "../core/domain/DocumentSnapshot";
import { type StyleProfile } from "../core/domain/StyleProfile";
import { type Finding } from "../core/domain/Finding";
import type { FormattingSnapshot } from "../formatting/formattingSnapshot";

export interface DocumentObserverStatus {
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  findings: Finding[];
  coverage: CoverageReport | null;
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
  findings: Finding[];
  lastScan: string | null;
  dirtyCount: number;
  stale: boolean;
  coverage: CoverageReport | null;
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
    findings: [],
    lastScan: null,
    dirtyCount: 0,
    stale: false,
    coverage: null,
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
    if (!state.running) return;

    // Check for stale run
    if (state.runId && state.documentVersion) {
      const { runId, documentVersion } = createRunId(state.documentVersion);
      if (cancelStaleRun(state.runId, state.documentVersion, runId, documentVersion)) {
        state.stale = true;
        emitStatus();
        return;
      }
      state.runId = runId;
    } else {
      const { runId, documentVersion } = createRunId("1");
      state.runId = runId;
      state.documentVersion = documentVersion;
    }

    try {
      // Get the document snapshot
      const snapshot = await getDocumentSnapshot();
      const structuredSnapshot = await getStructuredSnapshot();
      const formattingSnapshot = await getFormattingSnapshot();

      // Determine dirty nodes from the changed range
      const nodes = structuredSnapshot.nodes;
      const fullText = snapshot.text;

      // For the initial scan or full rescan, mark all nodes as dirty
      const allNodesDirty = state.findings.length === 0 || shouldFullRescan(state.findings);
      let dirtyNodeIds: string[];

      if (allNodesDirty) {
        dirtyNodeIds = nodes.map((n) => n.nodeId);
      } else {
        // Use a dummy range for the initial incremental scan
        // In practice, Word would provide the changed range
        dirtyNodeIds = nodes.map((n) => n.nodeId);
      }

      // Run deterministic rules on dirty nodes
      const newFindings = await runRulesOnDirtyNodes(
        dirtyNodeIds,
        nodes,
        formattingSnapshot,
        profile,
      );

      // Merge findings
      state.findings = mergeFindings(state.findings, dirtyNodeIds, () => newFindings);

      // Update coverage
      state.coverage = buildCoverage({ nodes, text: fullText });

      // Update state
      state.lastScan = new Date().toISOString();
      state.dirtyCount = dirtyNodeIds.length;
      state.stale = false;

      emitStatus();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Office")) {
        logger.warn("Office unavailable during document scan", { error: err.message });
        state.stale = true;
        emitStatus();
        return;
      }
      throw err;
    }
  }

  /** Run the applicable deterministic rules on the dirty nodes. */
  async function runRulesOnDirtyNodes(
    dirtyNodeIds: string[],
    nodes: DocumentNode[],
    formattingSnapshot: FormattingSnapshot,
    profile: StyleProfile,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const dirtySet = new Set(dirtyNodeIds);

    // Get text from dirty nodes
    const dirtyNodes = nodes.filter((n) => dirtySet.has(n.nodeId));
    const dirtyText = dirtyNodes.map((n) => n.text ?? "").join(" ");

    if (dirtyText.length > 0) {
      // Run typography rules
      findings.push(...findTypographyIssues({ text: dirtyText, rules: profile.typography }));

      // Run house-style rules
      findings.push(...findHouseStyleIssues({ text: dirtyText, rules: profile.houseStyle }));
    }

    // Run formatting rules on the formatting snapshot
    // Filter formatting snapshot to dirty paragraphs
    const dirtyParagraphs = formattingSnapshot.paragraphs.filter((p: { index: number }) =>
      dirtySet.has(p.index.toString()),
    );
    if (dirtyParagraphs.length > 0) {
      // For formatting, we need the full snapshot but can filter findings afterward
      const formatFindings = findFormattingIssues({
        snapshot: formattingSnapshot,
        profile,
      });
      // Filter to findings that overlap dirty nodes
      const filteredFormatFindings = formatFindings.filter((f) =>
        f.nodeIds.some((id) => dirtySet.has(id)),
      );
      findings.push(...filteredFormatFindings);
    }

    // Create new findings with proper nodeIds since Finding is immutable
    const resultFindings: Finding[] = [];
    for (const finding of findings) {
      if (finding.nodeIds.length === 0) {
        resultFindings.push({
          ...finding,
          nodeIds: [...dirtyNodeIds],
        });
      } else {
        resultFindings.push(finding);
      }
    }

    return resultFindings;
  }

  /** Emit the current status to the callback. */
  function emitStatus(): void {
    if (onStatus) {
      onStatus({
        lastScan: state.lastScan,
        dirtyCount: state.dirtyCount,
        stale: state.stale,
        findings: state.findings,
        coverage: state.coverage,
      });
    }
  }

  /** Start observing document changes. */
  function startObserver(): void {
    state.running = true;
    state.stale = false;
    // Trigger an initial scan
    debouncedScan();
    logger.info("Document observer started");
  }

  /** Stop observing document changes. */
  function stopObserver(): void {
    state.running = false;
    if (state.debouncedScan) {
      state.debouncedScan = debounce(() => {}, debounceMs);
    }
    logger.info("Document observer stopped");
  }

  /** Called when the document changes (e.g., from Word's change events). */
  function onDocumentChanged(): void {
    if (!state.running) return;
    debouncedScan();
  }

  return { startObserver, stopObserver, onDocumentChanged };
}
