import { describe, it, expect } from "vitest";
import { evaluateSampleQuality } from "../../../src/style/sampleQuality";
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
});
