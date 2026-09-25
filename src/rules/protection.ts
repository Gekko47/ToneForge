/**
 * Protection engine v1 — pure detectors for protected content.
 *
 * Detects quoted text, captions, tracked deletions, comments, text boxes,
 * shapes, alt text, headers/footers, fields, footnotes, and user-locked ranges.
 *
 * Boundary rule: rules/ must stay deterministic — no Office, AI, or UI imports.
 */

import type { DocumentNode } from "../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";

export interface ProtectionFinding {
  nodeId: string;
  protectionReason: string;
  nodeType: string;
}

export function detectQuotedRanges(text: string): ProtectionFinding[] {
  const findings: ProtectionFinding[] = [];
  const regex = /("(?:[^"\\]|\\.)*")/g;
  for (const _match of text.matchAll(regex)) {
    findings.push({
      nodeId: "",
      protectionReason: "quoted-text",
      nodeType: "text",
    });
  }
  return findings;
}

/** Detect caption nodes. */
export function detectCaptionNodes(nodes: DocumentNode[]): ProtectionFinding[] {
  return nodes
    .filter((n) => n.type === "caption")
    .map((n) => ({
      nodeId: n.nodeId,
      protectionReason: "caption",
      nodeType: n.type,
    }));
}

/** Detect tracked deletion ranges. */
export function detectTrackedDeletionRanges(text: string): ProtectionFinding[] {
  const findings: ProtectionFinding[] = [];
  const regex = /(\{\{\s*DELETE\s+.*?\}\})/g;
  for (const _match of text.matchAll(regex)) {
    findings.push({
      nodeId: "",
      protectionReason: "tracked-deletion",
      nodeType: "paragraph",
    });
  }
  return findings;
}

/** Detect comment ranges. */
export function detectCommentRanges(nodes: DocumentNode[]): ProtectionFinding[] {
  return nodes
    .filter((n) => n.type === "comment")
    .map((n) => ({
      nodeId: n.nodeId,
      protectionReason: "comment",
      nodeType: n.type,
    }));
}

/** Check if a node is protected based on its type and protection policy. */
export function isProtectedNode(
  node: DocumentNode,
  protectedReasons: string[] = [],
  policy?: GovernanceProfile,
): boolean {
  if (!node.editable) return true;
  if (protectedReasons.includes(node.protectionReason ?? "")) return true;
  if (policy?.protection.userLockedRanges.includes(node.nodeId)) return true;
  const protectedTypes = [
    "caption",
    "comment",
    "footnote",
    "endnote",
    "textBox",
    "shape",
    "smartArt",
    "contentControl",
    "field",
  ];
  if (protectedTypes.includes(node.type)) return true;
  return false;
}

/** Check if a range is protected. */
export function isProtectedRange(nodeIds: string[], nodes: DocumentNode[]): boolean {
  return nodeIds.some((id) => {
    const node = nodes.find((n) => n.nodeId === id);
    return node ? isProtectedNode(node) : false;
  });
}
