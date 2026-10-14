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
 * Read the body as Word currently sees it — `body.text`, revisions and all.
 *
 * Kept separate from `readReviewedText` so callers that need the literal text
 * (for example a scope that is about the document as typed) can say so. Analysis
 * must NOT use this: `body.text` still contains text marked for deletion by a
 * tracked revision until that revision is accepted.
 */
export async function readBodyText(): Promise<string> {
  return runInWord(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return body.text ?? "";
  });
}

export interface ReviewedText {
  /** The accept-all body text: only what is currently in the document. */
  text: string;
  /**
   * Whether the host served the accept-all view.
   *
   * `false` means this host predates WordApi 1.4 `getReviewedText`, so `text`
   * is the fallback `body.text` and may still contain text marked for deletion.
   * Every consumer that exists to catch a red-line must treat that as "unknown",
   * never as "clean".
   */
  reviewed: boolean;
}

/**
 * Read the body as a reviewer sees it — the accept-all view.
 *
 * Word keeps text marked for deletion in `body.text` until the tracked revision
 * is accepted. A deterministic scan reading `body.text` therefore re-reports a
 * finding whose correction ToneForge already applied, which is the red-line
 * loop the pane was stuck in. `Body.getReviewedText("Current")` (WordApi 1.4)
 * omits that text, so the scan reads exactly what ToneForge has accepted and
 * written.
 *
 * The capability is probed, not assumed: hosts older than WordApi 1.4 have no
 * `getReviewedText`, and calling it would throw. When it is absent the reader
 * falls back to `body.text` and says so through `reviewed: false`, so callers
 * can degrade to "unknown" rather than claim a clean document.
 *
 * One documented consequence: revisions ToneForge applies are authored as the
 * signed-in user, so `Current` also reads a pending revision the user made as
 * accepted. That is recorded in an ADR, not hidden here.
 */
/** The subset of `Word.Body` this reader needs, so the module stays `Word`-free. */
type ReviewableBody = {
  text: string;
  load: (prop: string | string[]) => unknown;
  getReviewedText?: (version?: string) => { value: string; load?: (prop: string) => unknown };
};

/**
 * Read the accept-all body text inside an existing `runInWord` transaction.
 *
 * Convenience wrapper over [`readBodyTextViews`] for callers that need only the
 * accept-all view.
 */
/**
 * Both body views, read by a single `body.load("text")`.
 *
 * Findings are addressed by `body.getRange("Whole").set({start, end})`, and
 * `Range.set`/`Range.select` count every character Word holds, including text a
 * tracked revision has marked for deletion. `getReviewedText("Current")` omits
 * that text, so an offset located against the accept-all view lands too early in
 * the raw view — and the offset error grows with every character of tracked
 * deletion that precedes it. Detection reads the accept-all view (an applied
 * correction must not reappear); offsets read the raw view. See ADR-0144.
 *
 * The two views are read from one `load` so a caller that already holds a
 * transaction issues one full-body read, not two.
 *
 * `getReviewedText` is called as a method on `body`, and never extracted into a
 * local first: Office.js client-object methods read their request context from
 * `this`, and an unbound call throws inside the host — which a mock whose
 * `getReviewedText` is an arrow function (ignoring `this`) can never reproduce.
 *
 * A host whose `getReviewedText` is absent makes no distinction between the two
 * views, so the accept-all text doubles as the raw text and `reviewed: false` says
 * so; callers must treat that as "unknown", never as "clean".
 */
export interface BodyTextViews {
  /** Accept-all text: only what is currently in the document. */
  fullText: string;
  /** Raw text (`body.text`): every character Word holds, revisions and all. */
  rawText: string;
  /** Whether the host served the accept-all view. */
  reviewed: boolean;
}

export async function readBodyTextViews(context: Office.Context): Promise<BodyTextViews> {
  const body = context.document.body as unknown as ReviewableBody;
  body.load("text");
  await context.sync();
  const rawText = body.text ?? "";
  /*
   * `getReviewedText` availability is detected by method presence, not by
   * requirement-set version: the same method is exposed under different
   * requirement sets on Word Desktop and Word Web, so a version gate is
   * unreliable. If the method exists, call it; otherwise fall back to raw text.
   */
  if (typeof body.getReviewedText !== "function") {
    return { fullText: rawText, rawText, reviewed: false };
  }
  /*
   * `getReviewedText` returns a Range client object whose `value` property
   * must be loaded independently — `body.load("text")` does not automatically
   * load properties on child objects. Load `value` on the returned range and
   * sync again before reading it. Without the second sync, reading `.value`
   * throws `ValueNotLoaded` on a real host.
   */
  const reviewedRange = body.getReviewedText("Current") as {
    value?: string;
    load?: (prop: string) => unknown;
  };
  reviewedRange.load?.("value");
  try {
    await context.sync();
  } catch {
    // The reviewed-range sync can fail on a real host; fall back to raw text.
    return { fullText: rawText, rawText, reviewed: false };
  }
  // An empty reviewed text is a legitimate result, not a failure: the accept-all
  // view of a body whose every paragraph is a pending deletion is empty.
  return { fullText: reviewedRange.value ?? "", rawText, reviewed: true };
}

export async function readBodyTextIn(context: Office.Context): Promise<string> {
  return (await readBodyTextViews(context)).fullText;
}

export async function readReviewedText(): Promise<ReviewedText> {
  return runInWord(async (context) => {
    const body = context.document.body as unknown as ReviewableBody;
    if (typeof body.getReviewedText === "function") {
      try {
        const reviewed = body.getReviewedText("Current") as { value: string };
        return { text: reviewed.value, reviewed: true };
      } catch {
        // Fall through to raw text
      }
    }
    const text = await readBodyTextIn(context);
    return { text, reviewed: false };
  });
}

/**
 * Read the document body in chunks to avoid exceeding Word JS limits
 * on very large documents.
 */
export async function getDocumentSnapshot(opts: ChunkOptions = {}): Promise<DocumentSnapshot> {
  const maxChars = opts.maxChars ?? 500_000;
  return runInWord(async (context) => {
    // The accept-all view, so a correction ToneForge already applied is not
    // re-reported on the next scan (see `readReviewedText`).
    const fullText = await readBodyTextIn(context);
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
    // An **array**, not three arguments. `load` takes one; the host loads the
    // first positional argument and ignores the rest, so the variadic form
    // compiles and throws on the next line in a real Word (ADR-0100).
    range.load(["text", "start", "end"]);
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
  getRange?: (rangeLocation: string) => {
    load?: (properties: string | string[]) => unknown;
    start?: number;
    end?: number;
  };
  startOffset?: number;
  endOffset?: number;
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
    /*
     * Both views in one read. Detection uses the accept-all view — an applied
     * correction must not reappear as a finding — while finding offsets are located
     * against the raw view, which is what `Range.set`/`Range.select` count.
     * See ADR-0144.
     */
    const { fullText, rawText } = await readBodyTextViews(context);
    paragraphs?.load("items");
    await context.sync();

    const analysisText = fullText.slice(0, maxChars);
    const items = Array.isArray(paragraphs?.items) ? (paragraphs.items as WordParagraphView[]) : [];
    items.forEach((paragraph) => {
      paragraph.load?.(["text", "style", "styleBuiltIn", "uniqueLocalId", "isListItem"]);
    });
    await context.sync();

    /*
     * Paragraph offsets from the Word range API.
     *
     * `Paragraph.getRange("Whole")` (WordApi 1.1) returns the paragraph's own range
     * with `start`/`end` offsets in the raw body text — the same coordinate space
     * `Range.set`/`Range.select` count. This replaces the `indexOf` reconstruction
     * that previously searched for each paragraph's text in `rawText`.
     *
     * The read is isolated per paragraph: a host that refuses `getRange` for one
     * paragraph costs that paragraph's offsets, not the whole scan.
     */
    if (context.requirements?.isSetSupported?.("WordApiDesktop", "1.4") === true) {
      const rangeProxies: Array<{ start?: number; end?: number } | null> = [];
      items.forEach((paragraph) => {
        if (typeof paragraph.getRange !== "function") {
          rangeProxies.push(null);
          return;
        }
        try {
          const range = paragraph.getRange("Whole");
          range?.load?.(["start", "end"]);
          rangeProxies.push(range);
        } catch {
          rangeProxies.push(null);
        }
      });
      try {
        await context.sync();
      } catch {
        // sync failure: offsets unavailable; the loop below falls back.
      }
      items.forEach((paragraph, i) => {
        const range = rangeProxies[i];
        if (range && typeof range.start === "number" && typeof range.end === "number") {
          paragraph.startOffset = range.start;
          paragraph.endOffset = range.end;
        }
      });
    }

    const fromCollection = items.length > 0;
    let paragraphOffset = 0;
    const nodes: DocumentNode[] = items.map((paragraph, index) => {
      const node = buildParagraphNode(paragraph, index, fromCollection);
      const text = node.text ?? "";
      /*
       * Offsets come from the Word range API (`Paragraph.getRange("Whole")`), which
       * serves them in the raw body text — the same coordinate space
       * `Range.set`/`Range.select` count. The `indexOf` fallback is kept only for
       * hosts that do not serve range offsets.
       *
       * The range API counts every character Word holds, including text a tracked
       * revision has marked for deletion. See ADR-0144.
       */
      const rangeStart = paragraph.startOffset;
      const rangeEnd = paragraph.endOffset;
      let resolvedStart: number;
      if (rangeStart !== undefined) {
        resolvedStart = rangeStart;
      } else {
        const startOffset = rawText.indexOf(text, paragraphOffset);
        resolvedStart = startOffset >= 0 ? startOffset : paragraphOffset;
      }
      const endOffset = rangeEnd ?? resolvedStart + text.length;
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
