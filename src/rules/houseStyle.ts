/**
 * Deterministic house-style engine.
 *
 * Scans document text against capitalization preferences. Pure: no Office, LLM,
 * or UI imports — fully unit-testable without Word.
 *
 * Terminology was removed from this module (ND-13): the checks were filtered
 * out of the registry, so the fields they read were inert. `findTerminologyIssues`
 * in `language.ts` is the one terminology engine.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type { HouseStyle } from "../core/domain/StyleProfile";

export interface HouseStyleCheckOptions {
  text: string;
  rules: HouseStyle;
}

interface MatchRange {
  start: number;
  end: number;
}

/*
 * The US/UK variant table that used to live here is gone (spec §4.3).
 *
 * It duplicated Word's own spellchecker, which already flags every one of these
 * words, and it did so worse: a closed list of fourteen pairs, so a house
 * spelling outside the list produced nothing while a word *inside* it produced
 * a finding the author had already been told about. A rule that can only ever
 * be a subset of the host's, and that reports the subset as if it were the
 * whole, is worse than no rule — the count in the findings list is a claim
 * about the document, and this one understated it.
 *
 * `houseStyle.spellingVariant` stays in the schema as metadata, and nothing
 * reads it. A house with its own spelling convention declares it as a
 * terminology rule, which is enforceable, scoped and correctable — the four
 * things this table could not be.
 */

/**
 * Scan text against house-style preferences and return deterministic findings.
 *
 * **Terminology is no longer checked here.** This module used to run three
 * checks — preferred terminology, banned terms and capitalisation — and the
 * registry filtered all but title case out of the result, because
 * `language/capitalisation` and `language/terminology` already reported the
 * same two things from the normative `language` section. The two terminology
 * checks were therefore reachable only through their own unit tests: a user who
 * typed a house term into the House style panel got a field that validated,
 * persisted, and produced nothing. That is ND-13, and it is the "it saved but
 * ignored my entry" failure in its purest form — the field looked authoritative
 * and governed nothing.
 *
 * `findTerminologyIssues` is the single terminology engine now. It is strictly
 * more capable: the flat record this module read could express a term and a
 * replacement and nothing else, while a `TerminologyRule` carries
 * `wholeWord`, `caseSensitive`, `severity` and a section/style scope. Nothing
 * was lost by retiring this half; a `caseSensitive: false, wholeWord: true,
 * severity: "advisory"` rule reproduces the old record's behaviour exactly.
 */
export function findHouseStyleIssues(options: HouseStyleCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];

  const findings: Finding[] = [];
  findings.push(...checkTitleCaseWords(text, rules));
  return findings;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedTermPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
}

/**
 * Build a finding.
 *
 * `deterministic` carries the provenance spec §12 requires. These findings
 * previously carried none at all, which had two consequences worth stating: the
 * review UI could not say which house-style field produced a finding, and
 * `groupFindings` fell back to grouping on `category|""` — so every preferred
 * term in the document landed in one bucket, and the group's `expected` values
 * differed, so the group refused batch approval with a reason that named the
 * symptom rather than the cause.
 *
 * `occurrenceGroupKey` is the *field plus the correction*, not the field alone.
 * `program → programme` and `colour → color` are both `language.terminology.preferred`,
 * and grouping them together would offer one `Approve all` for two unrelated
 * substitutions. With the correction in the key they are two groups of one each,
 * which is the honest answer.
 */
function makeFinding(params: {
  category: string;
  profilePath: string;
  range: Range;
  message: string;
  severity: Severity;
  evidence: string;
  actual: string;
  expected: string;
  transformation?: Finding["transformation"];
  /** Set only where the correction is a named substitution the profile asked for. */
  safeBatchKey?: string;
}): Finding {
  return {
    id: uuidv4(),
    kind: "deterministic",
    category: params.category,
    range: params.range,
    message: params.message,
    severity: params.severity,
    evidence: params.evidence,
    confidence: 1,
    ruleId: params.category,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    actual: params.actual,
    expected: params.expected,
    ...(params.transformation === undefined ? {} : { transformation: params.transformation }),
    precondition: { kind: "text", expectedText: params.actual },
    deterministic: {
      profilePath: params.profilePath,
      actual: params.actual,
      expected: params.expected,
      occurrenceGroupKey: `${params.profilePath}|${params.expected}`,
      ...(params.safeBatchKey === undefined ? {} : { safeBatchKey: params.safeBatchKey }),
      correctionAvailable: true,
    },
  };
}

function makeRange(range: MatchRange): Range {
  return { start: range.start, end: range.end, unit: "character" };
}

function firstCasedCharacter(
  text: string,
  start: number,
  end: number,
): { character: string; index: number } | null {
  const match = text.slice(start, end).match(/\p{L}/u);
  if (match?.index === undefined || match[0] === undefined) return null;
  return { character: match[0], index: start + match.index };
}

function isLowerCase(character: string): boolean {
  return /\p{Ll}/u.test(character);
}

/*
 * `checkSentenceCase` is deleted (ADR-0125).
 *
 * It flagged a sentence not opening with a capital — the same judgement
 * `language/capitalisation.sentenceCase` makes — while walking *every sentence
 * in the document*, not headings. Two faults, and the second is why it could
 * never simply have been enabled:
 *
 * 1. The registry filtered its category out, so the toggle in the editor wrote a
 *    field whose findings never reached the user. A control that saves,
 *    validates, and produces nothing observable is ND-13.
 * 2. Scoped to headings, it would collide with `language.capitalisation.headingCase`,
 *    which already enforces sentence case there. Two findings on one character
 *    is what makes the planner refuse a whole plan as conflicting.
 *
 * Sentence case now has exactly two owners: `headingCase` for headings, and
 * `language.capitalisation.sentenceCase` for body prose. There is no third.
 */
function checkTitleCaseWords(text: string, rules: HouseStyle): Finding[] {
  const findings: Finding[] = [];
  const seenRanges = new Set<string>();
  const candidates = rules.capitalization.titleCaseWords.flatMap((rawWord) => {
    const word = rawWord.trim();
    if (word.length === 0) return [];
    return findMatches(text, boundedTermPattern(word)).map((range) => ({ range, word }));
  });

  candidates
    .sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end)
    .forEach((candidate) => {
      const key = `${candidate.range.start}:${candidate.range.end}`;
      if (seenRanges.has(key)) return;
      seenRanges.add(key);

      const evidence = text.slice(candidate.range.start, candidate.range.end);
      const firstCased = firstCasedCharacter(evidence, 0, evidence.length);
      if (firstCased === null || !isLowerCase(firstCased.character)) return;

      const range = {
        start: candidate.range.start + firstCased.index,
        end: candidate.range.start + firstCased.index + firstCased.character.length,
      };
      findings.push(
        makeFinding({
          category: "houseStyle.capitalization.titleCase",
          profilePath: "houseStyle.capitalization.titleCaseWords",
          range: makeRange(range),
          message: `Capitalize title-case word “${candidate.word}”`,
          severity: "warning",
          evidence: text.slice(range.start, range.end),
          actual: text.slice(range.start, range.end),
          expected: firstCased.character.toUpperCase(),
          safeBatchKey: `titleCase:${candidate.word}`,
          transformation: {
            kind: "case",
            style: "title",
            text: text.slice(range.start, range.end),
          },
        }),
      );
    });

  return findings;
}
