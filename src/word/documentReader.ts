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
}

export async function getDocumentSnapshot(): Promise<DocumentSnapshot> {
  return runInWord(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    const text = body.text ?? "";
    return {
      id: context.document.url ?? "unknown",
      text,
      paragraphs: splitParagraphs(text),
      sentences: splitSentences(text),
      wordCount: countWords(text),
      capturedAt: new Date().toISOString(),
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
