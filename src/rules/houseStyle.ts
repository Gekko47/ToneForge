/**
 * Deterministic house-style engine.
 *
 * Scans document text against preferred terminology, banned terms,
 * capitalization preferences, and a bounded spelling-variant dictionary. Pure:
 * no Office, LLM, or UI imports — fully unit-testable without Word.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type { HouseStyle } from "../core/domain/StyleProfile";
import { splitSentences } from "../shared/utils/text";
import { toSentenceCase } from "../shared/utils/caseConversion";

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

/** Scan text against house-style preferences and return deterministic findings. */
export function findHouseStyleIssues(options: HouseStyleCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];

  const findings: Finding[] = [];
  findings.push(...checkPreferredTerminology(text, rules));
  findings.push(...checkBannedTerms(text, rules));
  findings.push(...checkSentenceCase(text, rules));
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
 * `program → programme` and `colour → color` are both `houseStyle.terminology`,
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

function overlaps(left: MatchRange, right: MatchRange): boolean {
  return left.start < right.end && right.start < left.end;
}

interface TerminologyCandidate {
  term: string;
  preferred: string;
  index: number;
  range: MatchRange;
}

function checkPreferredTerminology(text: string, rules: HouseStyle): Finding[] {
  const findings: Finding[] = [];
  const entries = Object.entries(rules.preferredTerminology)
    .filter(([term, preferred]) => term.trim().length > 0 && preferred.trim().length > 0)
    .map(([term, preferred], index) => ({ term: term.trim(), preferred: preferred.trim(), index }));
  const candidates: TerminologyCandidate[] = entries.flatMap((entry) =>
    findMatches(text, boundedTermPattern(entry.term)).map((range) => ({
      ...entry,
      range,
    })),
  );

  candidates
    .sort((left, right) => {
      const leftLength = left.range.end - left.range.start;
      const rightLength = right.range.end - right.range.start;
      const byLength = rightLength - leftLength;
      if (byLength !== 0) return byLength;
      const byStart = left.range.start - right.range.start;
      if (byStart !== 0) return byStart;
      return left.index - right.index;
    })
    .forEach((candidate) => {
      if (findings.some((finding) => overlaps(candidate.range, finding.range))) return;

      findings.push(
        makeFinding({
          category: "houseStyle.terminology",
          profilePath: "houseStyle.preferredTerminology",
          range: makeRange(candidate.range),
          message: `Use “${candidate.preferred}” instead of “${candidate.term}”`,
          severity: "warning",
          evidence: text.slice(candidate.range.start, candidate.range.end),
          actual: text.slice(candidate.range.start, candidate.range.end),
          expected: candidate.preferred,
          // A named substitution the profile asked for by value. Two occurrences
          // of the same `term → preferred` pair want the same edit, so the batch
          // key is the pair rather than the category: `program → programme` and
          // `colour → color` must never be approved together.
          safeBatchKey: `terminology:${candidate.term}->${candidate.preferred}`,
        }),
      );
    });

  return findings.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  );
}

function checkBannedTerms(text: string, rules: HouseStyle): Finding[] {
  const findings: Finding[] = [];
  const seenRanges = new Set<string>();

  rules.bannedTerms.forEach((rawTerm) => {
    const term = rawTerm.trim();
    if (term.length === 0) return;
    findMatches(text, boundedTermPattern(term)).forEach((range) => {
      const key = `${range.start}:${range.end}`;
      if (seenRanges.has(key)) return;
      seenRanges.add(key);
      findings.push(
        makeFinding({
          category: "houseStyle.bannedTerm",
          profilePath: "houseStyle.bannedTerms",
          range: makeRange(range),
          message: `Remove banned term “${term}”`,
          severity: "error",
          evidence: text.slice(range.start, range.end),
          actual: text.slice(range.start, range.end),
          expected: "",
          /*
           * No `safeBatchKey`, deliberately.
           *
           * Unlike a substitution, a deletion is not semantically neutral: it
           * removes the author's words rather than restating them, and the
           * planner already builds it as a non-reversible `deleteRange`. §13
           * permits batch approval only where the correction is neutral, so a
           * banned term is a group the user approves one occurrence at a time.
           * Leaving the key off is what makes `groupFindings` refuse, and it
           * refuses with a reason the UI can show rather than by hiding the
           * control.
           */
        }),
      );
    });
  });

  return findings;
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

function checkSentenceCase(text: string, rules: HouseStyle): Finding[] {
  if (!rules.capitalization.sentenceCase) return [];

  const findings: Finding[] = [];
  let searchFrom = 0;
  splitSentences(text).forEach((sentence) => {
    const sentenceStart = text.indexOf(sentence, searchFrom);
    if (sentenceStart < 0) return;
    searchFrom = sentenceStart + sentence.length;

    const firstCased = firstCasedCharacter(text, sentenceStart, sentenceStart + sentence.length);
    if (firstCased === null || !isLowerCase(firstCased.character)) return;

    const range = { start: firstCased.index, end: firstCased.index + firstCased.character.length };
    findings.push(
      makeFinding({
        category: "houseStyle.capitalization.sentenceCase",
        profilePath: "houseStyle.capitalization.sentenceCase",
        range: makeRange(range),
        message: `Start the sentence with uppercase “${firstCased.character.toUpperCase()}”`,
        severity: "warning",
        evidence: text.slice(range.start, range.end),
        actual: text.slice(range.start, range.end),
        expected: toSentenceCase(text.slice(range.start, range.end)),
        // The expected value is the uppercased character itself, so every
        // occurrence wanting the same letter groups together and a sentence
        // starting with a different one does not join it.
        safeBatchKey: "sentenceCase",
        transformation: {
          kind: "case",
          style: "sentence",
          text: text.slice(range.start, range.end),
        },
      }),
    );
  });

  return findings;
}

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
