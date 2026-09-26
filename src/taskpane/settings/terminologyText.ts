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

export function parseTerminology(value: string): TerminologyParse {
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
        error: `Terminology line ${index + 1} must use "term: replacement".`,
      };
    }
    const term = line.slice(0, separatorIndex).trim();
    const replacement = line.slice(separatorIndex + 1).trim();
    if (term.length === 0 || replacement.length === 0) {
      return {
        values,
        error: `Terminology line ${index + 1} needs both a term and a replacement.`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(values, term)) {
      return {
        values,
        error: `Terminology term "${term}" is listed more than once.`,
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
