/**
 * DocumentSnapshot with node graph v1 — host-neutral document model.
 *
 * Boundary rule: core/domain must not import from `word`, `ai`, or `ui`.
 */

import { z } from "zod";
import { hashText } from "../../shared/utils/text";

// ── SourceRange ──────────────────────────────────────────────────────

export const SourceRangeSchema = z.object({
  nodeId: z.string(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  structuralPath: z.string().optional(),
});

export type SourceRange = z.infer<typeof SourceRangeSchema>;

// ── DocumentNode ─────────────────────────────────────────────────────

export const DocumentNodeSchema = z.object({
  nodeId: z.string(),
  type: z.enum([
    "body",
    "paragraph",
    "heading",
    "listItem",
    "table",
    "tableCell",
    "caption",
    "header",
    "footer",
    "footnote",
    "endnote",
    "comment",
    "textBox",
    "shape",
    "smartArt",
    "contentControl",
    "field",
    "image",
    "other",
  ]),
  text: z.string().optional(),
  sourcePath: z.string(),
  sourceRange: SourceRangeSchema.optional(),
  editable: z.boolean().default(true),
  includedInGovernance: z.boolean().default(true),
  includedInAIReview: z.boolean().default(true),
  protectionReason: z.string().optional(),
});

export type DocumentNode = z.infer<typeof DocumentNodeSchema>;

// ── Coverage ─────────────────────────────────────────────────────────

export const CoverageItemSchema = z.object({
  nodeType: z.string(),
  count: z.number().int().nonnegative(),
  processedCharacterCount: z.number().int().nonnegative(),
  revisedCharacterCount: z.number().int().nonnegative(),
  excluded: z
    .array(
      z.object({
        reason: z.string(),
        locations: z.array(z.string()).max(10),
      }),
    )
    .default([]),
});

export type CoverageItem = z.infer<typeof CoverageItemSchema>;

export const CoverageReportSchema = z.object({
  runId: z.string().uuid(),
  counts: z.array(CoverageItemSchema),
  processedCharacterCount: z.number().int().nonnegative(),
  revisedCharacterCount: z.number().int().nonnegative(),
  examinedNodeIds: z.array(z.string()).default([]),
  /** Human-readable acquisition diagnostics; never includes raw document text. */
  acquisition: z
    .object({
      acquisitionReadCount: z.number().int().nonnegative(),
      syncCount: z.number().int().nonnegative(),
      analyzedCharacterCount: z.number().int().nonnegative(),
      completeDocumentCharacterCount: z.number().int().nonnegative(),
      fullBodyReadCount: z.number().int().nonnegative(),
      paragraphCollectionRead: z.boolean(),
      incremental: z.literal(false),
      incrementalReason: z.string().trim().min(1),
    })
    .optional(),
  excluded: z
    .array(
      z.object({
        reason: z.string(),
        locations: z.array(z.string()).max(10),
      }),
    )
    .default([]),
  unsupported: z.array(z.string()).default([]),
  unprocessed: z.array(z.string()).default([]),
  plannedChangeCount: z.number().int().nonnegative().default(0),
  appliedChangeCount: z.number().int().nonnegative().default(0),
  changedNodeIds: z.array(z.string()).default([]),
  complete: z.boolean().default(true),
});

export type CoverageReport = z.infer<typeof CoverageReportSchema>;

// ── DocumentSnapshot ─────────────────────────────────────────────────

export const DocumentSnapshotSchema = z.object({
  documentId: z.string().trim().min(1),
  versionToken: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
  structuralHash: z.string().trim().min(1),
  capturedAt: z.string().datetime(),
  /** Complete body text loaded by the host; never bounded by the analysis limit. */
  fullText: z.string().optional(),
  /** Explicit analysis window over `fullText`. */
  analysisText: z.string().optional(),
  analysisStart: z.number().int().nonnegative().optional(),
  analysisEnd: z.number().int().nonnegative().optional(),
  analysisTruncated: z.boolean().optional(),
  acquisition: z
    .object({
      paragraphsFromWordCollection: z.boolean(),
      structuralCoverage: z.enum(["complete", "partial", "unsupported"]),
      unsupported: z.array(z.string().trim().min(1)).default([]),
    })
    .optional(),
  nodes: z.array(DocumentNodeSchema),
  coverage: CoverageReportSchema.optional(),
});

export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>;

/** Build a stable node ID from type and path. */
export function buildNodeId(type: string, path: string): string {
  return hashText(`${type}:${path}`).substring(0, 8);
}

/** Compute a structural hash from node type and path sequence. */
export function computeStructuralHash(nodes: readonly DocumentNode[]): string {
  const sequence = nodes.map((n) => `${n.type}:${n.sourcePath}`).join("|");
  return hashText(sequence);
}

/** Stable identity for a Word paragraph, preferring the host's local ID. */
export function buildParagraphNodeId(input: {
  uniqueLocalId?: string;
  index: number;
  text: string;
}): string {
  if (input.uniqueLocalId && input.uniqueLocalId.trim().length > 0) {
    return `word-paragraph-${input.uniqueLocalId.trim()}`;
  }
  return buildNodeId("paragraph", `fallback:${input.index}:${hashText(input.text)}`);
}
