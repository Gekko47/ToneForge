/**
 * Qualification and negation vocabularies.
 *
 * **Both lists are soft, and that is the decision, not an accident.** The
 * specification's §17 lists fifteen tokens that change what an expert sentence
 * means, and §16.1 puts "changes a numeric value" in the hard tier while saying
 * nothing about these. Making them hard would be defensible on paper and
 * unusable in practice: "may", "not", "only", "all", and "if" appear in most
 * sentences an expert writes, so a hard failure on their removal would block
 * nearly every legitimate restyle. A validator the user learns to bypass is
 * worse than one that misses a case, because the day it catches a real one the
 * user will not believe it.
 *
 * So a qualifier or negation that moves produces a **warning** and an
 * acknowledgement, and the meaning itself is settled by the review model's
 * structured `MeaningPreservationAssessment` — treated as evidence, never as
 * proof, which is what the specification says and what the tiering has to match.
 *
 * Boundary rule: no `ai/`, no `word/`, no `taskpane/`. See `protectedFacts.ts`.
 */

/**
 * Words that hedge a claim: modal verbs, approximations, and the phrases an
 * expert uses to mark a view as their own.
 *
 * Sorted longest-first at match time, not here, so that `in my opinion` is
 * matched as one phrase rather than as `in` plus `opinion`. A phrase split into
 * its words would report "opinion removed" when the author still says it.
 */
export const QUALIFIER_TERMS: readonly string[] = [
  "in my opinion",
  "in the writer's opinion",
  "in my judgement",
  "in my judgment",
  "to the extent",
  "on balance",
  "subject to",
  "it appears",
  "appears to",
  "appeared to",
  "approximately",
  "roughly",
  "about",
  "assuming",
  "provided that",
  "assuming that",
  "may",
  "might",
  "could",
  "would",
  "appears",
  "seems",
  "likely",
  "unlikely",
  "possible",
  "probably",
  "arguably",
  "if",
];

/**
 * Words that reverse or narrow a claim.
 *
 * `no` and `all` are here because they are quantifiers as much as negations:
 * "all gangs were resourced" and "some gangs were resourced" differ by one
 * word, and a restyle that drops `all` has narrowed a finding without touching
 * a single figure.
 */
export const NEGATION_TERMS: readonly string[] = [
  "no",
  "not",
  "never",
  "neither",
  "nor",
  "none",
  "only",
  "all",
  "except",
  "without",
  "unless",
  "cannot",
  "without prejudice to",
];

/** Which list a term came from, so a message can name the kind of change. */
export type QualifierClass = "qualifier" | "negation";

interface CompiledTerm {
  readonly term: string;
  readonly kind: QualifierClass;
  readonly pattern: RegExp;
}

/**
 * Boundaries are lookarounds rather than `\b`, and the hyphen is inside them.
 *
 * `\b` treats a hyphen as a boundary, so `\bif\b` matches the `if` in `if-x` —
 * and `if-x` is a compound term, not a hedge. The same is true of an
 * apostrophe: `mayn't` is not a bare `may`. Both characters therefore continue a
 * word for the purpose of this match, while whitespace and real punctuation
 * still end one.
 */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(terms: readonly string[], kind: QualifierClass): CompiledTerm[] {
  return terms.map((term) => ({
    term,
    kind,
    pattern: new RegExp(`(?<![A-Za-z0-9'-])${escape(term)}(?![A-Za-z0-9'-])`, "gi"),
  }));
}

/** All terms, longest first so a phrase always wins over a word inside it. */
const COMPILED: readonly CompiledTerm[] = [
  ...compile(QUALIFIER_TERMS, "qualifier"),
  ...compile(NEGATION_TERMS, "negation"),
]
  .filter((entry, index, all) => all.findIndex((other) => other.term === entry.term) === index)
  .sort((left, right) => right.term.length - left.term.length);

/** One qualifier or negation, where it was, and how it was written. */
export interface QualifierOccurrence {
  readonly term: string;
  readonly kind: QualifierClass;
  readonly start: number;
  readonly end: number;
  readonly surface: string;
}

/**
 * Every qualifier and negation in `text`, in order of appearance.
 *
 * Overlapping matches are consumed rather than double-counted, for the same
 * reason `protectedFacts.ts` does it: `not` inside `cannot` would otherwise be
 * reported as a negation that was removed when the author changed `cannot` to
 * `could not`.
 */
export function extractQualifiers(text: string): QualifierOccurrence[] {
  const claimed: { start: number; end: number }[] = [];
  const found: QualifierOccurrence[] = [];

  COMPILED.forEach(({ term, kind, pattern }) => {
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(text);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = claimed.some((claim) => start < claim.end && end > claim.start);
      if (!overlaps) {
        claimed.push({ start, end });
        found.push({ term, kind, start, end, surface: match[0] });
      }
      match = re.exec(text);
    }
  });

  return found.sort((left, right) => left.start - right.start);
}

/** How many times `term` appears in the text, case-insensitively. */
export function countTerm(text: string, term: string): number {
  const pattern = new RegExp(`(?<![A-Za-z0-9'-])${escape(term)}(?![A-Za-z0-9'-])`, "gi");
  return (text.match(pattern) ?? []).length;
}

/**
 * The user-facing sentence for a qualifier or negation that moved.
 *
 * One template rather than a per-term message, because the term is already in
 * the report and a sentence that repeats it adds nothing a reader can act on.
 */
export function qualifierMessage(
  term: string,
  kind: QualifierClass,
  direction: "removed" | "added",
): string {
  const noun = kind === "negation" ? "a negation" : "a qualifier";
  const verb = direction === "removed" ? "removed" : "added";
  return `Review carefully: the proposed revision ${verb} ${noun} ("${term}"), which may change what the sentence claims.`;
}
