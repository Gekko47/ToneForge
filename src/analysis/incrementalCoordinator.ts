/**
 * Incremental coordinator v1 — pure functions for dirty-node tracking,
 * finding merge, full-rescan decisions, and stale-run cancellation.
 *
 * Boundary rule: analysis/ may import only core/domain and shared/utils.
 * No Office, AI, or UI imports.
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range } from "../core/domain/Finding";
import type { DocumentNode } from "../core/domain/DocumentSnapshot";
import { logger } from "../shared/utils/logger";

/** Map a changed character range onto the document nodes and return
 *  the nodeIds of nodes whose text overlaps the changed range. */
export function markDirtyNodes(changedRange: Range, nodes: DocumentNode[]): string[] {
  const dirtyIds: string[] = [];

  // Compute cumulative character offsets to map changedRange onto nodes.
  let cumulativeOffset = 0;

  for (const node of nodes) {
    const nodeText = node.text ?? "";
    const nodeStart = cumulativeOffset;
    const nodeEnd = cumulativeOffset + nodeText.length;
    cumulativeOffset = nodeEnd;

    if (changedRange.unit === "character") {
      if (changedRange.start < nodeEnd && changedRange.end > nodeStart) {
        dirtyIds.push(node.nodeId);
      }
    } else if (changedRange.unit === "paragraph") {
      // Paragraph-level change affects the node by index.
      // nodeId is used as a proxy; we match by position.
      // Since we cannot reliably map paragraph index to nodeId here,
      // we mark all nodes as dirty for paragraph-level changes.
      dirtyIds.push(node.nodeId);
    } else if (changedRange.unit === "section") {
      // Section-level change affects the entire document.
      dirtyIds.push(node.nodeId);
    }
  }

  return dirtyIds;
}

/** Replace findings whose nodeIds intersect with dirtyNodeIds,
 *  preserving all other findings unchanged. */
export function mergeFindings(
  findings: Finding[],
  dirtyNodeIds: string[],
  replacementFinder: (dirtyId: string) => Finding[],
): Finding[] {
  const dirtySet = new Set(dirtyNodeIds);
  const preserved: Finding[] = [];
  const replaced: Finding[] = [];

  for (const finding of findings) {
    const hasDirtyNode = finding.nodeIds.some((id) => dirtySet.has(id));
    if (hasDirtyNode) {
      const dirtyId = finding.nodeIds.find((id) => dirtySet.has(id)) ?? dirtyNodeIds[0] ?? "";
      replaced.push(...replacementFinder(dirtyId));
    } else {
      preserved.push(finding);
    }
  }

  return [...preserved, ...replaced];
}

/** Determine whether a full-document rescan is required.
 *  Returns true when any finding is document-wide (e.g., heading
 *  hierarchy or list-level rules that depend on the full structure). */
export function shouldFullRescan(findings: Finding[]): boolean {
  return findings.some((finding) => {
    const category = finding.category;
    return (
      category.startsWith("formatting.headingHierarchy") ||
      category.startsWith("formatting.listLevel") ||
      category.startsWith("houseStyle.capitalization")
    );
  });
}

/** Cancel a stale run when the runId or documentVersion has changed
 *  since the run started. Returns true if the run should be cancelled. */
export function cancelStaleRun(
  runId: string,
  documentVersion: string,
  currentRunId: string,
  currentDocumentVersion: string,
): boolean {
  if (runId !== currentRunId) {
    logger.warn("Stale run cancelled: runId mismatch", { runId, currentRunId });
    return true;
  }
  if (documentVersion !== currentDocumentVersion) {
    logger.warn("Stale run cancelled: documentVersion mismatch", {
      documentVersion,
      currentDocumentVersion,
    });
    return true;
  }
  return false;
}

/** Create a fresh run identifier with an associated document version. */
export function createRunId(documentVersion: string): { runId: string; documentVersion: string } {
  return { runId: uuidv4(), documentVersion };
}
