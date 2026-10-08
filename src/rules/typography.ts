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
  isThousandsGroupMark,
} from "../shared/utils/text";

export interface TypographyCheckOptions {
  text: string;
  rules: TypographyRules;
}

/**
 * Which profile field each finding category is a statement about.
 *
 * Spec §12: a finding names the profile field that produced it, and §13 groups
 * findings by that field. One entry per category rather than a `profilePath`
 * argument at each of the twenty-eight call sites, because the mapping is a
 * property of the rule rather than of any individual detection — a reader can
 * audit the whole thing in one place, and a site that forgot the field is a
 * category missing from this table rather than a silent omission.
 *
 * `typography.whitespace` and `typography.punctuation` are deliberately absent:
 * each covers several settings, and the check that produces them passes the
 * specific field explicitly. A single path for either would claim a finding came
 * from `typography.normaliseWhitespace` when the profile's
 * `typography.flagTabs` is what fired, and grouping on that key would put a tab
 * in the same batch as a doubled space.
 */
const CATEGORY_PROFILE_PATHS: Readonly<Record<string, string>> = {
  "typography.emDash": "typography.emDash",
  "typography.enDashSpacing": "typography.enDashSpacing",
  "typography.doubleQuotes": "typography.doubleQuotes",
  "typography.singleQuotes": "typography.singleQuotes",
  "typography.apostrophes": "typography.apostrophes",
  "typography.decimalSeparator": "typography.decimalSeparator",
  "typography.thousandsSeparator": "typography.thousandsSeparator",
  "typography.ellipsis": "typography.ellipsis",
};

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
  findings.push(...checkDecimalSeparator(text, rules));
  findings.push(...checkThousandsSeparator(text, rules));
  findings.push(...checkWhitespace(text, rules));
  findings.push(...checkSlashSpacing(text, rules));
  findings.push(...checkSpaceBeforeParenthesis(text, rules));
  findings.push(...checkSpaceAfterHyphen(text, rules));
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
  expected?: string;
  /** Overrides the table, for the categories that cover several settings. */
  profilePath?: string;
}): Finding {
  const profilePath = params.profilePath ?? CATEGORY_PROFILE_PATHS[params.category];
  if (profilePath === undefined) {
    /*
     * Thrown rather than defaulted.
     *
     * The alternative is a finding with no declared origin, which the engine
     * accepts and the §11 audit cannot see past: it groups on the category, the
     * UI cannot say which setting fired, and the failure is a report that looks
     * complete. A missing table entry is a coding error and belongs at the point
     * it is made.
     */
    throw new Error(`typography: no profile field declared for category "${params.category}"`);
  }
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
    actual: params.evidence,
    ...(params.expected === undefined ? {} : { expected: params.expected }),
    precondition: { kind: "text", expectedText: params.evidence },
    deterministic: {
      profilePath,
      actual: params.evidence,
      ...(params.expected === undefined ? {} : { expected: params.expected }),
      // One key per profile field: every occurrence of an em-dash finding wants
      // the same replacement, so a group is exactly "this setting, everywhere".
      occurrenceGroupKey: profilePath,
      safeBatchKey: profilePath,
      // Typography corrections are character substitutions the profile asked for
      // by name, so one is never structurally ambiguous. This is the assertion
      // §13 requires before `Approve all` may be offered at all.
      correctionAvailable: true,
    },
  };
}

function isBetweenWordChars(text: string, start: number, end: number): boolean {
  const before = start > 0 ? (text[start - 1] ?? "") : "";
  const after = end < text.length ? (text[end] ?? "") : "";
  return before.length > 0 && after.length > 0 && /\w/.test(before) && /\w/.test(after);
}

/**
 * How this house represents a dash.
 *
 * **Two representations, not three (owner decision D3).** `emDash` was
 * `["em", "hyphen", "space"]`, and `"space"` made the rule report *every* dash —
 * em or double hyphen — with a replacement of `" "`. That is a correction which
 * deletes a punctuation mark the author put there, and it was reachable from the
 * Em dash dropdown itself, which is why removing the spacing setting alone would
 * not have removed the hazard. The value is gone from the schema.
 *
 * **And no spacing check.** `emDashSpacing` is gone. Whether a dash takes
 * surrounding spaces is a question about the author's spacing, not about how the
 * dash is represented; enforcing it reported the dash together with a space it did
 * not own, over a range wider than the mark, and the planner would rewrite a
 * neighbour on its way to fixing the dash. `enDashSpacing` is a separate setting,
 * is not implicated, and is retained.
 *
 * The two branches are symmetric: whichever representation the house did not pick
 * is the one deviation. Each finding covers exactly the mark it names, so a
 * correction cannot reach past the punctuation it is about.
 */
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

    return findings;
  }

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

/**
 * The decimal separator, with group marks excluded.
 *
 * **ND-1.** This rule used to match `\d<sep>\d` and nothing else, so under a
 * dot-decimal profile the comma in `1,000` matched and the rule offered a
 * `replaceText` rewriting it to `1.000`. A figure was altered by a punctuation
 * rule, and the planner could then be handed two changes over the same character
 * when the language number rule reported the same comma (ND-2).
 *
 * The fix is the shared structural discriminator rather than a narrower pattern: a
 * mark with one to three digits before it and exactly three after it is a group
 * mark whichever separator the profile prefers, because `1.000` is grouped just as
 * `1,000` is. `isThousandsGroupMark` is the same predicate the language rule uses,
 * which is what stops the two from disagreeing again.
 */
function checkDecimalSeparator(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];
  const wrongSeparator = rules.decimalSeparator === "dot" ? "," : ".";

  const escapedSeparator = wrongSeparator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  findMatches(text, new RegExp(`\\d${escapedSeparator}\\d`, "g")).forEach((m) => {
    const separatorIndex = m.start + 1;
    const separator = text.charAt(separatorIndex);
    if (separator === undefined) return;
    if (isThousandsGroupMark(text, separatorIndex)) return;
    findings.push(
      makeFinding({
        category: "typography.decimalSeparator",
        range: { start: separatorIndex, end: separatorIndex + 1, unit: "character" },
        message: `Use ${rules.decimalSeparator === "dot" ? "dot (.)" : "comma (,)"} as the decimal separator`,
        severity: "warning",
        evidence: separator,
      }),
    );
  });

  return findings;
}

function checkThousandsSeparator(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];
  if (rules.thousandsSeparator === "none") {
    findMatches(text, /(?<=\d)[,.\u00a0\u202f](?=\d{3}(?!\d))/g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.thousandsSeparator",
          range: { start: m.start, end: m.end, unit: "character" },
          message: "Remove the thousands separator",
          severity: "warning",
          evidence: text.slice(m.start, m.end),
        }),
      );
    });
    return findings;
  }

  const wrongPattern = rules.thousandsSeparator === "comma" ? /[.\u00a0\u202f ]/g : /,/g;
  findMatches(text, wrongPattern).forEach((m) => {
    const before = m.start > 0 ? text[m.start - 1] : "";
    const after = text.slice(m.end, m.end + 3);
    if (before === undefined || !/\d/.test(before) || !/^\d{3}(?!\d)/.test(after)) return;
    findings.push(
      makeFinding({
        category: "typography.thousandsSeparator",
        range: { start: m.start, end: m.end, unit: "character" },
        message: `Use ${
          rules.thousandsSeparator === "comma" ? "a comma (,)" : "a space ( )"
        } as the thousands separator`,
        severity: "warning",
        evidence: text.slice(m.start, m.end),
      }),
    );
  });

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

/**
 * Whitespace, gated on the three settings that govern it.
 *
 * The gating is the point of the change, not a wrapper around it. Previously the
 * check ran unconditionally and took no `rules` at all, so `normaliseWhitespace`,
 * `flagTabs` and `nonBreakingSpace` were three settings a user could change and
 * nothing would happen — a document quoted from a spreadsheet could not be
 * accepted, and a non-breaking space could not be preserved.
 *
 * Each switch defaults to the behaviour that existed before the field did, so a
 * profile that never touched them reports exactly what it always did.
 */
function checkWhitespace(text: string, rules: TypographyRules): Finding[] {
  const findings: Finding[] = [];

  if (rules.normaliseWhitespace) {
    findMatches(text, / {2,}/g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.whitespace",
          range: { start: m.start, end: m.end, unit: "character" },
          message: "Use a single space instead of multiple consecutive spaces",
          severity: "warning",
          evidence: text.slice(m.start, m.end),
          profilePath: "typography.normaliseWhitespace",
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
          profilePath: "typography.normaliseWhitespace",
        }),
      );
    });
  }

  if (rules.flagTabs) {
    findMatches(text, /\t/g).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.whitespace",
          range: { start: m.start, end: m.end, unit: "character" },
          message: "Use spaces instead of tabs",
          severity: "warning",
          evidence: text.slice(m.start, m.end),
          profilePath: "typography.flagTabs",
        }),
      );
    });
  }

  // `preserve` is a real answer, and an important one: a non-breaking space is
  // how a house style keeps `10 kg` together, so treating every one as an error
  // would fight the profile's own units rule.
  if (rules.nonBreakingSpace === "flag") {
    findMatches(text, new RegExp(NON_BREAKING_SPACE, "g")).forEach((m) => {
      findings.push(
        makeFinding({
          category: "typography.whitespace",
          range: { start: m.start, end: m.end, unit: "character" },
          message: "Use a regular space instead of a non-breaking space",
          severity: "warning",
          evidence: text.slice(m.start, m.end),
          profilePath: "typography.nonBreakingSpace",
        }),
      );
    });
  }

  return findings;
}

/**
 * Report a gap that does not match the wanted spacing, and only that gap.
 *
 * `profilePath` is a parameter rather than derived from the category because the
 * spacing settings share `typography.punctuation`. Each one is a different
 * profile field with a different remedy, and grouping them under one path would
 * offer a single `Approve all` for a mix of solidus, bracket and hyphen
 * corrections.
 */
function spacingFindings(params: {
  text: string;
  matches: readonly { start: number; end: number }[];
  wantsSpace: boolean;
  category: string;
  profilePath: string;
  spacedMessage: string;
  tightMessage: string;
}): Finding[] {
  return params.matches
    .map((m) => ({ m, gap: params.text.slice(m.start, m.end) }))
    .filter(({ gap }) => gap.length > 0 !== params.wantsSpace)
    .map(({ m, gap }) =>
      makeFinding({
        category: params.category,
        range: { start: m.start, end: m.end, unit: "character" },
        message: params.wantsSpace ? params.spacedMessage : params.tightMessage,
        severity: "warning",
        evidence: gap,
        expected: params.wantsSpace ? " " : "",
        profilePath: params.profilePath,
      }),
    );
}

/**
 * Spacing around a solidus.
 *
 * `none` means the profile has no opinion, which is distinct from `tight`: an
 * opinion that forbids spaces is a decision, and a profile that has not made one
 * must not have the rule fire.
 */
function checkSlashSpacing(text: string, rules: TypographyRules): Finding[] {
  if (rules.slashSpacing === "none") return [];
  /*
   * The gaps either side of each solidus, measured separately.
   *
   * The old pattern was `\s*\/+`, which matched the slash as well as the space.
   * The reported range therefore covered the solidus, and applying the
   * correction replaced `/` with a space — turning `and/or` into `and or` and
   * deleting a character the author wrote. The fix is the same shape the other
   * spacing rules use: measure the gap, never consume the marker.
   *
   * Measured per side because the two are independent. A solidus can be tight on
   * one side and spaced on the other, and a single combined match reports the
   * pair as one thing it cannot correct. The result is the same zero-width gap
   * the currency rule yields for a tight symbol, so a tight solidus is still
   * reported under `spaced` rather than skipped — and under `tight`, a solidus
   * written `and / or` is reported once per side, which is what the author has to
   * change.
   */
  const gaps: { start: number; end: number }[] = [];
  findMatches(text, /\/+/g).forEach((slash) => {
    let before = slash.start;
    while (before > 0 && /[ \t]/u.test(text[before - 1] ?? "")) before -= 1;
    gaps.push({ start: before, end: slash.start });
    let after = slash.end;
    while (after < text.length && /[ \t]/u.test(text[after] ?? "")) after += 1;
    gaps.push({ start: slash.end, end: after });
  });
  return spacingFindings({
    text,
    matches: gaps,
    wantsSpace: rules.slashSpacing === "spaced",
    category: "typography.punctuation",
    profilePath: "typography.slashSpacing",
    spacedMessage: "A solidus is surrounded by spaces",
    tightMessage: "A solidus is written tight against the words around it",
  });
}

/**
 * A required space before an opening bracket.
 *
 * Off by default, and it is worth being explicit about why: the convention runs
 * the other way in most house styles, and a rule that fires on correct text
 * teaches the reader to ignore the panel it appears in.
 *
 * The match is the gap alone. The previous pattern began with a non-space
 * character, so the reported range covered the word before the bracket as well
 * as its gap, and correcting `word (x)` replaced the word itself with a space.
 * Only the whitespace is measured now, and a zero-width gap is accepted: a
 * bracket written tight against its word has no gap to match, and refusing
 * zero-length ranges is precisely how the case this rule exists to report went
 * unreported.
 */
function checkSpaceBeforeParenthesis(text: string, rules: TypographyRules): Finding[] {
  if (!rules.spaceBeforeParenthesis) return [];
  const findings: Finding[] = [];
  // The capture is the gap, so the range is measured from the group rather than
  // from the match — the match starts one character early on the word.
  [...text.matchAll(/\S([ \t]*)(?=[([])/g)].forEach((match) => {
    const [whole, gap] = match;
    const start = match.index;
    if (start === undefined || whole === undefined || gap === undefined) return;
    /*
     * Only the *missing* space is a deviation, which is the one case a
     * zero-length range reports. The previous filter dropped zero-length ranges
     * and kept the ones with a gap, so the rule reported correctly-spaced text
     * and stayed silent on the deviation the setting exists to catch.
     */
    if (gap.length > 0) return;
    const gapStart = start + whole.length;
    findings.push(
      makeFinding({
        category: "typography.punctuation",
        // Zero-width, immediately before the bracket: the planner turns this
        // into an insert of one space rather than a replacement over the word.
        range: { start: gapStart, end: gapStart, unit: "character" },
        message: "An opening bracket is separated from the word before it",
        severity: "warning",
        evidence: gap,
        expected: " ",
        profilePath: "typography.spaceBeforeParenthesis",
      }),
    );
  });
  return findings;
}

/** A required space on both sides of a hyphen used as a compound marker. */
function checkSpaceAfterHyphen(text: string, rules: TypographyRules): Finding[] {
  if (!rules.spaceAfterHyphen) return [];
  /*
   * The whitespace either side of the hyphen, with both sides in the match.
   *
   * The old filter required `text[m.start - 1] === " "` — a space *before* the
   * match. But the match itself starts at that space, so the character before it
   * is the preceding word, not a space, and the filter was false for every input
   * of the form the rule is about. `foo - bar` matched `" - "` at index 3,
   * `text[2]` was `o`, and the finding was discarded: the rule could never fire.
   *
   * Only the "there is some whitespace here" test survives. A tight `well-known`
   * is a closed compound rather than a spaced one, and rewriting it to
   * `well - known` would be the opposite correction.
   */
  return findMatches(text, /[ \t]*-[ \t]*/g)
    .filter((m) => m.end - m.start > 1)
    .map((m) =>
      makeFinding({
        category: "typography.punctuation",
        range: { start: m.start, end: m.end, unit: "character" },
        message: "A hyphen in a compound is separated by spaces",
        severity: "warning",
        evidence: text.slice(m.start, m.end),
        expected: " - ",
        profilePath: "typography.spaceAfterHyphen",
      }),
    );
}
