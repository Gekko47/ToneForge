/**
 * Pure text helpers used by deterministic rules and metrics.
 * No Office dependency — fully unit-testable.
 */

export const ELLIPSIS = "\u2026";
export const EM_DASH = "\u2014";
export const EN_DASH = "\u2013";
export const LEFT_DOUBLE_QUOTE = "\u201c";
export const RIGHT_DOUBLE_QUOTE = "\u201d";
export const LEFT_SINGLE_QUOTE = "\u2018";
export const RIGHT_SINGLE_QUOTE = "\u2019";
export const NON_BREAKING_SPACE = "\u00a0";

/** Split text into sentences on `.`, `!`, `?` boundaries. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Split text into paragraphs on blank lines. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Count words (whitespace-delimited tokens). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Count occurrences of a substring (overlapping allowed). */
export function countSubstring(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += 1;
  }
  return count;
}

/** Mean of a numeric array; returns null for empty input. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation; returns null for empty input. */
export function stdDev(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values);
  if (m === null) return null;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Strip leading/trailing whitespace from each line without collapsing internal spaces. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** FNV-1a 32-bit hash — fast, deterministic, good enough for stale guards. */
export function hashText(text: string): string {
  return [...text]
    .reduce((hash, char) => {
      const h = (hash ^ char.charCodeAt(0)) >>> 0;
      return (h * 16777619) >>> 0;
    }, 2166136261)
    .toString(16)
    .padStart(8, "0");
}
