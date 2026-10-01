/**
 * `.txt` import validation, and the sample it produces.
 *
 * What is pinned here is a privacy claim rather than a behaviour: a `.docx` is
 * a zip archive, and reading one as text would send the file's internal
 * structure to a provider as though it were the user's writing. Every refusal
 * below exists to make that impossible, and each one names what to do instead.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_FILE_BYTES,
  TEXT_FILE_EXTENSION,
  captureFromFileText,
  validateImportedText,
  validateTextFile,
} from "../../../src/style/textFileImport";

describe("validateTextFile", () => {
  it("accepts a .txt and keeps the name it was given", () => {
    const result = validateTextFile({ name: "expert-report.txt", size: 1024, type: "text/plain" });

    expect(result).toEqual({ ok: true, name: "expert-report.txt" });
  });

  it("accepts a .txt whose MIME type the host reported as nothing", () => {
    // The file picker on some Office hosts reports "" for every file. Refusing
    // on the MIME type would reject files that are perfectly fine.
    const result = validateTextFile({ name: "notes.txt", size: 10, type: "" });

    expect(result.ok).toBe(true);
  });

  it("refuses a document format with the reason it is a binary archive", () => {
    const result = validateTextFile({ name: "report.docx", size: 20_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("extension");
    expect(result.rejection.sentence).toMatch(/binary archive/i);
    expect(result.rejection.sentence).toMatch(/\.txt/);
  });

  it("is not fooled by an uppercase extension", () => {
    // `.endsWith` is case-sensitive; the comparison has to be or a file called
    // SAMPLE.TXT — which is what Windows produces for SAMPLE.txt — is refused.
    expect(validateTextFile({ name: "SAMPLE.TXT", size: 10 }).ok).toBe(true);
  });

  it("refuses a file over the cap, and says how big it was", () => {
    const result = validateTextFile({
      name: "huge.txt",
      size: MAX_TEXT_FILE_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("size");
    expect(result.rejection.sentence).toContain(String(MAX_TEXT_FILE_BYTES / 1024));
  });

  it("accepts a file exactly at the cap", () => {
    expect(validateTextFile({ name: "exact.txt", size: MAX_TEXT_FILE_BYTES }).ok).toBe(true);
  });
});

describe("validateImportedText", () => {
  it("accepts ordinary prose", () => {
    expect(
      validateImportedText("A paragraph of writing, with an em dash — and a “quote”.").ok,
    ).toBe(true);
  });

  it("refuses a file that is only whitespace", () => {
    const result = validateImportedText("   \n\t  \n ");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("empty");
  });

  it("refuses binary content, and points at a .txt export", () => {
    // Escaped so the fixture is reviewable: a literal NUL in a source file is
    // invisible and indistinguishable from a typo.
    const archive = "PK\u0003\u0004" + "\u0000\u0001\u0002".repeat(40) + "text";
    const result = validateImportedText(archive);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("binary");
    expect(result.rejection.sentence).toMatch(/\.txt export/i);
  });

  it("accepts accented and symbol characters, which prose legitimately carries", () => {
    // The binary check is a ratio, not an exact test. An exact test on any
    // control character would refuse a Greek or Japanese sample.
    expect(validateImportedText("Καλημέρα κόσμε. 日本語のテキスト。 Ünïcödé.").ok).toBe(true);
  });

  it("accepts a single stray control character in a long document", () => {
    const long = "word ".repeat(400) + "\u0007tail";

    expect(validateImportedText(long).ok).toBe(true);
  });
});

describe("captureFromFileText", () => {
  it("attributes the sample to the file, with its name, and to nothing else", () => {
    const sample = captureFromFileText("First sentence. Second sentence.", "expert.txt");

    expect(sample.source).toBe("text_file");
    expect(sample.filename).toBe("expert.txt");
    // No document id: the file did not come from one, and inventing a
    // placeholder would put a claim in the evidence the user reads.
    expect(sample.documentId).toBeUndefined();
  });

  it("counts the same words and sentences the paste route counts", () => {
    const sample = captureFromFileText("One two three. Four five six.", "s.txt");

    expect(sample.wordCount).toBe(6);
    expect(sample.sentences).toHaveLength(2);
  });

  it("hashes the text, so two imports of the same file are comparable without keeping it", () => {
    const first = captureFromFileText("Same text.", "a.txt");
    const second = captureFromFileText("Same text.", "b.txt");
    const third = captureFromFileText("Different text.", "a.txt");

    expect(first.sampleHash).toBe(second.sampleHash);
    expect(first.sampleHash).not.toBe(third.sampleHash);
  });

  it("uses the extension it was built for", () => {
    // Pinned because the input control's `accept` reads this constant: if the
    // two ever disagree, the picker offers files the validator then refuses.
    expect(TEXT_FILE_EXTENSION).toBe(".txt");
  });
});
