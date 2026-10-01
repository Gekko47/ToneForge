/**
 * `.txt` import, as pure validation over a plain object.
 *
 * **No `File`, no `FileReader`, no DOM.** The component owns the read — it has
 * the `<input type="file">` and the browser's `File` — and hands over the three
 * facts that decide whether the file is acceptable: its name, its size and the
 * text. Everything this module decides is then testable without a browser, which
 * is the same boundary `sampleCapture.ts` states for itself: no Office, no LLM,
 * no UI.
 *
 * **What is refused, and why each one is refused rather than coerced.** A `.docx`
 * is a zip archive: reading it as text yields binary noise that would be sent to
 * a provider as though it were prose. A file over the cap is a request the model
 * cannot answer. Anything else is accepted and attributed, because the evidence
 * card's job is to record where the sample came from rather than to keep the user
 * from choosing a file.
 */

import { captureFromText, type CapturedSample } from "./sampleCapture";

/**
 * The largest `.txt` import accepted, in bytes.
 *
 * One megabyte is roughly 150 000 words — far past anything a profile can be
 * learned from, and small enough that a mistaken drag-and-drop fails in a
 * sentence rather than after a long spinner.
 */
export const MAX_TEXT_FILE_BYTES = 1_048_576;

/** The extension accepted. `.text` and `.md` are the same thing to a profiler. */
export const TEXT_FILE_EXTENSION = ".txt";

export interface TextFileFacts {
  name: string;
  /** Bytes, as the browser reports them. */
  size: number;
  /** The file's MIME type, which is advisory: browsers report it inconsistently. */
  type?: string;
}

export type TextFileRejection =
  | { reason: "extension"; sentence: string }
  | { reason: "size"; sentence: string }
  | { reason: "empty"; sentence: string }
  | { reason: "binary"; sentence: string };

export type TextFileValidation =
  { ok: true; name: string } | { ok: false; rejection: TextFileRejection };

/**
 * Whether a picked file may be read as a writing sample.
 *
 * The extension is checked first and the MIME type is deliberately not: a
 * Windows `.txt` arrives as `text/plain`, a `.md` as `text/markdown` or as
 * nothing at all, and the file picker on some hosts reports `""`. Refusing on
 * the MIME type would reject files that are fine, and the extension check is
 * the one a user can see and correct.
 */
export function validateTextFile(file: TextFileFacts): TextFileValidation {
  const name = file.name.trim();
  if (!name.toLowerCase().endsWith(TEXT_FILE_EXTENSION)) {
    return {
      ok: false,
      rejection: {
        reason: "extension",
        sentence:
          "Choose a plain-text file ending in .txt. A .docx is a binary archive, and reading it as text would send the file's internal structure to your provider rather than your writing.",
      },
    };
  }
  if (file.size > MAX_TEXT_FILE_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: "size",
        sentence: `That file is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(
          MAX_TEXT_FILE_BYTES / 1024,
        )} KB; split it, or paste a section instead.`,
      },
    };
  }
  return { ok: true, name };
}

/**
 * Whether the text a `.txt` produced is usable as a sample.
 *
 * Separate from `validateTextFile` because it is about the *content* rather than
 * the file, and the two can fail independently: a valid `.txt` can be empty, and
 * a file can be within the cap while holding nothing but whitespace.
 *
 * The binary check is a control-character ratio rather than an exact test: a
 * sample of prose contains no NUL at all, while a mis-picked archive contains
 * many, and a ratio catches that without a false positive on the accented and
 * symbol characters a language sample legitimately carries.
 */
export function validateImportedText(text: string): TextFileValidation {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      rejection: {
        reason: "empty",
        sentence: "That file is empty, so there is no writing to learn from.",
      },
    };
  }
  // Escaped rather than literal: a raw control character in a source file is
  // invisible, unreviewable, and indistinguishable from a typo in review.
  const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  if (controls / text.length > 0.01) {
    return {
      ok: false,
      rejection: {
        reason: "binary",
        sentence:
          "That file does not look like plain text. Choose a .txt export rather than the original document format.",
      },
    };
  }
  return { ok: true, name: "" };
}

/**
 * Turn a validated file's text into a captured sample.
 *
 * Delegating to `captureFromText` rather than building one here is deliberate:
 * the word and sentence counts, the hash and the source attribution are the
 * evidence the profile card shows, and a second implementation of them would be a
 * second answer to "where did this profile come from".
 */
export function captureFromFileText(text: string, filename: string): CapturedSample {
  return captureFromText(text, { source: "text_file", filename });
}
