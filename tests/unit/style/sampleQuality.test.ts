import { describe, it, expect } from "vitest";
import { SAMPLE_QUALITY_BANDS, evaluateSampleQuality } from "../../../src/style/sampleQuality";
import { captureFromText } from "../../../src/style/sampleCapture";

function makeSample(text: string) {
  return captureFromText(text);
}

describe("evaluateSampleQuality", () => {
  it("passes a sufficiently large sample", () => {
    const sample = makeSample(
      "First sentence here with several words to reach the minimum. Second sentence follows with more words to keep building the total. Third sentence ends with extra words to push us over the threshold. Fourth sentence now concludes the sample with enough words to pass.",
    );
    const result = evaluateSampleQuality(sample);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("fails an empty sample", () => {
    const sample = makeSample("   ");
    const result = evaluateSampleQuality(sample);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("Sample text is empty.");
  });

  it("fails when word count is too low", () => {
    const sample = makeSample("Short text.");
    const result = evaluateSampleQuality(sample, { minWords: 40 });
    expect(result.pass).toBe(false);
    expect(result.reasons.some((r) => r.includes("words"))).toBe(true);
  });

  it("fails when sentence count is too low", () => {
    const sample = makeSample(
      "This is a single sentence with many many many many many many many words.",
    );
    const result = evaluateSampleQuality(sample, { minSentences: 2 });
    expect(result.pass).toBe(false);
    expect(result.reasons.some((r) => r.includes("sentences"))).toBe(true);
  });

  it("respects custom thresholds", () => {
    const sample = makeSample("One sentence with ten words here now please.");
    const low = evaluateSampleQuality(sample, { minWords: 5, minSentences: 1 });
    expect(low.pass).toBe(true);
    const high = evaluateSampleQuality(sample, { minWords: 100, minSentences: 1 });
    expect(high.pass).toBe(false);
  });

  it("reports word and sentence counts", () => {
    const sample = makeSample("First sentence. Second sentence.");
    const result = evaluateSampleQuality(sample);
    expect(result.wordCount).toBe(4);
    expect(result.sentenceCount).toBe(2);
  });

  /*
   * The bands, and the one rule that keeps them separate from eligibility.
   *
   * D7: "eligible" and "how much can be learned from this" are two axes. A
   * sample that is eligible but thin is still learnable, and the level is a
   * statement of confidence rather than a permission — so a test that only
   * checked `pass` would pass with the bands removed entirely.
   */

  /** A sample of `count` words in two sentences, so eligibility is not the variable. */
  function words(count: number): string {
    const half = Math.floor(count / 2);
    return `${Array.from({ length: half }, (_u, i) => `w${i}`).join(" ")}. ${Array.from(
      { length: count - half },
      (_u, i) => `o${i}`,
    ).join(" ")}.`;
  }

  it("keeps `pass` and `eligible` as the same verdict under two names", () => {
    // `learnStyleDraft` throws on `pass`; the UI reads `eligible`. They are
    // computed from the same reasons, so they cannot drift.
    [0, 20, 60, 320, 2000].forEach((count) => {
      const result = evaluateSampleQuality(makeSample(words(count)));
      expect(result.eligible).toBe(result.pass);
    });
  });

  it("puts each band at the word count the constant declares", () => {
    // Read from the exported table rather than restating the numbers, so
    // changing a threshold is one edit in one file instead of a hunt.
    SAMPLE_QUALITY_BANDS.forEach((band) => {
      if (band.level === "insufficient") return;
      const at = evaluateSampleQuality(makeSample(words(band.minWords)));
      const below = evaluateSampleQuality(makeSample(words(band.minWords - 1)));
      expect(at.level).toBe(band.level);
      expect(below.level).not.toBe(band.level);
    });
  });

  it("calls a thin but eligible sample learnable, at a level that is not confidence", () => {
    const result = evaluateSampleQuality(makeSample(words(60)));

    expect(result.eligible).toBe(true);
    // 60 words is eligible (the gate is 40) and still the lowest band. This is
    // the exact case a gate-only implementation would refuse.
    expect(result.level).toBe("insufficient");
    expect(result.reasons).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/60 words/);
  });

  it("says nothing about confidence on a large sample", () => {
    const result = evaluateSampleQuality(makeSample(words(1200)));

    expect(result.level).toBe("strong");
    // A warning that is always present is a warning nobody reads.
    expect(result.warnings).toEqual([]);
  });

  it("gives an ineligible sample no confidence claim at all", () => {
    const result = evaluateSampleQuality(makeSample("Too short."));

    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    // Not "insufficient — you can barely learn from this". It cannot be learned
    // from, and the reason says why.
    expect(result.warnings).toEqual([]);
  });
});
