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
import { findTypographyIssues } from "../../rules/typography";
import {
  findAbbreviationIssues,
  findCapitalisationIssues,
  findCurrencyIssues,
  findDateIssues,
  findNumberIssues,
  findTerminologyIssues,
  findUnitIssues,
  type LanguageCheckOptions,
} from "../../rules/language";
import { findFormattingIssues } from "../../formatting/analyzer";
import type { Finding } from "../../core/domain/Finding";

/** The categories `typography/dashes` is responsible for. */
const DASH_CATEGORIES = [
  "typography.emDash",
  "typography.emDashSpacing",
  "typography.enDashSpacing",
] as const;

/** The categories `typography/quotes` is responsible for. */
const QUOTE_CATEGORIES = [
  "typography.doubleQuotes",
  "typography.singleQuotes",
  "typography.apostrophes",
] as const;

/** The categories `typography/numbers` is responsible for. */
const NUMBER_CATEGORIES = ["typography.decimalSeparator", "typography.thousandsSeparator"] as const;

/**
 * Keep only the findings a rule is responsible for.
 *
 * The three legacy scanners each return every category they know about, so a
 * rule wrapping one of them has to select its own. Without the filter every rule
 * wrapping `findTypographyIssues` would report the same dashes *and* the same
 * quotes, and the report would carry a finding four times over.
 */
function selectCategories(
  findings: readonly { category: string }[],
  categories: readonly string[],
): { category: string }[] {
  const wanted = new Set(categories);
  return findings.filter((finding) => wanted.has(finding.category));
}

/** Run the typography scanner and keep one rule's categories. */
function typography(
  ruleContext: DeterministicRuleContext,
  categories: readonly string[],
): DeterministicFinding[] {
  return selectCategories(
    findTypographyIssues({ text: ruleContext.context.text, rules: ruleContext.policy.typography }),
    categories,
  ) as DeterministicFinding[];
}

/**
 * Run one of the spec §4.2 language scanners and keep one rule's categories.
 *
 * The filter is not optional bookkeeping. Each scanner in `src/rules/language.ts`
 * is a complete check of its own subsection — `findCapitalisationIssues` reports
 * proper nouns, prohibited capitals and sentence case — so without selecting,
 * three registry rules would each report all three categories and the report
 * would carry every capitalisation finding three times.
 */
function language(
  ruleContext: DeterministicRuleContext,
  scan: (options: LanguageCheckOptions) => Finding[],
  categories: readonly string[],
): DeterministicFinding[] {
  const scanOptions: LanguageCheckOptions = {
    text: ruleContext.context.text,
    rules: ruleContext.policy.language,
  };
  return selectCategories(scan(scanOptions), categories) as DeterministicFinding[];
}

/**
 * Run the formatting scanner and keep one rule's categories.
 *
 * The profile, the structure section and the host capabilities are all passed
 * through rather than being read from the snapshot. That is the spec §10 change:
 * a formatting check with no profile has no standard to compare against, and one
 * that cannot see the capabilities would report a property the host declined to
 * serve as if the document had got it wrong.
 */
function formatting(
  ruleContext: DeterministicRuleContext,
  categories: readonly string[],
): DeterministicFinding[] {
  return selectCategories(
    findFormattingIssues({
      snapshot: ruleContext.context.formatting,
      profile: ruleContext.policy.formatting,
      structure: ruleContext.policy.structure,
      capabilities: ruleContext.context.capabilities,
    }),
    categories,
  ) as DeterministicFinding[];
}

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
  /**
   * The rule's headline category — the one the UI groups by and the one a
   * profile setting is named after.
   */
  category: string;
  /**
   * Every finding category the rule can emit, `category` included.
   *
   * Needed because one rule often produces several closely related categories
   * (`typography/dashes` emits emDash, emDashSpacing and enDashSpacing). The
   * engine filters a shared body function's output by this list, which is what
   * lets every rule wrap the same underlying scanner while remaining separately
   * auditable. Defaults to `[category]` when a rule emits one.
   */
  emits?: readonly string[];
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
 * The typography, house-style and formatting bodies are attached here; the
 * language-convention and structural rules that have no body yet are declared
 * so the audit has something to check against, and a rule with no `analyze` is
 * visibly incomplete rather than invisible.
 *
 * **Why the bodies are attached here rather than called directly by the
 * engine.** The audit in `ruleRegistry.test.ts` reads this array. If the engine
 * called `findTypographyIssues` itself, the registry would describe a rule set
 * that nothing consults, and the audit could pass while the engine ran
 * something else entirely. Dispatching through `analyze` is what makes the audit
 * a statement about the running engine rather than about a declaration.
 */
export const DETERMINISTIC_RULES: readonly DeterministicRule[] = [
  {
    id: "typography/dashes",
    group: "typography",
    scope: "text",
    category: "typography.emDash",
    emits: ["typography.emDash", "typography.emDashSpacing", "typography.enDashSpacing"],
    profilePaths: ["typography.emDash", "typography.emDashSpacing", "typography.enDashSpacing"],
    correctable: true,
    analyze: (ruleContext) => typography(ruleContext, DASH_CATEGORIES),
  },
  {
    id: "typography/quotes",
    group: "typography",
    scope: "text",
    category: "typography.doubleQuotes",
    emits: ["typography.doubleQuotes", "typography.singleQuotes", "typography.apostrophes"],
    profilePaths: ["typography.doubleQuotes", "typography.singleQuotes", "typography.apostrophes"],
    correctable: true,
    analyze: (ruleContext) => typography(ruleContext, QUOTE_CATEGORIES),
  },
  {
    id: "typography/ellipsis",
    group: "typography",
    scope: "text",
    category: "typography.ellipsis",
    profilePaths: ["typography.ellipsis"],
    correctable: true,
    analyze: (ruleContext) => typography(ruleContext, ["typography.ellipsis"]),
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
    // The decimal separator is a safe substitution; spelling a numeral out
    // changes the author's prose and a range written "to" changes the register.
    // Both are reported without a correction, so this rule is mixed and the
    // per-finding `correctionAvailable` is what the review reads.
    correctable: true,
    analyze: (ruleContext) => [
      ...typography(ruleContext, NUMBER_CATEGORIES),
      ...language(ruleContext, findNumberIssues, [
        "language.number.decimalSeparator",
        "language.number.percentageSpacing",
        "language.number.spelling",
        "language.number.range",
      ]),
    ],
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
    analyze: (ruleContext) => typography(ruleContext, ["typography.whitespace"]),
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
    // Only the substitution category. A banned term is a separate rule below,
    // and a rule that emitted both would report every banned term twice.
    analyze: (ruleContext) =>
      language(ruleContext, findTerminologyIssues, ["houseStyle.terminology"]),
  },
  {
    id: "language/banned",
    group: "language",
    scope: "text",
    category: "houseStyle.bannedTerm",
    profilePaths: ["language.bannedTerms"],
    correctable: true,
    analyze: (ruleContext) => language(ruleContext, findTerminologyIssues, ["language.bannedTerm"]),
  },
  {
    id: "language/capitalisation",
    group: "language",
    scope: "text",
    category: "language.capitalisation.sentenceCase",
    emits: [
      "language.capitalisation.sentenceCase",
      "language.capitalisation.properNoun",
      "language.capitalisation.prohibited",
    ],
    profilePaths: [
      "language.capitalisation.sentenceCase",
      "language.capitalisation.properNouns",
      "language.capitalisation.prohibitedCapitalised",
      "language.capitalisation.headingCase",
    ],
    correctable: true,
    analyze: (ruleContext) =>
      language(ruleContext, findCapitalisationIssues, [
        "language.capitalisation.sentenceCase",
        "language.capitalisation.properNoun",
        "language.capitalisation.prohibited",
      ]),
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
    analyze: (ruleContext) =>
      language(ruleContext, findAbbreviationIssues, [
        "language.abbreviation.prohibited",
        "language.abbreviation.firstUse",
      ]),
  },
  {
    id: "language/dates",
    group: "language",
    scope: "text",
    category: "language.date",
    profilePaths: ["language.dates.formats", "language.dates.requireUnambiguous"],
    // Reported, never corrected: converting between date shapes means deciding
    // which field is the day, and `31/05/2026` is exactly the case where
    // guessing is worst. The rule points at it; the user resolves it.
    correctable: false,
    analyze: (ruleContext) =>
      language(ruleContext, findDateIssues, ["language.date.ambiguous", "language.date.format"]),
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
    analyze: (ruleContext) =>
      language(ruleContext, findCurrencyIssues, [
        "language.currency.representation",
        "language.currency.spacing",
      ]),
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
    analyze: (ruleContext) =>
      language(ruleContext, findUnitIssues, [
        "language.unit.spacing",
        "language.unit.capitalisation",
      ]),
  },
  {
    id: "formatting/body",
    group: "formatting",
    scope: "paragraph",
    category: "formatting.bodyStyle",
    emits: ["formatting.bodyStyle", "formatting.emptyStyle", "formatting.styleStandard"],
    profilePaths: [
      "formatting.bodyStyle",
      "formatting.titleStyle",
      "formatting.subtitleStyle",
      "formatting.captions",
    ],
    correctable: true,
    analyze: (ruleContext) =>
      formatting(ruleContext, [
        "formatting.emptyStyle",
        "formatting.bodyStyle",
        "formatting.styleStandard",
      ]),
  },
  {
    id: "formatting/headings",
    group: "formatting",
    scope: "paragraph",
    category: "formatting.headingStyle",
    profilePaths: ["formatting.headings", "structure.maxHeadingLevel"],
    correctable: true,
    analyze: (ruleContext) => formatting(ruleContext, ["formatting.headingStyle"]),
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
    analyze: (ruleContext) => formatting(ruleContext, ["formatting.directFormatting"]),
  },
  {
    id: "formatting/lists",
    group: "formatting",
    scope: "list",
    category: "formatting.listLevel",
    emits: ["formatting.listLevel", "formatting.listStyle"],
    profilePaths: ["formatting.lists"],
    correctable: true,
    analyze: (ruleContext) =>
      formatting(ruleContext, ["formatting.listLevel", "formatting.listStyle"]),
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
    analyze: (ruleContext) => formatting(ruleContext, ["formatting.headingHierarchy"]),
  },
  {
    id: "integrity/emptyHeading",
    group: "integrity",
    scope: "paragraph",
    category: "formatting.emptyHeading",
    profilePaths: ["structure.reportEmptyHeadings"],
    correctable: true,
    analyze: (ruleContext) => formatting(ruleContext, ["formatting.emptyHeading"]),
  },
  {
    id: "integrity/unknownStyle",
    group: "integrity",
    scope: "paragraph",
    category: "formatting.unknownStyle",
    profilePaths: ["structure.reportUnknownStyles"],
    correctable: true,
    analyze: (ruleContext) => formatting(ruleContext, ["formatting.unknownStyle"]),
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

/**
 * The rule id and field list a rule declares, for diagnostics.
 *
 * `implemented` says whether the rule has a body. It is here rather than left to
 * a caller counting `analyze` because the interesting question for anyone
 * debugging a missing finding is not "is this rule declared" but "is this rule
 * declared *and* running" — and a summary that omitted the second half answered
 * the wrong question.
 */
export function registrySummary(): readonly {
  id: string;
  group: RuleGroup;
  scope: RuleScope;
  category: string;
  correctable: boolean;
  reads: number;
  implemented: boolean;
}[] {
  return DETERMINISTIC_RULES.map((rule) => ({
    id: rule.id,
    group: rule.group,
    scope: rule.scope,
    category: rule.category,
    correctable: rule.correctable,
    reads: rule.profilePaths.length,
    implemented: rule.analyze !== undefined,
  }));
}

/** Read the four deterministic sections off a full profile. */
export function profileOf(profile: DeterministicStyleProfile): DeterministicStyleProfile {
  return profile;
}

export { deterministicProfileOf };
