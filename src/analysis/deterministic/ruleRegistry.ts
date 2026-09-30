/**
 * The deterministic rule registry.
 *
 * Spec §11. Every deterministic rule is declared here with the profile field it
 * reads, so three questions can be answered mechanically rather than by
 * reading: which rules exist, which profile setting each one consumes, and
 * whether a setting has no rule at all.
 *
 * **Why the declaration and the implementation are separate.** A rule's
 * *identity* — its id, the profile path it reads, the scope it applies to — is
 * metadata the audit needs but the rule body has no use for. Putting the two
 * together would mean every rule's profile path lived inside the function that
 * reads the profile, where the audit cannot see it without executing anything.
 * So the declaration here and the body in `src/rules/` and
 * `src/formatting/`, and `assertEveryProfileFieldIsWired` is what keeps them
 * honest.
 *
 * Boundary rule: the registry may import `core/domain`, `rules`, `formatting`
 * and `shared/utils` — never `ai`, `word`, `taskpane` or `commands`. That is
 * enforced by the ESLint scope over `src/analysis/deterministic/**`.
 */

import type { DeterministicRuleContext, DeterministicPlanContext } from "./contracts";
import type { DeterministicFinding } from "./contracts";
import type { Change } from "../../core/domain/Change";
import {
  deterministicProfileOf,
  type DeterministicStyleProfile,
} from "../../core/domain/StyleProfile";

/** The rule groups spec §11 asks the registry to expose. */
export const RULE_GROUPS = [
  "language",
  "typography",
  "formatting",
  "structure",
  "integrity",
] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

/** The document structures a rule examines. */
export const RULE_SCOPES = [
  "text",
  "paragraph",
  "list",
  "table",
  "section",
  "headerFooter",
] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export interface DeterministicRule {
  /** Stable, and the value a finding's `ruleId` carries. */
  id: string;
  group: RuleGroup;
  scope: RuleScope;
  /** The user-facing name, which is also the finding category. */
  category: string;
  /**
   * The profile fields this rule reads.
   *
   * This is the audit's input, and it is declared rather than derived. The
   * alternative — inferring it by diffing what a rule reads against what a
   * profile has — cannot distinguish "this rule reads the whole typography
   * section" from "this rule reads one field", which is the difference between
   * a rule that is wired and one that happens to work.
   */
  profilePaths: readonly string[];
  /**
   * Whether a finding from this rule can be corrected by the planner.
   *
   * Declared here rather than left to the rule, because batch approval and the
   * review UI both need the answer before any finding exists, and a rule that
   * produced a correction the planner cannot build would otherwise advertise
   * "Approve" for something Apply will refuse.
   */
  correctable: boolean;
  /**
   * Run the rule over the acquired context.
   *
   * Optional in the type and required in practice: a rule that cannot run yet
   * is declared with `analyze` undefined and a reason in `description`, which
   * is visible to the audit rather than silently absent from the registry.
   */
  analyze?: (context: DeterministicRuleContext) => DeterministicFinding[];
  /**
   * Build the correction for a finding, when the rule is `correctable`.
   *
   * Implemented in `src/changes/deterministicChanges.ts` rather than here,
   * because `src/changes/` is forbidden from importing `src/analysis/**` and a
   * planner function living here could not be called from the planner at all.
   */
  plan?: (finding: DeterministicFinding, context: DeterministicPlanContext) => Change[];
}

/**
 * Profile fields that are recorded but drive no check.
 *
 * Spec §5: "Do not add UI settings that no rule reads." A field listed here is
 * an explicit, reviewed exception rather than an oversight — `locale` is the
 * case, kept because a future house-specific rule needs it and removing it
 * would discard a stored value for no gain. The list is the reason the audit
 * can insist every field is either wired *or* excused.
 */
export const METADATA_ONLY_PROFILE_PATHS: readonly string[] = ["language.locale"];

/**
 * Every field a deterministic profile exposes, as dotted paths.
 *
 * Written out rather than walked from the schema. A schema walk would produce
 * the paths for `Record` and `z.array` members as opaque entries and could not
 * tell an authored setting from a derived one — so a field nobody could ever
 * read would look wired, which is the failure the audit exists to prevent.
 */
export const PROFILE_FIELD_PATHS: readonly string[] = [
  // Language conventions (spec §4.2).
  "language.terminology",
  "language.legacyPreferredTerminology",
  "language.bannedTerms",
  "language.capitalisation.sentenceCase",
  "language.capitalisation.properNouns",
  "language.capitalisation.prohibitedCapitalised",
  "language.capitalisation.headingCase",
  "language.abbreviations.approved",
  "language.abbreviations.preferredExpanded",
  "language.abbreviations.requireFirstUseExpansion",
  "language.abbreviations.prohibitedVariants",
  "language.numbers.decimalSeparator",
  "language.numbers.thousandsSeparator",
  "language.numbers.percentageSpacing",
  "language.numbers.numberWordThreshold",
  "language.numbers.negativeNumber",
  "language.numbers.rangeStyle",
  "language.dates.formats",
  "language.dates.requireUnambiguous",
  "language.currency.representation",
  "language.currency.symbolSpacing",
  "language.currency.thousandsSeparator",
  "language.currency.decimalSeparator",
  "language.currency.magnitude",
  "language.units.valueSpacing",
  "language.units.capitalisation",
  "language.units.symbols",
  "language.locale",

  // Typography (spec §5).
  "typography.emDash",
  "typography.emDashSpacing",
  "typography.enDashSpacing",
  "typography.doubleQuotes",
  "typography.singleQuotes",
  "typography.apostrophes",
  "typography.decimalSeparator",
  "typography.thousandsSeparator",
  "typography.ellipsis",
  "typography.normaliseWhitespace",
  "typography.flagTabs",
  "typography.nonBreakingSpace",
  "typography.slashSpacing",
  "typography.percentageSpacing",
  "typography.currencySpacing",
  "typography.spaceBeforeParenthesis",
  "typography.spaceAfterHyphen",

  // Document formatting (spec §6).
  "formatting.bodyStyle",
  "formatting.titleStyle",
  "formatting.subtitleStyle",
  "formatting.headings",
  "formatting.captions",
  "formatting.lists",
  "formatting.tables",
  "formatting.headersFooters",
  "formatting.page",

  // Document structure (spec §4.1, §10.2).
  "structure.allowSkippedHeadingLevels",
  "structure.maxHeadingLevel",
  "structure.reportEmptyHeadings",
  "structure.reportUnknownStyles",
];

/**
 * The rules as they stand.
 *
 * The typography and house-style bodies are attached in T7–T9; the registry
 * declares them now so the audit has something to check against from the start.
 * A rule with no `analyze` yet is visibly incomplete rather than invisible.
 */
export const DETERMINISTIC_RULES: readonly DeterministicRule[] = [
  {
    id: "typography/dashes",
    group: "typography",
    scope: "text",
    category: "typography.emDash",
    profilePaths: ["typography.emDash", "typography.emDashSpacing", "typography.enDashSpacing"],
    correctable: true,
  },
  {
    id: "typography/quotes",
    group: "typography",
    scope: "text",
    category: "typography.doubleQuotes",
    profilePaths: ["typography.doubleQuotes", "typography.singleQuotes", "typography.apostrophes"],
    correctable: true,
  },
  {
    id: "typography/ellipsis",
    group: "typography",
    scope: "text",
    category: "typography.ellipsis",
    profilePaths: ["typography.ellipsis"],
    correctable: true,
  },
  {
    id: "typography/numbers",
    group: "typography",
    scope: "text",
    category: "typography.decimalSeparator",
    /*
     * The number-word threshold, the negative-number convention and the range
     * style are declared here rather than left for T8 to add, because the
     * registry audit failed on exactly these three while they were missing. A
     * rule that reads a profile section is the claim that the section is wired;
     * leaving three fields unclaimed is what the audit reported — which is the
     * audit working, not the audit being wrong.
     */
    profilePaths: [
      "typography.decimalSeparator",
      "typography.thousandsSeparator",
      "language.numbers.decimalSeparator",
      "language.numbers.thousandsSeparator",
      "language.numbers.percentageSpacing",
      "language.numbers.numberWordThreshold",
      "language.numbers.negativeNumber",
      "language.numbers.rangeStyle",
      "typography.percentageSpacing",
    ],
    correctable: true,
  },
  {
    id: "typography/whitespace",
    group: "typography",
    scope: "text",
    category: "typography.whitespace",
    profilePaths: [
      "typography.normaliseWhitespace",
      "typography.flagTabs",
      "typography.nonBreakingSpace",
    ],
    correctable: true,
  },
  {
    id: "typography/punctuation",
    group: "typography",
    scope: "text",
    category: "typography.punctuation",
    profilePaths: [
      "typography.slashSpacing",
      "typography.currencySpacing",
      "typography.spaceBeforeParenthesis",
      "typography.spaceAfterHyphen",
    ],
    correctable: true,
  },
  {
    id: "language/terminology",
    group: "language",
    scope: "text",
    category: "houseStyle.terminology",
    profilePaths: ["language.terminology", "language.legacyPreferredTerminology"],
    correctable: true,
  },
  {
    id: "language/banned",
    group: "language",
    scope: "text",
    category: "houseStyle.bannedTerm",
    profilePaths: ["language.bannedTerms"],
    correctable: true,
  },
  {
    id: "language/capitalisation",
    group: "language",
    scope: "text",
    category: "houseStyle.capitalization",
    profilePaths: [
      "language.capitalisation.sentenceCase",
      "language.capitalisation.properNouns",
      "language.capitalisation.prohibitedCapitalised",
      "language.capitalisation.headingCase",
    ],
    correctable: true,
  },
  {
    id: "language/abbreviations",
    group: "language",
    scope: "text",
    category: "language.abbreviation",
    profilePaths: [
      "language.abbreviations.approved",
      "language.abbreviations.preferredExpanded",
      "language.abbreviations.requireFirstUseExpansion",
      "language.abbreviations.prohibitedVariants",
    ],
    correctable: true,
  },
  {
    id: "language/dates",
    group: "language",
    scope: "text",
    category: "language.date",
    profilePaths: ["language.dates.formats", "language.dates.requireUnambiguous"],
    correctable: true,
  },
  {
    id: "language/currency",
    group: "language",
    scope: "text",
    category: "language.currency",
    profilePaths: [
      "language.currency.representation",
      "language.currency.symbolSpacing",
      "language.currency.thousandsSeparator",
      "language.currency.decimalSeparator",
      "language.currency.magnitude",
    ],
    correctable: true,
  },
  {
    id: "language/units",
    group: "language",
    scope: "text",
    category: "language.unit",
    profilePaths: [
      "language.units.valueSpacing",
      "language.units.capitalisation",
      "language.units.symbols",
    ],
    correctable: true,
  },
  {
    id: "formatting/body",
    group: "formatting",
    scope: "paragraph",
    category: "formatting.bodyStyle",
    profilePaths: [
      "formatting.bodyStyle",
      "formatting.titleStyle",
      "formatting.subtitleStyle",
      "formatting.captions",
    ],
    correctable: true,
  },
  {
    id: "formatting/headings",
    group: "formatting",
    scope: "paragraph",
    category: "formatting.headingStyle",
    profilePaths: ["formatting.headings", "structure.maxHeadingLevel"],
    correctable: true,
  },
  {
    id: "formatting/direct",
    group: "formatting",
    scope: "paragraph",
    category: "formatting.directFormatting",
    profilePaths: ["formatting.bodyStyle"],
    // Declared non-correctable because spec §14.5 forbids a reset that has not
    // proved it will restore style-controlled appearance without erasing the
    // author's emphasis. T12 replaces this with the provenance-gated predicate
    // and flips it per-finding rather than per-rule; the rule-level answer is
    // "not by default" because the safe case is the exception.
    correctable: false,
  },
  {
    id: "formatting/lists",
    group: "formatting",
    scope: "list",
    category: "formatting.listLevel",
    profilePaths: ["formatting.lists"],
    correctable: true,
  },
  {
    id: "formatting/tables",
    group: "formatting",
    scope: "table",
    category: "formatting.tableStyle",
    profilePaths: ["formatting.tables"],
    correctable: true,
  },
  {
    id: "formatting/page",
    group: "formatting",
    scope: "section",
    category: "formatting.pageSetup",
    profilePaths: ["formatting.page"],
    correctable: false,
  },
  {
    id: "formatting/headersFooters",
    group: "formatting",
    scope: "headerFooter",
    category: "formatting.headerFooter",
    profilePaths: ["formatting.headersFooters"],
    correctable: true,
  },
  {
    id: "structure/headingHierarchy",
    group: "structure",
    scope: "paragraph",
    category: "formatting.headingHierarchy",
    profilePaths: ["structure.allowSkippedHeadingLevels", "structure.maxHeadingLevel"],
    correctable: true,
  },
  {
    id: "integrity/emptyHeading",
    group: "integrity",
    scope: "paragraph",
    category: "formatting.emptyHeading",
    profilePaths: ["structure.reportEmptyHeadings"],
    correctable: true,
  },
  {
    id: "integrity/unknownStyle",
    group: "integrity",
    scope: "paragraph",
    category: "formatting.unknownStyle",
    profilePaths: ["structure.reportUnknownStyles"],
    correctable: true,
  },
];

/** Every rule, in declaration order. */
export function allRules(): readonly DeterministicRule[] {
  return DETERMINISTIC_RULES;
}

/** Rules in one group, which is how the Review UI partitions its cards. */
export function rulesInGroup(group: RuleGroup): readonly DeterministicRule[] {
  return DETERMINISTIC_RULES.filter((rule) => rule.group === group);
}

/** Look a rule up by its stable id. */
export function ruleById(id: string): DeterministicRule | undefined {
  return DETERMINISTIC_RULES.find((rule) => rule.id === id);
}

/** Look a rule up by the category its findings carry. */
export function ruleByCategory(category: string): DeterministicRule | undefined {
  return DETERMINISTIC_RULES.find((rule) => rule.category === category);
}

/**
 * Whether a declared profile path is covered by some rule.
 *
 * A rule that reads a whole section (`typography`) covers every field beneath
 * it, so the match is by prefix. A rule that names one field covers only that
 * field, and a path it names by mistake does not silently inherit its parent's
 * coverage.
 */
function isCovered(path: string, covered: readonly string[]): boolean {
  return covered.some((entry) => path === entry || path.startsWith(`${entry}.`));
}

/**
 * Every profile field that no rule reads and no metadata entry excuses.
 *
 * The list the audit asserts is empty. A non-empty result is the spec §11
 * failure mode exactly: a setting the user can change that changes nothing.
 */
export function unwiredProfilePaths(): readonly string[] {
  const covered = DETERMINISTIC_RULES.flatMap((rule) => [...rule.profilePaths]);
  const excused = new Set<string>(METADATA_ONLY_PROFILE_PATHS);
  return PROFILE_FIELD_PATHS.filter(
    (path) => !isCovered(path, covered) && !isCovered(path, [...excused]),
  );
}

/** The rule id and field list a rule declares, for diagnostics. */
export function registrySummary(): readonly {
  id: string;
  group: RuleGroup;
  scope: RuleScope;
  category: string;
  correctable: boolean;
  reads: number;
}[] {
  return DETERMINISTIC_RULES.map((rule) => ({
    id: rule.id,
    group: rule.group,
    scope: rule.scope,
    category: rule.category,
    correctable: rule.correctable,
    reads: rule.profilePaths.length,
  }));
}

/** Read the four deterministic sections off a full profile. */
export function profileOf(profile: DeterministicStyleProfile): DeterministicStyleProfile {
  return profile;
}

export { deterministicProfileOf };
