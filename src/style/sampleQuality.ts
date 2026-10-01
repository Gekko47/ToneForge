/**
 * Sample quality gate.
 *
 * Pure function that decides whether a captured sample is large and coherent
 * enough to feed the deterministic metrics and the semantic profiler.
 *
 * Boundary rule: no Office, LLM, or UI imports — pure functions only.
 */

import type { CapturedSample } from "./sampleCapture";

/**
 * The four bands, as exported constants.
 *
 * **A band is a statement of confidence, not a permission.** Exported so the
 * badge, the gate and the tests cannot quote different numbers — the same
 * discipline `CONSISTENCY_DEFAULT_MAX_STATEMENTS` follows. These are product
 * thresholds, not measurements, and the numbers are here so that changing one is
 * a deliberate edit rather than a coincidence between three files (D7).
 */
export const SAMPLE_QUALITY_BANDS = [
  { level: "insufficient", minWords: 0 },
  { level: "limited", minWords: 100 },
  { level: "good", minWords: 300 },
  { level: "strong", minWords: 1000 },
] as const;

export type SampleQualityLevel = (typeof SAMPLE_QUALITY_BANDS)[number]["level"];

export interface SampleQuality {
  /**
   * Whether the sample is mechanically usable — the only axis that ever blocks.
   *
   * Kept as `pass` because `learnStyleDraft` throws on it and changing the name
   * would touch every caller for no gain in meaning. `eligible` is the alias that
   * says what it means; the two cannot disagree because one is computed from the
   * other.
   */
  pass: boolean;
  /** The same verdict, named for what it is. */
  eligible: boolean;
  /** How much can be learned from this sample. Never a gate. */
  level: SampleQualityLevel;
  /** Why it is not eligible. Empty when it is. */
  reasons: string[];
  /** What a low level means for the profile that will be learned. */
  warnings: string[];
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
    return {
      pass: false,
      eligible: false,
      level: "insufficient",
      reasons: ["Sample text is empty."],
      warnings: [],
      wordCount,
      sentenceCount,
    };
  }
  if (wordCount < minWords) {
    reasons.push(`Sample has ${wordCount} words; minimum is ${minWords}.`);
  }
  if (sentenceCount < minSentences) {
    reasons.push(`Sample has ${sentenceCount} sentences; minimum is ${minSentences}.`);
  }

  const eligible = reasons.length === 0;
  const level = eligible ? levelFor(wordCount) : "insufficient";

  /*
   * The warning is about the *level*, and it is written to be read on the badge
   * beside the button rather than dismissed. "Learn anyway?" belongs to the user's
   * decision, so the sentence has to say what they are getting rather than that
   * something is low.
   */
  const warnings =
    level === "limited"
      ? [
          `${wordCount} words — limited. ToneForge can learn a rough voice from this, but not reliably.`,
        ]
      : level === "insufficient" && eligible
        ? [
            `${wordCount} words — insufficient. ToneForge can learn a rough voice from this, but barely.`,
          ]
        : [];

  return {
    pass: eligible,
    eligible,
    level,
    reasons,
    warnings,
    wordCount,
    sentenceCount,
  };
}

/** The band a word count falls into. Boundaries are inclusive at the lower edge. */
function levelFor(wordCount: number): SampleQualityLevel {
  const match = [...SAMPLE_QUALITY_BANDS].reverse().find((band) => wordCount >= band.minWords);
  return match?.level ?? "insufficient";
}
