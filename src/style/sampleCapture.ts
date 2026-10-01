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
import { splitParagraphs, splitSentences, countWords, hashText } from "../shared/utils/text";
import {
  SEMANTIC_SAMPLE_SOURCES,
  type SemanticSampleSource,
} from "../core/domain/SemanticReviewSession";

export interface SampleCaptureOptions {
  /** Prefer the user's selection when non-empty; fall back to the snapshot. */
  preferSelection?: boolean;
  /** Cap the sample to this many characters. */
  maxChars?: number;
  /**
   * How to attribute the sample. Defaults to `selection`.
   *
   * A parameter rather than a post-hoc assignment because `source` is the
   * evidence the learned profile is attributed to, and a sample whose origin is
   * patched after the fact is one a caller can get wrong without any check.
   */
  source?: SemanticSampleSource;
  /** The file's name, for a `.txt` import. Ignored unless `source` is `text_file`. */
  filename?: string;
}

/** Re-exported so `style/` callers need one import for a captured sample. */
export type { SemanticSampleSource };
export { SEMANTIC_SAMPLE_SOURCES };

export interface CapturedSample {
  text: string;
  paragraphs: string[];
  sentences: string[];
  wordCount: number;
  /**
   * Where the text came from.
   *
   * **Four named sources, not three, and none of them folded together.** The
   * evidence is shown to the user as the basis for a learned profile, so a
   * profile attributed to the wrong source is a claim the evidence cannot
   * support. `word_selection` and `word_document` were previously `selection` and
   * `document`, which read as though the user had selected the whole document —
   * and a `.txt` import reads as neither, so it needs its own name rather than
   * being filed under `pasted_text`.
   *
   * Widened from three to four in P1. The values are persisted — as part of
   * `semanticSampleEvidence` — which makes this the one type in `style/` that a
   * state migration has to agree with, and `SemanticSampleSourceSchema` in
   * `core/domain` is the single list both sides read.
   */
  source: SemanticSampleSource;
  /**
   * `hashText(text)` — identity of the sample without the sample.
   *
   * Present so persisted evidence can prove two captures were the same text
   * without either of them being kept. Not a content hash of the *document*:
   * that would require reading the document, which the selection path avoids.
   */
  sampleHash: string;
  /** The document this sample came from, when it came from one. */
  documentId?: string;
  /** The file this sample came from, when it came from a `.txt` import. */
  filename?: string;
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

  const rawText = useSelection ? selectionTrimmed : (snapshot.analysisText ?? snapshot.text);
  const text = rawText.length > maxChars ? rawText.slice(0, maxChars) : rawText;

  return {
    text,
    paragraphs: splitParagraphs(text),
    sentences: splitSentences(text),
    wordCount: countWords(text),
    sampleHash: hashText(text),
    source: opts.source ?? (useSelection ? "word_selection" : "word_document"),
    documentId: snapshot.id,
    capturedAt: snapshot.capturedAt,
  };
}

/**
 * Build a captured sample from a plain text string (clipboard or file import).
 *
 * The source defaults to `pasted_text`, which is what a bare string handed to
 * this function actually is. It used to say `document`, which is a different
 * claim: text the user pasted is neither their selection nor the document they
 * have open, and the learned profile is attributed to this value in the evidence
 * it shows. A wrong default here is not a naming slip — it is the record of where
 * a profile came from.
 *
 * A `.txt` import passes `source: "text_file"` and `filename`, and the two are
 * kept distinct because the file has a name the user chose and the paste does
 * not — which is the difference between "learned from expert-report.txt" and
 * "learned from text you pasted", as evidence the user can check.
 */
export function captureFromText(text: string, opts: SampleCaptureOptions = {}): CapturedSample {
  const maxChars = opts.maxChars ?? 500_000;
  const trimmed = text.trim();
  const bounded = trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
  const source = opts.source ?? "pasted_text";
  const capture: CapturedSample = {
    text: bounded,
    paragraphs: splitParagraphs(bounded),
    sentences: splitSentences(bounded),
    wordCount: countWords(bounded),
    sampleHash: hashText(bounded),
    source,
  };
  if (opts.filename !== undefined && source === "text_file") {
    return { ...capture, filename: opts.filename };
  }
  return capture;
}
