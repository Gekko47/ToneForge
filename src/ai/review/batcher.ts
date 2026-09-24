import { type DocumentNode } from "../../core/domain/DocumentSnapshot";

export interface ReviewBatch {
  index: number;
  nodeIds: string[];
  text: string;
  characterCount: number;
  startOffset: number;
}

export interface BatcherOptions {
  maxCharacters?: number;
  maxNodes?: number;
}

const DEFAULT_MAX_CHARACTERS = 8000;
const DEFAULT_MAX_NODES = 20;

/** Partition editable nodes in document order into bounded review batches. */
export function partitionReviewBatches(
  nodes: readonly DocumentNode[],
  options: BatcherOptions = {},
): ReviewBatch[] {
  const maxCharacters = Math.max(1, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS);
  const maxNodes = Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES);
  const batches: ReviewBatch[] = [];
  let current: DocumentNode[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.map((node) => node.text ?? "").join("\n");
    batches.push({
      index: batches.length,
      nodeIds: current.map((node) => node.nodeId),
      text,
      characterCount: text.length,
      startOffset: current[0]?.sourceRange?.startOffset ?? 0,
    });
    current = [];
  };

  const appendChunks = (node: DocumentNode, text: string): void => {
    if (text.length === 0) return;
    const chunks = Math.ceil(text.length / maxCharacters);
    Array.from({ length: chunks }, (_, index) => index).forEach((index) => {
      const start = index * maxCharacters;
      const chunk = text.slice(start, start + maxCharacters);
      const sourceRange = node.sourceRange;
      batches.push({
        index: batches.length,
        nodeIds: [node.nodeId],
        text: chunk,
        characterCount: chunk.length,
        startOffset: (sourceRange?.startOffset ?? 0) + start,
      });
    });
  };

  nodes.forEach((node) => {
    if (!node.editable || node.protectionReason || !node.includedInAIReview) return;
    const text = node.text ?? "";
    if (text.length > maxCharacters) {
      flush();
      appendChunks(node, text);
      return;
    }
    const projected =
      current.reduce((sum, item) => sum + (item.text?.length ?? 0) + 1, 0) + text.length;
    if (current.length >= maxNodes || projected > maxCharacters) flush();
    current.push(node);
  });
  flush();
  return batches;
}
