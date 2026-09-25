import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import { isProtectedNode } from "../../rules/protection";

const DEFAULT_CHAR_BUDGET = 4000;

export interface ContextMinimizerOptions {
  selectedText: string;
  nodes: readonly DocumentNode[];
  targetNodeIds: readonly string[];
  userInstruction?: string;
  governance?: GovernanceProfile;
  charBudget?: number;
}

export interface MinimalContext {
  text: string;
  requestedNodeIds: string[];
  excludedNodeIds: string[];
  unresolvedNodeIds: string[];
  includedNodeIds: string[];
  truncatedNodeIds: string[];
  truncated: boolean;
}

/**
 * Build bounded provider context without importing Word or UI modules.
 * Selected text is sent only when every requested target resolves to an
 * editable, AI-reviewable node. Node text is never appended independently of
 * the selected slice, which prevents duplicate or out-of-scope disclosure.
 */
export function buildMinimalContext(options: ContextMinimizerOptions): MinimalContext {
  const budget = Math.max(0, options.charBudget ?? DEFAULT_CHAR_BUDGET);
  const requestedNodeIds = [...new Set(options.targetNodeIds)];
  const nodesById = new Map(options.nodes.map((node) => [node.nodeId, node]));
  const excludedNodeIds: string[] = [];
  const unresolvedNodeIds: string[] = [];
  const eligible: DocumentNode[] = [];

  requestedNodeIds.forEach((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node) {
      unresolvedNodeIds.push(nodeId);
      return;
    }
    if (
      isProtectedNode(node, [], options.governance) ||
      !node.editable ||
      !node.includedInAIReview ||
      !isGovernanceIncluded(node, options.governance)
    ) {
      excludedNodeIds.push(nodeId);
      return;
    }
    eligible.push(node);
  });

  const selected = options.selectedText;
  const representedNodeIds = resolveRepresentedNodes(selected, eligible);
  eligible.forEach((node) => {
    if (!representedNodeIds.includes(node.nodeId)) unresolvedNodeIds.push(node.nodeId);
  });

  const policyBlocked =
    selected.trim().length === 0 ||
    unresolvedNodeIds.length > 0 ||
    excludedNodeIds.length > 0 ||
    representedNodeIds.length === 0;
  const metadata = [
    options.userInstruction ? `User instruction: ${options.userInstruction}` : "",
    options.governance ? `Policy: ${JSON.stringify(options.governance.editorial)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const rawSelected = policyBlocked ? "" : selected;
  const separator = rawSelected.length > 0 && metadata.length > 0 ? "\n" : "";
  const availableForSelected = Math.max(0, budget - metadata.length - separator.length);
  const selectedText = rawSelected.slice(0, availableForSelected);
  const text = `${selectedText}${selectedText.length > 0 ? separator : ""}${metadata.slice(
    0,
    Math.max(0, budget - selectedText.length - separator.length),
  )}`;
  const selectedComplete = rawSelected.length > 0 && selectedText.length === rawSelected.length;
  const includedNodeIds = selectedComplete ? representedNodeIds : [];
  const truncatedNodeIds = rawSelected.length > 0 && !selectedComplete ? representedNodeIds : [];

  return {
    text,
    requestedNodeIds,
    excludedNodeIds,
    unresolvedNodeIds,
    includedNodeIds,
    truncatedNodeIds,
    truncated: text.length < rawSelected.length + separator.length + metadata.length,
  };
}

function isGovernanceIncluded(
  node: DocumentNode,
  governance: GovernanceProfile | undefined,
): boolean {
  if (governance === undefined) return true;
  const protectionReason = node.protectionReason;
  if (protectionReason === "quoted-text" || protectionReason === "quote") {
    return !governance.protection.protectQuotedText;
  }
  if (protectionReason === "caption") return !governance.protection.protectCaptions;
  if (protectionReason === "comment") return !governance.protection.protectComments;
  if (protectionReason === "textBox") return !governance.protection.protectTextBoxes;
  if (protectionReason === "shape") return !governance.protection.protectShapes;
  if (protectionReason === "alt-text") return !governance.protection.protectAltText;
  if (protectionReason === "header" || protectionReason === "footer") {
    return !governance.protection.protectHeadersFooters;
  }
  if (protectionReason === "field") return !governance.protection.protectFields;
  if (protectionReason === "footnote") return !governance.protection.protectFootnotes;
  return true;
}

function resolveRepresentedNodes(selected: string, eligible: readonly DocumentNode[]): string[] {
  if (selected.length === 0) return [];
  const joined = eligible.map((node) => node.text ?? "").join("\n");
  if (joined === selected) return eligible.map((node) => node.nodeId);
  if (
    eligible.length > 1 &&
    eligible.map((node) => node.text ?? "").join("") === selected &&
    eligible.every(
      (node, index) =>
        index === 0 ||
        (node.sourceRange?.startOffset !== undefined &&
          eligible[index - 1]?.sourceRange?.endOffset === node.sourceRange.startOffset),
    )
  ) {
    return eligible.map((node) => node.nodeId);
  }
  const matches = eligible.filter((node) => node.text?.includes(selected));
  return matches.length === 1 && matches[0] ? [matches[0].nodeId] : [];
}
