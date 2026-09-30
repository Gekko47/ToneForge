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
import type { LanguageConventionProfile, TerminologyRule } from "../core/domain/StyleProfile";

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
        makeFinding({
          category: banned ? "language.bannedTerm" : "houseStyle.terminology",
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
          safeBatchKey: `terminology:${rule.source}:${expected}`,
        }),
      );
    });

  return findings.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  );
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
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const capitalisation = rules.capitalisation;

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
 * hard error, and a first-use expansion requirement is a structural
 * observation about the document rather than a deviation at a span.
 */
export function findAbbreviationIssues(options: LanguageCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];
  const findings: Finding[] = [];
  const abbreviations = rules.abbreviations;

  abbreviations.prohibitedVariants.forEach((variant) => {
    const term = variant.trim();
    if (term.length === 0) return;
    findMatches(text, termPattern(term, true, false)).forEach((range) => {
      const found = text.slice(range.start, range.end);
      const approved = abbreviations.approved[found] ?? abbreviations.approved[term];
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

  const wanted = numbers.decimalSeparator === "comma" ? "," : ".";
  const unwanted = numbers.decimalSeparator === "comma" ? "." : ",";
  /*
   * A comma between digits is not necessarily a decimal separator: `1,000` and
   * `4,200,000` are grouped thousands. The lookaround matched every one of them,
   * so a document written with comma grouping under a dot-decimal profile
   * reported a decimal-separator deviation at each group mark and offered to
   * rewrite `1,000` as `1.000` — a figure altered by a punctuation rule.
   *
   * The group is recognised structurally rather than by counting commas: a
   * separator preceded by one to three digits from a non-digit boundary and
   * followed by exactly three digits is a thousands group mark, whatever the
   * profile's own `thousandsSeparator` says, because `1,000` is grouped whether
   * or not the house asked for it.
   */
  const isGroupMark = (index: number): boolean => {
    if (unwanted !== ",") return false;
    let leading = 0;
    while (index - leading > 0 && /\d/u.test(text[index - leading - 1] ?? "")) leading += 1;
    if (leading < 1 || leading > 3) return false;
    const boundary = text[index - leading - 1];
    if (boundary !== undefined && /\d/u.test(boundary)) return false;
    const after = /^\d{3}(?!\d)/u.exec(text.slice(index + 1));
    return after !== null;
  };
  [...text.matchAll(new RegExp(`(?<=\\d)\\${unwanted}(?=\\d)`, "g"))].forEach((match) => {
    const start = match.index;
    if (start === undefined) return;
    if (isGroupMark(start)) return;
    /*
     * A separator that is neither a clean decimal nor a clean group is
     * ambiguous: `0,1234` could be either, and picking one rewrites a figure.
     * Those are reported so the reader knows a convention was broken, and marked
     * non-correctable so nothing offers to decide it.
     */
    const ambiguous = unwanted === "," && /^\d{3,}(?!\d)/u.test(text.slice(start + 1));
    findings.push(
      makeFinding({
        category: "language.number.decimalSeparator",
        ruleId: "language/numbers",
        profilePath: "language.numbers.decimalSeparator",
        range: { start, end: start + 1, unit: "character" },
        message: `Use “${wanted}” as the decimal separator`,
        severity: "warning",
        actual: unwanted,
        expected: wanted,
        // A figure is the one thing a formatting tool must not alter, so an
        // ambiguous run is pointed at and left for the user to resolve.
        correctionAvailable: !ambiguous,
        ...(ambiguous ? {} : { safeBatchKey: `decimal:${wanted}` }),
      }),
    );
  });

  /*
   * Percentage spacing.
   *
   * The gap between the number and the sign is captured, then compared with
   * what the profile wants. The comparison has to be *is this the wanted form*,
   * not *does this look wrong*: an earlier version skipped a match whose gap
   * already matched the profile, which discarded exactly the cases it existed
   * to report and left the rule silent.
   */
  const wantsSpace = numbers.percentageSpacing === "space";
  gapsBefore(text, /%|(?:per\s+cent|percent)/giu).forEach(({ start, end }) => {
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

  // Reported, never corrected. See the function's own note.
  const threshold = numbers.numberWordThreshold;
  if (threshold !== null) {
    [...text.matchAll(/(?<!\p{L})\d{1,3}(?!\p{L})/gu)].forEach((match) => {
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

  return findings.sort((left, right) => left.range.start - right.range.start);
}

/** Name the shape a written date has. */
function describeDateShape(found: string): string {
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u.test(found)) return "year-first";
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/u.test(found)) return "day-month-year";
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/u.test(found)) return "numeric";
  return "unrecognised";
}

function describeShape(id: string): string {
  const named: Record<string, string> = {
    "year-first": "year first (2026-05-31)",
    "day-month-year": "day first with the month named (31 May 2026)",
    numeric: "numerically (31/05/2026)",
  };
  return named[id] ?? id;
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
  const preferred = dates.formats.find((format) => format.preferred);

  // No preference declared is not a preference for whatever shape is already
  // there, so with no preferred format the rule is silent.
  if (preferred === undefined) return findings;

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
        profilePath: "language.dates.formats",
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

  return findings.sort((left, right) => left.range.start - right.range.start);
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
