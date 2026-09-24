import { isProtectedNode } from "../../rules/protection";
import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import type { Finding } from "../../core/domain/Finding";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";

const DEFAULT_CHAR_BUDGET = 4000;

export interface ContextMinimizerOptions {
  selectedText: string;
  nodes: readonly DocumentNode[];
  targetNodeIds: readonly string[];
  findings?: readonly Finding[];
  userInstruction?: string;
  governance?: GovernanceProfile;
  charBudget?: number;
}

export interface MinimalContext {
  text: string;
  excludedNodeIds: string[];
  includedNodeIds: string[];
  truncated: boolean;
}

/** Build bounded, evidence-oriented context without importing Word or UI modules. */
export function buildMinimalContext(options: ContextMinimizerOptions): MinimalContext {
  const budget = Math.max(0, options.charBudget ?? DEFAULT_CHAR_BUDGET);
  const target = new Set(options.targetNodeIds);
  const excludedNodeIds: string[] = [];
  const included: string[] = [];
  const parts: string[] = [];

  options.nodes.forEach((node) => {
    if (target.has(node.nodeId) && (isProtectedNode(node) || !node.editable)) {
      excludedNodeIds.push(node.nodeId);
      return;
    }
    if (node.includedInAIReview && node.text && (target.size === 0 || target.has(node.nodeId))) {
      included.push(node.nodeId);
      parts.push(node.text);
    }
  });

  const selected = options.selectedText.trim();
  if (selected) parts.unshift(selected);
  if (options.userInstruction) parts.push(`User instruction: ${options.userInstruction}`);
  if (options.governance) parts.push(`Policy: ${JSON.stringify(options.governance.editorial)}`);

  const full = parts.filter(Boolean).join("\n");
  const truncated = full.length > budget;
  return {
    text: truncated ? full.slice(0, budget) : full,
    excludedNodeIds,
    includedNodeIds: included,
    truncated,
  };
}
