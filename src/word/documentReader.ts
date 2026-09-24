/**
 * Read-only document access layer.
 * Returns plain DTOs (no Office objects leak out) so deterministic engines
 * can be tested without Word.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { splitParagraphs, splitSentences, countWords, hashText } from "../shared/utils/text";
import {
  DocumentSnapshotSchema,
  type DocumentSnapshot as DocumentSnapshotSchemaType,
  DocumentNodeSchema,
  type DocumentNode,
  buildNodeId,
} from "../core/domain/DocumentSnapshot";

export interface DocumentSnapshot {
  id: string;
  text: string;
  paragraphs: string[];
  sentences: string[];
  wordCount: number;
  capturedAt: string;
  hash?: string;
}

/** FNV-1a 32-bit hash — fast, deterministic, good enough for stale guards. */
export function hashDocument(text: string): string {
  return [...text]
    .reduce((hash, char) => {
      const h = (hash ^ char.charCodeAt(0)) >>> 0;
      return (h * 16777619) >>> 0;
    }, 2166136261)
    .toString(16)
    .padStart(8, "0");
}

export interface ChunkOptions {
  maxChars?: number;
}

/**
 * Read the document body in chunks to avoid exceeding Word JS limits
 * on very large documents.
 */
export async function getDocumentSnapshot(opts: ChunkOptions = {}): Promise<DocumentSnapshot> {
  const maxChars = opts.maxChars ?? 500_000;
  return runInWord(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    const fullText = body.text ?? "";
    const text = fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

    // Stable document ID: prefer Office.Context.document.id when available,
    // otherwise hash the full text.
    const anyContext = context as unknown as {
      document?: { id?: string; url?: string };
    };
    const docId = anyContext.document?.id ?? hashDocument(fullText);

    return {
      id: docId,
      text,
      paragraphs: splitParagraphs(text),
      sentences: splitSentences(text),
      wordCount: countWords(text),
      capturedAt: new Date().toISOString(),
      hash: hashDocument(text),
    };
  });
}

export async function getSelectionText(): Promise<string> {
  return runInWord(async (context) => {
    const range = context.document.getSelection();
    range.load("text");
    await context.sync();
    return range.text ?? "";
  });
}

/** Read a specific paragraph range by index. */
export async function getParagraphRange(startIndex: number, count: number): Promise<string[]> {
  return runInWord(async (context) => {
    const body = context.document.body as unknown as {
      paragraphs?: { load: (p: string) => unknown; items: unknown[] };
    };
    const paragraphs = body.paragraphs;
    if (!paragraphs) return [];
    paragraphs.load("items");
    await context.sync();
    const items = paragraphs.items ?? [];
    const target = items.slice(startIndex, startIndex + count);
    // Load `text` on each paragraph and sync again before reading it.
    // Without this second sync, paragraph.text is still a proxy and will
    // always resolve to an empty string in a real Word host.
    for (const p of target) {
      const para = p as { load?: (prop: string) => unknown };
      if (typeof para.load === "function") para.load("text");
    }
    await context.sync();
    return target.map((p: unknown) => {
      const para = p as { text?: string };
      return typeof para.text === "string" ? para.text : "";
    });
  });
}

/**
 * Build a structured node graph snapshot alongside the text-only snapshot.
 * The node graph is additive — the text path remains the live-proven path.
 */
export async function getStructuredSnapshot(): Promise<DocumentSnapshotSchemaType> {
  const textSnapshot = await getDocumentSnapshot();
  const fullText = textSnapshot.text;
  const paragraphs = splitParagraphs(fullText);

  const nodes: DocumentNode[] = paragraphs.map((paraText, index) => {
    const isHeading = paraText.match(/^(Heading\s*\d+\s*:?\s*)/i) !== null;
    const nodeType = isHeading ? "heading" : "paragraph";
    const sourcePath = `body/paragraph/${index}`;
    return DocumentNodeSchema.parse({
      nodeId: buildNodeId(nodeType, sourcePath),
      type: nodeType,
      text: paraText,
      sourcePath,
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
  });

  // Add a body node
  const bodyNode = DocumentNodeSchema.parse({
    nodeId: buildNodeId("body", "body"),
    type: "body",
    sourcePath: "body",
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
  });

  const allNodes = [bodyNode, ...nodes];
  const contentHash = hashDocument(fullText);
  const structuralHash = hashText(allNodes.map((n) => `${n.type}:${n.sourcePath}`).join("|"));

  return DocumentSnapshotSchema.parse({
    documentId: textSnapshot.id,
    versionToken: `${textSnapshot.capturedAt}:${contentHash}`,
    contentHash,
    structuralHash,
    capturedAt: textSnapshot.capturedAt,
    nodes: allNodes,
  });
}

/**
 * Resolve a source range preferring nodeId + structuralPath when present,
 * falling back to character offsets for adapter compatibility.
 */
export function resolveSourceRange(
  nodeId: string | undefined,
  structuralPath: string | undefined,
  startOffset?: number,
  endOffset?: number,
): {
  nodeId: string | undefined;
  structuralPath: string | undefined;
  start: number | undefined;
  end: number | undefined;
} {
  if (nodeId || structuralPath) {
    return {
      nodeId,
      structuralPath,
      start: startOffset,
      end: endOffset,
    };
  }
  return {
    nodeId: undefined,
    structuralPath: undefined,
    start: startOffset,
    end: endOffset,
  };
}
