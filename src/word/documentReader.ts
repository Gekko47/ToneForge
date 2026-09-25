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
  buildParagraphNodeId,
} from "../core/domain/DocumentSnapshot";

export interface DocumentSnapshot {
  id: string;
  /** Compatibility alias for the explicit analysis text. */
  text: string;
  fullText?: string;
  analysisText?: string;
  analysisStart?: number;
  analysisEnd?: number;
  analysisTruncated?: boolean;
  documentVersion?: string;
  paragraphs: string[];
  sentences: string[];
  wordCount: number;
  capturedAt: string;
  /** Complete-document identity, never the bounded analysis-window hash. */
  fullDocumentHash?: string;
  /** Compatibility alias for the complete-document hash. */
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
    const analysisText = fullText.slice(0, maxChars);
    const analysisStart = 0;
    const analysisEnd = analysisText.length;
    const analysisTruncated = fullText.length > maxChars;
    const fullDocumentHash = hashDocument(fullText);

    // Stable document ID: prefer Office.Context.document.id when available,
    // otherwise hash the full text.
    const anyContext = context as unknown as {
      document?: { id?: string; url?: string; properties?: { title?: string } };
    };
    const docId = anyContext.document?.id ?? fullDocumentHash;
    const capturedAt = new Date().toISOString();

    return {
      id: docId,
      text: analysisText,
      fullText,
      analysisText,
      analysisStart,
      analysisEnd,
      analysisTruncated,
      documentVersion: `${capturedAt}:${fullDocumentHash}`,
      paragraphs: splitParagraphs(analysisText),
      sentences: splitSentences(analysisText),
      wordCount: countWords(analysisText),
      capturedAt,
      fullDocumentHash,
      // Legacy `hash` remains analysis-window compatible; freshness consumers
      // must use `fullDocumentHash`.
      hash: hashDocument(analysisText),
    };
  });
}

export interface LiveSelection {
  text: string;
  start: number;
  end: number;
}

export async function getSelectionText(): Promise<string> {
  const selection = await getLiveSelection();
  return selection?.text ?? "";
}

export async function getLiveSelection(): Promise<LiveSelection | null> {
  return runInWord(async (context) => {
    const range = context.document.getSelection() as Office.Range & {
      start?: number;
      end?: number;
    };
    range.load("text", "start", "end");
    await context.sync();
    if (
      typeof range.start !== "number" ||
      typeof range.end !== "number" ||
      range.start < 0 ||
      range.end < range.start
    ) {
      return null;
    }
    return { text: range.text ?? "", start: range.start, end: range.end };
  });
}

/** Read the complete paragraph containing the current selection or insertion point. */
export async function getSelectedParagraphText(): Promise<string> {
  return runInWord(async (context) => {
    const selection = context.document.getSelection();
    const paragraphs = selection.paragraphs as unknown as {
      getFirst?: () => { load: (property: string) => unknown; text?: string };
    };
    if (typeof paragraphs.getFirst !== "function") return "";
    const paragraph = paragraphs.getFirst();
    paragraph.load("text");
    await context.sync();
    return paragraph.text ?? "";
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

interface WordParagraphView {
  text?: string;
  style?: string | { name?: string };
  styleBuiltIn?: string;
  uniqueLocalId?: string;
  isListItem?: boolean;
  load?: (properties: string | string[]) => unknown;
}

/**
 * Build a structured node graph from Word's paragraph collection. The text
 * fallback remains available for hosts that do not expose the collection, but
 * it is explicitly reported as unsupported structural coverage.
 */
export async function getStructuredSnapshot(
  opts: ChunkOptions = {},
): Promise<DocumentSnapshotSchemaType> {
  const maxChars = opts.maxChars ?? 500_000;
  return runInWord(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    body.load("text");
    paragraphs?.load("items");
    await context.sync();

    const fullText = body.text ?? "";
    const analysisText = fullText.slice(0, maxChars);
    const items = Array.isArray(paragraphs?.items) ? (paragraphs.items as WordParagraphView[]) : [];
    items.forEach((paragraph) => {
      paragraph.load?.(["text", "style", "styleBuiltIn", "uniqueLocalId", "isListItem"]);
    });
    await context.sync();

    const fromCollection = items.length > 0;
    const fallbackRanges = fromCollection ? [] : splitParagraphRanges(analysisText);
    let paragraphOffset = 0;
    const nodes: DocumentNode[] = items.map((paragraph, index) => {
      const node = buildParagraphNode(paragraph, index, fromCollection);
      const text = node.text ?? "";
      const startOffset = fullText.indexOf(text, paragraphOffset);
      const resolvedStart = startOffset >= 0 ? startOffset : paragraphOffset;
      const endOffset = resolvedStart + text.length;
      paragraphOffset = endOffset;
      return {
        ...node,
        sourceRange: {
          nodeId: node.nodeId,
          paragraphIndex: index,
          structuralPath: node.sourcePath,
          startOffset: resolvedStart,
          endOffset,
        },
      };
    });
    fallbackRanges.forEach(({ text, start, end }, index) => {
      const nodeId = buildParagraphNodeId({ index, text });
      const nodeType = /^(?:Heading\s*|\s*Heading)([1-9])\b/i.test(text) ? "heading" : "paragraph";
      nodes.push(
        DocumentNodeSchema.parse({
          nodeId,
          type: nodeType,
          text,
          sourcePath: `body/paragraph/${index}`,
          sourceRange: {
            nodeId,
            paragraphIndex: index,
            startOffset: start,
            endOffset: end,
            structuralPath: `body/paragraph/${index}`,
          },
          editable: true,
          includedInGovernance: true,
          includedInAIReview: true,
        }),
      );
    });

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
    const structuralHash = hashText(
      allNodes.map((node) => `${node.nodeId}:${node.type}:${node.sourcePath}`).join("|"),
    );
    const anyContext = context as unknown as { document?: { id?: string } };
    const capturedAt = new Date().toISOString();

    return DocumentSnapshotSchema.parse({
      documentId: anyContext.document?.id ?? contentHash,
      versionToken: `${capturedAt}:${contentHash}`,
      contentHash,
      structuralHash,
      capturedAt,
      fullText,
      analysisText,
      analysisStart: 0,
      analysisEnd: analysisText.length,
      analysisTruncated: fullText.length > maxChars,
      acquisition: {
        paragraphsFromWordCollection: fromCollection,
        structuralCoverage: fromCollection ? "partial" : "unsupported",
        unsupported: fromCollection
          ? ["tables", "headers", "footers", "sections", "fields", "controls", "shapes"]
          : ["wordParagraphCollection"],
      },
      nodes: allNodes,
    });
  });
}

function buildParagraphNode(paragraph: WordParagraphView, index: number, fromCollection: boolean) {
  const text = typeof paragraph.text === "string" ? paragraph.text : "";
  const styleName =
    typeof paragraph.style === "string"
      ? paragraph.style
      : typeof paragraph.style?.name === "string"
        ? paragraph.style.name
        : "Normal";
  const headingMatch = /^(?:Heading\s*([1-9])|Heading([1-9]))$/i.exec(
    paragraph.styleBuiltIn ?? styleName,
  );
  const nodeType = headingMatch ? "heading" : paragraph.isListItem ? "listItem" : "paragraph";
  const sourcePath = `body/paragraph/${index}`;
  const nodeId = buildParagraphNodeId({
    ...(paragraph.uniqueLocalId ? { uniqueLocalId: paragraph.uniqueLocalId } : {}),
    index,
    text,
  });
  return DocumentNodeSchema.parse({
    nodeId,
    type: nodeType,
    text,
    sourcePath,
    sourceRange: {
      nodeId,
      paragraphIndex: index,
      structuralPath: sourcePath,
    },
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
    ...(fromCollection ? {} : {}),
  });
}

export interface ParagraphRange {
  text: string;
  start: number;
  end: number;
}

/** Split paragraphs while retaining exact offsets into the full body text. */
export function splitParagraphRanges(text: string): ParagraphRange[] {
  const ranges: ParagraphRange[] = [];
  const separator = /\n\s*\n/g;
  let cursor = 0;
  for (const match of text.matchAll(separator)) {
    appendTrimmedRange(ranges, text, cursor, match.index ?? cursor);
    cursor = (match.index ?? cursor) + match[0].length;
  }
  appendTrimmedRange(ranges, text, cursor, text.length);
  return ranges;
}

function appendTrimmedRange(
  ranges: ParagraphRange[],
  text: string,
  rawStart: number,
  rawEnd: number,
): void {
  const leading = text.slice(rawStart, rawEnd).search(/\S/);
  if (leading < 0) return;
  const raw = text.slice(rawStart, rawEnd);
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const start = rawStart + leading;
  ranges.push({ text: raw.trim(), start, end: rawEnd - trailingWhitespace });
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
