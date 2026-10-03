/**
 * Canonical StyleProfile domain model.
 *
 * This single object drives BOTH the Reformat and Consistency Check engines
 * (Roadmap "One canonical profile" rule). It is user-editable, revisioned, and
 * split into measured (deterministic) and semantic (AI) sections. Revision
 * bookkeeping and the audit trail are owned by ProfileRecord.
 *
 * Boundary rule: core/domain must not import from `word`, `ai`, or `ui`.
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { StoredSemanticStyleSchema } from "./SemanticStyleProfile";

export type {
  SemanticStyleProfile,
  SemanticDimension,
  SemanticStyleProfileSchema,
  StoredSemanticStyleSchema,
  SEMANTIC_DIMENSIONS,
  SEMANTIC_STYLE_SCHEMA_VERSION,
} from "./SemanticStyleProfile";

/**
 * A profile revision is a plain monotonically increasing integer.
 *
 * It is assigned by the owning ProfileRecord when a revision is written, so a
 * stored snapshot is self-identifying and a ChangePlan can cite the exact
 * revision it was built from. There is deliberately no semantic version here:
 * two unrelated counters previously wrote to the same `patch` field, which made
 * a "version" ambiguous.
 */
export const RevisionSchema = z.number().int().nonnegative();
export type Revision = z.infer<typeof RevisionSchema>;

/** Human-facing label for a revision, used in the task pane. */
export function formatRevision(revision: Revision): string {
  return `r${revision}`;
}

export const TypographyRulesSchema = z.object({
  // How an em dash is represented. "em" is the Unicode U+2014 character,
  // "hyphen" is a double hyphen "--", and "space" is a plain space. The
  // companion `emDashSpacing` field controls whether the dash is surrounded
  // by spaces, which is orthogonal to how the dash itself is encoded.
  emDash: z.enum(["em", "hyphen", "space"]).default("em"),
  emDashSpacing: z.enum(["spaced", "tight"]).default("spaced"),
  enDashSpacing: z.enum(["spaced", "tight"]).default("spaced"),
  doubleQuotes: z.enum(["curly", "straight"]).default("curly"),
  singleQuotes: z.enum(["curly", "straight"]).default("curly"),
  apostrophes: z.enum(["curly", "straight"]).default("curly"),
  decimalSeparator: z.enum(["dot", "comma"]).default("dot"),
  thousandsSeparator: z.enum(["none", "space", "comma"]).default("none"),
  ellipsis: z.enum(["ellipsis", "three-dots", "spaced-dots"]).default("ellipsis"),

  // ── Spec §5 additions ──────────────────────────────────────────────
  // Every field below is read by a rule in `src/rules/typography.ts`. The
  // registry's orphan-setting assertion (spec §11) fails if one is added
  // without a rule, so an inert field cannot be introduced here.

  /**
   * Whether runs of spaces and trailing spaces are deviations.
   *
   * Previously the whitespace check ran unconditionally, which meant a profile
   * could not accept a document with a double space — a real requirement in
   * text that quotes tabular figures. Default true preserves the behaviour a
   * profile had before this field existed.
   */
  normaliseWhitespace: z.boolean().default(true),
  /**
   * Whether a tab is a deviation, or is merely left alone.
   *
   * Separate from `normaliseWhitespace` because a document pasted from a
   * spreadsheet legitimately contains tabs and the author may want them.
   */
  flagTabs: z.boolean().default(true),
  /**
   * How a non-breaking space is treated.
   *
   * `preserve` is a real answer: a non-breaking space is how a house style
   * keeps `10 kg` together, so treating every one as an error would fight the
   * profile's own units rule.
   */
  nonBreakingSpace: z.enum(["flag", "preserve"]).default("flag"),
  /**
   * Spacing around a solidus: `and/or` against `and / or`.
   *
   * `none` means the profile has no opinion and the rule does not run, which
   * is distinct from `tight` (an opinion that forbids spaces).
   */
  slashSpacing: z.enum(["none", "spaced", "tight"]).default("none"),
  /**
   * Spacing before a percent sign.
   *
   * The number profile's own `percentageSpacing` is the normative one; this
   * exists so a typography-only profile can express the rule without also
   * configuring a number convention. The two are reconciled by the rule, which
   * prefers the number profile's value when it differs.
   */
  percentageSpacing: z.enum(["none", "spaced", "tight"]).default("none"),
  /**
   * Spacing between a currency symbol and its amount.
   *
   * `none` defers to the currency profile, which is the normative source for
   * money. The typography rule runs only when this is set, so a profile that
   * configures neither stays silent rather than guessing.
   */
  currencySpacing: z.enum(["none", "spaced", "tight"]).default("none"),
  /**
   * Whether a space is required before an opening bracket, as `word (paren)`.
   *
   * Off by default because the convention runs the other way in most house
   * styles, and a rule that fires on correct text trains the reader to ignore
   * it.
   */
  spaceBeforeParenthesis: z.boolean().default(false),
  /**
   * Whether a space is required after a hyphenated compound, as `state -of -art`.
   *
   * Off by default: the field exists because a few house styles do space
   * compounds, and without it the rule cannot be expressed at all.
   */
  spaceAfterHyphen: z.boolean().default(false),
});

export type TypographyRules = z.infer<typeof TypographyRulesSchema>;

/**
 * One configured house substitution.
 *
 * Spec §4.2. The flat `preferredTerminology` record this replaces could express
 * a term and its replacement and nothing else: no severity, no case sensitivity,
 * no whole-word control, and no way to say a term is only wrong in a particular
 * section. Each of those is a real editorial decision, and a schema that cannot
 * record it forces the decision to be made by how the user happened to type the
 * term.
 *
 * `id` is required rather than derived, because two rules can legitimately name
 * the same term in different scopes, and a derived key would collapse them.
 */
export const TerminologyRuleSchema = z.object({
  id: z.string().trim().min(1),
  /** The term as it appears in the document. */
  source: z.string().trim().min(1),
  /**
   * The replacement, or absent for a banned term.
   *
   * Absent rather than an empty string, because "replace with nothing" and
   * "remove this term entirely" are the same instruction here and a rule that
   * wants deletion says so by omitting the field. A `replacement: ""` would
   * parse, and the planner would build a `deleteRange` for a rule that did not
   * ask for one.
   */
  replacement: z.string().trim().min(1).optional(),
  /**
   * When false, `source` matches regardless of case and the replacement takes
   * the *source's* casing, so `Programme` is not rewritten to `programme` in a
   * sentence that opens it.
   */
  caseSensitive: z.boolean().default(false),
  /**
   * When true, `color` will not match inside `colorful`.
   *
   * Default true: a house substitution that fires inside a longer word is
   * almost always wrong, and the case where it is right is rare enough to be
   * worth turning the flag off deliberately.
   */
  wholeWord: z.boolean().default(true),
  /** `mandatory` maps to error, `advisory` to warning. */
  severity: z.enum(["mandatory", "advisory"]).default("advisory"),
  /**
   * Restricts the rule to one section or style, or applies it everywhere.
   *
   * Both are checked: a heading can begin a section, and a paragraph can carry
   * a style. A rule that matched on either alone would fire in the wrong place
   * half the time.
   */
  scope: z
    .object({
      /** Match only inside a heading whose text contains this. */
      withinSectionContaining: z.string().trim().min(1).optional(),
      /** Match only on a paragraph carrying this Word style. */
      withinStyle: z.string().trim().min(1).optional(),
    })
    .default({}),
});
export type TerminologyRule = z.infer<typeof TerminologyRuleSchema>;

/** Spec §4.2 capitalisation. */
export const CapitalisationProfileSchema = z.object({
  /** Whether a sentence should open with an upper-case letter. */
  sentenceCase: z.boolean().default(true),
  /**
   * Words that are always upper case, as proper nouns are.
   *
   * Distinct from the legacy `titleCaseWords`, which meant "capitalise this word
   * wherever it appears" and so fired on a common noun at the start of a
   * clause. A proper noun is a closed list the author maintains; a word to
   * capitalise everywhere is a much broader and riskier instruction, and the
   * two do not belong in one field.
   */
  properNouns: z.array(z.string().trim().min(1)).default([]),
  /** Words that must never appear capitalised outside a proper noun. */
  prohibitedCapitalised: z.array(z.string().trim().min(1)).default([]),
  /**
   * Heading case convention.
   *
   * `undefined` rather than a default, because no convention is a real answer
   * distinct from "sentence case": a profile that has not chosen must not be
   * reported as having chosen.
   */
  headingCase: z.enum(["sentence", "title", "upper"]).optional(),
});
export type CapitalisationProfile = z.infer<typeof CapitalisationProfileSchema>;

/** Spec §4.2 abbreviations. */
export const AbbreviationProfileSchema = z.object({
  /** Short form → long form, when the long form is the preferred rendering. */
  approved: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  /** Long form → the short form to use in running text. */
  preferredExpanded: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  /**
   * Whether the first use of an approved abbreviation must carry its expansion.
   *
   * `undefined` means "not configured". It is distinct from `false`, which is a
   * decision that the expansion is not required — a distinction a profile
   * cannot express if the field defaults to `false`.
   */
  requireFirstUseExpansion: z.boolean().optional(),
  /** Short or long forms that must never appear. */
  prohibitedVariants: z.array(z.string().trim().min(1)).default([]),
});
export type AbbreviationProfile = z.infer<typeof AbbreviationProfileSchema>;

/**
 * Spec §4.2 numbers.
 *
 * **No separator fields, deliberately.** `decimalSeparator` and
 * `thousandsSeparator` used to be declared here *and* in `typography`, and both
 * rules ran (owner decision D2). Two owners for one behaviour is the defect the
 * registry audit exists to catch, and it caught it: the two rules reported the
 * same separator at the same offset, so the planner held two overlapping changes
 * over one character and was entitled to refuse the whole plan (ND-2).
 *
 * They are genuinely different behaviours rather than duplicates — `1.00` is a
 * decimal, `1,000` is a group — so both survive, and `typography` owns them,
 * which is where they were always enforced. Declaring them here as well gave a
 * user two controls for one behaviour with no way to tell which was in force.
 *
 * Removing them from the schema rather than leaving them inert matters: an
 * unread field a user can still change is exactly the failure §11 describes.
 */
export const NumberProfileSchema = z.object({
  /** Space before a percent sign, as `50 %` or `50%`. */
  percentageSpacing: z.enum(["space", "tight"]).default("tight"),
  /**
   * Spell out numbers at or below this value. `null` means never.
   *
   * A `null` rather than `0` default, because 0 would be a rule ("spell out
   * every number") that no profile has chosen.
   */
  numberWordThreshold: z.number().int().nonnegative().nullable().default(null),
  /** How a negative number is written. */
  negativeNumber: z.enum(["minus", "parenthesis"]).default("minus"),
  /** Whether ranges use an en dash, a hyphen, or `to`. */
  rangeStyle: z.enum(["enDash", "hyphen", "to"]).default("enDash"),
});
export type NumberProfile = z.infer<typeof NumberProfileSchema>;

/**
 * One recognised date pattern.
 *
 * A `format` string rather than a named pattern, because the recognised set is
 * open — `31 May 2026`, `31/05/2026` and `2026-05-31` are the common ones, but a
 * house style can call for a pattern none of them names. A closed enum would
 * make a fourth pattern inexpressible rather than merely uncommon.
 */
export const DateFormatSchema = z.object({
  id: z.string().trim().min(1),
  /** A `strftime`-style pattern, e.g. `%d %B %Y`. */
  format: z.string().trim().min(1),
  /** Whether this is the form new dates should be written in. */
  preferred: z.boolean().default(false),
});
export type DateFormat = z.infer<typeof DateFormatSchema>;

/**
 * Spec §4.2 dates.
 *
 * Deterministic parsing only. A date rule reports the *shape* it found and the
 * shape the profile wants; it never decides what a date means, which day a
 * period refers to, or whether two dates contradict. That is Semantic Review's
 * job, and a deterministic rule that answered it would be guessing.
 */
export const DateProfileSchema = z.object({
  formats: z.array(DateFormatSchema).default([]),
  /** When true, two dates written the same way must name the same day. */
  requireUnambiguous: z.boolean().default(true),
});
export type DateProfile = z.infer<typeof DateProfileSchema>;

/**
 * Spec §4.2 currency.
 *
 * **No separator fields, for the same reason `NumberProfileSchema` has none.**
 * `typography` owns the decimal and thousands separators document-wide (owner
 * decision D2), and those two rules were the whole of ND-2: two findings at one
 * offset and a planner entitled to refuse the plan. A currency-scoped second owner
 * would have reproduced it exactly — the same comma in `£1,000` reported twice,
 * once under each profile's own setting. One owner, one setting.
 */
export const CurrencyProfileSchema = z.object({
  /** `symbol` writes `£100`; `code` writes `GBP 100`. */
  representation: z.enum(["symbol", "code"]).default("symbol"),
  /** Space between the symbol or code and the amount. */
  symbolSpacing: z.enum(["space", "tight"]).default("tight"),
  /** How large amounts are abbreviated: `4.2m` versus `4,200,000`. */
  magnitude: z.enum(["full", "thousands", "millions"]).default("full"),
});
export type CurrencyProfile = z.infer<typeof CurrencyProfileSchema>;

/** Spec §4.2 units. */
export const UnitProfileSchema = z.object({
  /** Space between the value and the unit, as `10 kg` or `10kg`. */
  valueSpacing: z.enum(["space", "tight"]).default("space"),
  /** A unit written with a lower-case name uses a lower-case symbol. */
  capitalisation: z.enum(["lower", "asWritten"]).default("lower"),
  /** Symbol preferred for a named unit, e.g. `kilogram` → `kg`. */
  symbols: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
});
export type UnitProfile = z.infer<typeof UnitProfileSchema>;

/**
 * The locales the house-standard editor offers (D5).
 *
 * A closed set for two reasons. The editor can only offer a dropdown over a
 * known list, and — the reason that matters — a free string accepts a typo that
 * parses cleanly and then matches no rule, which is the ND-13 failure wearing a
 * different hat: a field that looks configured and governs nothing.
 *
 * Deliberately short. Each entry carries only the *default numeric date shape*,
 * which is the one convention where the day/month order genuinely differs and a
 * wrong guess would misreport a date. Everything else about a locale — spelling,
 * punctuation, currency placement — is a house decision, and inferring it here
 * would re-introduce the variant table spec §4.3 removed.
 */
export const LOCALE_OPTIONS = ["en-US", "en-GB", "en-AU", "en-CA", "en-IE", "en-NZ"] as const;
export const LocaleSchema = z.enum(LOCALE_OPTIONS);
export type Locale = z.infer<typeof LocaleSchema>;

/**
 * The numeric date shape each locale defaults to, and the human sentence for it.
 *
 * Month-first for the US, day-first everywhere else in this set — which is the
 * whole reason the locale has to be *enforced* rather than decorative. The
 * `DateFormat.id` values are the shapes `describeDateShape` recognises, so the
 * default is expressible in the same vocabulary an author would use by hand.
 */
export const LOCALE_DATE_SHAPES: Readonly<Record<Locale, { id: string; format: string }>> = {
  "en-US": { id: "mdy", format: "M/D/YYYY" },
  "en-GB": { id: "dmy", format: "DD/MM/YYYY" },
  "en-AU": { id: "dmy", format: "DD/MM/YYYY" },
  "en-CA": { id: "mdy", format: "M/D/YYYY" },
  "en-IE": { id: "dmy", format: "DD/MM/YYYY" },
  "en-NZ": { id: "dmy", format: "DD/MM/YYYY" },
};

/**
 * The date shapes the deterministic rule recognises.
 *
 * Shared with the editor, because the editor has to offer exactly the vocabulary
 * the rule compares against. A free-text shape id would accept `DD/MM/YYYY`
 * cleanly and then match nothing at all — the ND-13 failure with a date in it.
 *
 * `unrecognised` is deliberately *not* in this set. It is what the rule reports
 * when it could not read a shape, and a profile claiming to prefer a shape the
 * tool cannot recognise would be a standard no document could ever meet.
 */
export const DATE_SHAPE_IDS = ["year-first", "day-month-year", "dmy", "mdy", "numeric"] as const;
export type DateShapeId = (typeof DATE_SHAPE_IDS)[number];

/**
 * How each shape is named to a user. The examples are the point — "dmy" and
 * "mdy" mean nothing until you have seen `31/05/2026` and `05/31/2026` side by side.
 */
export const DATE_SHAPE_LABELS: Readonly<Record<DateShapeId, string>> = {
  "year-first": "year first (2026-05-31)",
  "day-month-year": "day first with the month named (31 May 2026)",
  dmy: "day first (31/05/2026)",
  mdy: "month first (05/31/2026)",
  numeric: "numerically (31/05/2026)",
};

/**
 * Spec §4.2 language conventions: everything about the words themselves.
 *
 * A section of its own rather than an extension of `HouseStyle`, because the
 * two answer different questions. `houseStyle` is the legacy flat record the
 * existing rules read; `language` is the expanded schema spec §4.2 asks for.
 * Both are kept during the transition so a profile authored under the old
 * editor still produces the findings it did before.
 */
export const LanguageConventionProfileSchema = z.object({
  terminology: z.array(TerminologyRuleSchema).default([]),
  /**
   * The legacy term map, read alongside `terminology`.
   *
   * Additive rather than a migration: a record written by the old editor has
   * entries here and none in `terminology`, and both must fire until the editor
   * writes the new form.
   */
  legacyPreferredTerminology: z.record(z.string(), z.string()).default({}),
  bannedTerms: z.array(z.string().trim().min(1)).default([]),
  /**
   * Terms the house requires, expressed as substitutions.
   *
   * Owner decision D1. This was a `requiredTerms` list on the *governance*
   * profile, where it governed nothing: no rule read it, and it sat beside
   * protection and scope settings it had nothing to do with.
   *
   * It is a wording standard, so it lives here and is enforced by the pipeline.
   * The shape is a `TerminologyRule` rather than a bare word so the same record
   * expresses what should be there (`source` absent from the document, written as
   * `replacement`) — a required *term* with no replacement would be a completeness
   * check, which is a different rule and not what was asked for.
   */
  requiredTerms: z.array(TerminologyRuleSchema).default([]),
  capitalisation: CapitalisationProfileSchema.default({}),
  abbreviations: AbbreviationProfileSchema.default({}),
  numbers: NumberProfileSchema.default({}),
  dates: DateProfileSchema.default({}),
  currency: CurrencyProfileSchema.default({}),
  units: UnitProfileSchema.default({}),
  /**
   * The locale the house writes in (D5).
   *
   * **Enforced, not metadata.** It was a free string nothing read, listed in
   * `METADATA_ONLY_PROFILE_PATHS` so the registry recorded the omission as
   * deliberate while the editor presented it as an editable text box. A setting a
   * user can change and observe no consequence from is the same failure as ND-13:
   * it looks authoritative and governs nothing.
   *
   * **A closed set**, so the editor can offer a dropdown and a typo cannot
   * produce a locale that silently does nothing.
   *
   * **What it does *not* drive.** Not a spelling dictionary: spec §4.3 removes
   * the generic US/UK variant table precisely because it duplicated Word's
   * spellchecker, and a locale driving one would reintroduce the same
   * duplication through a different door.
   *
   * **What it does drive.** The *default* numeric date shape, applied only where
   * the profile has declared no preferred format of its own. An explicit setting
   * always wins, so a house writing `31/05/2026` under an `en-GB` default keeps
   * its own convention rather than being overruled by the locale beside it.
   */
  locale: LocaleSchema.default("en-US"),
});
export type LanguageConventionProfile = z.infer<typeof LanguageConventionProfileSchema>;

/**
 * Character properties a paragraph style standard may require.
 *
 * Every field optional, and that is the point: a standard that names only the
 * style and the font is a real and common configuration, and requiring the rest
 * would make a partial standard unrepresentable.
 */
export const CharacterStandardSchema = z.object({
  name: z.string().trim().min(1).optional(),
  size: z.number().positive().max(200).optional(),
  color: z.string().trim().min(1).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});
export type CharacterStandard = z.infer<typeof CharacterStandardSchema>;

/** Paragraph properties a style standard may require. Spacing is in points. */
export const ParagraphStandardSchema = z.object({
  alignment: z.enum(["left", "center", "right", "justified"]).optional(),
  lineSpacing: z.number().positive().max(10).optional(),
  spaceBefore: z.number().min(0).max(100).optional(),
  spaceAfter: z.number().min(0).max(100).optional(),
  leftIndent: z.number().min(-100).max(200).optional(),
  rightIndent: z.number().min(0).max(200).optional(),
  firstLineIndent: z.number().min(-100).max(200).optional(),
  keepWithNext: z.boolean().optional(),
  keepLinesTogether: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
});
export type ParagraphStandard = z.infer<typeof ParagraphStandardSchema>;

/** Spec §6: one Word style, and what a paragraph using it must look like. */
export const ParagraphStyleStandardSchema = z.object({
  styleName: z.string().trim().min(1),
  font: CharacterStandardSchema.optional(),
  paragraph: ParagraphStandardSchema.optional(),
  /**
   * Whether appearance must come from the style rather than from direct
   * formatting.
   *
   * This is the flag spec §10.3 turns on. A direct override is only a
   * deviation when the profile says the style owns that property; without it,
   * a bold run is the author's emphasis and clearing it would erase intent.
   */
  styleControlledFormatting: z.boolean().default(false),
});
export type ParagraphStyleStandard = z.infer<typeof ParagraphStyleStandardSchema>;

/** Spec §6 lists. */
export const ListFormattingStandardSchema = z.object({
  /** The Word style a list paragraph should carry, e.g. `List Paragraph`. */
  styleName: z.string().trim().min(1).optional(),
  /** The level a list item of this depth should carry. */
  level: z.number().int().min(0).max(8).optional(),
  /** Whether list level is a property this review can verify at all. */
  supported: z.boolean().default(false),
});
export type ListFormattingStandard = z.infer<typeof ListFormattingStandardSchema>;

/**
 * Spec §6 and §8.3 tables.
 *
 * Only properties Word can both acquire and, where a correction is offered,
 * mutate. Anything outside that is named in the coverage report as
 * unsupported rather than guessed at, which is why this has no cell-padding or
 * column-width field: an unrepresentable standard is better than one the
 * analyzer cannot check and the planner cannot satisfy.
 */
export const TableFormattingStandardSchema = z.object({
  styleName: z.string().trim().min(1).optional(),
  /** Whether the first row should carry the configured header style. */
  headerRow: z.boolean().optional(),
  /** The Word style a cell's paragraphs should carry. */
  cellStyleName: z.string().trim().min(1).optional(),
  /** How many leading rows are header rows. */
  headerRowCount: z.number().int().min(0).max(10).optional(),
  /**
   * Whether table properties are readable in this host.
   *
   * The analyzer reads this before comparing anything, so a profile that
   * configures a table standard on a host without table support reports a
   * coverage limitation rather than a clean table.
   */
  supported: z.boolean().default(false),
});
export type TableFormattingStandard = z.infer<typeof TableFormattingStandardSchema>;

/** Spec §6 and §8.4 headers and footers. */
export const HeaderFooterStandardSchema = z.object({
  styleName: z.string().trim().min(1).optional(),
  font: CharacterStandardSchema.optional(),
  /** Whether a header or footer is required to exist. */
  required: z.boolean().default(false),
  supported: z.boolean().default(false),
});
export type HeaderFooterStandard = z.infer<typeof HeaderFooterStandardSchema>;

/** Spec §6 and §8.5 page setup. Margins in points; sizes in twips. */
export const PageStandardSchema = z.object({
  /** Margin in points, named by edge as Word names them. */
  margins: z
    .object({
      top: z.number().min(0).max(500).optional(),
      bottom: z.number().min(0).max(500).optional(),
      left: z.number().min(0).max(500).optional(),
      right: z.number().min(0).max(500).optional(),
    })
    .optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  /** Page width and height in twips, as Word measures them. */
  width: z.number().int().positive().max(31680).optional(),
  height: z.number().int().positive().max(31680).optional(),
  supported: z.boolean().default(false),
});
export type PageStandard = z.infer<typeof PageStandardSchema>;

/**
 * Spec §6: the whole document's formatting standard.
 *
 * `headings` is keyed 1–9 rather than a record, because a heading level is a
 * closed set in Word and an open one would let a profile name a level that
 * cannot exist. `bodyStyle` is required because a document standard with no
 * body standard is not a standard, and every comparison needs somewhere to
 * start.
 */
export const DocumentFormattingProfileSchema = z
  .object({
    bodyStyle: ParagraphStyleStandardSchema,
    titleStyle: ParagraphStyleStandardSchema.optional(),
    subtitleStyle: ParagraphStyleStandardSchema.optional(),
    headings: z
      .object({
        "1": ParagraphStyleStandardSchema.optional(),
        "2": ParagraphStyleStandardSchema.optional(),
        "3": ParagraphStyleStandardSchema.optional(),
        "4": ParagraphStyleStandardSchema.optional(),
        "5": ParagraphStyleStandardSchema.optional(),
        "6": ParagraphStyleStandardSchema.optional(),
        "7": ParagraphStyleStandardSchema.optional(),
        "8": ParagraphStyleStandardSchema.optional(),
        "9": ParagraphStyleStandardSchema.optional(),
      })
      .default({}),
    captions: ParagraphStyleStandardSchema.optional(),
    lists: ListFormattingStandardSchema.optional(),
    tables: TableFormattingStandardSchema.optional(),
    headersFooters: HeaderFooterStandardSchema.optional(),
    page: PageStandardSchema.optional(),
  })
  .default({ bodyStyle: { styleName: "Normal" } });
export type DocumentFormattingProfile = z.infer<typeof DocumentFormattingProfileSchema>;

/**
 * Spec §4.1 and §10.2: rules about the *shape* of the document.
 *
 * Separate from `formatting` because a structure rule reasons about the
 * document as a whole — whether a heading level was skipped, whether a table
 * has a header row — while a formatting rule compares one paragraph against a
 * style standard. The review UI groups them separately (spec §22) for the same
 * reason.
 */
export const DocumentStructureProfileSchema = z.object({
  /**
   * Whether a heading may jump levels.
   *
   * True is a real editorial policy — a short report may legitimately go from
   * H2 to H4 — and it is distinct from not having an opinion, which is
   * `undefined`.
   */
  allowSkippedHeadingLevels: z.boolean().optional(),
  /** The deepest heading level in use, so a deeper one is a deviation. */
  maxHeadingLevel: z.number().int().min(1).max(9).optional(),
  /** Whether an empty heading is a deviation or merely untidy. */
  reportEmptyHeadings: z.boolean().default(true),
  /** Whether an unknown or unrecognised Word style is a deviation. */
  reportUnknownStyles: z.boolean().default(true),
});
export type DocumentStructureProfile = z.infer<typeof DocumentStructureProfileSchema>;

/**
 * The legacy house-style section, now capitalisation only.
 *
 * `preferredTerminology` and `bannedTerms` are **removed** (ND-13). Both were
 * authored in the House style panel, validated on save and round-tripped through
 * storage — and neither produced a finding, because the registry filtered both
 * checks out of `findHouseStyleIssues` in favour of the `language` section's
 * rules. A field that looked authoritative, persisted, and governed nothing is
 * the "it saved but ignored my entry" failure exactly.
 *
 * `findTerminologyIssues` is the single terminology engine. It is strictly more
 * capable than the flat record these fields held: a `TerminologyRule` carries
 * `wholeWord`, `caseSensitive`, `severity` and a section/style scope, where a
 * `Record<string, string>` could express a term and its replacement and nothing
 * else.
 *
 * Zod strips the retired keys on load, so a record written before this change
 * still parses and its stale values are discarded rather than honoured. Safe
 * here because there are no users to migrate; it would not be safe if a stored
 * term were ever load-bearing.
 */
export const HouseStyleSchema = z.object({
  capitalization: z
    .object({
      sentenceCase: z.boolean().default(true),
      titleCaseWords: z.array(z.string()).default([]),
    })
    .default({}),
  spellingVariant: z.enum(["en-US", "en-GB", "au"]).default("en-US"),
});

export type HouseStyle = z.infer<typeof HouseStyleSchema>;

// The V1 semantic shape is declared in `SemanticStyleProfile.ts`, not here.
// Re-exported so the migration has one import site to change when V1 is retired;
// see that module's header for why declaring it here would make the two files
// import each other.
export {
  LegacySemanticProfileV1Schema,
  type LegacySemanticProfileV1,
} from "./SemanticStyleProfile";

export const MeasuredProfileSchema = z.object({
  avgSentenceLength: z.number().nullable().default(null),
  sentenceLengthStdDev: z.number().nullable().default(null),
  emDashFrequency: z.number().nullable().default(null),
  enDashFrequency: z.number().nullable().default(null),
  curlyQuoteFrequency: z.number().nullable().default(null),
  paragraphLengthAvg: z.number().nullable().default(null),
  capitalizationConsistency: z.number().nullable().default(null),
  sampleWordCount: z.number().nullable().default(null),
});

export type MeasuredProfile = z.infer<typeof MeasuredProfileSchema>;

/**
 * Which half of the product a profile governs.
 *
 * The two halves are edited in different places, use different providers, and
 * are revised independently, so they are separate records rather than one object
 * with two sets of fields. The kind is a property of the profile so a record can
 * never be stored in the wrong namespace or shown on the wrong tab.
 *
 * - `deterministic` — typography, house style, and measured metrics. Checked
 *   continuously over the whole document by rules. Sends nothing anywhere.
 * - `semantic` — tone, voice, register, and learned style. Used by the selected
 *   paragraph review and rewrite, which do send text to a provider.
 */
export const ProfileKindSchema = z.enum(["deterministic", "semantic"]);
export type ProfileKind = z.infer<typeof ProfileKindSchema>;

/**
 * Spec §4.1: the four sections Deterministic Review compares against.
 *
 * Assembled here rather than stored as one object so a consumer can reach a
 * single section without parsing the rest. `semantic` is deliberately absent:
 * semantic review is a separate product with a separate profile namespace, and
 * a "deterministic style profile" carrying a tone and a register would be the
 * blending spec §0 rules out.
 */
export const DeterministicStyleProfileSchema = z.object({
  language: LanguageConventionProfileSchema.default({}),
  typography: TypographyRulesSchema.default({}),
  formatting: DocumentFormattingProfileSchema.default({
    bodyStyle: { styleName: "Normal" },
  }),
  structure: DocumentStructureProfileSchema.default({}),
});
export type DeterministicStyleProfile = z.infer<typeof DeterministicStyleProfileSchema>;

/** The four sections a deterministic review compares against, read off a profile. */
export function deterministicProfileOf(profile: StyleProfile): DeterministicStyleProfile {
  return {
    language: profile.language,
    typography: profile.typography,
    formatting: profile.formatting,
    structure: profile.structure,
  };
}

export const StyleProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  /** Assigned by the owning ProfileRecord; not a semantic version. */
  revision: RevisionSchema,
  kind: ProfileKindSchema.default("deterministic"),
  measured: MeasuredProfileSchema,
  /**
   * V2, sixteen grouped dimensions.
   *
   * The deterministic engine never reads this field — it refuses a `kind:
   * "semantic"` profile outright — so its size costs nothing on the scanning path
   * and is paid only by the semantic tab and the review prompt.
   */
  semantic: StoredSemanticStyleSchema,
  typography: TypographyRulesSchema,
  houseStyle: HouseStyleSchema,
  /**
   * Spec §4.1: the expanded deterministic sections.
   *
   * Additive with a full default, so a record written before these fields
   * existed parses to a profile whose standards are the Word defaults rather
   * than to a parse failure. A profile that says nothing is a profile that has
   * not chosen a document standard, and the analyzer must be able to tell that
   * apart from one that chose `Normal` deliberately.
   */
  language: LanguageConventionProfileSchema.default({}),
  formatting: DocumentFormattingProfileSchema.default({
    bodyStyle: { styleName: "Normal" },
  }),
  structure: DocumentStructureProfileSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sourceSampleIds: z.array(z.string().uuid()).default([]),
});

export type StyleProfile = z.infer<typeof StyleProfileSchema>;

/**
 * A blank profile scaffold.
 *
 * `revision` defaults to 1 because that is the number the record assigns on
 * first save. A revision of 0 would mean "not yet persisted", which no
 * ChangePlan may cite.
 */
export function createEmptyProfile(
  name: string,
  revision: Revision = 1,
  kind: ProfileKind = "deterministic",
): StyleProfile {
  const now = new Date().toISOString();
  return StyleProfileSchema.parse({
    id: uuidv4(),
    name,
    revision,
    kind,
    measured: {},
    semantic: {},
    typography: {},
    houseStyle: {},
    language: {},
    formatting: { bodyStyle: { styleName: "Normal" } },
    structure: {},
    createdAt: now,
    updatedAt: now,
    sourceSampleIds: [],
  });
}
