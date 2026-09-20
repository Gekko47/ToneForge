/**
 * Writing sample capture.
 *
 * Pure functions that accept already-read DTOs (DocumentSnapshot or a plain
 * selection string) so they can be unit-tested without Word. The actual
 * Office.js read lives in `word/documentReader.ts`; this module only decides
 * *which* text to use as the sample.
 *
 * Boundary rule: this module must NOT import from `word/`, `ai/`, `ui/`, or
 * `Office` — it only consumes DTOs.
 */

import type { DocumentSnapshot } from "../word/documentReader";
import { splitParagraphs, splitSentences, countWords } from "../shared/utils/text";

export interface SampleCaptureOptions {
  /** Prefer the user's selection when non-empty; fall back to the snapshot. */
  preferSelection?: boolean;
  /** Cap the sample to this many characters. */
  maxChars?: number;
}

export interface CapturedSample {
  text: string;
  paragraphs: string[];
  sentences: string[];
  wordCount: number;
  source: "selection" | "document";
  documentId?: string;
  capturedAt?: string;
}

/**
 * Build a captured sample from a selection string and a document snapshot.
 *
 * When `preferSelection` is true (default) and the selection is non-empty,
 * the selection wins. Otherwise the document snapshot is used. Both inputs
 * may be empty; the result is then an empty sample.
 */
export function captureSample(
  selection: string,
  snapshot: DocumentSnapshot,
  opts: SampleCaptureOptions = {},
): CapturedSample {
  const preferSelection = opts.preferSelection ?? true;
  const maxChars = opts.maxChars ?? 500_000;

  const selectionTrimmed = selection.trim();
  const useSelection = preferSelection && selectionTrimmed.length > 0;

  const rawText = useSelection ? selectionTrimmed : snapshot.text;
  const text = rawText.length > maxChars ? rawText.slice(0, maxChars) : rawText;

  return {
    text,
    paragraphs: splitParagraphs(text),
    sentences: splitSentences(text),
    wordCount: countWords(text),
    source: useSelection ? "selection" : "document",
    documentId: snapshot.id,
    capturedAt: snapshot.capturedAt,
  };
}

/** Build a captured sample from a plain text string (clipboard fallback). */
export function captureFromText(text: string, opts: SampleCaptureOptions = {}): CapturedSample {
  const maxChars = opts.maxChars ?? 500_000;
  const trimmed = text.trim();
  const bounded = trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
  return {
    text: bounded,
    paragraphs: splitParagraphs(bounded),
    sentences: splitSentences(bounded),
    wordCount: countWords(bounded),
    source: "document",
  };
}
