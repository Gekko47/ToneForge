import { describe, it, expect } from "vitest";
import { captureSample, captureFromText } from "../../../src/style/sampleCapture";
import { SAMPLE_TEXT } from "../../fixtures/sampleDocs";

function makeSnapshot(text: string, id = "doc-1") {
  return {
    id,
    text,
    paragraphs: [text],
    sentences: [text],
    wordCount: 5,
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "deadbeef",
  };
}

describe("captureSample", () => {
  it("prefers the selection when non-empty", () => {
    const snapshot = makeSnapshot("Document body text that is long enough.");
    const result = captureSample("Selection text here.", snapshot);
    expect(result.text).toBe("Selection text here.");
    expect(result.source).toBe("selection");
    expect(result.documentId).toBe("doc-1");
  });

  it("falls back to the snapshot when selection is empty", () => {
    const snapshot = makeSnapshot("Document body text that is long enough.");
    const result = captureSample("   ", snapshot);
    expect(result.text).toBe("Document body text that is long enough.");
    expect(result.source).toBe("document");
  });

  it("respects preferSelection=false", () => {
    const snapshot = makeSnapshot("Document body text that is long enough.");
    const result = captureSample("Selection text here.", snapshot, {
      preferSelection: false,
    });
    expect(result.text).toBe("Document body text that is long enough.");
    expect(result.source).toBe("document");
  });

  it("truncates to maxChars", () => {
    const snapshot = makeSnapshot("a".repeat(100));
    const result = captureSample("", snapshot, { maxChars: 10 });
    expect(result.text).toHaveLength(10);
  });

  it("computes paragraphs, sentences and word count", () => {
    const snapshot = makeSnapshot("First sentence. Second sentence here.");
    const result = captureSample("", snapshot);
    expect(result.paragraphs).toHaveLength(1);
    expect(result.sentences).toHaveLength(2);
    expect(result.wordCount).toBe(5);
  });

  it("carries capturedAt from the snapshot", () => {
    const snapshot = makeSnapshot("Some sample text.", "doc-9");
    const result = captureSample("", snapshot);
    expect(result.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("captureFromText", () => {
  it("builds a sample from plain text", () => {
    const result = captureFromText(SAMPLE_TEXT);
    expect(result.text).toBe(SAMPLE_TEXT);
    expect(result.source).toBe("document");
    expect(result.paragraphs).toHaveLength(2);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("trims surrounding whitespace", () => {
    const result = captureFromText("  hello world.  ");
    expect(result.text).toBe("hello world.");
  });

  it("truncates to maxChars", () => {
    const result = captureFromText("a".repeat(100), { maxChars: 5 });
    expect(result.text).toHaveLength(5);
  });
});
