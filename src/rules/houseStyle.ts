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

export interface HouseStyleCheckOptions {
  text: string;
  rules: HouseStyle;
}

interface MatchRange {
  start: number;
  end: number;
}

interface SpellingVariantEntry {
  "en-US": string;
  "en-GB": string;
  au: string;
}

/** Common variant sets only; this engine is not a full spellchecker. */
const SPELLING_VARIANT_TABLE: readonly SpellingVariantEntry[] = [
  { "en-US": "color", "en-GB": "colour", au: "colour" },
  { "en-US": "favorite", "en-GB": "favourite", au: "favourite" },
  { "en-US": "honor", "en-GB": "honour", au: "honour" },
  { "en-US": "labor", "en-GB": "labour", au: "labour" },
  { "en-US": "center", "en-GB": "centre", au: "centre" },
  { "en-US": "organize", "en-GB": "organise", au: "organise" },
  { "en-US": "organization", "en-GB": "organisation", au: "organisation" },
  { "en-US": "analyze", "en-GB": "analyse", au: "analyse" },
  { "en-US": "behavior", "en-GB": "behaviour", au: "behaviour" },
  { "en-US": "defense", "en-GB": "defence", au: "defence" },
  { "en-US": "traveling", "en-GB": "travelling", au: "travelling" },
  { "en-US": "canceled", "en-GB": "cancelled", au: "cancelled" },
  { "en-US": "modeled", "en-GB": "modelled", au: "modelled" },
  { "en-US": "program", "en-GB": "programme", au: "program" },
];

/** Scan text against house-style preferences and return deterministic findings. */
export function findHouseStyleIssues(options: HouseStyleCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];

  const findings: Finding[] = [];
  findings.push(...checkPreferredTerminology(text, rules));
  findings.push(...checkBannedTerms(text, rules));
  findings.push(...checkSentenceCase(text, rules));
  findings.push(...checkTitleCaseWords(text, rules));
  findings.push(...checkSpellingVariant(text, rules));
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

function makeFinding(params: {
  category: string;
  range: Range;
  message: string;
  severity: Severity;
  evidence: string;
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
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
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
          range: makeRange(candidate.range),
          message: `Use “${candidate.preferred}” instead of “${candidate.term}”`,
          severity: "warning",
          evidence: text.slice(candidate.range.start, candidate.range.end),
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
          range: makeRange(range),
          message: `Remove banned term “${term}”`,
          severity: "error",
          evidence: text.slice(range.start, range.end),
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
        range: makeRange(range),
        message: `Start the sentence with uppercase “${firstCased.character.toUpperCase()}”`,
        severity: "warning",
        evidence: text.slice(range.start, range.end),
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
          range: makeRange(range),
          message: `Capitalize title-case word “${candidate.word}”`,
          severity: "warning",
          evidence: text.slice(range.start, range.end),
        }),
      );
    });

  return findings;
}

function checkSpellingVariant(text: string, rules: HouseStyle): Finding[] {
  const findings: Finding[] = [];

  SPELLING_VARIANT_TABLE.forEach((entry) => {
    const preferred = entry[rules.spellingVariant];
    const alternatives = [
      ...new Set(Object.values(entry).filter((variant) => variant !== preferred)),
    ];

    alternatives.forEach((alternative) => {
      findMatches(text, boundedTermPattern(alternative)).forEach((range) => {
        findings.push(
          makeFinding({
            category: "houseStyle.spellingVariant",
            range: makeRange(range),
            message: `Use ${rules.spellingVariant} spelling “${preferred}” instead of “${alternative}”`,
            severity: "warning",
            evidence: text.slice(range.start, range.end),
          }),
        );
      });
    });
  });

  return findings;
}
