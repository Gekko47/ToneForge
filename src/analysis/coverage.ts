/**
 * Authoritative analysis coverage.
 *
 * Coverage is derived from the acquired node scope and acquisition diagnostics;
 * it is never a claim based only on a caller-provided list of interesting nodes.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type DocumentNode,
  CoverageReportSchema,
  type CoverageReport,
  type CoverageItem,
} from "../core/domain/DocumentSnapshot";
import type { AcquisitionDiagnostics } from "./analysisContext";

export interface CoverageOptions {
  nodes: readonly DocumentNode[];
  text: string;
  requiredNodeTypes?: readonly string[];
  exclusions?: Array<{ reason: string; nodeTypes?: readonly string[] }>;
  acquisition?: Pick<
    AcquisitionDiagnostics,
    | "structuralCoverage"
    | "unsupported"
    | "analyzedCharacterCount"
    | "completeDocumentCharacterCount"
  >;
  plannedChangeCount?: number;
  examinedNodeIds?: readonly string[];
  appliedChangeCount?: number;
  changedNodeIds?: readonly string[];
  changedCharacterCount?: number;
}

export function buildCoverage(options: CoverageOptions): CoverageReport {
  const { nodes, exclusions = [], requiredNodeTypes = ["body", "paragraph/heading"] } = options;
  const counts = new Map<string, CoverageItem>();
  const examinedNodeIds = [
    ...(options.examinedNodeIds ??
      nodes.filter((node) => node.includedInGovernance).map((node) => node.nodeId)),
  ];
  const excluded: CoverageReport["excluded"] = [];
  const unprocessed: string[] = [];
  const unsupported = [...(options.acquisition?.unsupported ?? [])];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  nodes.forEach((node) => {
    const existing = counts.get(node.type);
    const characters = node.text?.length ?? 0;
    if (existing) {
      existing.count += 1;
      existing.processedCharacterCount += characters;
    } else {
      counts.set(node.type, {
        nodeType: node.type,
        count: 1,
        processedCharacterCount: characters,
        revisedCharacterCount: 0,
        excluded: [],
      });
    }
  });

  nodes.forEach((node) => {
    if (node.includedInGovernance) return;
    excluded.push({
      reason: node.protectionReason ?? "Node is excluded from governance scope",
      locations: [node.sourcePath],
    });
  });

  exclusions.forEach((exclusion) => {
    const locations = nodes
      .filter((node) => exclusion.nodeTypes?.includes(node.type))
      .map((node) => node.sourcePath)
      .slice(0, 10);
    if (locations.length > 0) excluded.push({ reason: exclusion.reason, locations });
  });

  requiredNodeTypes.forEach((requiredType) => {
    const alternatives = requiredType.split("/");
    // A required type counts as discovered only when a node that governance
    // actually includes was acquired. Excluded nodes stay visible in
    // `excluded` and must not mask an inaccessible in-scope container.
    const discovered = nodes.some(
      (node) => node.includedInGovernance && alternatives.includes(node.type),
    );
    if (!discovered) {
      unprocessed.push(`Required in-scope node type inaccessible: ${requiredType}`);
    }
  });

  if (options.acquisition?.structuralCoverage === "unsupported") {
    unprocessed.push("Acquisition did not expose a supported structural scope");
  }
  if (
    options.acquisition?.analyzedCharacterCount !== undefined &&
    options.acquisition.completeDocumentCharacterCount !== undefined &&
    options.acquisition.analyzedCharacterCount < options.acquisition.completeDocumentCharacterCount
  ) {
    unprocessed.push("Analysis window is shorter than the complete document");
  }

  const totalProcessed = Array.from(counts.values()).reduce(
    (sum, item) => sum + item.processedCharacterCount,
    0,
  );
  const plannedChangeCount = options.plannedChangeCount ?? 0;
  const appliedChangeCount = options.appliedChangeCount ?? 0;
  const changedNodeIds = [...new Set(options.changedNodeIds ?? [])].filter((nodeId) =>
    nodeById.has(nodeId),
  );
  const changedCharacterCount = options.changedCharacterCount ?? 0;
  const revisedCharacterCount = changedCharacterCount;
  const acquisitionDiagnostics = options.acquisition
    ? {
        acquisitionReadCount: 1,
        syncCount: 2,
        analyzedCharacterCount: options.acquisition.analyzedCharacterCount,
        completeDocumentCharacterCount: options.acquisition.completeDocumentCharacterCount,
        fullBodyReadCount: 1,
        paragraphCollectionRead: options.acquisition.structuralCoverage !== "unsupported",
        incremental: false as const,
        incrementalReason:
          "No verified Word changed-range event; conservative full rescan is supported.",
      }
    : undefined;
  // `complete` describes the requested analysis scope. Declared unsupported
  // containers and protected exclusions remain visible in the report, but only
  // unexpected processing gaps make the requested scope incomplete.
  const complete = unprocessed.length === 0;

  return CoverageReportSchema.parse({
    runId: uuidv4(),
    counts: Array.from(counts.values()).map((item) => ({ ...item, revisedCharacterCount })),
    processedCharacterCount: totalProcessed,
    revisedCharacterCount,
    examinedNodeIds,
    excluded,
    unsupported,
    unprocessed,
    plannedChangeCount,
    appliedChangeCount,
    changedNodeIds,
    complete,
    ...(acquisitionDiagnostics ? { acquisition: acquisitionDiagnostics } : {}),
  });
}
