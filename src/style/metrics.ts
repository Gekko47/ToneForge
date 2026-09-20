/**
 * Deterministic style metrics.
 *
 * Pure functions that derive a `MeasuredProfile` from a captured sample.
 * No Office, LLM, or UI imports — fully unit-testable without Word.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import type { MeasuredProfile } from "../core/domain/StyleProfile";
import {
  splitSentences,
  splitParagraphs,
  countWords,
  mean,
  stdDev,
  countSubstring,
  EM_DASH,
  EN_DASH,
  LEFT_DOUBLE_QUOTE,
  RIGHT_DOUBLE_QUOTE,
  LEFT_SINGLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
} from "../shared/utils/text";

/** Sentence length measured in whitespace-delimited tokens. */
function sentenceLengths(sentences: string[]): number[] {
  return sentences.map((s) => countWords(s));
}

/**
 * Frequency of a character relative to word count, expressed as a count per
 * 100 words so it is comparable across samples of different sizes.
 */
function charFrequencyPer100Words(text: string, char: string, wordCount: number): number {
  if (wordCount <= 0) return 0;
  const occurrences = countSubstring(text, char);
  return (occurrences / wordCount) * 100;
}

/**
 * Proportion of sentences that start with a capital letter.
 * Returns null when there are no sentences.
 */
function capitalizationConsistency(sentences: string[]): number | null {
  if (sentences.length === 0) return null;
  let capitalized = 0;
  for (const sentence of sentences) {
    const first = sentence.trimStart().charAt(0);
    if (first.length > 0 && first === first.toUpperCase()) {
      capitalized++;
    }
  }
  return capitalized / sentences.length;
}

/**
 * Average paragraph length measured in words.
 * Returns null when there are no paragraphs.
 */
function paragraphLengthAvg(paragraphs: string[]): number | null {
  if (paragraphs.length === 0) return null;
  const lengths = paragraphs.map((p) => countWords(p));
  return mean(lengths);
}

/**
 * Compute deterministic style metrics from a sample string.
 *
 * Frequencies are normalized per 100 words so samples of different sizes
 * produce comparable values. All metrics are nullable: a metric is null
 * when the sample lacks the feature entirely (e.g. no sentences).
 */
export function computeMeasuredProfile(text: string): MeasuredProfile {
  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  const paragraphs = splitParagraphs(trimmed);
  const wordCount = countWords(trimmed);

  const lengths = sentenceLengths(sentences);

  return {
    avgSentenceLength: mean(lengths),
    sentenceLengthStdDev: stdDev(lengths),
    emDashFrequency: charFrequencyPer100Words(trimmed, EM_DASH, wordCount),
    enDashFrequency: charFrequencyPer100Words(trimmed, EN_DASH, wordCount),
    curlyQuoteFrequency:
      charFrequencyPer100Words(trimmed, LEFT_DOUBLE_QUOTE, wordCount) +
      charFrequencyPer100Words(trimmed, RIGHT_DOUBLE_QUOTE, wordCount) +
      charFrequencyPer100Words(trimmed, LEFT_SINGLE_QUOTE, wordCount) +
      charFrequencyPer100Words(trimmed, RIGHT_SINGLE_QUOTE, wordCount),
    paragraphLengthAvg: paragraphLengthAvg(paragraphs),
    capitalizationConsistency: capitalizationConsistency(sentences),
    sampleWordCount: wordCount,
  };
}
