/**
 * Spec §4.2 language-convention rules.
 *
 * Everything about the words themselves: which terms the house uses, how
 * capitalisation is applied, which abbreviations may appear, how numbers, dates,
 * currency and units are written. Pure — no Office, no LLM, no UI, so every rule
 * here is unit-testable with a string and a profile.
 *
 * **Why this is a new module rather than an extension of `houseStyle.ts`.**
 * The legacy scanner reads a flat record where every finding has the same shape:
 * a term, a replacement, a severity. Spec §4.2 asks for rules that carry
 * case-sensitivity, word-boundary behaviour, a severity, and a scope that can
 * restrict them to one section or style — none of which the flat record can
 * express. Adding them to the existing signature would have meant a rule
 * carrying per-rule options through a per-profile parameter, which is the shape
 * that lets one rule's option silently apply to another's findings.
 *
 * **What these rules do not do.** None of them decides what a sentence *means*.
 * A date rule reports the shape it found and the shape the profile wants; it
 * never resolves which day a period refers to. That is Semantic Review's job,
 * and a deterministic rule answering it would be guessing. The same applies to
 * figures: nothing here rounds, abbreviates or reorders a number, because a
 * figure is the one thing a formatting tool must not alter.
 *
 * Boundary rule: this module may import `core/domain` and `shared/utils` only.
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type {
  CapitalisationProfile,
  DateShapeId,
  LanguageConventionProfile,
  TerminologyRule,
} from "../core/domain/StyleProfile";
import { DATE_SHAPE_LABELS, LOCALE_DATE_SHAPES } from "../core/domain/StyleProfile";

/** A heading, used to resolve a rule scoped to one section. */
export interface SectionMark {
  /** The offset the heading's own text starts at. */
  readonly start: number;
  /** The heading's text. */
  readonly text: string;
}

export interface LanguageCheckOptions {
  text: string;
  rules: LanguageConventionProfile;
  /**
   * Per-paragraph style names, keyed by paragraph start offset.
   *
   * A terminology rule scoped to `withinStyle` cannot be evaluated without
   * knowing which style each occurrence sits in, and a text-only scanner has no
   * way to know. A rule with no style scope ignores this entirely, so the
   * common case costs nothing.
   */
  styleByStart?: ReadonlyMap<number, string>;
  /**
   * Headings in document order, for a rule scoped to one section.
   *
   * A profile with a section-scoped rule and no marks cannot evaluate it, so the
   * rule stays silent rather than firing everywhere.
   */
  sectionHeads?: readonly SectionMark[];
}

interface MatchRange {
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a matcher for one term, honouring both `wholeWord` and `caseSensitive`.
 *
 * The two settings select *different patterns*, not a pattern plus a filter. A
 * bounded pattern for a `wholeWord: false` rule would find nothing extra to
 * filter down from — `color` bounded does not match inside `colorful` at all —
 * so the boundary has to be omitted from the pattern itself.
 *
 * `\b` is deliberately not used. It is defined in terms of `\w`, which is
 * `[A-Za-z0-9_]`, so it treats `café` as ending at the `é` and `color` as
 * matching inside `coloré`. The lookaround form below uses Unicode letter and
 * number properties, so a house rule does not fire on a word in a language the
 * profile is not written for.
 */
function termPattern(value: string, wholeWord: boolean, caseSensitive: boolean): RegExp {
  const escaped = escapeRegExp(value);
  const body = wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(body, caseSensitive ? "gu" : "giu");
}

function findMatches(text: string, regex: RegExp): MatchRange[] {
  const results: MatchRange[] = [];
  [...text.matchAll(regex)].forEach((match) => {
    const start = match.index;
    const evidence = match[0];
    if (start === undefined || evidence === undefined) return;
    results.push({ start, end: start + evidence.length });
  });
  return results;
}

function overlaps(left: MatchRange, right: Range): boolean {
  return left.start < right.end && right.start < left.end;
}

function makeRange(range: MatchRange): Range {
  return { start: range.start, end: range.end, unit: "character" };
}

/** A gap measured between two offsets. */
export interface MeasuredGap {
  /** The offset just after the preceding digit. */
  readonly start: number;
  /** The offset of the marker that follows the gap. */
  readonly end: number;
}

/**
 * Every place a digit run is followed by an optional gap and then a marker.
 *
 * Scanned by walking back from the marker rather than matched with a lookaround,
 * and that is deliberate. A pattern like `(?<=\d)(?<gap>[ \t]*)(?=[A-Za-z])` is
 * *zero-width* whenever the gap is empty — the whole match consumes nothing —
 * and a zero-width match is exactly the case where the captured group is least
 * dependable. All three spacing rules need the gap, so the marker is located by
 * a pattern that always consumes something and the gap is measured from it.
 */
function gapsBefore(
  text: string,
  marker: RegExp,
  /** What may legitimately precede the gap. */
  precededBy: RegExp = /\d/u,
): MeasuredGap[] {
  const gaps: MeasuredGap[] = [];
  [...text.matchAll(marker)].forEach((match) => {
    const markerStart = match.index;
    if (markerStart === undefined) return;
    let start = markerStart;
    while (start > 0 && /[ \t]/.test(text[start - 1] ?? "")) start -= 1;
    // A gap only counts as *spacing* when something meaningful precedes it.
    // Without this the space in "the NHS responded" would be reported as a
    // unit needing one. The predecessor is a parameter because a currency gap
    // follows a symbol, not a digit — a default of digit-only silently made
    // the currency rule unreachable.
    if (start === 0 || !precededBy.test(text[start - 1] ?? "")) return;
    gaps.push({ start, end: markerStart });
  });
  return gaps;
}

/**
 * Build a finding.
 *
 * `deterministic` carries the provenance spec §12 requires: which profile field
 * produced the finding, what was found, what was expected, and — critically —
 * whether a correction is actually available. A rule that finds a deviation it
 * cannot fix must say so, or the review UI offers an "Approve" for something
 * Apply will refuse.
 *
 * `safeBatchKey` is set only where every occurrence carrying the same key wants
 * the same correction. Spec §13 permits batch approval on that basis and no
 * other, so a key left off is a group that must be approved one at a time.
 *
 * `occurrenceGroupKey` is the batch key when there is one, and the profile path
 * and expected value otherwise. Grouping on the category alone would put
 * `01/02/2026` and an ambiguous currency figure in one bucket, and the group's
 * `expected` values would then differ — so the group would refuse batch approval
 * for the wrong reason, and the UI would show a mixed bucket under one heading.
 */
function makeFinding(params: {
  category: string;
  ruleId: string;
  profilePath: string;
  range: Range;
  message: string;
  severity: Severity;
  actual: string;
  expected: string;
  correctionAvailable: boolean;
  safeBatchKey?: string;
}): Finding {
  return {
    id: uuidv4(),
    kind: "deterministic",
    category: params.category,
    range: params.range,
    message: params.message,
    severity: params.severity,
    evidence: params.actual,
    confidence: 1,
    ruleId: params.ruleId,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    actual: params.actual,
    expected: params.expected,
    precondition: { kind: "text", expectedText: params.actual },
    deterministic: {
      profilePath: params.profilePath,
      actual: params.actual,
      expected: params.expected,
      occurrenceGroupKey: params.safeBatchKey ?? `${params.profilePath}|${params.expected}`,
      correctionAvailable: params.correctionAvailable,
      ...(params.safeBatchKey === undefined ? {} : { safeBatchKey: params.safeBatchKey }),
    },
  };
}

function severityOf(rule: TerminologyRule): Severity {
  return rule.severity === "mandatory" ? "error" : "warning";
}

/**
 * Apply a replacement while preserving the source's own capitalisation.
 *
 * A case-insensitive rule matching `Programme` must not rewrite it to
 * `programme`: that is rewriting the opening word of a sentence, and the user
 * would be shown a lower-case start as a correction to their capitalisation.
 * The replacement's own capitalisation applies only when the source is fully
 * upper case, which is the acronym case.
 */
function matchCasing(source: string, replacement: string): string {
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) return replacement.toUpperCase();
  const first = source[0];
  if (first !== undefined && first === first.toUpperCase()) {
    return (replacement[0]?.toUpperCase() ?? "") + replacement.slice(1);
  }
  return replacement;
}

/** The nearest heading at or before `offset`. */
function nearestHead(
  sectionHeads: readonly SectionMark[],
  offset: number,
): SectionMark | undefined {
  let best: SectionMark | undefined;
  sectionHeads.forEach((head) => {
    if (head.start <= offset && (best === undefined || head.start > best.start)) best = head;
  });
  return best;
}

/** The style of the paragraph containing `offset`. */
function styleAt(styleByStart: ReadonlyMap<number, string>, offset: number): string | undefined {
  let best: string | undefined;
  let bestStart = -1;
  styleByStart.forEach((style, start) => {
    if (start <= offset && start > bestStart) {
      bestStart = start;
      best = style;
    }
  });
  return best;
}

/**
 * Whether a scoped rule applies at this offset.
 *
 * Both scope keys are checked. Without the maps a scope cannot be evaluated, and
 * a rule that cannot be shown to apply must not fire: reporting a deviation
 * inside a quotation the author explicitly excluded is worse than missing one,
 * because the user cannot tell which of the two happened.
 */
function inScope(
  rule: TerminologyRule,
  offset: number,
  sectionHeads: readonly SectionMark[],
  styleByStart: ReadonlyMap<number, string> | undefined,
): boolean {
  const { withinSectionContaining, withinStyle } = rule.scope;
  if (withinStyle !== undefined) {
    if (styleByStart === undefined) return false;
    if (styleAt(styleByStart, offset) !== withinStyle) return false;
  }
  if (withinSectionContaining !== undefined) {
    const head = nearestHead(sectionHeads, offset);
    if (head === undefined || !head.text.includes(withinSectionContaining)) return false;
  }
  return true;
}

/**
 * Spec §4.2 terminology.
 *
 * Fires for each `terminology` rule and for the legacy `legacyPreferredTerminology`
 * record, because a profile authored under the old editor has entries in the
 * record and none in the list.
 *
 * Overlapping matches resolve longest-first, then earliest, then by rule id: two
 * rules for `organisation` and `organisation name` should report the longer one,
 * and reporting both is one deviation shown twice.
 */
export function findTerminologyIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules, styleByStart } = options;
  if (text.length === 0) return [];
  const sectionHeads = options.sectionHeads ?? [];

  /*
   * Required terms, checked first.
   *
   * A required term is a wording the house insists on, so its absence is the
   * deviation. Checked before the substitution pass because an absence overlaps
   * nothing: it is reported at offset 0 with a zero-length range, and a
   * substitution that claims that span would be reporting the wrong problem.
   *
   * Reported, never corrected. There is no text to rewrite - the term is not there -
   * and inventing a sentence to contain it would be the tool writing the author's
   * prose. The finding names the term and says where it would be expected.
   *
   * Matched with the same case sensitivity the rule declares, so a house that
   * insists on a lower-case term is not satisfied by a capitalised one and vice
   * versa. A term already present is silent, which is the compliant case.
   */
  const required: Finding[] = rules.requiredTerms
    .map((rule) => ({ rule, source: rule.source.trim() }))
    .filter((entry) => entry.source.length > 0)
    .filter(
      (entry) =>
        findMatches(text, termPattern(entry.source, entry.rule.wholeWord, entry.rule.caseSensitive))
          .length === 0,
    )
    .map((entry) =>
      makeFinding({
        category: "language.terminology.missing",
        ruleId: "language/terminology",
        profilePath: `language.requiredTerms.${entry.rule.id}`,
        // Zero-length at the document start: there is no span in the text to point
        // at, and a range that names one would send "Go to text" somewhere the
        // term is not.
        range: { start: 0, end: 0, unit: "character" },
        message: `This style requires the term “${entry.source}”`,
        severity: severityOf(entry.rule),
        actual: "",
        expected: entry.source,
        // No correction exists. Offering one would advertise an Apply that has
        // nothing to apply.
        correctionAvailable: false,
      }),
    );

  const legacy: TerminologyRule[] = Object.entries(rules.legacyPreferredTerminology)
    .filter(([source, replacement]) => source.trim().length > 0 && replacement.trim().length > 0)
    .map(([source, replacement]) => ({
      id: `legacy:${source.trim()}`,
      source: source.trim(),
      replacement: replacement.trim(),
      caseSensitive: false,
      wholeWord: true,
      severity: "advisory",
      scope: {},
    }));

  /*
   * The banned-term list, as terminology rules.
   *
   * `language.bannedTerms` is a plain list of words the house has forbidden, and
   * this function scanned `rules.terminology` and the legacy record but not it —
   * so the setting was declared in the registry as read by `language/banned` and
   * changed nothing, which is the spec §11 failure the audit exists to catch.
   * A banned term becomes a rule with *no* `replacement`, which is exactly how
   * the scanner below already says "remove this", so the two paths converge on
   * one implementation rather than two.
   *
   * Mandatory and case-insensitive because a banned word is forbidden however it
   * is capitalised, and whole-word because banning "utilise" is not a claim
   * about "utilisation".
   */
  const banned: TerminologyRule[] = rules.bannedTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => ({
      id: `banned:${term}`,
      source: term,
      caseSensitive: false,
      wholeWord: true,
      severity: "mandatory" as const,
      scope: {},
    }));

  const findings: Finding[] = [];
  const claimed: Range[] = [];

  [...rules.terminology, ...legacy, ...banned]
    .flatMap((rule) =>
      findMatches(text, termPattern(rule.source, rule.wholeWord, rule.caseSensitive)).map(
        (range) => ({ rule, range }),
      ),
    )
    .sort((left, right) => {
      const leftLength = left.range.end - left.range.start;
      const rightLength = right.range.end - right.range.start;
      const byLength = rightLength - leftLength;
      if (byLength !== 0) return byLength;
      const byStart = left.range.start - right.range.start;
      if (byStart !== 0) return byStart;
      return left.rule.id.localeCompare(right.rule.id);
    })
    .forEach(({ rule, range }) => {
      if (claimed.some((taken) => overlaps(range, taken))) return;
      if (!inScope(rule, range.start, sectionHeads, styleByStart)) return;
      claimed.push(makeRange(range));

      const found = text.slice(range.start, range.end);
      const replacement = rule.replacement;
      // A rule with no replacement is a banned term. Omitting the field is how
      // a rule says "remove this", and it is deliberately not the same as
      // replacing with an empty string.
      const banned = replacement === undefined;
      const expected = banned ? "" : matchCasing(found, replacement);
      findings.push(
        /*
         * The category used to be `houseStyle.terminology` while the
         * `profilePath` right below it said `language.terminology.<id>` — the
         * category contradicted the field that produced it (ND-12). It is now
         * `language.terminology.preferred`, beside its two siblings
         * `language.terminology.missing` and `language.bannedTerm`.
         */
        makeFinding({
          category: banned ? "language.bannedTerm" : "language.terminology.preferred",
          ruleId: "language/terminology",
          profilePath: banned ? "language.bannedTerms" : `language.terminology.${rule.id}`,
          range: makeRange(range),
          message: banned
            ? `Remove the banned term “${rule.source}”`
            : `Use “${expected}” instead of “${found}”`,
          severity: banned ? "error" : severityOf(rule),
          actual: found,
          expected,
          // Both are correctable — a banned term becomes a deleteRange, a
          // substitution a replaceText. Which one it is, is the planner's
          // call from the empty `expected`.
          correctionAvailable: true,
          /*
           * No batch key for a banned term, deliberately.
           *
           * Unlike a substitution, a deletion is not semantically neutral: it
           * removes the author's words rather than restating them, and the
           * planner already builds it as a non-reversible `deleteRange`. Spec §13
           * permits batch approval only where the correction is neutral, so the
           * key is withheld here exactly as `houseStyle.ts` withholds it for its
           * own banned-term rule. Without a key, `groupFindings` refuses the
           * batch and refuses it *with a reason the UI can show* — which is the
           * outcome the rule wants, rather than a disabled control with no
           * explanation.
           */
          ...(banned ? {} : { safeBatchKey: `terminology:${rule.source}:${expected}` }),
        }),
      );
    });

  // The required-term findings lead, because an absence is a whole-document
  // observation while a substitution is anchored at a span, and a reader working
  // top-down should see what is missing before what is misspelled.
  return [...required, ...findings].sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  );
}

/**
 * The paragraph style names that mark a paragraph as a heading.
 *
 * Matched on the name because that is all the reader gives us, and a localized
 * Word reports "Überschrift 1" where an English one says "Heading 1". The
 * consequence is that this rule is **silent on a non-English host**, which is the
 * safe direction: a heading-case check that cannot tell a heading from a body
 * paragraph must not guess. Stated here rather than discovered by a German user
 * reporting that ToneForge finds nothing.
 */
const HEADING_STYLE = /^(heading|title|subtitle)\b/iu;

/**
 * The words left lower case inside a title-case heading.
 *
 * The usual English rule, and a house can overrule it by listing a word in
 * `properNouns` — which is checked first, so a house that capitalises "The" in
 * "The Sun Report" wins over this list.
 */
const TITLE_CASE_MINOR_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "off",
  "on",
  "onto",
  "or",
  "over",
  "per",
  "so",
  "the",
  "to",
  "up",
  "via",
  "with",
  "yet",
]);

/**
 * Every paragraph the reader has told us is a heading, as a span.
 *
 * `styleByStart` is keyed by paragraph start, so the paragraphs are the gaps
 * between consecutive keys — the same reconstruction `styleAt` relies on when it
 * resolves an arbitrary offset. An absent or empty map names no paragraph, and
 * the honest answer to "which paragraphs are headings" on such a scan is none.
 */
function headingParagraphs(
  text: string,
  styleByStart: ReadonlyMap<number, string> | undefined,
): MatchRange[] {
  if (styleByStart === undefined || styleByStart.size === 0) return [];
  const starts = [...styleByStart.keys()].sort((left, right) => left - right);
  const heads: MatchRange[] = [];
  starts.forEach((start, index) => {
    const style = styleByStart.get(start);
    if (style === undefined || !HEADING_STYLE.test(style.trim())) return;
    const next = starts[index + 1];
    const end = next === undefined ? text.length : next;
    if (end > start) heads.push({ start, end });
  });
  return heads;
}

/**
 * `capitalisation.headingCase` — the convention this house writes headings in.
 *
 * This field was declared in the schema, named in `language/capitalisation`'s
 * `profilePaths`, and read by nothing. The registry therefore reported it as
 * wired, which is the same defect class as ND-13 under a third field name.
 *
 * **What each convention reports.**
 *
 * - `upper` — every lower-case letter in the heading. Correctable: upper-casing
 *   one letter inside a word cannot change which word it is.
 * - `title` — a word that should open with a capital and does not. Correctable
 *   for the same reason. The *reverse* — a capitalised word that should be a
 *   lower-case "of" — is deliberately **not** corrected: lower-casing a word the
 *   profile has not listed as a proper noun may destroy one.
 * - `sentence` — a word capitalised where only the first should be. Reported
 *   with no correction, for the same reason, and with all-upper-case words
 *   skipped: an acronym in a heading is not a capitalisation error, and flagging
 *   one would make the rule cry wolf on every document that names a product.
 */
function checkHeadingCase(
  text: string,
  rules: CapitalisationProfile,
  styleByStart: ReadonlyMap<number, string> | undefined,
): Finding[] {
  // `undefined` means the house has not chosen a heading convention, which is a
  // different answer from "sentence case" — and is the reason the field is
  // optional rather than defaulting.
  const wanted = rules.headingCase;
  if (wanted === undefined) return [];

  const findings: Finding[] = [];
  const properNouns = new Set(rules.properNouns.map((noun) => noun.trim().toLowerCase()));

  const headingFinding = (
    offset: number,
    character: string,
    expected: string,
    correctionAvailable: boolean,
    message: string,
  ): void => {
    findings.push(
      makeFinding({
        category: "language.capitalisation.headingCase",
        ruleId: "language/capitalisation",
        profilePath: "language.capitalisation.headingCase",
        range: { start: offset, end: offset + character.length, unit: "character" },
        message,
        severity: "warning",
        actual: character,
        expected,
        correctionAvailable,
        // No batch key: each finding wants a different correction, and a key is a
        // claim that every occurrence under it wants the same edit.
      }),
    );
  };

  headingParagraphs(text, styleByStart).forEach((paragraph) => {
    const raw = text.slice(paragraph.start, paragraph.end);
    const body = raw.trim();
    if (body.length === 0) return;
    const bodyStart = paragraph.start + (raw.length - raw.trimStart().length);

    if (wanted === "upper") {
      // Walked with a running code-unit cursor rather than `indexOf`, because a
      // heading may contain the same letter twice and `indexOf` would report both
      // occurrences at the first one's offset.
      let cursor = bodyStart;
      for (const character of body) {
        if (character === character.toLowerCase() && character !== character.toUpperCase()) {
          headingFinding(
            cursor,
            character,
            character.toUpperCase(),
            true,
            "A heading is written in upper case in this house",
          );
        }
        cursor += character.length;
      }
      return;
    }

    let colonAt = body.indexOf(":");
    for (const match of body.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
      const word = match[0];
      const at = match.index ?? 0;
      const lower = word.toLowerCase();
      const first = word[0];
      if (first === undefined) continue;
      // A word is capitalised after a colon in every title-case style in use, and
      // a subtitle introduced by one is not an error.
      const afterColon = colonAt !== -1 && colonAt < at;
      if (afterColon) colonAt = -1;
      const isFirstWord = at === 0;
      const isAcronym = word === word.toUpperCase();
      const isLower = first === first.toLowerCase() && first !== first.toUpperCase();

      if (wanted === "title" && isLower) {
        if (isFirstWord || afterColon || properNouns.has(lower)) continue;
        if (TITLE_CASE_MINOR_WORDS.has(lower)) continue;
        headingFinding(
          bodyStart + at,
          first,
          first.toUpperCase(),
          true,
          "A heading is written in title case in this house",
        );
        continue;
      }

      if (wanted === "sentence" && !isLower && !isAcronym) {
        if (isFirstWord || afterColon || properNouns.has(lower)) continue;
        headingFinding(
          bodyStart + at,
          first,
          "",
          false,
          "A heading is written in sentence case, so only its first word is capitalised",
        );
      }
    }
  });

  return findings;
}

/**
 * Spec §4.2 capitalisation.
 *
 * Three checks with three different failure modes, reported separately rather
 * than merged: a proper noun in lower case is a different error from a common
 * noun in upper case, and both are different from a sentence that does not open
 * with a capital. One merged "capitalisation" finding would give the user a
 * single type with three meanings, and the correction for one is frequently
 * wrong for another.
 */
export function findCapitalisationIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules, styleByStart } = options;
  if (text.length === 0) return [];
  const capitalisation = rules.capitalisation;
  // First, because a heading that is not in the house's case is the deviation a
  // reader notices before anything else on the page.
  const findings: Finding[] = checkHeadingCase(text, capitalisation, styleByStart);

  capitalisation.properNouns.forEach((noun) => {
    const term = noun.trim();
    if (term.length === 0) return;
    // Matched case-insensitively then checked, because the whole point is to
    // catch `parliament` where the profile wants `Parliament` — a
    // case-sensitive match would never see it.
    findMatches(text, termPattern(term, true, false)).forEach((range) => {
      const found = text.slice(range.start, range.end);
      const first = found[0];
      if (first === undefined || first === first.toUpperCase()) return;
      findings.push(
        makeFinding({
          category: "language.capitalisation.properNoun",
          ruleId: "language/capitalisation",
          profilePath: "language.capitalisation.properNouns",
          range: makeRange(range),
          message: `“${term}” is a proper noun and takes a capital letter`,
          severity: "warning",
          actual: found,
          expected: matchCasing(found, term),
          correctionAvailable: true,
          safeBatchKey: `properNoun:${term}`,
        }),
      );
    });
  });

  capitalisation.prohibitedCapitalised.forEach((word) => {
    const term = word.trim();
    if (term.length === 0) return;
    // The pattern requires the capital, so only the capitalised form matches.
    const capitalised = (term[0]?.toUpperCase() ?? "") + term.slice(1);
    findMatches(text, termPattern(capitalised, true, true)).forEach((range) => {
      /*
       * A capital that opens a sentence is the rule, not a violation of it.
       *
       * The list names words that are not proper nouns and so are written in
       * lower case *within* a sentence. The first word of a sentence is
       * capitalised whatever it is, so reporting "The Committee met." would
       * tell the author to delete the capital that English requires — and the
       * user who approved it would be shown a lower-case sentence start as a
       * correction.
       *
       * Skipped at the very start of the text and after sentence-ending
       * punctuation, with opening quotes allowed between them: `He said "The
       * Committee met."` opens a quoted sentence, not a mid-sentence use.
       */
      const before = text.slice(0, range.start);
      const preceding = before.replace(/[\s"'(\[]*$/u, "");
      const last = preceding.at(-1);
      if (last === undefined || /[.!?]/u.test(last)) return;
      const found = text.slice(range.start, range.end);
      findings.push(
        makeFinding({
          category: "language.capitalisation.prohibited",
          ruleId: "language/capitalisation",
          profilePath: "language.capitalisation.prohibitedCapitalised",
          range: makeRange(range),
          message: `“${term}” is not a proper noun and is written in lower case`,
          severity: "warning",
          actual: found,
          expected: term,
          correctionAvailable: true,
          safeBatchKey: `prohibitedCapital:${term}`,
        }),
      );
    });
  });

  if (!capitalisation.sentenceCase) return findings;

  /*
   * A sentence opens with a capital.
   *
   * Matched as "a terminator, then optional opening punctuation, then a
   * lower-case letter" and reported at the letter. Reporting at the terminator
   * would be wrong — the deviation is the letter, and the user fixes the letter.
   *
   * A decimal point is excluded, because the character after `3.` is a digit
   * and never a letter; an initial is left alone because a single capital
   * followed by a point is not a sentence boundary the author got wrong.
   */
  const opening = /(?:^|(?<=[.!?])(?:["')\]]*)\s+)(?:["'(\[]*)\p{Ll}/gu;
  [...text.matchAll(opening)].forEach((match) => {
    const text3 = match[0];
    // The first capture is empty at the very start of the text, so the letter's
    // position is measured from the end of the match rather than from a group's
    // length — a document's opening sentence is the common case, and getting it
    // wrong makes the rule silent on exactly the text a reader looks at first.
    const letterIndex = (match.index ?? 0) + text3.length - 1;
    const letter = text[letterIndex];
    if (letter === undefined) return;
    findings.push(
      makeFinding({
        category: "language.capitalisation.sentenceCase",
        ruleId: "language/capitalisation",
        profilePath: "language.capitalisation.sentenceCase",
        range: { start: letterIndex, end: letterIndex + 1, unit: "character" },
        message: "A sentence opens with a capital letter",
        severity: "warning",
        actual: letter,
        expected: letter.toUpperCase(),
        correctionAvailable: true,
        safeBatchKey: "sentenceCase",
      }),
    );
  });

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/**
 * Spec §4.2 abbreviations.
 *
 * Checked in the order a copy-editor would make them: a prohibited form is a
 * hard error, a first-use expansion requirement is a structural observation
 * about the document rather than a deviation at a span, and a long form written
 * where the house prefers the short one is an ordinary span-local substitution.
 */
export function findAbbreviationIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const abbreviations = rules.abbreviations;

  /*
   * Spans the prohibited check has already claimed.
   *
   * A profile can put the same form in `prohibitedVariants` and name a
   * `preferredExpanded` replacement for it. Both checks would then want to write
   * over one range, which is ND-2 — two owners for one character, and the
   * planner is entitled to refuse the whole plan over it. The prohibited rule
   * wins the claim: it is the stricter of the two, it is the one that says the
   * form may not appear at all, and it carries the `approved` replacement that
   * the user is more likely to accept.
   */
  const prohibitedSpans: MatchRange[] = [];

  abbreviations.prohibitedVariants.forEach((variant) => {
    const term = variant.trim();
    if (term.length === 0) return;
    findMatches(text, termPattern(term, true, false)).forEach((range) => {
      const found = text.slice(range.start, range.end);
      const approved = abbreviations.approved[found] ?? abbreviations.approved[term];
      prohibitedSpans.push(range);
      findings.push(
        makeFinding({
          category: "language.abbreviation.prohibited",
          ruleId: "language/abbreviations",
          profilePath: "language.abbreviations.prohibitedVariants",
          range: makeRange(range),
          message: `“${term}” is not an approved abbreviation`,
          severity: "error",
          actual: found,
          expected: approved ?? "",
          // Correctable only when the profile supplies the approved form.
          // Otherwise the planner has nothing to substitute, and offering
          // Approve would be an offer the Apply path cannot honour.
          correctionAvailable: approved !== undefined,
          safeBatchKey: `abbrevProhibited:${term}`,
        }),
      );
    });
  });

  // Only enforced when the profile asked. `undefined` means "not configured",
  // which is a different answer from a decision that it is not required.
  if (abbreviations.requireFirstUseExpansion === true) {
    Object.keys(abbreviations.approved).forEach((short) => {
      const expansion = abbreviations.approved[short];
      if (expansion === undefined) return;
      const matches = findMatches(text, termPattern(short, true, false));
      const first = matches[0];
      // No occurrence is not a deviation, and one already preceded by its
      // expansion is compliant.
      if (first === undefined) return;
      if (text.slice(0, first.start).toLowerCase().includes(expansion.toLowerCase())) return;
      findings.push(
        makeFinding({
          category: "language.abbreviation.firstUse",
          ruleId: "language/abbreviations",
          profilePath: "language.abbreviations.requireFirstUseExpansion",
          range: makeRange(first),
          message: `Expand “${short}” to “${expansion}” on first use`,
          severity: "warning",
          actual: text.slice(first.start, first.end),
          expected: `${expansion} (${short})`,
          correctionAvailable: true,
          safeBatchKey: `abbrevFirstUse:${short}`,
        }),
      );
    });
  }

  /*
   * A house can hold both of these at once.
   *
   * `approved` says which short form is permitted; `preferredExpanded` says which
   * rendering the running text should actually use. Reporting the long form
   * everywhere would then contradict the first-use rule immediately above, which
   * *requires* the long form to appear before the first short one. Two rules
   * disagreeing about the same sentence is exactly what this whole audit is about,
   * so they are read together rather than independently.
   *
   * **Where the long form stops being licensed.** When the profile asks for the
   * expansion on first use, a long form that precedes the first short form is the
   * expansion the profile demanded, and reporting it would ask the user to delete
   * the very thing the other rule just told them to add. Everything after that
   * point is an ordinary deviation. When the profile does *not* ask for the
   * expansion there is no licensed long form at all, and every occurrence counts.
   *
   * **A boundary, stated rather than hidden.** The rule is conservative in the gap
   * the schema cannot express: two long forms before the first short one are both
   * excused, though the profile licenses only one. Excusing them is the safe error
   * — it under-reports, and under-reporting never rewrites prose the author wrote.
   */
  const requiresExpansion = abbreviations.requireFirstUseExpansion === true;

  Object.entries(abbreviations.preferredExpanded).forEach(([longForm, shortForm]) => {
    const source = longForm.trim();
    const replacement = shortForm.trim();
    if (source.length === 0 || replacement.length === 0) return;
    // A profile that maps a form to itself has expressed no preference, and
    // reporting it would offer a no-op correction the user could only decline.
    if (source.toLowerCase() === replacement.toLowerCase()) return;

    const licensedUpTo = requiresExpansion
      ? (findMatches(text, termPattern(replacement, true, false))[0]?.end ?? -1)
      : -1;

    findMatches(text, termPattern(source, true, false)).forEach((range) => {
      if (range.start < licensedUpTo) return;
      const alreadyClaimed = prohibitedSpans.some(
        (claimed) => range.start < claimed.end && claimed.start < range.end,
      );
      if (alreadyClaimed) return;
      findings.push(
        makeFinding({
          category: "language.abbreviation.preferredExpanded",
          ruleId: "language/abbreviations",
          profilePath: `language.abbreviations.preferredExpanded.${source}`,
          range: makeRange(range),
          message: `“${source}” is written long where this house prefers “${replacement}”`,
          severity: "warning",
          actual: text.slice(range.start, range.end),
          expected: replacement,
          correctionAvailable: true,
          safeBatchKey: `abbrevPreferred:${source}`,
        }),
      );
    });
  });

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/**
 * Spec §4.2 numbers.
 *
 * Separator and spacing are span-local substitutions. The number-word threshold
 * and the "write ranges as words" style are *reporting* observations: spelling
 * out "ten" changes the author's prose, and rewriting a range as "to" changes
 * its register. Both are reported non-correctable so the review never offers an
 * Approve for a change to how the author writes.
 */
export function findNumberIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const numbers = rules.numbers;

  /*
   * **The decimal separator check moved out of this rule (D2, ND-2).**
   *
   * It used to run here as well as in `checkDecimalSeparator`, and both reported
   * the same character: the typography scanner under `typography.decimalSeparator`
   * and this one under `language.number.decimalSeparator`. Two changes over one
   * range is a plan the conflict detector is entitled to refuse, so a single
   * separator deviation could block every unrelated correction in the document.
   *
   * The two settings were never genuinely duplicates — `1.00` is a decimal,
   * `1,000` is a group — but only one rule may report either. `typography` owns
   * both separators, it applies the same structural group-mark guard, and this
   * function now owns only what the number *convention* adds: percentage
   * spacing, the number-word threshold, the range style and the negative-number
   * form.
   */

  /*
   * Percentage spacing.
   *
   * The gap between the number and the sign is captured, then compared with
   * what the profile wants. The comparison has to be *is this the wanted form*,
   * not *does this look wrong*: an earlier version skipped a match whose gap
   * already matched the profile, which discarded exactly the cases it existed
   * to report and left the rule silent.
   *
   * The marker is the percent sign alone. Matching the spelled-out forms as well
   * meant `gapsBefore` measured the gap in front of the *word*, so under the
   * default tight rule "50 percent" reported a deviation and proposed deleting
   * the space — turning a correctly written figure into "50percent". A
   * punctuation-spacing setting has no opinion about how the word is spelled,
   * and `gapsBefore` already refuses a gap with no digit before it.
   */
  const wantsSpace = numbers.percentageSpacing === "space";
  gapsBefore(text, /%/gu).forEach(({ start, end }) => {
    const gap = text.slice(start, end);
    if (gap.length > 0 === wantsSpace) return;
    findings.push(
      makeFinding({
        category: "language.number.percentageSpacing",
        ruleId: "language/numbers",
        profilePath: "language.numbers.percentageSpacing",
        range: { start, end, unit: "character" },
        message: wantsSpace
          ? "A percentage takes a space before the sign"
          : "A percentage takes no space before the sign",
        severity: "warning",
        actual: gap,
        expected: wantsSpace ? " " : "",
        correctionAvailable: true,
        safeBatchKey: `percentSpacing:${numbers.percentageSpacing}`,
      }),
    );
  });

  /*
   * Reported, never corrected. See the function's own note.
   *
   * The numeral must be a whole number standing alone. The old lookarounds only
   * excluded *letters*, so `2026` matched as `202` and `3.50` matched as both
   * `3` and `50`: the rule reported "spell out 202" against a year, and offered
   * the same remedy for the integer and the fractional part of one figure. A
   * digit or a numeric separator on either side means the numeral is part of a
   * longer number, and this rule has no correction for that anyway — rewriting
   * `3.50` as "three point five zero" is a change of register, not a spelling.
   */
  const threshold = numbers.numberWordThreshold;
  if (threshold !== null) {
    [...text.matchAll(/(?<![\p{L}\d.,])\d{1,3}(?![\p{L}\d.,])/gu)].forEach((match) => {
      const value = Number(match[0]);
      if (!Number.isFinite(value) || value > threshold) return;
      const start = match.index;
      if (start === undefined) return;
      findings.push(
        makeFinding({
          category: "language.number.spelling",
          ruleId: "language/numbers",
          profilePath: "language.numbers.numberWordThreshold",
          range: { start, end: start + match[0].length, unit: "character" },
          message: `Numbers at or below ${threshold} are spelled out in this style`,
          severity: "warning",
          actual: match[0],
          expected: "",
          // Spelling out a numeral rewrites the author's prose. Reporting it
          // without a correction is the honest answer: the user decides.
          correctionAvailable: false,
        }),
      );
    });
  }

  /*
   * Range style.
   *
   * All three styles are enforced, `enDash` included. An earlier version only
   * checked the two non-default styles, which left the *default* profile with
   * no range check at all — a rule that only fires for people who changed the
   * setting.
   */
  const wantsTo = numbers.rangeStyle === "to";
  const dash = numbers.rangeStyle === "hyphen" ? "-" : "–";
  /*
   * One pattern for all three styles, matching *any* range form and then
   * comparing, rather than the dash branch matching only dashes. A profile that
   * wants an en dash must still be told about `10 to 20`, and a pattern that
   * only looked for a dash could never report it.
   *
   * The pattern is a literal rather than a class built by interpolation. The
   * class version had to exclude the wanted dash to be worth matching at all,
   * and interpolating it produced `[\d\s-–—]` — an unescaped hyphen mid-class,
   * which is a range from `s` to `–` and throws at construction. A throw in the
   * rule's setup takes down every number check, not just the range one, which
   * is how an unrelated separator test ended up reporting this.
   */
  const rangePattern = /(?<=\d)\s*(?:[-–—]|to)\s*(?=\d)/gu;
  /*
   * Whether this match is one separator in a longer chain of digits.
   *
   * `2026-05-31` matches three times over — `2026-`, `-05`, `-31` — and each
   * match is individually indistinguishable from a range. The rule therefore
   * reported three range deviations on an ISO date and offered to rewrite its
   * hyphens as en dashes, corrupting a date that another rule in this same file
   * (`findDateIssues`) is simultaneously reporting as the wrong date *shape*.
   *
   * A chain is detected by looking outward: a separator is part of one when
   * either side's digit run is itself continued by another separator. A
   * standalone `10-20` has nothing beyond either run and stays correctable.
   */
  const partOfChain = (start: number, end: number): boolean => {
    let left = start;
    while (left > 0 && /\d/u.test(text[left - 1] ?? "")) left -= 1;
    let right = end;
    while (right < text.length && /\d/u.test(text[right] ?? "")) right += 1;
    const before = left > 0 ? text[left - 1] : undefined;
    const after = right < text.length ? text[right] : undefined;
    return (
      (before !== undefined && /[-–—]/u.test(before) && /\d/u.test(text[left - 2] ?? "")) ||
      (after !== undefined && /[-–—]/u.test(after) && /\d/u.test(text[right + 1] ?? ""))
    );
  };
  [...text.matchAll(rangePattern)].forEach((match) => {
    const start = match.index;
    if (start === undefined) return;
    const found = match[0];
    const foundTo = /(^|\s)to(\s|$)/u.test(found);
    const foundDash = found.includes("-") ? "-" : found.includes("–") ? "–" : "—";
    /*
     * Skip only when the form found is the form wanted, and compare the axis
     * the profile actually constrains.
     *
     * The previous test was `foundTo === wantsTo`, which returns early for
     * *every* dash under a dash profile — `10-20` with an en-dash profile is
     * `false === false`, so the finding was dropped before it was built and
     * dash corrections were unreachable in practice. Under a dash profile the
     * question is which dash, not whether the word `to` appeared; only a `to`
     * profile constrains the axis `foundTo` measures.
     */
    if (wantsTo) {
      if (foundTo) return;
    } else if (!foundTo && foundDash === dash) {
      return;
    }
    const chained = partOfChain(start, start + found.length);
    findings.push(
      makeFinding({
        category: "language.number.range",
        ruleId: "language/numbers",
        profilePath: "language.numbers.rangeStyle",
        range: { start, end: start + found.length, unit: "character" },
        message: wantsTo ? "A range is written with “to”" : `A range is written with “${dash}”`,
        severity: "warning",
        actual: found,
        expected: wantsTo ? " to " : dash,
        /*
         * Rewriting a range's punctuation is safe. Rewriting it as words is not,
         * and neither is rewriting one separator inside a chain: the dash may be
         * a date's or an identifier's, and only the author knows which. Those
         * are reported so the deviation is visible, with no correction and no
         * batch key, because a batch key is a claim that every occurrence wants
         * the same edit.
         */
        correctionAvailable: !wantsTo && !chained,
        ...(wantsTo || chained ? {} : { safeBatchKey: `range:${numbers.rangeStyle}` }),
      }),
    );
  });

  /*
   * How a negative number is written.
   *
   * Both directions are correctable, unlike the range rule's "to" form: `(5)` and
   * `-5` are the same number written two ways, and neither correction changes the
   * author's prose or the value.
   *
   * **What counts as a parenthesised negative.** A figure of two or more digits, or
   * one carrying a decimal separator. A *single* digit in parentheses is left
   * alone, because `(1)` and `(5)` are indistinguishable and `(1)` is far more
   * often a numbered reference. That means a genuine `(5)` is not reported — an
   * under-report rather than a wrong correction, which is the direction this audit
   * has taken everywhere else. Two digits and up is the threshold, and it is one
   * boundary rather than two contradictory ones.
   *
   * **What counts as a minus.** The sign must not be preceded by a letter, digit,
   * slash or hyphen, so the hyphens in `2026-05-31`, in `AB-12` and in a
   * telephone number are not read as negatives — they continue a word or a run,
   * they do not start one.
   */
  if (numbers.negativeNumber === "parenthesis") {
    [...text.matchAll(/(?<![\p{L}\d/-])[-−](\d[\d.,]*)(?![\d/-])/gu)].forEach((match) => {
      const start = match.index;
      if (start === undefined) return;
      findings.push(
        makeFinding({
          category: "language.number.negative",
          ruleId: "language/numbers",
          profilePath: "language.numbers.negativeNumber",
          range: { start, end: start + match[0].length, unit: "character" },
          message: "This style writes a negative number in parentheses",
          severity: "warning",
          actual: match[0],
          expected: `(${match[1]})`,
          correctionAvailable: true,
          safeBatchKey: "negativeParenthesis",
        }),
      );
    });
  } else {
    // `\d{2,}` or a lone digit followed by a decimal point — `(1.5)` is a figure
    // whatever its size; `(1)` is a reference, and `(5)` is not distinguishable
    // from one.
    [...text.matchAll(/\((\d{2,}(?:[.,]\d+)?|\d+[.,]\d+)\)/gu)].forEach((match) => {
      const start = match.index;
      if (start === undefined) return;
      findings.push(
        makeFinding({
          category: "language.number.negative",
          ruleId: "language/numbers",
          profilePath: "language.numbers.negativeNumber",
          range: { start, end: start + match[0].length, unit: "character" },
          message: "This style writes a negative number with a minus sign",
          severity: "warning",
          actual: match[0],
          expected: `-${match[1]}`,
          correctionAvailable: true,
          safeBatchKey: "negativeMinus",
        }),
      );
    });
  }

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/**
 * Name the shape a written date has.
 *
 * **`dmy` and `mdy` are separated here, and this is what makes the locale
 * enforceable.** Both describe `05/03/2026`, and the tool cannot tell which day
 * the author meant — but it *can* tell which order the house wrote the fields in
 * when the first field exceeds 12. `25/12/2026` has no valid month-first reading, so
 * it is day-first by construction; `05/03/2026` could be either, and stays
 * `numeric`.
 *
 * So the locale's default is not applied by guessing at the ambiguous case. It
 * silences the *unambiguous* wrong-order case, and leaves the ambiguous one to the
 * existing `requireUnambiguous` refusal. A locale that tried to resolve `05/03/2026`
 * by convention would be the tool deciding what day a date names — precisely what
 * the rule's own comment says it must not do.
 */
function describeDateShape(found: string): string {
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u.test(found)) return "year-first";
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/u.test(found)) return "day-month-year";
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/u.exec(found);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    // A first field above 12 cannot be a month, so the order is day-first.
    if (first > 12) return "dmy";
    // A second field above 12 cannot be a day, so the order is month-first.
    if (second > 12) return "mdy";
    // Both fields are valid as either. Reporting a shape here would be a guess.
    return "numeric";
  }
  return "unrecognised";
}

/**
 * Name a shape for a message.
 *
 * `DATE_SHAPE_LABELS` is the same table the date editor offers, so the sentence a
 * finding is reported with and the choice a user makes in the editor come from one
 * list. An id outside it — `unrecognised`, or a profile written before this table
 * existed — is echoed rather than dropped, because silently naming it "numerically"
 * would misdescribe what the rule actually found.
 */
function describeShape(id: string): string {
  return DATE_SHAPE_LABELS[id as DateShapeId] ?? id;
}

/**
 * Spec §4.2 dates.
 *
 * Reports the *shape* it recognised against the shape the profile prefers. It
 * never resolves which day a period refers to and never compares two dates —
 * that is Semantic Review's job, and a deterministic answer would be a guess.
 */
export function findDateIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const dates = rules.dates;
  const declared = dates.formats.find((format) => format.preferred);

  /*
   * The locale's default shape, and only as a fallback (D5).
   *
   * An explicit `preferred` format always wins — a house that writes `31/05/2026`
   * under an `en-GB` default has made its own choice, and overruling it with the
   * locale beside it would be the tool deciding the house's conventions for it.
   *
   * With no declared preference the locale supplies one. That is the change that
   * makes `locale` enforced rather than decorative: before this, selecting a
   * locale changed nothing at all, because `requireUnambiguous` alone cannot tell
   * a month-first date from a day-first one — only the *preferred shape* can.
   *
   * The reported `profilePath` is the one that actually produced the
   * comparison, so a finding says which setting the user should change to
   * silence it.
   */
  const fallback = LOCALE_DATE_SHAPES[rules.locale];
  const preferred = declared ?? { id: fallback.id, format: fallback.format, preferred: true };
  const preferredPath = declared ? "language.dates.formats" : "language.locale";

  const dateLike =
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/gu;

  [...text.matchAll(dateLike)].forEach((match) => {
    const start = match.index;
    const found = match[0];
    if (start === undefined || found === undefined) return;
    const shape = describeDateShape(found);
    if (shape === preferred.id) return;

    if (shape === "numeric" && dates.requireUnambiguous) {
      findings.push(
        makeFinding({
          category: "language.date.ambiguous",
          ruleId: "language/dates",
          profilePath: "language.dates.requireUnambiguous",
          range: { start, end: start + found.length, unit: "character" },
          message: "This date is ambiguous: it could be read as day-first or month-first",
          severity: "error",
          actual: found,
          expected: "",
          // Reordering the fields would change which day the date names if the
          // reader guessed the other way. The user resolves it; the tool
          // points at it.
          correctionAvailable: false,
        }),
      );
      return;
    }

    findings.push(
      makeFinding({
        category: "language.date.format",
        ruleId: "language/dates",
        profilePath: preferredPath,
        range: { start, end: start + found.length, unit: "character" },
        message: `Dates in this style are written ${describeShape(preferred.id)}`,
        severity: "warning",
        actual: found,
        expected: "",
        // The scanner knows the shape it found and the shape wanted, but
        // converting between them means deciding which field is the day, and
        // that is the guess this whole rule exists not to make.
        correctionAvailable: false,
      }),
    );
  });

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/**
 * Spec §4.2 currency.
 *
 * The magnitude field is deliberately *not* enforced: rewriting `4,200,000` as
 * `4.2m` changes a figure's precision, and a figure is the one thing in a
 * document a formatting tool must not round. The setting is read by the UI to
 * explain the profile, and the registry declares it so the orphan-setting audit
 * knows it is a deliberate exclusion rather than an oversight.
 */
export function findCurrencyIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const currency = rules.currency;

  if (currency.representation === "symbol") {
    [
      ...text.matchAll(/(?<!\p{L})\d[\d.,\s]*\s?(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|SEK|NOK|DKK)\b/gu),
    ].forEach((match) => {
      const start = match.index;
      if (start === undefined) return;
      findings.push(
        makeFinding({
          category: "language.currency.representation",
          ruleId: "language/currency",
          profilePath: "language.currency.representation",
          range: { start, end: start + match[0].length, unit: "character" },
          message: "This style writes currency as a symbol, not a code",
          severity: "warning",
          actual: match[0],
          expected: "",
          // Which symbol stands for a code is the profile's business, and the
          // schema records no mapping to make the substitution from.
          correctionAvailable: false,
        }),
      );
    });
  }

  /*
   * Symbol spacing, on the same "is this the wanted form" comparison as
   * percentage spacing: a rule that skipped the already-correct case reported
   * nothing at all.
   */
  const wantsSpace = currency.symbolSpacing === "space";
  gapsBefore(text, /\d+(?:[.,]\d+)*/gu, /[$£€¥]/u).forEach(({ start, end }) => {
    const gap = text.slice(start, end);
    if (gap.length > 0 === wantsSpace) return;
    findings.push(
      makeFinding({
        category: "language.currency.spacing",
        ruleId: "language/currency",
        profilePath: "language.currency.symbolSpacing",
        range: { start, end, unit: "character" },
        message: wantsSpace
          ? "A currency symbol is separated from its amount by a space"
          : "A currency symbol is written tight against its amount",
        severity: "warning",
        actual: gap,
        expected: wantsSpace ? " " : "",
        correctionAvailable: true,
        safeBatchKey: `currencySpacing:${currency.symbolSpacing}`,
      }),
    );
  });

  /*
   * Magnitude.
   *
   * **There is deliberately no separator check here.** `typography` owns both
   * separators document-wide (owner decision D2), and adding a second currency-
   * scoped owner for the same characters would be ND-2 all over again: two rules
   * writing over one offset, and a planner entitled to refuse the whole plan. The
   * currency profile's own separator fields are removed for the same reason the
   * number profile's were — one owner, one setting.
   *
   * Reported, never corrected.
   *
   * Abbreviating `4,200,000` as `4.2m` does not restate the figure — it replaces it
   * with a rounded one. And expanding `4.2m` needs the tool to decide which magnitude
   * the author meant, which is the guess the currency rule exists not to make. The
   * finding names the convention and stops.
   */
  const markerBefore = new RegExp(`[$£€¥]|(?:${CURRENCY_CODES})$`, "u");

  currencyAmounts(text, markerBefore).forEach(({ run, runStart, suffix }) => {
    const digits = run.replace(/\D/gu, "").length;
    const abbreviated = suffix !== undefined;
    if (currency.magnitude === "full" && abbreviated) {
      findings.push(
        makeFinding({
          category: "language.currency.magnitude",
          ruleId: "language/currency",
          profilePath: "language.currency.magnitude",
          range: { start: runStart, end: runStart + run.length, unit: "character" },
          message: "This style writes amounts in full, not abbreviated",
          severity: "warning",
          actual: run,
          expected: "",
          correctionAvailable: false,
        }),
      );
      return;
    }
    if (currency.magnitude !== "full" && digits >= 4) {
      findings.push(
        makeFinding({
          category: "language.currency.magnitude",
          ruleId: "language/currency",
          profilePath: "language.currency.magnitude",
          range: { start: runStart, end: runStart + run.length, unit: "character" },
          message: `This style abbreviates amounts of ${currency.magnitude}`,
          severity: "warning",
          actual: run,
          expected: "",
          correctionAvailable: false,
        }),
      );
    }
  });

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/** One amount run, the offset it starts at, and any magnitude suffix after it. */
interface CurrencyAmount {
  readonly run: string;
  readonly runStart: number;
  readonly suffix: string | undefined;
}

/** The currency markers this rule recognises, symbol or code. */
const CURRENCY_CODES = "USD|EUR|GBP|JPY|AUD|CAD|CHF|SEK|NOK|DKK";

/**
 * Every digit run written immediately after a currency marker.
 *
 * The marker may be separated from the amount by the gap the spacing rule also
 * measures. A run with no marker before it is not a currency amount, so
 * `10 items` and `2026-05-31` never reach the checks below — the same reason the
 * unit rule builds its marker list from the profile rather than from a shape.
 */
function currencyAmounts(text: string, marker: RegExp): CurrencyAmount[] {
  const amounts: CurrencyAmount[] = [];
  const markerSource = marker.source;
  [...text.matchAll(/\d[\d.,\u00a0\u202f ]*/gu)].forEach((match) => {
    /*
     * Trailing separators and spaces are trimmed rather than the run rejected.
     * The pattern deliberately runs through `.` and `,` because they appear
     * *inside* an amount, which means it also swallows the full stop that ends the
     * sentence — and rejecting `£4,200,000.` because it ends in a full stop is
     * exactly how the whole rule ends up silent.
     */
    const run = match[0].replace(/[.,\u00a0\u202f ]+$/u, "");
    if (run.length === 0 || !/\d$/u.test(run)) return;
    const runStart = match.index ?? 0;
    let markerEnd = runStart;
    while (markerEnd > 0 && /[ \t\u00a0\u202f]/.test(text[markerEnd - 1] ?? "")) markerEnd -= 1;
    const before = text.slice(0, markerEnd);
    if (!new RegExp(`(?:${markerSource})$`, "u").test(before)) return;
    amounts.push({
      run,
      runStart,
      suffix: /^[ \t\u00a0\u202f]?(?:bn|million|millions|thousand|thousands|[kmb])(?![A-Za-z])/iu
        .exec(text.slice(runStart + run.length))?.[0]
        .trim(),
    });
  });
  return amounts;
}

/**
 * Spec §4.2 units.
 *
 * Spacing is a correction; the symbol mapping is reported only, because a named
 * unit and its symbol are equivalent only in the SI-defined cases — everywhere
 * else the mapping is a house convention the tool cannot know.
 */
export function findUnitIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const units = rules.units;
  const wantsSpace = units.valueSpacing === "space";

  /*
   * A number followed by a short word is not always a measurement — "3 items",
   * "2 March" — so the marker is built from the unit symbols the profile has
   * actually declared rather than from "one to four letters".
   *
   * The profile's `units.symbols` record is the only place a house states which
   * words are its units, and it is the same record the capitalisation check
   * below already reads. A shape-based match had no way to consult it, so it
   * reported "3 items" as a unit needing a space and offered to insert one —
   * a confident, wrong correction to prose, on a rule whose whole job is
   * measurements.
   *
   * With no symbols configured there is nothing to match and the rule is
   * silent. That is the honest answer rather than a default list: a house that
   * has not said which words are its units has not asked this rule to fire.
   */
  const symbols = Object.values(units.symbols)
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol.length > 0);
  if (symbols.length === 0) return findings;

  /*
   * The preferred-rendering half of the map (D4).
   *
   * `units.symbols` is a map from a **named** unit to the **symbol** the house
   * prefers — `kilogram` → `kg`. Until now only the values were read (for
   * spacing) and the keys were used solely to word a capitalisation message, so
   * half the record governed nothing: a document could write "5 kilogram" against
   * a house that says "5 kg" and get no finding at all.
   *
   * This is a *named substitution*, the same shape as a terminology rule, and it
   * is correctable for the same reason: replacing a spelled-out unit with its
   * declared symbol changes no magnitude, so the value survives the edit. The
   * planner builds a `replaceText` and the review shows it for approval.
   *
   * Two guards, both load-bearing:
   *  - A name that already *is* its symbol (`m` → `m`) contributes nothing, or
   *    every occurrence would be reported as its own correction.
   *  - A multi-word name is matched whole, so "second" inside "secondary" is not
   *    a measurement.
   */
  const claimed = new Set<number>();
  Object.entries(units.symbols).forEach(([name, symbol]) => {
    const trimmedName = name.trim();
    const trimmedSymbol = symbol.trim();
    if (trimmedName.length === 0 || trimmedSymbol.length === 0) return;
    // A house that maps a name to itself has expressed no preference, and a
    // case-only difference belongs to the capitalisation check below.
    if (trimmedName.toLowerCase() === trimmedSymbol.toLowerCase()) return;

    findMatches(text, termPattern(trimmedName, true, false)).forEach((range) => {
      // Already preferred — the document wrote the symbol, so nothing to say.
      if (text.slice(range.start, range.end).toLowerCase() === trimmedSymbol.toLowerCase()) return;
      if ([...claimed].some((start) => start < range.end && range.start < start + 1)) return;
      claimed.add(range.start);
      findings.push(
        makeFinding({
          category: "language.unit.preferredSymbol",
          ruleId: "language/units",
          profilePath: `language.units.symbols.${trimmedName}`,
          range: makeRange(range),
          message: `Use “${trimmedSymbol}” instead of “${text.slice(range.start, range.end)}”`,
          severity: "warning",
          actual: text.slice(range.start, range.end),
          expected: trimmedSymbol,
          // Safe because a unit's name and its symbol denote the same quantity:
          // the edit is a restatement, never a change of magnitude. The unit
          // spacing check above deliberately makes no such claim, because
          // inserting a space *does* alter the written form.
          correctionAvailable: true,
          safeBatchKey: `unitSymbol:${trimmedName}:${trimmedSymbol}`,
        }),
      );
    });
  });
  // Longest first, so "mg" is preferred over "g" where both are declared, and
  // every alternative is bounded so `10kg.` cannot match on the `k`.
  const alternatives = [...new Set(symbols)]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  gapsBefore(text, new RegExp(`(?:${alternatives})(?![\\p{L}\\p{N}])`, "gu")).forEach(
    ({ start, end }) => {
      const gap = text.slice(start, end);
      // Skip only when the gap already *is* the wanted form. The other two
      // spacing rules read the same way; an inverted comparison here made this
      // rule fire on every correctly-spaced unit and stay silent on every
      // tight one, which is the exact inverse of what it exists to do.
      if (gap.length > 0 === wantsSpace) return;
      findings.push(
        makeFinding({
          category: "language.unit.spacing",
          ruleId: "language/units",
          profilePath: "language.units.valueSpacing",
          range: { start, end, unit: "character" },
          message: wantsSpace
            ? "A unit is separated from its value by a space"
            : "A unit is written tight against its value",
          severity: "warning",
          actual: gap,
          expected: wantsSpace ? " " : "",
          correctionAvailable: true,
          safeBatchKey: `unitSpacing:${units.valueSpacing}`,
        }),
      );
    },
  );

  if (units.capitalisation === "lower") {
    Object.keys(units.symbols).forEach((name) => {
      const symbol = units.symbols[name];
      if (symbol === undefined) return;
      const wrong = symbol.toUpperCase();
      // A symbol with no case (`m`, `s`) has nothing to flag.
      if (wrong === symbol) return;
      findMatches(text, termPattern(wrong, true, true)).forEach((range) => {
        findings.push(
          makeFinding({
            category: "language.unit.capitalisation",
            ruleId: "language/units",
            profilePath: "language.units.capitalisation",
            range: makeRange(range),
            message: `The symbol for ${name} is written in lower case`,
            severity: "warning",
            actual: text.slice(range.start, range.end),
            expected: symbol,
            // Correctable only because it is a pure case change on a symbol the
            // profile itself declared, which cannot alter the value.
            correctionAvailable: true,
            safeBatchKey: `unitCase:${symbol}`,
          }),
        );
      });
    });
  }

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/** Every language finding, in document order. */
export function findLanguageIssues(options: LanguageCheckOptions): Finding[] {
  return [
    ...findTerminologyIssues(options),
    ...findCapitalisationIssues(options),
    ...findAbbreviationIssues(options),
    ...findNumberIssues(options),
    ...findDateIssues(options),
    ...findCurrencyIssues(options),
    ...findUnitIssues(options),
  ].sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
}
