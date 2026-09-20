/**
 * Sample quality gate.
 *
 * Pure function that decides whether a captured sample is large and coherent
 * enough to feed the deterministic metrics and the semantic profiler.
 *
 * Boundary rule: no Office, LLM, or UI imports — pure functions only.
 */

import type { CapturedSample } from "./sampleCapture";

export interface SampleQuality {
  /** Whether the sample is usable for style learning. */
  pass: boolean;
  /** Human-readable reasons explaining the verdict. */
  reasons: string[];
  /** Effective word count after trimming. */
  wordCount: number;
  /** Effective sentence count. */
  sentenceCount: number;
}

export interface SampleQualityOptions {
  /** Minimum words required for a usable sample. Default 40. */
  minWords?: number;
  /** Minimum sentences required for a usable sample. Default 2. */
  minSentences?: number;
}

const DEFAULT_MIN_WORDS = 40;
const DEFAULT_MIN_SENTENCES = 2;

/**
 * Evaluate a captured sample against quality thresholds.
 *
 * A sample passes when it has at least `minWords` words and `minSentences`
 * sentences. Empty or whitespace-only text always fails.
 */
export function evaluateSampleQuality(
  sample: CapturedSample,
  opts: SampleQualityOptions = {},
): SampleQuality {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const minSentences = opts.minSentences ?? DEFAULT_MIN_SENTENCES;

  const reasons: string[] = [];
  const text = sample.text.trim();
  const wordCount = sample.wordCount;
  const sentenceCount = sample.sentences.length;

  if (text.length === 0) {
    return { pass: false, reasons: ["Sample text is empty."], wordCount, sentenceCount };
  }
  if (wordCount < minWords) {
    reasons.push(`Sample has ${wordCount} words; minimum is ${minWords}.`);
  }
  if (sentenceCount < minSentences) {
    reasons.push(`Sample has ${sentenceCount} sentences; minimum is ${minSentences}.`);
  }

  return {
    pass: reasons.length === 0,
    reasons,
    wordCount,
    sentenceCount,
  };
}
