import { describe, it, expect } from "vitest";
import {
  splitSentences,
  splitParagraphs,
  countWords,
  countSubstring,
  mean,
  stdDev,
  normalizeLineEndings,
  stripParagraphMark,
} from "../../../../src/shared/utils/index";

describe("splitSentences", () => {
  it("splits on sentence boundaries", () => {
    expect(splitSentences("Hello world. How are you?")).toEqual(["Hello world.", "How are you?"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });

  it("handles no punctuation", () => {
    expect(splitSentences("just text")).toEqual(["just text"]);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines", () => {
    expect(splitParagraphs("para one\n\npara two")).toEqual(["para one", "para two"]);
  });

  it("trims whitespace", () => {
    expect(splitParagraphs("  para  ")).toEqual(["para"]);
  });
});

describe("countWords", () => {
  it("counts whitespace-delimited tokens", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });
});

describe("countSubstring", () => {
  it("counts overlapping occurrences", () => {
    expect(countSubstring("aaa", "aa")).toBe(2);
  });

  it("returns 0 for empty needle", () => {
    expect(countSubstring("abc", "")).toBe(0);
  });
});

describe("mean / stdDev", () => {
  it("returns null for empty input", () => {
    expect(mean([])).toBeNull();
    expect(stdDev([])).toBeNull();
  });

  it("computes mean", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("computes population stdDev", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
});

describe("normalizeLineEndings", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("converts lone CR to LF", () => {
    expect(normalizeLineEndings("a\rb")).toBe("a\nb");
  });
});

describe("stripParagraphMark", () => {
  it("removes a single trailing paragraph mark, in either host form", () => {
    expect(stripParagraphMark("hello\r")).toBe("hello");
    expect(stripParagraphMark("hello\u0007")).toBe("hello");
  });

  it("removes at most one trailing mark, preserving additional trailing breaks as content", () => {
    // Only one mark is removed; additional trailing line breaks are content.
    expect(stripParagraphMark("hello\r\n")).toBe("hello\r");
    expect(stripParagraphMark("hello\r\r")).toBe("hello\r");
  });

  it("leaves text with no trailing mark untouched", () => {
    expect(stripParagraphMark("hello")).toBe("hello");
  });

  it("does not touch a mark that is not trailing", () => {
    // Only a paragraph's own boundary is representational; an internal break is content.
    expect(stripParagraphMark("a\rb")).toBe("a\rb");
  });
});
