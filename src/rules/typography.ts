/**
 * Deterministic typography and punctuation engine.
 *
 * Scans document text against a `TypographyRules` preference and reports
 * deviations as `Finding` objects with character offsets. Pure: no Office,
 * no LLM, no UI imports — fully unit-testable without Word.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type { TypographyRules } from "../core/domain/StyleProfile";
import {
  ELLIPSIS,
  EM_DASH,
  EN_DASH,
  LEFT_DOUBLE_QUOTE,
  RIGHT_DOUBLE_QUOTE,
  LEFT_SINGLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
  NON_BREAKING_SPACE,
} from "../shared/utils/text";

export interface TypographyCheckOptions {
  text: string;
  rules: TypographyRules;
}

/**
 * Scan text against typography preferences and return deterministic findings.
 * Returns an empty array for empty input.
 */
export function findTypographyIssues(options: TypographyCheckOptions): Finding[] {
  const { text, rules } = options;
  if (text.length === 0) return [];

  const findings: Finding[] = [];
  findings.push(...checkEmDash(text, rules));
  findings.push(...checkEnDashSpacing(text, rules));
  findings.push(...checkDoubleQuotes(text, rules));
  findings.push(...checkSingleQuotes(text, rules));
  findings.push(...checkApostrophes(text, rules));
  findings.push(...checkEllipsis(text, rules));
  findings.push(...checkWhitespace(text));
  return findings;
}

/** Find all matches of a global regex with their character offsets. */
function findMatches(text: string, regex: RegExp): { start: number; end: number }[] {
  const results: { start: number; end: number }[] = [];
  [...text.matchAll(regex)].forEach((m) => {
    const index = m.index;
    const matched = m[0];
    if (index === undefined || matched === undefined) return;
    results.push({ start: index, end: index + matched.length });
  });
  return results;
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
  };
}

function isBetweenWordChars(text: string, start: number, end: number): boolean {
  const before = start > 0 ? (text[start - 1] ?? "") : "";
  const after = end < text.length ? (text[end] ?? "") : "";
  return before.length > 0 && after.length > 0 && /\w/.test(before) && /\w/.test(after);
}

function checkEmDash(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.emDash === "em") {
    findMatches(text, /--/g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.emDash",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use em dash (${EM_DASH}) instead of double hyphen (--)`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });

    const emDashMatches = findMatches(text, new RegExp(EM_DASH, "g"));
    emDashMatches.forEach((m) => {
      const before = m.start > 0 ? (text[m.start - 1] ?? "") : "";
      const after = m.end < text.length ? (text[m.end] ?? "") : "";
      const hasSpaceBefore = before.length > 0 && /\s/.test(before);
      const hasSpaceAfter = after.length > 0 && /\s/.test(after);

      if (rules.emDashSpacing === "tight" && hasSpaceBefore && hasSpaceAfter) {
        findings.push(
          makeFinding({
            category: "typography.emDashSpacing",
            range: { start: m.start, end: m.end, unit: "character" },
            message: `Em dash should be tight (no surrounding spaces): use ${EM_DASH}`,
            severity: "warning",
            evidence: text.slice(m.start - 1, m.end + 1),
          }),
        );
      } else if (
        rules.emDashSpacing === "spaced" &&
        before.length > 0 &&
        after.length > 0 &&
        !hasSpaceBefore &&
        !hasSpaceAfter
      ) {
        findings.push(
          makeFinding({
            category: "typography.emDashSpacing",
            range: { start: m.start, end: m.end, unit: "character" },
            message: `Em dash should be spaced (surrounded by spaces): use ${EM_DASH}`,
            severity: "warning",
            evidence: text.slice(m.start - 1, m.end + 1),
          }),
        );
      }
    });
  } else if (rules.emDash === "hyphen") {
    findMatches(text, new RegExp(EM_DASH, "g")).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.emDash",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use double hyphen (--) instead of em dash (${EM_DASH})`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else {
    // emDash === "space": both em dash and double hyphen are deviations.
    findMatches(text, new RegExp(`--|${EM_DASH}`, "g")).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.emDash",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use a plain space instead of em dash (${EM_DASH}) or double hyphen (--)`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  }

  return findings;
}

function checkEnDashSpacing(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];
  const enDashMatches = findMatches(text, new RegExp(EN_DASH, "g"));

  enDashMatches.forEach((m) => {
    const before = m.start > 0 ? (text[m.start - 1] ?? "") : "";
    const after = m.end < text.length ? (text[m.end] ?? "") : "";
    const hasSpaceBefore = before.length > 0 && /\s/.test(before);
    const hasSpaceAfter = after.length > 0 && /\s/.test(after);

    if (rules.enDashSpacing === "tight" && hasSpaceBefore && hasSpaceAfter) {
      findings.push(
        makeFinding({
          category: "typography.enDashSpacing",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `En dash should be tight (no surrounding spaces): use ${EN_DASH}`,
          severity: "warning",
          evidence: text.slice(m.start - 1, m.end + 1),
        }),
      );
    } else if (
      rules.enDashSpacing === "spaced" &&
      before.length > 0 &&
      after.length > 0 &&
      !hasSpaceBefore &&
      !hasSpaceAfter
    ) {
      findings.push(
        makeFinding({
          category: "typography.enDashSpacing",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `En dash should be spaced (surrounded by spaces): use ${EN_DASH}`,
          severity: "warning",
          evidence: text.slice(m.start - 1, m.end + 1),
        }),
      );
    }
  });

  return findings;
}

function checkDoubleQuotes(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.doubleQuotes === "curly") {
    findMatches(text, /"/g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.doubleQuotes",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use curly double quotes (${LEFT_DOUBLE_QUOTE} ${RIGHT_DOUBLE_QUOTE}) instead of straight double quote (")`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else {
    findMatches(text, new RegExp(`${LEFT_DOUBLE_QUOTE}|${RIGHT_DOUBLE_QUOTE}`, "g")).forEach(
      (m) => {
        findings.push(
          makeFinding({
            category: "typography.doubleQuotes",
            range: { start: m.start, end: m.end, unit: "character" },
            message: `Use straight double quote (") instead of curly double quotes (${LEFT_DOUBLE_QUOTE} ${RIGHT_DOUBLE_QUOTE})`,
            severity: "warning",
            evidence: text.slice(m.start, m.end),
          }),
        );
      },
    );
  }

  return findings;
}

function checkSingleQuotes(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.singleQuotes === "curly") {
    findMatches(text, /'/g).forEach((m) => {
      if (isBetweenWordChars(text, m.start, m.end)) return;
      findings.push(
        makeFinding({
          category: "typography.singleQuotes",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use curly single quotes (${LEFT_SINGLE_QUOTE} ${RIGHT_SINGLE_QUOTE}) instead of straight single quote (')`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else {
    findMatches(text, new RegExp(`${LEFT_SINGLE_QUOTE}|${RIGHT_SINGLE_QUOTE}`, "g")).forEach(
      (m) => {
        if (isBetweenWordChars(text, m.start, m.end)) return;
        findings.push(
          makeFinding({
            category: "typography.singleQuotes",
            range: { start: m.start, end: m.end, unit: "character" },
            message: `Use straight single quote (') instead of curly single quotes (${LEFT_SINGLE_QUOTE} ${RIGHT_SINGLE_QUOTE})`,
            severity: "warning",
            evidence: text.slice(m.start, m.end),
          }),
        );
      },
    );
  }

  return findings;
}

function checkApostrophes(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.apostrophes === "curly") {
    findMatches(text, /'/g).forEach((m) => {
      if (!isBetweenWordChars(text, m.start, m.end)) return;
      findings.push(
        makeFinding({
          category: "typography.apostrophes",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use curly apostrophe (${RIGHT_SINGLE_QUOTE}) instead of straight apostrophe (')`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else {
    findMatches(text, new RegExp(RIGHT_SINGLE_QUOTE, "g")).forEach((m) => {
      if (!isBetweenWordChars(text, m.start, m.end)) return;
      findings.push(
        makeFinding({
          category: "typography.apostrophes",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use straight apostrophe (') instead of curly apostrophe (${RIGHT_SINGLE_QUOTE})`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  }

  return findings;
}

function checkEllipsis(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.ellipsis === "ellipsis") {
    findMatches(text, /\.\.\./g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.ellipsis",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use ellipsis character (${ELLIPSIS}) instead of three dots (...)`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else if (rules.ellipsis === "three-dots") {
    findMatches(text, new RegExp(ELLIPSIS, "g")).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.ellipsis",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use three dots (...) instead of ellipsis character (${ELLIPSIS})`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  } else {
    findMatches(text, new RegExp(`${ELLIPSIS}|\\.\\.\\.`, "g")).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.ellipsis",
          range: { start: m.start, end: m.end, unit: "character" },
          message: `Use spaced dots (. . .) instead of ellipsis (${ELLIPSIS}) or three dots (...)`,
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
  }

  return findings;
}

function checkWhitespace(text: string): Finding[] {
  const findings: Finding[] = [];

  findMatches(text, / {2,}/g).forEach((m) => {
    findings.push(
      makeFinding({
        category: "typography.whitespace",
        range: { start: m.start, end: m.end, unit: "character" },
        message: "Use a single space instead of multiple consecutive spaces",
        severity: "warning",
        evidence: text.slice(m.start, m.end),
      }),
    );
  });

  findMatches(text, / +$/gm).forEach((m) => {
    findings.push(
      makeFinding({
        category: "typography.whitespace",
        range: { start: m.start, end: m.end, unit: "character" },
        message: "Remove trailing spaces",
        severity: "warning",
        evidence: text.slice(m.start, m.end),
      }),
    );
  });

  findMatches(text, /\t/g).forEach((m) => {
    findings.push(
      makeFinding({
        category: "typography.whitespace",
        range: { start: m.start, end: m.end, unit: "character" },
        message: "Use spaces instead of tabs",
        severity: "warning",
        evidence: text.slice(m.start, m.end),
      }),
    );
  });

  findMatches(text, new RegExp(NON_BREAKING_SPACE, "g")).forEach((m) => {
    findings.push(
      makeFinding({
        category: "typography.whitespace",
        range: { start: m.start, end: m.end, unit: "character" },
        message: "Use a regular space instead of a non-breaking space",
        severity: "warning",
        evidence: text.slice(m.start, m.end),
      }),
    );
  });

  return findings;
}
