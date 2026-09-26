import { type DocumentNode } from "../core/domain/DocumentSnapshot";

/**
 * Resolve a model-supplied anchor to a real span in a real document.
 *
 * A semantic finding used to carry `range: { start: 0, end: text.length }` and
 * `nodeIds: []` — the whole document, addressed by nobody. It could not be
 * planned, and `actionable: false` with a reason was the only honest thing the
 * engine could do with it. The fix is to require the model to quote the text it
 * is talking about and verify that quote against the acquired nodes.
 *
 * The three rules below are the whole contract:
 *
 * 1. **A quote that is not in the document is not evidence of anything.** A model
 *    that paraphrases must be refused, not fuzzy-matched. Paraphrase matching
 *    is how a finding ends up pointing at a sentence that says something else.
 * 2. **A quote that appears more than once is refused, not guessed.** "irregardless"
 *    twice in a document has two possible targets and no way to choose between
 *    them, and an edit to the wrong one is a silent corruption.
 * 3. **A node with no offsets cannot be addressed.** Findings carry character
 *    ranges, so a node without a source range offers nothing to point at.
 *
 * Pure, and independent of Office, so it is testable without a host.
 */

export type AnchorResolution =
  | { ok: true; nodeId: string; start: number; end: number }
  | { ok: false; reason: string };

/** The minimum a node needs before it can carry a character range. */
interface RangeableNode {
  nodeId: string;
  text?: string | null;
  sourceRange?: { startOffset: number } | undefined;
}

/**
 * Find the one node containing `anchor` exactly once.
 *
 * `anchor` is compared literally. No normalisation, no case folding, no
 * whitespace collapsing: the model was shown this exact text and asked to quote
 * it, so anything but an exact hit is a model that did not do what was asked.
 */
export function resolveAnchor(
  anchor: string,
  nodes: readonly (DocumentNode | RangeableNode)[],
): AnchorResolution {
  const needle = anchor.trim();
  if (needle.length === 0) {
    return { ok: false, reason: "The model did not quote the text it is describing." };
  }

  const hits: { nodeId: string; start: number; end: number }[] = [];
  for (const node of nodes as readonly RangeableNode[]) {
    const text = node.text ?? "";
    if (text.length === 0) continue;
    // Every occurrence within the node, not just the first: a second hit in the
    // same node is still two candidates, and refusing is the safe answer.
    let from = text.indexOf(needle);
    while (from !== -1) {
      hits.push({ nodeId: node.nodeId, start: from, end: from + needle.length });
      from = text.indexOf(needle, from + 1);
    }
  }

  if (hits.length === 0) {
    return {
      ok: false,
      reason:
        "The quoted text does not appear in the document, so there is no verified span to " +
        "edit. The model appears to have paraphrased.",
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason:
        `The quoted text appears ${hits.length} times, so there is no single span to edit. ` +
        "A finding with an ambiguous target is reported, not applied.",
    };
  }

  const hit = hits[0];
  if (hit === undefined) {
    return { ok: false, reason: "The quoted text could not be located." };
  }
  const node = (nodes as readonly RangeableNode[]).find((item) => item.nodeId === hit.nodeId);
  // A node with no source offset has no addressable position. Refusing is right:
  // emitting a range measured from the node's own text start would point into
  // whatever text happens to sit there in someone else's document.
  if (node?.sourceRange?.startOffset === undefined) {
    return {
      ok: false,
      reason:
        "The quoted text is in a node with no document offset, so the span cannot be " +
        "verified against the document.",
    };
  }
  return { ok: true, nodeId: hit.nodeId, start: hit.start, end: hit.end };
}
