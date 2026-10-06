/**
 * Section-hierarchy batching (original §7).
 *
 * The document is batched by its own structure — headings and
 * paragraphs — never by arbitrary character windows, so a long
 * report becomes one prompt per section rather than one enormous
 * prompt. Every paragraph gets a stable id, `p-<section>-<paragraph>`,
 * and its exact character span in the document text, so a claim's
 * quoted evidence can be located and proven against the document
 * afterwards.
 *
 * This module is pure: it reads the document snapshot the request
 * carries and invents nothing. Ids are assigned from position, so
 * the same document always batches the same way within a session.
 */

import type { ConsistencyDocument } from "../contracts";

/** One paragraph of the document, with its stable id and its span. */
export interface ExtractionParagraph {
  paragraphId: string;
  text: string;
  /** Character span within the document text. */
  startOffset: number;
  endOffset: number;
}

/** One extraction batch: a section and the paragraphs under it. */
export interface ExtractionBatch {
  batchId: string;
  sectionId: string;
  sectionTitle: string;
  sectionPath: string[];
  paragraphs: ExtractionParagraph[];
}

/**
 * A Markdown heading marker: one to six `#` marks, a space, then the
 * title. Headings are carried into the run text as Markdown markers
 * (see `ConsistencyDocument`), so the engine reads section identity
 * from the text itself rather than guessing at a style name.
 */
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * Batch the document by its section hierarchy.
 *
 * Each heading opens a section; the section path is the stack of
 * enclosing headings, so a subsection knows its ancestors. Text
 * before the first heading is the opening section. A single newline
 * is a soft wrap inside a paragraph; a blank line closes one. A
 * section with no paragraphs produces no batch — the model is never
 * called on empty content.
 */
export function buildExtractionBatches(document: ConsistencyDocument): ExtractionBatch[] {
  const batches: ExtractionBatch[] = [];
  // Splitting with a captured separator keeps the exact character
  // accounting: every line's span is known, so paragraph spans slice
  // back to their raw text whatever line endings the document has.
  const parts = document.text.split(/(\r?\n)/);

  let sectionIndex = 0;
  let sectionTitle = "";
  let sectionPath: string[] = [];
  const paragraphs: ExtractionParagraph[] = [];
  let paragraphIndex = 0;
  let paragraphFirstStart = -1;
  let paragraphLastEnd = -1;
  let paragraphHasContent = false;
  let lineOffset = 0;

  const closeParagraph = (): void => {
    if (paragraphHasContent) {
      paragraphs.push({
        paragraphId: `p-${sectionIndex}-${paragraphIndex}`,
        text: document.text.slice(paragraphFirstStart, paragraphLastEnd),
        startOffset: paragraphFirstStart,
        endOffset: paragraphLastEnd,
      });
      paragraphIndex += 1;
    }
    paragraphHasContent = false;
    paragraphFirstStart = -1;
    paragraphLastEnd = -1;
  };

  const closeSection = (): void => {
    closeParagraph();
    if (paragraphs.length > 0) {
      batches.push({
        batchId: `batch-${sectionIndex}`,
        sectionId: `section-${sectionIndex}`,
        sectionTitle,
        sectionPath: [...sectionPath],
        paragraphs: [...paragraphs],
      });
    }
    paragraphs.length = 0;
    paragraphIndex = 0;
  };

  // Pair each line with the separator that follows it, so the
  // walk below can account for every character exactly.
  const linePairs = Array.from({ length: Math.ceil(parts.length / 2) }, (_, pairIndex) => ({
    line: parts[pairIndex * 2] ?? "",
    separator: parts[pairIndex * 2 + 1] ?? "",
  }));

  linePairs.forEach(({ line, separator }) => {
    const lineStart = lineOffset;
    const lineEnd = lineStart + line.length;

    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      closeSection();
      const level = heading[1]?.length ?? 1;
      sectionIndex += 1;
      sectionTitle = heading[2] ?? "";
      sectionPath = sectionPath.slice(0, Math.max(level - 1, 0));
      sectionPath.push(sectionTitle);
    } else if (line.trim().length === 0) {
      closeParagraph();
    } else {
      if (!paragraphHasContent) {
        paragraphFirstStart = lineStart;
        paragraphHasContent = true;
      }
      paragraphLastEnd = lineEnd;
    }

    lineOffset = lineEnd + separator.length;
  });

  closeSection();
  return batches;
}
