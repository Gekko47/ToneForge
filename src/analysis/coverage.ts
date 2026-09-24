/**
 * Coverage engine v1 — pure function producing CoverageReport
 * from document nodes and text.
 *
 * Boundary rule: analysis/ may import core/domain, rules, formatting,
 * ai/providers, and shared/utils — never word/revisionAdapter or ui.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type DocumentNode,
  CoverageReportSchema,
  type CoverageReport,
  type CoverageItem,
} from "../core/domain/DocumentSnapshot";

export interface CoverageOptions {
  nodes: DocumentNode[];
  text: string;
  exclusions?: Array<{ reason: string; nodeTypes?: string[] }>;
}

/** Enumerate node types and produce a coverage report. */
export function buildCoverage(options: CoverageOptions): CoverageReport {
  const { nodes, exclusions = [] } = options;

  const counts = new Map<string, CoverageItem>();
  const excluded: CoverageReport["excluded"] = [];
  const unprocessed: string[] = [];

  // Count nodes by type
  for (const node of nodes) {
    const nodeType = node.type;
    const existing = counts.get(nodeType);
    if (existing) {
      existing.count += 1;
      existing.processedCharacterCount += node.text?.length ?? 0;
    } else {
      counts.set(nodeType, {
        nodeType,
        count: 1,
        processedCharacterCount: node.text?.length ?? 0,
        revisedCharacterCount: 0,
        excluded: [],
      });
    }
  }

  // Apply exclusions
  for (const exclusion of exclusions) {
    const locations: string[] = [];
    for (const node of nodes) {
      if (exclusion.nodeTypes?.includes(node.type)) {
        locations.push(node.sourcePath);
        if (locations.length >= 10) break;
      }
    }
    if (locations.length > 0) {
      excluded.push({ reason: exclusion.reason, locations });
    }
  }

  // Check for inaccessible required in-scope nodes
  const hasBody = nodes.some((n) => n.type === "body");
  const hasParagraphs = nodes.some((n) => n.type === "paragraph" || n.type === "heading");
  if (!hasBody || !hasParagraphs) {
    unprocessed.push("Required in-scope node inaccessible");
  }

  const totalProcessed = Array.from(counts.values()).reduce(
    (sum, item) => sum + item.processedCharacterCount,
    0,
  );
  const totalRevised = Array.from(counts.values()).reduce(
    (sum, item) => sum + item.revisedCharacterCount,
    0,
  );

  return CoverageReportSchema.parse({
    runId: uuidv4(),
    counts: Array.from(counts.values()),
    processedCharacterCount: totalProcessed,
    revisedCharacterCount: totalRevised,
    excluded,
    unprocessed,
    complete: unprocessed.length === 0,
  });
}
