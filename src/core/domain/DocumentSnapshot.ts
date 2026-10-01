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
    /*
     * `section` and the header/footer pair were added with the section scope
     * (spec §8.4, §8.5).
     *
     * `analysis/deterministic/coverage.ts` counts `sectionsExamined` and
     * `headersFootersExamined` by looking for nodes of these types, so without
     * them a scan that read every section reported zero sections examined —
     * indistinguishable from a document that has none. `header` and `footer`
     * were already here; the count sums them rather than adding a
     * `headerFooter` type, because Word's own model distinguishes the two and a
     * merged type would have to choose one.
     */
    "section",
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
      /**
       * Whether this report covers only part of the acquired document.
       *
       * This was `z.literal(false)`, which meant a narrowed run could not be
       * represented at all: `buildCoverage` set the field from the caller's
       * `incremental` flag, so every narrowed scan failed its own schema parse
       * and was reported as a failed scan. The literal was accurate only while
       * the flag was hardcoded, and it silently invalidated the incremental
       * path the moment the observer started setting it.
       */
      incremental: z.boolean(),
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
  /**
   * Everything acquired was excluded from governance by policy.
   *
   * Not a failure and not an `unprocessed` entry. It is the state a document
   * reaches when every paragraph is protected — most often because each one
   * contains a double-quoted span, which a style guide or an editorial memo
   * has throughout. The distinction matters because `complete` gates Apply, and
   * reporting a policy outcome as a processing gap denied Apply on documents
   * that were read end to end.
   */
  protectedOnly: z.boolean().default(false),
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

/**
 * The node-id prefix a host-assigned paragraph id carries.
 *
 * Exported because two modules hold the host's raw `uniqueLocalId` and have to
 * recognise the node built from it: the acquisition, and the semantic selection
 * anchor. Re-deriving the prefix in each would let the two drift, and a mismatch
 * would read as "this paragraph is not the one you selected" rather than as the
 * bug it is.
 */
export const WORD_PARAGRAPH_NODE_PREFIX = "word-paragraph-";

/** The node id a host paragraph id corresponds to, without needing its index. */
export function wordParagraphNodeId(uniqueLocalId: string): string {
  return `${WORD_PARAGRAPH_NODE_PREFIX}${uniqueLocalId.trim()}`;
}

/** Stable identity for a Word paragraph, preferring the host's local ID. */
export function buildParagraphNodeId(input: {
  uniqueLocalId?: string;
  index: number;
  text: string;
}): string {
  if (input.uniqueLocalId && input.uniqueLocalId.trim().length > 0) {
    return wordParagraphNodeId(input.uniqueLocalId);
  }
  return buildNodeId("paragraph", `fallback:${input.index}:${hashText(input.text)}`);
}
