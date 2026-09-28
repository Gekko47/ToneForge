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
  /**
   * Node types the caller genuinely requires, as `type/alternative` groups.
   *
   * Defaults to empty. It used to default to `["body", "paragraph/heading"]`,
   * which asked whether any node was typed *exactly* `paragraph` or `heading` —
   * so a document made entirely of list items reported
   * `Required in-scope node type inaccessible: paragraph/heading`, was marked
   * incomplete, and could never be applied. That is the wrong question: the
   * check is a discovery test, and the acquisition it was reaching for is
   * already reported by `structuralCoverage === "unsupported"` below.
   */
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
  /**
   * True when this report covers only part of the acquired document, and why.
   *
   * The diagnostic used to be hardcoded to `incremental: false` with a reason
   * saying no verified changed-range event existed. The adapter that normalises
   * those events existed and its output was discarded, so the claim was accurate
   * but permanently true. It is now driven by the caller that actually knows
   * which scope it examined.
   */
  incremental?: boolean;
  incrementalReason?: string;
}

export function buildCoverage(options: CoverageOptions): CoverageReport {
  const { nodes, exclusions = [], requiredNodeTypes = [] } = options;
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

  /*
   * Did we acquire anything at all?
   *
   * The question is deliberately about *content*, not about a list of node
   * types. Asking "is there a node typed exactly paragraph or heading" reports
   * a perfectly readable document of nothing but list items as inaccessible,
   * and since `complete` drives the Apply gate, that permanently denies Apply
   * on a document ToneForge had in fact read end to end.
   *
   * It is also deliberately about acquisition, not about *governance
   * eligibility*. Those are different questions and conflating them is what
   * denied Apply on a readable document. `analysisAcquisition` marks a
   * paragraph `includedInGovernance: false` when it contains a double-quoted
   * span, so a document that discusses quotations — a style guide, an editorial
   * memo, a paper about typography — has every paragraph protected. The old
   * check asked for in-scope content, found none, and reported
   * `No in-scope document content was acquired` as though nothing had been
   * read. It had been read end to end: the rules scan the analysis text and
   * produce findings from it, which is why the findings list filled up while
   * Apply refused and cited a document ToneForge was demonstrably reading.
   *
   * A protection exclusion is a policy outcome, not a processing gap. It is
   * already reported in `excluded` with its reason and locations, and it must
   * not also appear in `unprocessed`, because `complete` is derived from
   * `unprocessed` and it gates Apply. A document the user has deliberately
   * excluded from governance is one they can still correct in the parts they
   * did not exclude.
   */
  const acquiredContent = nodes.filter((node) => (node.text?.length ?? 0) > 0);
  if (acquiredContent.length === 0) {
    unprocessed.push("No document content was acquired");
  }

  /**
   * Everything acquired was excluded by policy.
   *
   * A distinct state, not a flavour of failure. It is worth naming because the
   * plan it produces is legitimately empty, and an empty plan next to a
   * refusal reads as two contradictory answers to the same question.
   */
  const inScopeContent = nodes.filter(
    (node) => node.includedInGovernance && (node.text?.length ?? 0) > 0,
  );
  const protectedOnly = acquiredContent.length > 0 && inScopeContent.length === 0;

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
        incremental: options.incremental ?? false,
        incrementalReason:
          options.incrementalReason ??
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
    protectedOnly,
    ...(acquisitionDiagnostics ? { acquisition: acquisitionDiagnostics } : {}),
  });
}
