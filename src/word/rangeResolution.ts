/**
 * Resolving a captured selection to a range the adapter can actually resolve.
 *
 * **Why this is its own module.** A semantic revision is written as a character
 * range, and `getRangeByChange` resolves a character-unit change through
 * `body.getRange("Whole").set({ start, end })`. `Range.set` is **WordApiDesktop
 * 1.4** and is absent on Word on the web — the same reason `PageSetup` is
 * optional in `office.d.ts`. A paragraph-unit change does not need it: it goes
 * through `Paragraph.getRange("Whole")` on WordApi 1.1.
 *
 * So there are two ways to write the same text and one of them is not available
 * everywhere. Deciding between them before the write — rather than discovering
 * the absence as a host exception mid-apply — is what this module is for.
 *
 * **The index problem.** A paragraph-unit target needs a *body* paragraph index,
 * because that is what `body.paragraphs.items[index]` means. The selection's own
 * paragraph collection is relative to the selection, so `word/selectionScope.ts`
 * cannot supply one: asking for it would mean the whole-document read that
 * selection-scope capture exists to remove. The index is therefore resolved here,
 * against the snapshot the apply path already reads, by matching the anchor's
 * captured offsets against each node's source range.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { logger } from "../shared/utils/logger";
import type { SemanticSelectionAnchor } from "../core/domain/SemanticReviewSession";
import { wordParagraphNodeId, type DocumentNode } from "../core/domain/DocumentSnapshot";

/**
 * Whether this host can replace a character range at all.
 *
 * A guarded, non-destructive inspection of the object model — the same rule
 * ADR-0012 sets for the capability probe: nothing is written, and a host that
 * cannot answer reports `false` rather than throwing.
 */
export async function supportsRangedReplacement(): Promise<boolean> {
  try {
    return await runInWord(async (context) => {
      const range = context.document.getSelection() as unknown as {
        set?: (properties: { start?: number; end?: number }) => unknown;
      };
      return typeof range?.set === "function";
    });
  } catch {
    logger.warn("Ranged replacement could not be established on this host", {
      verificationResult: "refused",
      refusalCategory: "ranged_replacement_unavailable",
    });
    return false;
  }
}

/**
 * The body paragraph index the anchor names, or `null` when it names none.
 *
 * Two conditions, both required, because either alone would be a guess:
 *
 * - the node's source range **exactly** covers the anchor's offsets, so a
 *   selection covering two paragraphs, or part of one, resolves to nothing;
 * - when the anchor carries paragraph ids, the node is one of them, so a
 *   paragraph that happens to sit at the right offsets but is not the one the
 *   user pointed at is not substituted for it.
 *
 * `null` is the honest answer whenever the host gave no ids and the offsets do
 * not line up with a paragraph, and the caller falls back to the character path.
 */
export function resolveWholeParagraphIndex(
  anchor: SemanticSelectionAnchor,
  nodes: readonly DocumentNode[],
): number | null {
  const candidates = nodes.filter((node) => {
    const range = node.sourceRange;
    if (range === undefined) return false;
    if (range.startOffset !== anchor.startOffset || range.endOffset !== anchor.endOffset) {
      return false;
    }
    if (anchor.nodeIds.length === 0) return true;
    // The anchor holds the host's raw `uniqueLocalId`; the node holds the id built
    // from it. `wordParagraphNodeId` is the one place that relationship is stated,
    // so this comparison cannot drift from the acquisition's.
    return anchor.nodeIds.some((id) => wordParagraphNodeId(id) === node.nodeId);
  });
  if (candidates.length !== 1) return null;
  return candidates[0]?.sourceRange?.paragraphIndex ?? null;
}

/**
 * What a user is told when a partial selection cannot be written on this host.
 *
 * Named as a constant rather than written at the call site, because it is a
 * promise: the refusal says the remedy is to select a whole paragraph, and that
 * has to be true on every host that prints it. The whole-paragraph path is
 * preferred for exactly that reason.
 */
export const PARTIAL_SELECTION_REFUSAL =
  "This version of Word cannot replace part of a paragraph. Select the whole paragraph and review it again; nothing has been changed.";
