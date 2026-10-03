/**
 * The `term: replacement` line format, shared by every terminology editor.
 *
 * Extracted from `ProfileEditor` so the governance policy editor does not ship
 * a second, subtly different parser. Two parsers for one format is how "it
 * saved but ignored my entry" happens: the format that one field accepts and
 * the other silently drops.
 */

export interface TerminologyParse {
  values: Record<string, string>;
  error: string | null;
}

/**
 * The words an error message uses for the two halves of a `left: right` line.
 *
 * Defaulted to the terminology wording so every existing message is byte-for-byte
 * unchanged. It is named for the fields where the halves are not a "term" and a
 * "replacement": an abbreviation line is a short form and a long form, and telling
 * a user their approved abbreviation is malformed because they did not write
 * "term: replacement" describes the terminology editor, not theirs.
 */
export interface TermNouns {
  /** The field as the user knows it, e.g. "Approved abbreviation". */
  readonly subject: string;
  /** What precedes the colon. */
  readonly left: string;
  /** What follows the colon. */
  readonly right: string;
}

/** The wording the terminology editors report errors in. */
export const TERMINOLOGY_NOUNS: TermNouns = {
  subject: "Terminology",
  left: "term",
  right: "replacement",
};

/** Render a preferred-term map back into the editable line format. */
export function formatTerminology(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([term, replacement]) => `${term}: ${replacement}`)
    .join("\n");
}

/** Render a term list, one per line. */
export function formatTermList(terms: readonly string[]): string {
  return terms.join("\n");
}

export function parseTerminology(
  value: string,
  nouns: TermNouns = TERMINOLOGY_NOUNS,
): TerminologyParse {
  const values: Record<string, string> = {};
  const lines = value.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      return {
        values,
        error: `${nouns.subject} line ${index + 1} must use "${nouns.left}: ${nouns.right}".`,
      };
    }
    const term = line.slice(0, separatorIndex).trim();
    const replacement = line.slice(separatorIndex + 1).trim();
    if (term.length === 0 || replacement.length === 0) {
      return {
        values,
        error: `${nouns.subject} line ${index + 1} needs both a ${nouns.left} and a ${nouns.right}.`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(values, term)) {
      return {
        values,
        error: `${nouns.subject} "${term}" is listed more than once.`,
      };
    }
    values[term] = replacement;
  }
  return { values, error: null };
}

export function parseTermList(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
