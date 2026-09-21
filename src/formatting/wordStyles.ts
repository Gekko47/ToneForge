/**
 * Word style-name mapping to profile expectations.
 *
 * The mapping is kept as a data table (not hardcoded branches) so new Word
 * style names can be added without touching the analyzer. Unknown styles
 * pass through as informational findings rather than errors.
 *
 * Boundary rule: this file lives in `src/formatting/` and may only import
 * from `core/domain` and `shared/utils` (see docs/architecture.md).
 */

export interface WordStyleMapping {
  readonly wordName: string;
  readonly expectedStyle: string;
  readonly severity: "info" | "warning" | "error";
}

/**
 * Canonical mapping of Word style names to the style name the profile
 * expects. The analyzer uses this to flag paragraphs whose applied Word
 * style does not match the profile's expectation.
 *
 * `Normal` is the default body style and is not flagged when applied to
 * body paragraphs. Headings and Title are the styles most commonly misused
 * in Word documents.
 */
export const WORD_STYLE_MAPPING: readonly WordStyleMapping[] = [
  { wordName: "Normal", expectedStyle: "Normal", severity: "info" },
  { wordName: "Title", expectedStyle: "Title", severity: "warning" },
  { wordName: "Subtitle", expectedStyle: "Subtitle", severity: "info" },
  { wordName: "Heading 1", expectedStyle: "Heading 1", severity: "warning" },
  { wordName: "Heading 2", expectedStyle: "Heading 2", severity: "warning" },
  { wordName: "Heading 3", expectedStyle: "Heading 3", severity: "warning" },
  { wordName: "Heading 4", expectedStyle: "Heading 4", severity: "warning" },
  { wordName: "Heading 5", expectedStyle: "Heading 5", severity: "warning" },
  { wordName: "Heading 6", expectedStyle: "Heading 6", severity: "warning" },
  { wordName: "Heading 7", expectedStyle: "Heading 7", severity: "warning" },
  { wordName: "Heading 8", expectedStyle: "Heading 8", severity: "warning" },
  { wordName: "Heading 9", expectedStyle: "Heading 9", severity: "warning" },
  { wordName: "List Paragraph", expectedStyle: "List Paragraph", severity: "info" },
  { wordName: "List Bullet", expectedStyle: "List Bullet", severity: "info" },
  { wordName: "List Number", expectedStyle: "List Number", severity: "info" },
  { wordName: "Quote", expectedStyle: "Quote", severity: "info" },
  { wordName: "Intense Quote", expectedStyle: "Intense Quote", severity: "info" },
];

/** Look up a mapping by Word style name (case-insensitive). */
export function lookupWordStyle(name: string): WordStyleMapping | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return undefined;
  return WORD_STYLE_MAPPING.find((m) => m.wordName.toLowerCase() === trimmed.toLowerCase());
}

/** Heading style names ordered by level. */
export const HEADING_STYLE_NAMES: readonly string[] = Array.from(
  Array.from({ length: 9 }, (_, i) => `Heading ${i + 1}`),
);
