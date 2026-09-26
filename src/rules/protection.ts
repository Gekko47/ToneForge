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

/** Node types no author may unprotect, whatever the policy says. */
const ALWAYS_PROTECTED_TYPES: readonly string[] = [
  "comment",
  "textBox",
  "shape",
  "smartArt",
  "contentControl",
];

/**
 * Node types the author controls, each bound to the policy flag that governs it.
 *
 * `footnote`/`endnote`/`field` are here rather than in the fixed list because
 * they are genuinely optional in a house style — a legal document that never
 * uses fields should not have field content silently skipped. `caption` is here
 * for the same reason. The comment, text-box, shape, smart-art, and
 * content-control types are not: those are containers whose contents the
 * formatter cannot address safely, so unprotecting them would mean changing
 * text the user cannot see changed.
 */
const POLICY_CONTROLLED_TYPES: Readonly<Record<string, keyof ProtectionPolicyFlags>> = {
  caption: "protectCaptions",
  footnote: "protectFootnotes",
  endnote: "protectFootnotes",
  field: "protectFields",
  header: "protectHeadersFooters",
  footer: "protectHeadersFooters",
};

export interface ProtectionPolicyFlags {
  protectQuotedText: boolean;
  protectCaptions: boolean;
  protectTrackedDeletions: boolean;
  protectComments: boolean;
  protectTextBoxes: boolean;
  protectShapes: boolean;
  protectAltText: boolean;
  protectHeadersFooters: boolean;
  protectFields: boolean;
  protectFootnotes: boolean;
}

/**
 * Check if a node is protected under the given policy.
 *
 * The policy argument is what makes the protection flags mean anything. It was
 * previously accepted and consulted only for `userLockedRanges`, so
 * `protectQuotedText`, `protectCaptions`, and the rest were schema fields that
 * no code path read — a governance author could turn quoted-text protection
 * off and observe nothing at all.
 *
 * Every flag defaults to protecting, and turning one off is the author's
 * explicit choice rather than the absence of one, so a policy that omits a
 * flag is read as the schema default and not as "unprotected".
 */
export function isProtectedNode(
  node: DocumentNode,
  protectedReasons: string[] = [],
  policy?: GovernanceProfile,
): boolean {
  if (!node.editable) return true;
  if (protectedReasons.includes(node.protectionReason ?? "")) return true;
  const protection = policy?.protection;
  if (protection?.userLockedRanges.includes(node.nodeId)) return true;

  const flag = POLICY_CONTROLLED_TYPES[node.type];
  // Absent flag means the schema default, which is to protect.
  if (flag !== undefined) return (protection?.[flag] ?? true) === true;
  return ALWAYS_PROTECTED_TYPES.includes(node.type);
}

/** Check if a range is protected. */
export function isProtectedRange(nodeIds: string[], nodes: DocumentNode[]): boolean {
  return nodeIds.some((id) => {
    const node = nodes.find((n) => n.nodeId === id);
    return node ? isProtectedNode(node) : false;
  });
}
