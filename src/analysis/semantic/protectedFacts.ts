/**
 * Protected-fact extraction.
 *
 * Pure, offline, and the only thing standing between a model and a document. It
 * takes text and returns the tokens that carry a claim about the world — a date,
 * a figure, a currency, a duration, a reference, a party — each with enough
 * position information to be shown to the user as the reason a revision was
 * refused.
 *
 * **Three rules govern what counts as protected.**
 *
 * 1. **Normalisation decides identity, not the surface.** `£1,240,000` and
 *    `1240000` are the same figure, and a validator that treats a thousands
 *    separator as a change would report a diff on every sentence where the
 *    model's formatting was slightly different — which trains the user to
 *    dismiss the check. Dates normalise to an ordered `(day, month, year)`
 *    triple for the same reason: `30 June 2025` and `June 30, 2025` must not
 *    read as a change, while `18 July 2025` must.
 *
 * 2. **`certain` is a claim about the extractor's confidence, not about the
 *    text.** A date with a month name is certainly a date. A capitalised
 *    two-word run is probably an entity and is sometimes just two words that
 *    happen to start sentences. The specification's §16.1 makes a changed
 *    entity a hard failure and §16.2 makes an unverifiable one a soft warning,
 *    and the only thing that can tell those apart is this flag.
 *
 * 3. **Overlap is consumed, not double-counted.** `30 June 2025` must not also
 *    be read as the number `30` and the number `2025`, or every date change
 *    would be reported three times and a figure change twice. Extractors run in
 *    priority order and each one skips a span an earlier one already claimed.
 *
 * Boundary rule (enforced by an ESLint scope, not by convention): no `ai/`, no
 * `word/`, no `taskpane/`. This file runs before any model is consulted and must
 * keep working when no provider is configured at all — that is the case it
 * exists for.
 */

/** The classes of token a style-only revision must not move. */
export const PROTECTED_FACT_KINDS = [
  "date",
  "duration",
  "percentage",
  "currency",
  "quantity",
  "activityIdentifier",
  "eventIdentifier",
  "identifier",
  "clauseReference",
  "documentReference",
  "partyName",
  "suspectedEntity",
] as const;
export type ProtectedFactKind = (typeof PROTECTED_FACT_KINDS)[number];

/** One protected token, located and normalised. */
export interface ProtectedFact {
  readonly kind: ProtectedFactKind;
  /**
   * The normalised identity, prefixed by kind so two kinds can never collide:
   * `date:2025-06-30`, `currency:GBP 1240000`, `party:ardmore construction group`.
   *
   * Lower-cased for the free-text classes and exact for the numeric ones, so
   * that `Ardmore Construction Group` and `ARDMORE CONSTRUCTION GROUP` are one
   * party while `4.2` and `4.20` are two different figures.
   */
  readonly value: string;
  /** Exactly as it appeared, so the refusal message quotes the document. */
  readonly surface: string;
  readonly start: number;
  readonly end: number;
  /**
   * Whether the extractor is confident this token is what it says it is.
   *
   * `false` never produces a hard failure. It is the difference between "the
   * validator caught a changed date" and "ToneForge could not verify that all
   * named entities were preserved", and the specification asks for both.
   */
  readonly certain: boolean;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_NUMBER: ReadonlyMap<string, number> = new Map(
  MONTHS.map((month, index) => [month, index + 1]),
);

const CURRENCY_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ["£", "GBP"],
  ["$", "USD"],
  ["€", "EUR"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["₩", "KRW"],
  ["₽", "RUB"],
]);

/**
 * Identifiers grouped by what they name.
 *
 * A prefix table rather than a generic "alphanumeric" rule, because the two
 * cases behave differently for the user. Swapping `ACT-0142` for `ACT-0197` puts
 * a different activity's cost in the sentence; swapping an internal reference
 * number is the same class of error but a less alarming one to name.
 */
const IDENTIFIER_PREFIXES: ReadonlyArray<readonly [RegExp, ProtectedFactKind]> = [
  [/^(?:ACT|PROG|WBS|TASK|MILESTONE)[-_]/i, "activityIdentifier"],
  [/^(?:EVT|INC|EVENT|REF|DR)[-_]/i, "eventIdentifier"],
];

/**
 * Words that end a company, partnership, or public body.
 *
 * A capitalised run is only a party name with confidence when it ends in one of
 * these. Without the suffix the run is `suspectedEntity` and never a hard
 * failure — because "The Contractor", "The Employer", and "The Programme" are
 * capitalised two-word runs, and reporting them as changed entities would put a
 * soft warning on nearly every paragraph a user reviews.
 */
const ORGANISATIONAL_SUFFIXES: ReadonlySet<string> = new Set([
  "ltd",
  "limited",
  "group",
  "holdings",
  "holding",
  "plc",
  "llp",
  "llp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "ag",
  "sa",
  "nv",
  "bv",
  "pte",
  "partners",
  "associates",
  "authority",
  "board",
  "council",
  "committee",
  "department",
  "ministry",
  "trust",
]);

/** A claimed span of the source text. */
interface Claim {
  readonly start: number;
  readonly end: number;
}

function overlaps(claims: readonly Claim[], start: number, end: number): boolean {
  return claims.some((claim) => start < claim.end && end > claim.start);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A quantity with a unit, which is a fact; a bare number, which is not
 * necessarily one.
 *
 * `42 days` is a claim about elapsed time and a restyle that changes it has
 * changed the argument. `3` might be a count, an item number, a house number,
 * or part of an identifier — so it is extracted as a `quantity` with
 * `certain: false`, which means it can never be a hard failure on its own.
 *
 * This is the class that makes the difference between a validator that catches
 * real changes and one that refuses every revision. Refusing on an ambiguous
 * number is worse than missing a change, because the user's response is to stop
 * reading the warnings.
 */
const UNIT_PATTERN =
  "days?|weeks?|months?|years?|hours?|minutes?|seconds?|metres?|meters?|kilometres?|kilometers?|km|cm|mm|kg|tonnes?|tons?|litres?|liters?|l\\b";

function normaliseQuantity(amount: string, unit: string): string {
  const normalisedUnit = unit.toLowerCase().replace(/s$/, "");
  return `quantity:${amount} ${normalisedUnit}`;
}

function claimFacts(
  kind: ProtectedFactKind,
  text: string,
  pattern: RegExp,
  toValue: (match: RegExpExecArray) => { value: string; certain: boolean } | null,
  claims: Claim[],
): ProtectedFact[] {
  const found: ProtectedFact[] = [];
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match = re.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (!overlaps(claims, start, end)) {
      const converted = toValue(match);
      if (converted !== null) {
        found.push({
          kind,
          value: `${kind}:${converted.value}`,
          surface: match[0],
          start,
          end,
          certain: converted.certain,
        });
        claims.push({ start, end });
      }
    }
    match = re.exec(text);
  }
  return found;
}

function extractClauseReferences(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "clauseReference",
    text,
    /\b(?:clause|section|paragraph|sub-?clause|article|appendix)\s+\d+(?:\.\d+)*/gi,
    (match) => ({ value: match[0].toLowerCase().replace(/\s+/g, " "), certain: true }),
    claims,
  );
}

function extractDocumentReferences(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "documentReference",
    text,
    // `[A-Z]{1,3}` before the digit alternative: `Appendix C` is a letter, and a
    // reference extractor that only knows numbers misses every appendix whose
    // numbering is alphabetical — which is most expert reports.
    /\b(?:Appendix|Annex|Figure|Table|Report|Letter|Drawing)\s+(?:[A-Z]{1,3}|\d+(?:\.\d+)*)/g,
    (match) => ({
      // `paragraph 4.2` is a clause reference; `Appendix C` is not a number at
      // all, so the two classes stay apart and a report names the right one.
      value: match[0].toLowerCase().replace(/\s+/g, " "),
      certain: true,
    }),
    claims,
  );
}

function extractDates(text: string, claims: Claim[]): ProtectedFact[] {
  const named = claimFacts(
    "date",
    text,
    /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
    (match) => {
      const parts = match[0].split(/\s+/);
      const day = Number(parts[0]);
      const month = MONTH_NUMBER.get(String(parts[1]).toLowerCase());
      const year = Number(parts[2]);
      if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) return null;
      return { value: `${year}-${pad(month)}-${pad(day)}`, certain: true };
    },
    claims,
  );
  const iso = claimFacts(
    "date",
    text,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    (match) => {
      const [year, month, day] = match[0].split("-").map(Number);
      if (month === undefined || day === undefined) return null;
      return { value: `${year}-${pad(month)}-${pad(day)}`, certain: true };
    },
    claims,
  );
  return [...named, ...iso].sort((left, right) => left.start - right.start);
}

function extractDurations(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "duration",
    text,
    // The unit is captured, not merely matched: `normaliseQuantity` keys on it, so
    // without the group `3 days` and `3 weeks` would share one identity and a
    // model that changed the unit would pass the duration check.
    new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})`, "gi"),
    (match) => ({
      value: normaliseQuantity(match[1] ?? "", match[2] ?? ""),
      certain: true,
    }),
    claims,
  );
}

function extractPercentages(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "percentage",
    text,
    /\b\d+(?:\.\d+)?\s*%/g,
    (match) => ({ value: match[0].replace(/\s+/g, ""), certain: true }),
    claims,
  );
}

function extractCurrencies(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "currency",
    text,
    /*
     * Grouped digits are matched as groups rather than as "digits and commas".
     * `[\d,]*` is greedy and takes the sentence punctuation with it, so
     * `£1,240,000, recorded` yields a surface ending in a comma — which then
     * renders in the refusal message as a quoted fragment of the document with
     * the wrong punctuation.
     */
    /[£$€¥₹₩₽]\s?\d+(?:[ ,]\d{3})*(?:\.\d+)?/g,
    (match) => ({
      // The separators are removed rather than kept, so `£1,240,000` and
      // `£1240000` are one figure and `£1,240,000` and `£1,240,500` are two.
      value: `${CURRENCY_SYMBOLS.get(match[0][0] ?? "") ?? "???"} ${match[0].slice(1).replace(/[\s,]/g, "")}`,
      certain: true,
    }),
    claims,
  );
}

function extractQuantities(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "quantity",
    text,
    /\b\d+(?:\.\d+)?\b/g,
    (match) => ({
      // A bare number. Never certain: it might be a count, an item, a house
      // number, or part of an identifier that another extractor already claimed.
      value: match[0],
      certain: false,
    }),
    claims,
  );
}

/**
 * Alphanumeric codes: `ACT-0142`, `EVT-0087`, `ISO9001`.
 *
 * A recognised prefix upgrades the kind and raises `certain`; an unrecognised
 * one stays a plain `identifier`, still `certain: false`. That asymmetry is
 * deliberate — `ACT-0142` is unambiguously an activity reference, while
 * `MX4471` might be a part number, a barcode, or a typing error, and a hard
 * failure on an unrecognised code would fire on ordinary prose.
 */
function extractIdentifiers(text: string, claims: Claim[]): ProtectedFact[] {
  const hyphenated = claimFacts(
    "identifier",
    text,
    /\b[A-Za-z]{2,}[-_]\d+[A-Za-z0-9_-]*\b/g,
    (match) => ({ value: match[0].toUpperCase(), certain: false }),
    claims,
  );
  const bare = claimFacts(
    "identifier",
    text,
    /\b[A-Z]{2,}\d{2,}[A-Z0-9]*\b/g,
    (match) => ({ value: match[0].toUpperCase(), certain: false }),
    claims,
  );
  return [...hyphenated, ...bare]
    .map((fact): ProtectedFact => {
      // Matched against the surface, not `value`. `value` carries the kind as a
      // prefix, so testing it against an anchored prefix pattern never matches
      // and every code silently stays a plain identifier.
      const kind = IDENTIFIER_PREFIXES.find(([pattern]) =>
        pattern.test(fact.surface.toUpperCase()),
      )?.[1];
      return kind === undefined ? fact : { ...fact, kind, certain: true };
    })
    .sort((left, right) => left.start - right.start);
}

function extractPartyNames(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "partyName",
    text,
    /*
     * `[A-Z][A-Za-z]+` per token rather than `[A-Z][a-z]+`, so a party rendered
     * in capitals — which is how a party appears in a report heading — is still
     * recognised. The suffix requirement is what keeps this from matching
     * ordinary prose, so widening the token shape costs nothing in precision.
     */
    /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\b/g,
    (match) => {
      const words = match[0].split(/\s+/);
      const last = String(words[words.length - 1]).toLowerCase();
      if (words.length < 2) return null;
      if (!ORGANISATIONAL_SUFFIXES.has(last)) return null;
      return { value: match[0].toLowerCase().replace(/\s+/g, " "), certain: true };
    },
    claims,
  );
}

/**
 * Capitalised runs that might be an entity and are not provably one.
 *
 * **Sentence-initial runs are excluded.** `The Contractor` and `The Programme`
 * are capitalised two-word runs, and a checker that reported them as changed
 * entities would put a soft warning on essentially every paragraph an expert
 * writes. The exclusion is what makes the remaining class usable: a run that is
 * capitalised mid-sentence, is not a known common phrase, and is not already
 * claimed as something else, is worth a *warning* and nothing more.
 */
function extractSuspectedEntities(text: string, claims: Claim[]): ProtectedFact[] {
  return claimFacts(
    "suspectedEntity",
    text,
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
    (match) => {
      const start = match.index;
      if (start === 0) return null;
      const before = text.slice(Math.max(0, start - 2), start);
      if (/[.?!;\n]/.test(before)) return null;
      const words = match[0].toLowerCase().split(/\s+/);
      if (words.length < 2) return null;
      if (words.every((word) => STOP_WORDS.has(word))) return null;
      return { value: match[0].toLowerCase().replace(/\s+/g, " "), certain: false };
    },
    claims,
  );
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "it",
  "they",
  "we",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "to",
  "of",
  "with",
  "and",
  "or",
  "but",
  "as",
  "if",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "not",
  "no",
  "all",
  "only",
  "under",
  "subject",
  "recorded",
  "programme",
  "programmed",
  "works",
  "figure",
  "employer",
  "contractor",
]);

/**
 * The extractors, in the order they claim spans.
 *
 * Order is the whole design. A date claims `30 June 2025` before the quantity
 * extractor can see `30` and `2025`; a currency claims `£1,240,000` before the
 * quantity extractor sees `1,240,000`; a clause reference claims `clause 12.4.3`
 * before the identifier extractor can see `12.4.3`. Reversing any pair produces
 * duplicate findings for one change, and a report that names the same edit three
 * times is a report the user stops reading.
 */
const EXTRACTORS: readonly ((text: string, claims: Claim[]) => ProtectedFact[])[] = [
  extractDocumentReferences,
  extractClauseReferences,
  extractDates,
  extractCurrencies,
  extractPercentages,
  extractDurations,
  extractIdentifiers,
  extractPartyNames,
  extractQuantities,
  extractSuspectedEntities,
];

/**
 * Every protected token in `text`, in order of appearance.
 *
 * Deterministic and side-effect free: the same text always yields the same
 * report, which is what lets a caller cache one and compare two.
 */
export function extractProtectedFacts(text: string): ProtectedFact[] {
  const claims: Claim[] = [];
  const facts = EXTRACTORS.flatMap((extractor) => extractor(text, claims));
  return facts.sort((left, right) => left.start - right.start);
}

/**
 * Protected tokens from `text` that also appear in `facts`.
 *
 * This is the leakage check P2 needs, and it is why the extractor lives in a
 * module with no provider dependency: a model told not to reproduce the sample
 * may still write "the delay at Ardmore Construction Group" into a profile
 * description, and the only reliable way to notice is to compare against what
 * was sent.
 */
export function findFactsPresentIn(text: string, facts: readonly ProtectedFact[]): ProtectedFact[] {
  const present = new Map(extractProtectedFacts(text).map((fact) => [fact.value, fact]));
  return facts
    .filter((fact) => present.has(fact.value))
    .map((fact) => present.get(fact.value) as ProtectedFact);
}
