/**
 * Read-only document access layer.
 * Returns plain DTOs (no Office objects leak out) so deterministic engines
 * can be tested without Word.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { splitParagraphs, splitSentences, countWords } from "../shared/utils/text";

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
