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
    expect(result.source).toBe("word_selection");
    expect(result.documentId).toBe("doc-1");
  });

  it("falls back to the snapshot when selection is empty", () => {
    const snapshot = makeSnapshot("Document body text that is long enough.");
    const result = captureSample("   ", snapshot);
    expect(result.text).toBe("Document body text that is long enough.");
    expect(result.source).toBe("word_document");
  });

  it("respects preferSelection=false", () => {
    const snapshot = makeSnapshot("Document body text that is long enough.");
    const result = captureSample("Selection text here.", snapshot, {
      preferSelection: false,
    });
    expect(result.text).toBe("Document body text that is long enough.");
    expect(result.source).toBe("word_document");
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
    // Not "document". A string handed to this function is pasted text, and the
    // learned profile is attributed to this value in the evidence it shows — so
    // a wrong default is a wrong record of where the profile came from.
    expect(result.source).toBe("pasted_text");
    expect(result.paragraphs).toHaveLength(2);
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("attributes the sample to the source the caller declares", () => {
    expect(captureFromText(SAMPLE_TEXT, { source: "word_selection" }).source).toBe(
      "word_selection",
    );
    expect(captureFromText(SAMPLE_TEXT, { source: "word_document" }).source).toBe("word_document");
  });

  it("keeps a file's name on a .txt import and nowhere else", () => {
    // The name is the difference between "learned from expert-report.txt" and
    // "learned from text you pasted", as evidence the user can check. Recording
    // it against a pasted sample would attribute a name to something that has
    // none.
    expect(
      captureFromText(SAMPLE_TEXT, { source: "text_file", filename: "expert.txt" }).filename,
    ).toBe("expert.txt");
    expect(
      captureFromText(SAMPLE_TEXT, { source: "pasted_text", filename: "expert.txt" }).filename,
    ).toBeUndefined();
  });

  it("hashes the sample so two captures can be compared without keeping either", () => {
    const a = captureFromText(SAMPLE_TEXT);
    const b = captureFromText(`  ${SAMPLE_TEXT}  `);
    expect(a.sampleHash).toBe(b.sampleHash);
    expect(a.sampleHash).not.toBe(captureFromText(`${SAMPLE_TEXT} Extra.`).sampleHash);
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
