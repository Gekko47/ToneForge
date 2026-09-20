import { describe, it, expect } from "vitest";
import { computeMeasuredProfile } from "../../../src/style/metrics";
import { SAMPLE_TEXT } from "../../fixtures/sampleDocs";

describe("computeMeasuredProfile", () => {
  it("computes metrics for a sample with sentences and paragraphs", () => {
    const profile = computeMeasuredProfile(SAMPLE_TEXT);
    expect(profile.sampleWordCount).toBeGreaterThan(0);
    expect(profile.avgSentenceLength).toBeGreaterThan(0);
    expect(profile.paragraphLengthAvg).toBeGreaterThan(0);
    expect(profile.capitalizationConsistency).toBeGreaterThan(0);
    expect(profile.capitalizationConsistency).toBeLessThanOrEqual(1);
  });

  it("returns nulls for an empty sample", () => {
    const profile = computeMeasuredProfile("   ");
    expect(profile.sampleWordCount).toBe(0);
    expect(profile.avgSentenceLength).toBeNull();
    expect(profile.sentenceLengthStdDev).toBeNull();
    expect(profile.paragraphLengthAvg).toBeNull();
    expect(profile.capitalizationConsistency).toBeNull();
    expect(profile.emDashFrequency).toBe(0);
    expect(profile.curlyQuoteFrequency).toBe(0);
  });

  it("handles a single sentence", () => {
    const profile = computeMeasuredProfile("Only one sentence here.");
    expect(profile.sampleWordCount).toBe(4);
    expect(profile.avgSentenceLength).toBe(4);
    expect(profile.sentenceLengthStdDev).toBe(0);
    expect(profile.paragraphLengthAvg).toBe(4);
    expect(profile.capitalizationConsistency).toBe(1);
  });

  it("counts em dashes per 100 words", () => {
    const text = "Word word word word word \u2014 word word word word word.";
    const profile = computeMeasuredProfile(text);
    expect(profile.emDashFrequency).toBeCloseTo((1 / 11) * 100, 5);
  });

  it("counts en dashes per 100 words", () => {
    const text = "Word word word word word \u2013 word word word word word.";
    const profile = computeMeasuredProfile(text);
    expect(profile.enDashFrequency).toBeCloseTo((1 / 11) * 100, 5);
  });

  it("counts curly quotes per 100 words", () => {
    const text = "\u201cHello\u201d word word word word word word.";
    const profile = computeMeasuredProfile(text);
    expect(profile.curlyQuoteFrequency).toBeCloseTo((2 / 7) * 100, 5);
  });

  it("counts apostrophes as curly quotes", () => {
    const text = "It\u2019s word word word word word word.";
    const profile = computeMeasuredProfile(text);
    expect(profile.curlyQuoteFrequency).toBeGreaterThan(0);
    expect(profile.curlyQuoteFrequency).toBeCloseTo((1 / 7) * 100, 5);
  });

  it("measures paragraph length average", () => {
    const text = "First paragraph with words. Second sentence here.\n\nShort.";
    const profile = computeMeasuredProfile(text);
    expect(profile.paragraphLengthAvg).not.toBeNull();
    expect(profile.paragraphLengthAvg as number).toBeGreaterThan(0);
  });

  it("computes sentence length standard deviation", () => {
    const text = "Short. This is a much longer sentence with many words.";
    const profile = computeMeasuredProfile(text);
    expect(profile.sentenceLengthStdDev).not.toBeNull();
    expect(profile.sentenceLengthStdDev as number).toBeGreaterThan(0);
  });

  it("tracks capitalization consistency", () => {
    const text = "Capitalized sentence. lowercase sentence. Another Capital.";
    const profile = computeMeasuredProfile(text);
    expect(profile.capitalizationConsistency).toBeCloseTo(2 / 3, 5);
  });

  it("is deterministic for the same input", () => {
    const a = computeMeasuredProfile(SAMPLE_TEXT);
    const b = computeMeasuredProfile(SAMPLE_TEXT);
    expect(a).toEqual(b);
  });
});
