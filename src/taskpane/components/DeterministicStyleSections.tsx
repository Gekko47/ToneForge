/**
 * DeterministicStyleSections — the §21 profile editor IA.
 *
 * Spec §4.1, §6 and §21. The four deterministic sections as collapsible blocks,
 * each marked with whether *this* Word host can read the content it governs.
 *
 * **Why the marking is per-section and not one banner.** A host that cannot read
 * page setup can still read the body perfectly, and a single "some sections are
 * unsupported" note tells the user nothing about which. More importantly, a
 * section that looks like the others is the failure §9 exists to prevent: a user
 * who sets a table style, never sees a table finding, and concludes the document
 * complies — when the table was never examined. The marking is on the section
 * that cannot be checked, not on the profile as a whole.
 *
 * **Why the sections are still editable when unsupported.** The host may be
 * replaced and the profile is a durable record of the house standard. Blocking
 * the edit would leave a user stuck with whatever default shipped, and the
 * standard would be wrong the moment they moved to a desktop Word. What is not
 * allowed is the edit looking effective; the section says what it will and will
 * not do on this host.
 */

import React from "react";
import ProfileSection from "./ProfileSection";
import {
  AbbreviationProfileSchema,
  CapitalisationProfileSchema,
  CurrencyProfileSchema,
  DateProfileSchema,
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
  HeaderFooterStandardSchema,
  LanguageConventionProfileSchema,
  ListFormattingStandardSchema,
  NumberProfileSchema,
  PageStandardSchema,
  TableFormattingStandardSchema,
  UnitProfileSchema,
  type AbbreviationProfile,
  type CapitalisationProfile,
  type CurrencyProfile,
  type DeterministicStyleProfile,
  type NumberProfile,
  type TerminologyRule,
  type UnitProfile,
  DATE_SHAPE_IDS,
  DATE_SHAPE_LABELS,
  LOCALE_OPTIONS,
  LOCALE_DATE_SHAPES,
} from "../../core/domain/StyleProfile";
import type { WordCapabilities } from "../../word/capabilityProbe";
import {
  formatTermList,
  formatTerminology,
  parseTermList,
  parseTerminology,
  type TermNouns,
} from "../settings/terminologyText";

export interface DeterministicStyleSectionsProps {
  profile: DeterministicStyleProfile;
  onChange: (next: DeterministicStyleProfile) => void;
  /**
   * The live capability set, or `null` before the probe has answered.
   *
   * `null` is a third state, not a synonym for unsupported: marking a section
   * unsupported before the probe has run would be a claim about the host nobody
   * made. Until it answers, the section simply carries no marking.
   */
  capabilities: WordCapabilities | null;
}

function set<K extends keyof DeterministicStyleProfile>(
  profile: DeterministicStyleProfile,
  key: K,
  value: DeterministicStyleProfile[K],
): DeterministicStyleProfile {
  return { ...profile, [key]: value };
}

/**
 * A number field that can be left blank.
 *
 * Blank is not zero. Every one of these standards is `optional()`, and a margin
 * of "unset" is a different claim from a margin of 0 points — so an empty input
 * removes the field rather than writing `0`.
 */
function numberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrUndefined(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A text input bound to one optional string field of the formatting standard. */
function StyleTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string) => void;
}): React.ReactNode {
  return (
    <label className="tf-field">
      <span>{label}</span>
      <input type="text" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** A number input bound to one optional bounded-integer field. */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (next: string) => void;
}): React.ReactNode {
  return (
    <label className="tf-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * The "compare this" switch every structural standard carries.
 *
 * Each standard schema has its own `supported` flag, and the analyzer returns
 * nothing at all unless it is set — deliberately, so a profile parsed from an
 * older record cannot start firing findings nobody chose. That leaves the user
 * with no way to reach the check, so the switch is part of the field rather than
 * an implementation detail: the standard is stored either way, and this says
 * whether the review compares it.
 */
function CompareToggle({
  what,
  checked,
  onChange,
}: {
  /** What is being compared. Named, because four identically-labelled toggles are one toggle to a screen reader. */
  what: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.ReactNode {
  return (
    <label className="tf-field tf-field-inline">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{`Compare ${what} against the document`}</span>
    </label>
  );
}

/**
 * A one-entry-per-line list field.
 *
 * Backs every plain `string[]` the language profile holds. The alternative — a
 * row per term, with an add and a remove button — is right for `terminology`,
 * which carries five flags per rule and so needs a row. A banned-words list
 * carries nothing but the word, and a row per word makes the editor longer than
 * the content it is editing.
 */
function LineListField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
}): React.ReactNode {
  const controlId = React.useId();
  const hintId = React.useId();
  return (
    <div className="tf-field">
      <label htmlFor={controlId}>{label}</label>
      <textarea
        id={controlId}
        aria-describedby={hintId}
        rows={3}
        value={formatTermList(value)}
        onChange={(event) => onChange(parseTermList(event.target.value))}
      />
      <span className="tf-sub" id={hintId}>
        {hint}
      </span>
    </div>
  );
}

/**
 * A `left: right` map field.
 *
 * **The error is kept, the text is not.** A malformed line reverts to the last
 * value the schema accepted, because a profile must never hold something the rule
 * cannot read — but the message stays on screen, so the user learns *which* line
 * was wrong instead of watching their typing bounce. The message is local state
 * rather than a prop because it describes the last keystroke, not the profile.
 */
function PairListField({
  label,
  hint,
  value,
  nouns,
  onChange,
}: {
  label: string;
  hint: string;
  value: Record<string, string>;
  nouns: TermNouns;
  onChange: (next: Record<string, string>) => void;
}): React.ReactNode {
  const [error, setError] = React.useState<string | null>(null);
  const controlId = React.useId();
  const hintId = React.useId();
  const errorId = React.useId();
  return (
    <div className="tf-field">
      <label htmlFor={controlId}>{label}</label>
      <textarea
        id={controlId}
        aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        aria-invalid={error !== null}
        rows={3}
        value={formatTerminology(value)}
        onChange={(event) => {
          const parsed = parseTerminology(event.target.value, nouns);
          setError(parsed.error);
          if (parsed.error === null) onChange(parsed.values);
        }}
      />
      <span className="tf-sub" id={hintId}>
        {hint}
      </span>
      {error !== null && (
        <span className="tf-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * A dropdown over a closed set of profile values.
 *
 * The vocabulary is passed rather than derived, because the sentence a user reads
 * is not always the stored value: `parenthesis` is stored as an enum member and
 * shown as “(5) rather than −5”.
 */
function EnumSelect<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}): React.ReactNode {
  const controlId = React.useId();
  const hintId = React.useId();
  return (
    <div className="tf-field">
      <label htmlFor={controlId}>{label}</label>
      <select
        id={controlId}
        {...(hint === undefined ? {} : { "aria-describedby": hintId })}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <span className="tf-sub" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * The same dropdown with a third, unset state.
 *
 * `headingCase` and `requireFirstUseExpansion` are `optional()` in the schema
 * because “the house has not said” is a real answer, distinct from “the house said
 * no”. A two-state control cannot express that, and collapsing three states into two
 * is how an unanswered question comes to read as a yes — which is exactly what
 * `requireFirstUseExpansion` was doing while no rule read it.
 *
 * “Not set” reports `undefined` and the caller *removes* the key rather than
 * writing `undefined`, because `exactOptionalPropertyTypes` treats the two as
 * different values.
 */
function OptionalEnumSelect({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | undefined;
  options: readonly (readonly [string, string])[];
  onChange: (next: string | undefined) => void;
}): React.ReactNode {
  const controlId = React.useId();
  const hintId = React.useId();
  return (
    <div className="tf-field">
      <label htmlFor={controlId}>{label}</label>
      <select
        id={controlId}
        aria-describedby={hintId}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      >
        <option value="">Not set</option>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      <span className="tf-sub" id={hintId}>
        {hint}
      </span>
    </div>
  );
}

/**
 * A terminology rule with no replacement.
 *
 * `exactOptionalPropertyTypes` distinguishes an absent field from `undefined`, so
 * "this rule wants no replacement" has to be expressed by omitting the key. A
 * spread with `replacement: undefined` would not type-check, and a rule that
 * parsed with a blank replacement would be one the planner could build a
 * deletion from.
 */
function withoutReplacement(rule: TerminologyRule): TerminologyRule {
  const { replacement: _replacement, ...rest } = rule;
  return rest;
}

/** An id no existing rule is using, so a new row cannot collide with an old one. */
function nextTermId(existing: readonly TerminologyRule[]): string {
  const taken = new Set(existing.map((rule) => rule.id));
  const candidates = Array.from(
    { length: taken.size + 1 },
    (_unused, index) => `term-${index + 1}`,
  );
  return candidates.find((candidate) => !taken.has(candidate)) ?? `term-${candidates.length + 1}`;
}

/**
 * One editable terminology rule.
 *
 * **Why a row per rule rather than a `term: replacement` textarea.** A flat line
 * format can express a substitution and nothing else, so writing it back would
 * have to drop the four other things a rule carries — `wholeWord`, `caseSensitive`,
 * `severity` and its scope. A user who set a mandatory term and reopened the page
 * would find their setting silently reverted to an advisory one. A row shows every
 * field the rule actually has, which is also what makes "give every editable field
 * a reachable control" checkable rather than aspirational.
 *
 * **Why the source is locally held.** `source` cannot be blank, so a half-typed
 * term would make `LanguageConventionProfileSchema.parse` throw inside a keystroke
 * and take the pane down with it. The row keeps the draft text, refuses the commit,
 * and says why; the profile keeps the last value that did parse.
 */
function TerminologyRow({
  rule,
  withReplacement,
  onChange,
  onRemove,
}: {
  rule: TerminologyRule;
  /** A required-term row has nothing to substitute, so it hides the replacement. */
  withReplacement: boolean;
  onChange: (next: TerminologyRule) => boolean;
  onRemove: () => void;
}): React.ReactNode {
  const [source, setSource] = React.useState(rule.source);
  const [replacement, setReplacement] = React.useState(rule.replacement ?? "");
  const [sourceProblem, setSourceProblem] = React.useState<string | null>(null);

  function commitSource(next: string): void {
    setSource(next);
    if (!onChange({ ...rule, source: next })) {
      setSourceProblem("A term cannot be blank.");
      return;
    }
    setSourceProblem(null);
  }

  function commitReplacement(next: string): void {
    setReplacement(next);
    const candidate =
      next.trim().length === 0 ? withoutReplacement(rule) : { ...rule, replacement: next };
    onChange(candidate);
  }

  return (
    <fieldset className="tf-standard-block">
      <legend>{rule.id}</legend>
      <label className="tf-field">
        <span>Term</span>
        <input type="text" value={source} onChange={(event) => commitSource(event.target.value)} />
        {sourceProblem !== null ? <span className="tf-sub">{sourceProblem}</span> : null}
      </label>
      {withReplacement ? (
        <label className="tf-field">
          <span>Replacement</span>
          <input
            type="text"
            value={replacement}
            onChange={(event) => commitReplacement(event.target.value)}
          />
          <span className="tf-sub">Blank means the term is flagged, never rewritten.</span>
        </label>
      ) : null}
      <label className="tf-field tf-field-inline">
        <input
          type="checkbox"
          checked={rule.wholeWord}
          onChange={(event) => onChange({ ...rule, wholeWord: event.target.checked })}
        />
        <span>Match whole words only</span>
      </label>
      <label className="tf-field tf-field-inline">
        <input
          type="checkbox"
          checked={rule.caseSensitive}
          onChange={(event) => onChange({ ...rule, caseSensitive: event.target.checked })}
        />
        <span>Case sensitive</span>
      </label>
      <label className="tf-field">
        <span>Severity</span>
        <select
          value={rule.severity}
          onChange={(event) =>
            onChange({ ...rule, severity: event.target.value as "mandatory" | "advisory" })
          }
        >
          <option value="advisory">Advisory</option>
          <option value="mandatory">Mandatory</option>
        </select>
      </label>
      <button type="button" className="tf-link-button" onClick={onRemove}>
        Remove
      </button>
    </fieldset>
  );
}

/**
 * Every closed vocabulary the language editor offers, named the way a copy-editor
 * would say it out loud.
 *
 * Module-level rather than inline because these are constants of the *product's
 * vocabulary*, not of a render: rebuilding them on every keystroke would allocate
 * a dozen arrays to redraw a dropdown whose options never change. The second half
 * of each pair is an example, because "Space" and "Tight" are only meaningful
 * against a rendered figure.
 */
/*
 * `NonNullable` because the *stored* value may be undefined — the schema's
 * optionality is exactly what "Not set" means — while no individual option is.
 */
type HeadingCase = NonNullable<CapitalisationProfile["headingCase"]>;

const HEADING_CASE_OPTIONS: readonly (readonly [HeadingCase, string])[] = [
  ["sentence", "Sentence case — only the first word"],
  ["title", "Title case — each significant word"],
  ["upper", "UPPER CASE"],
];
/*
 * Encoded as DOM strings rather than as booleans.
 *
 * A `<select>` can only carry strings, so a boolean option list would have to be
 * cast back at every read. Encoding it once here keeps the cast at the single place
 * where the meaning of "true"/"false" is decided.
 */
const FIRST_USE_EXPANSION_OPTIONS: readonly (readonly [string, string])[] = [
  ["true", "Required — expand the first use"],
  ["false", "Not required — the short form may stand alone"],
];
const PERCENTAGE_SPACING_OPTIONS: readonly (readonly [
  NumberProfile["percentageSpacing"],
  string,
])[] = [
  ["space", "Space — 50 %"],
  ["tight", "Tight — 50%"],
];
const NEGATIVE_NUMBER_OPTIONS: readonly (readonly [NumberProfile["negativeNumber"], string])[] = [
  ["minus", "Minus sign — -5"],
  ["parenthesis", "Parentheses — (5)"],
];
const RANGE_STYLE_OPTIONS: readonly (readonly [NumberProfile["rangeStyle"], string])[] = [
  ["enDash", "En dash — 5–10"],
  ["hyphen", "Hyphen — 5-10"],
  ["to", "The word to — 5 to 10"],
];
const CURRENCY_REPRESENTATION_OPTIONS: readonly (readonly [
  CurrencyProfile["representation"],
  string,
])[] = [
  ["symbol", "Symbol — £100"],
  ["code", "Code — GBP 100"],
];
const CURRENCY_SPACING_OPTIONS: readonly (readonly [CurrencyProfile["symbolSpacing"], string])[] = [
  ["space", "Space — £ 100"],
  ["tight", "Tight — £100"],
];
const CURRENCY_MAGNITUDE_OPTIONS: readonly (readonly [CurrencyProfile["magnitude"], string])[] = [
  ["full", "In full — 4,200,000"],
  ["thousands", "Abbreviated — 4.2k"],
  ["millions", "Abbreviated — 4.2m"],
];
const UNIT_VALUE_SPACING_OPTIONS: readonly (readonly [UnitProfile["valueSpacing"], string])[] = [
  ["space", "Space — 10 kg"],
  ["tight", "Tight — 10kg"],
];
const UNIT_CAPITALISATION_OPTIONS: readonly (readonly [UnitProfile["capitalisation"], string])[] = [
  ["lower", "Lower case — 10 kg"],
  ["asWritten", "As written — 10 KG left as the author wrote it"],
];

/** The date shapes the rule can recognise, offered as the id the rule compares. */
const DATE_SHAPE_OPTIONS: readonly (readonly [string, string])[] = DATE_SHAPE_IDS.map((id) => [
  id,
  DATE_SHAPE_LABELS[id],
]);

export default function DeterministicStyleSections({
  profile,
  onChange,
  capabilities,
}: DeterministicStyleSectionsProps): React.ReactNode {
  const patchLanguage = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "language",
        LanguageConventionProfileSchema.parse({ ...profile.language, ...values }),
      ),
    );
  /*
   * No `patchTypography`, and that is deliberate.
   *
   * Every typography setting already has a named control in the Typography
   * panel above, each one bound to the exact dropdown the rule reads. A second
   * editor for the same section would give the user two places to change one
   * setting, and the section here exists to summarise and to hold what has no
   * control yet — not to duplicate what does.
   */
  /*
   * A commit that is allowed to fail.
   *
   * `patchLanguage` throws by design: a value that does not parse must never be
   * written. A terminology row is mid-keystroke, though, and "color" passing
   * while "" does not is normal rather than exceptional — so a row that cannot
   * parse reports the problem and leaves the profile alone. Dropping the commit
   * is the whole point: the alternative is a pane that unmounts itself because
   * somebody pressed backspace.
   */
  const tryPatchLanguage = (values: Record<string, unknown>): boolean => {
    const parsed = LanguageConventionProfileSchema.safeParse({ ...profile.language, ...values });
    if (!parsed.success) return false;
    onChange(set(profile, "language", parsed.data));
    return true;
  };

  /*
   * One patcher per language subsection, so every editor commits through the
   * schema that owns its field.
   *
   * `patchLanguage` alone would take a raw object, and a raw object is how a
   * half-built subsection reaches the profile: `{ numbers: { percentageSpacing } }`
   * merges over the stored numbers and silently discards everything else in the
   * subsection. Parsing the subsection first means a bad edit throws where it can
   * still be reported, and a good one lands complete.
   */
  const capitalisation = profile.language.capitalisation;
  const patchCapitalisation = (values: Record<string, unknown>): void =>
    patchLanguage({
      capitalisation: CapitalisationProfileSchema.parse({ ...capitalisation, ...values }),
    });

  const abbreviations = profile.language.abbreviations;
  const patchAbbreviations = (values: Record<string, unknown>): void =>
    patchLanguage({
      abbreviations: AbbreviationProfileSchema.parse({ ...abbreviations, ...values }),
    });

  const numbers = profile.language.numbers;
  const patchNumbers = (values: Record<string, unknown>): void =>
    patchLanguage({ numbers: NumberProfileSchema.parse({ ...numbers, ...values }) });

  const dates = profile.language.dates;
  const patchDates = (values: Record<string, unknown>): void =>
    patchLanguage({ dates: DateProfileSchema.parse({ ...dates, ...values }) });

  const currency = profile.language.currency;
  const patchCurrency = (values: Record<string, unknown>): void =>
    patchLanguage({ currency: CurrencyProfileSchema.parse({ ...currency, ...values }) });

  const units = profile.language.units;
  const patchUnits = (values: Record<string, unknown>): void =>
    patchLanguage({ units: UnitProfileSchema.parse({ ...units, ...values }) });

  /*
   * The settings whose third state is "the house has not said".
   *
   * The key is *removed* rather than set to `undefined`, because
   * `exactOptionalPropertyTypes` treats an absent optional property and one
   * explicitly set to `undefined` as different, and the second is not what the
   * schema means by "not configured".
   */
  const setHeadingCase = (next: CapitalisationProfile["headingCase"]): void => {
    if (next !== undefined) {
      patchCapitalisation({ headingCase: next });
      return;
    }
    const { headingCase: _unset, ...rest } = capitalisation;
    patchLanguage({ capitalisation: rest });
  };

  const setFirstUseExpansion = (next: AbbreviationProfile["requireFirstUseExpansion"]): void => {
    if (next !== undefined) {
      patchAbbreviations({ requireFirstUseExpansion: next });
      return;
    }
    const { requireFirstUseExpansion: _unset, ...rest } = abbreviations;
    patchLanguage({ abbreviations: rest });
  };

  /*
   * Blank means "never", not zero.
   *
   * `numberWordThreshold` is `null` for never, and `0` would mean "spell out every
   * number" — a rule no profile has chosen. An empty input has to produce the
   * first, or clearing the box would silently turn a house that spells out "ten"
   * into one that spells out everything.
   */
  const setNumberWordThreshold = (raw: string): void =>
    patchNumbers({ numberWordThreshold: numberOrUndefined(raw) ?? null });

  const patchDateFormat = (index: number, changes: Record<string, unknown>): void =>
    patchDates({
      formats: dates.formats.map((format, position) =>
        position === index ? { ...format, ...changes } : format,
      ),
    });

  /*
   * Mark one format preferred and every other one not.
   *
   * The rule takes the *first* format flagged `preferred`, so two of them is not a
   * richer standard — it is an answer that depends on the order of an array the
   * user never sees ordered. Exactly one may be preferred.
   */
  const preferDateFormat = (index: number): void =>
    patchDates({
      formats: dates.formats.map((format, position) => ({
        ...format,
        preferred: position === index,
      })),
    });

  const removeDateFormat = (index: number): void =>
    patchDates({ formats: dates.formats.filter((_format, position) => position !== index) });

  const addDateFormat = (): void => {
    const fallback = LOCALE_DATE_SHAPES[profile.language.locale];
    patchDates({
      formats: [
        ...dates.formats,
        {
          id: fallback.id,
          format: fallback.format,
          // The first row added becomes the preferred one. A house that has added a
          // format and marked nothing preferred has expressed no preference, and the
          // locale fallback would then be doing the work under a borrowed name.
          preferred: dates.formats.length === 0,
        },
      ],
    });
  };

  const patchFormatting = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "formatting",
        DocumentFormattingProfileSchema.parse({ ...profile.formatting, ...values }),
      ),
    );
  const patchStructure = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "structure",
        DocumentStructureProfileSchema.parse({ ...profile.structure, ...values }),
      ),
    );

  /*
   * The four structural standards, and the editors that make them reachable.
   *
   * **Why these controls exist at all.** `formatting.lists`, `formatting.tables`,
   * `formatting.headersFooters` and `formatting.page` were declared in the
   * profile schema, read by the analyzer, and wired to registered rules — so the
   * §11 audit reported every one of them as covered. But nothing in the pane
   * could set them, so in the running product they were always at their schema
   * defaults: `supported: false`, no style name. The table, header/footer and
   * page-setup checks could therefore never produce a finding, no matter what a
   * user did. That is the §11 defect in its other direction — a rule reading a
   * setting the user cannot reach — and it is invisible to the registry audit,
   * which can only see that the rule reads the field.
   */
  const lists = profile.formatting.lists;
  const patchLists = (values: Record<string, unknown>): void =>
    patchFormatting({ lists: ListFormattingStandardSchema.parse({ ...lists, ...values }) });

  const tables = profile.formatting.tables;
  const patchTables = (values: Record<string, unknown>): void =>
    patchFormatting({ tables: TableFormattingStandardSchema.parse({ ...tables, ...values }) });

  const headersFooters = profile.formatting.headersFooters;
  const patchHeadersFooters = (values: Record<string, unknown>): void =>
    patchFormatting({
      headersFooters: HeaderFooterStandardSchema.parse({ ...headersFooters, ...values }),
    });

  const page = profile.formatting.page;
  const patchPage = (values: Record<string, unknown>): void =>
    patchFormatting({ page: PageStandardSchema.parse({ ...page, ...values }) });

  /*
   * Which of the standards this host cannot read, per standard.
   *
   * `null` capabilities mean the probe has not answered, and a claim about the
   * host nobody has made is worse than no claim, so an unprobed host produces an
   * empty list and the section carries no marking at all.
   */
  const uncheckedStandards = (() => {
    if (capabilities === null) return [];
    const entries: { label: string; reason: string }[] = [];
    if (!capabilities.supportsListLevel) {
      entries.push({
        label: "List level",
        reason:
          "this Word version does not serve a list item's level, so a level set here is stored but never compared. The list style is still compared.",
      });
    }
    if (!capabilities.supportsTables) {
      entries.push({
        label: "Tables",
        reason:
          "this Word version cannot read table properties, so a table standard set here is stored but not compared.",
      });
    }
    if (!capabilities.supportsHeadersFooters) {
      entries.push({
        label: "Headers and footers",
        reason:
          "this Word version cannot read headers and footers, so a header standard set here is stored but not compared.",
      });
    }
    if (!capabilities.supportsSections) {
      entries.push({
        label: "Page setup",
        reason:
          "this Word version cannot read section page setup, so margins and orientation set here are stored but not compared.",
      });
    }
    return entries;
  })();

  return (
    <div aria-label="Deterministic style sections">
      <ProfileSection
        id="language"
        title="Language"
        summary="Terminology, capitalisation, abbreviations, and the number, date, currency and unit conventions this house writes in."
        supported={capabilities === null ? null : true}
        defaultOpen
      >
        {/*
         * Terminology lives here, and this is the only place it is authored.
         *
         * It used to be on the *governance* policy page, which was the wrong
         * record twice over: governance governs protection and editability, and two
         * of these three fields were read by nothing at all. Preferred terms,
         * banned terms and required terms are house wording — a deterministic
         * standard — so they are authored beside the rules that consume them.
         */}
        <h4 className="tf-subheading">Preferred terminology</h4>
        <p className="tf-sub">
          Words the house always spells one way. A replacement is offered; accepting it is the
          user's decision, never automatic.
        </p>
        {profile.language.terminology.map((rule) => (
          <TerminologyRow
            key={rule.id}
            rule={rule}
            withReplacement
            onChange={(next) =>
              tryPatchLanguage({
                terminology: profile.language.terminology.map((entry) =>
                  entry.id === next.id ? next : entry,
                ),
              })
            }
            onRemove={() =>
              tryPatchLanguage({
                terminology: profile.language.terminology.filter((entry) => entry.id !== rule.id),
              })
            }
          />
        ))}
        <button
          type="button"
          className="tf-link-button"
          onClick={() =>
            tryPatchLanguage({
              terminology: [
                ...profile.language.terminology,
                {
                  id: nextTermId(profile.language.terminology),
                  source: "term",
                  replacement: "term",
                  caseSensitive: false,
                  wholeWord: true,
                  severity: "advisory",
                  scope: {},
                },
              ],
            })
          }
        >
          Add preferred term
        </button>

        {/*
         * The heading is the control's name, so it is wired to it explicitly.
         *
         * This textarea had no accessible name at all — a heading above it is a
         * visual grouping, not a label, and a screen reader announcing "edit text,
         * blank" is a user with no idea which list they are typing into.
         */}
        <h4 className="tf-subheading" id="tf-banned-terms-heading">
          Banned terms
        </h4>
        <p className="tf-sub" id="tf-banned-terms-hint">
          One per line. Flagged, never rewritten.
        </p>
        <textarea
          aria-labelledby="tf-banned-terms-heading"
          aria-describedby="tf-banned-terms-hint"
          rows={4}
          value={formatTermList(profile.language.bannedTerms)}
          onChange={(event) => tryPatchLanguage({ bannedTerms: parseTermList(event.target.value) })}
        />

        <h4 className="tf-subheading">Required terms</h4>
        <p className="tf-sub">
          Words that must appear somewhere in the document. Reported when absent; never inserted
          automatically.
        </p>
        {profile.language.requiredTerms.map((rule) => (
          <TerminologyRow
            key={rule.id}
            rule={rule}
            withReplacement={false}
            onChange={(next) =>
              tryPatchLanguage({
                requiredTerms: profile.language.requiredTerms.map((entry) =>
                  entry.id === next.id ? next : entry,
                ),
              })
            }
            onRemove={() =>
              tryPatchLanguage({
                requiredTerms: profile.language.requiredTerms.filter(
                  (entry) => entry.id !== rule.id,
                ),
              })
            }
          />
        ))}
        <button
          type="button"
          className="tf-link-button"
          onClick={() =>
            tryPatchLanguage({
              requiredTerms: [
                ...profile.language.requiredTerms,
                {
                  id: nextTermId(profile.language.requiredTerms),
                  source: "term",
                  caseSensitive: false,
                  wholeWord: true,
                  severity: "advisory",
                  scope: {},
                },
              ],
            })
          }
        >
          Add required term
        </button>

        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.language.capitalisation.sentenceCase}
            onChange={(event) =>
              patchLanguage({
                capitalisation: {
                  ...profile.language.capitalisation,
                  sentenceCase: event.target.checked,
                },
              })
            }
          />
          <span>Sentences begin with a capital letter</span>
        </label>
        {/*
         * A dropdown, because the locale is now *enforced* (D5).
         *
         * It was a free-text box labelled "recorded, not enforced" — an honest
         * label on a control that changed nothing. It now supplies the default
         * numeric date shape, and a closed set is what makes that possible: a
         * typo in a free-text field would parse cleanly and then match no rule,
         * which is the ND-13 failure wearing a different hat.
         */}
        <label className="tf-field">
          <span>Locale</span>
          <select
            value={profile.language.locale}
            onChange={(event) => tryPatchLanguage({ locale: event.target.value })}
          >
            {LOCALE_OPTIONS.map((locale) => (
              <option key={locale} value={locale}>
                {locale} — dates as {LOCALE_DATE_SHAPES[locale].format}
              </option>
            ))}
          </select>
          <span className="tf-sub">
            Sets the default numeric date shape. A preferred date format set elsewhere always wins.
          </span>
        </label>
        {/*
         * Every language field, with a control.
         *
         * There was a sentence here saying these conventions were set in the House
         * style panel. It was false in four directions: that panel holds terminology,
         * banned terms, title-case words and one sentence-case toggle, and
         * abbreviations, numbers, dates, currency and units had no control *anywhere*
         * in the product. Every rule in those subsections was therefore reading a
         * field no user could reach, so in the running product they all sat at their
         * schema defaults and none of them could fire — including the units-symbol
         * and locale behaviour D4 and D5 just added.
         *
         * The registry audit cannot see this. It can see that a rule *reads* a
         * field; it can never see that a control *writes* one. Which is why the fix
         * is the controls below and not a rewording — and why the sentence had to go
         * either way.
         */}
        <fieldset className="tf-standard-block">
          <legend>Capitalisation</legend>
          <LineListField
            label="Proper nouns (one per line)"
            hint="Always written with a capital letter. Enter a word here and a report will look for it in lower case."
            value={capitalisation.properNouns}
            onChange={(next) => patchCapitalisation({ properNouns: next })}
          />
          <LineListField
            label="Words that must never be capitalised (one per line)"
            hint="Common nouns this house writes in lower case, such as “programme”."
            value={capitalisation.prohibitedCapitalised}
            onChange={(next) => patchCapitalisation({ prohibitedCapitalised: next })}
          />
          <OptionalEnumSelect
            label="Heading case"
            hint="Left unset, headings are not checked at all — which is a different answer from choosing sentence case. A heading is recognised by its paragraph style, so this check does nothing on a non-English Word, where the style is named “Überschrift” rather than “Heading”."
            value={capitalisation.headingCase}
            options={HEADING_CASE_OPTIONS}
            onChange={(next) => setHeadingCase(next as HeadingCase | undefined)}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Abbreviations</legend>
          <PairListField
            label="Approved abbreviations (one “short form: long form” per line)"
            hint="The short forms this house permits, and the expansion each one stands for."
            value={abbreviations.approved}
            nouns={{ subject: "Approved abbreviation", left: "short form", right: "long form" }}
            onChange={(next) => patchAbbreviations({ approved: next })}
          />
          <OptionalEnumSelect
            label="Expansion on first use"
            hint="Left unset, the first use is not checked at all — which is a different answer from deciding it is not required."
            value={
              abbreviations.requireFirstUseExpansion === undefined
                ? undefined
                : abbreviations.requireFirstUseExpansion
                  ? "true"
                  : "false"
            }
            options={FIRST_USE_EXPANSION_OPTIONS}
            onChange={(next) =>
              setFirstUseExpansion(next === undefined ? undefined : next === "true")
            }
          />
          <PairListField
            label="Preferred short form (one “long form: short form” per line)"
            hint="Where the running text should use the short form. The long form is still required once, on first use, if you have asked for an expansion."
            value={abbreviations.preferredExpanded}
            nouns={{ subject: "Preferred short form", left: "long form", right: "short form" }}
            onChange={(next) => patchAbbreviations({ preferredExpanded: next })}
          />
          <LineListField
            label="Forms that must never appear (one per line)"
            hint="Short or long forms this house does not use at all."
            value={abbreviations.prohibitedVariants}
            onChange={(next) => patchAbbreviations({ prohibitedVariants: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Numbers</legend>
          <EnumSelect
            label="Percent sign"
            hint="Whether a percentage carries a space before the sign."
            value={numbers.percentageSpacing}
            options={PERCENTAGE_SPACING_OPTIONS}
            onChange={(next) => patchNumbers({ percentageSpacing: next })}
          />
          <div className="tf-field">
            <label htmlFor="tf-number-word-threshold">Spell out numbers up to</label>
            <input
              id="tf-number-word-threshold"
              aria-describedby="tf-number-word-threshold-hint"
              type="number"
              min={0}
              max={999}
              value={numbers.numberWordThreshold ?? ""}
              onChange={(event) => setNumberWordThreshold(event.target.value)}
            />
            <span className="tf-sub" id="tf-number-word-threshold-hint">
              Left blank, numbers are never spelled out. This is reported only — rewriting “10” as
              “ten” changes the author’s prose, so no correction is offered.
            </span>
          </div>
          <EnumSelect
            label="Negative numbers"
            hint="How a negative figure is written."
            value={numbers.negativeNumber}
            options={NEGATIVE_NUMBER_OPTIONS}
            onChange={(next) => patchNumbers({ negativeNumber: next })}
          />
          <EnumSelect
            label="Ranges"
            hint="What joins the two ends of a range."
            value={numbers.rangeStyle}
            options={RANGE_STYLE_OPTIONS}
            onChange={(next) => patchNumbers({ rangeStyle: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Dates</legend>
          {dates.formats.map((format, index) => (
            <fieldset className="tf-standard-block" key={`date-format-${index}`}>
              <legend>{`Date format ${index + 1}`}</legend>
              {/*
               * Ids are derived from the row index rather than generated by a hook,
               * because a hook cannot be called inside this `map`. `useId` would be
               * the usual answer and would be wrong here.
               */}
              <div className="tf-field">
                <label htmlFor={`tf-date-shape-${index}`}>Shape</label>
                <select
                  id={`tf-date-shape-${index}`}
                  aria-describedby={`tf-date-shape-hint-${index}`}
                  value={format.id}
                  onChange={(event) => patchDateFormat(index, { id: event.target.value })}
                >
                  {DATE_SHAPE_OPTIONS.map(([id, text]) => (
                    <option key={id} value={id}>
                      {text}
                    </option>
                  ))}
                </select>
                <span className="tf-sub" id={`tf-date-shape-hint-${index}`}>
                  The shape the rule recognises in the document. “unrecognised” is not offered: a
                  profile cannot prefer a shape the tool cannot read.
                </span>
              </div>
              <div className="tf-field">
                <label htmlFor={`tf-date-format-${index}`}>Written as</label>
                <input
                  id={`tf-date-format-${index}`}
                  aria-describedby={`tf-date-format-hint-${index}`}
                  type="text"
                  value={format.format}
                  onChange={(event) => patchDateFormat(index, { format: event.target.value })}
                />
                <span className="tf-sub" id={`tf-date-format-hint-${index}`}>
                  For your reference, e.g. DD/MM/YYYY.
                </span>
              </div>
              <label className="tf-field tf-field-inline">
                <input
                  type="radio"
                  name="tf-preferred-date-format"
                  checked={format.preferred}
                  onChange={() => preferDateFormat(index)}
                />
                <span>This is the shape new dates should be written in</span>
              </label>
              <button
                type="button"
                className="tf-link-button"
                onClick={() => removeDateFormat(index)}
              >
                Remove
              </button>
            </fieldset>
          ))}
          <button type="button" className="tf-link-button" onClick={addDateFormat}>
            Add date format
          </button>
          <label className="tf-field tf-field-inline">
            <input
              type="checkbox"
              checked={dates.requireUnambiguous}
              onChange={(event) => patchDates({ requireUnambiguous: event.target.checked })}
            />
            <span>Refuse a date written in a shape that could be read two ways</span>
          </label>
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Currency</legend>
          <EnumSelect
            label="Amounts are written with"
            hint="A symbol, or a three-letter code."
            value={currency.representation}
            options={CURRENCY_REPRESENTATION_OPTIONS}
            onChange={(next) => patchCurrency({ representation: next })}
          />
          <EnumSelect
            label="Between the symbol and the amount"
            value={currency.symbolSpacing}
            options={CURRENCY_SPACING_OPTIONS}
            onChange={(next) => patchCurrency({ symbolSpacing: next })}
          />
          {/*
           * No thousands or decimal separator control here, deliberately.
           *
           * `typography` owns both document-wide, and a second control for the same
           * characters is the two-owners defect ND-2 describes — a house that set
           * `£1,000` here and `1,000` there would get two findings over one comma,
           * and the planner would be entitled to refuse the whole plan. They are set
           * in the Typography panel.
           */}
          <EnumSelect
            label="How large amounts are written"
            hint="Stored as the house’s house rule. Abbreviating a figure changes what it says, so it is reported and never corrected."
            value={currency.magnitude}
            options={CURRENCY_MAGNITUDE_OPTIONS}
            onChange={(next) => patchCurrency({ magnitude: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Units</legend>
          <EnumSelect
            label="Between the value and the unit"
            value={units.valueSpacing}
            options={UNIT_VALUE_SPACING_OPTIONS}
            onChange={(next) => patchUnits({ valueSpacing: next })}
          />
          <EnumSelect
            label="Unit symbols are written in"
            value={units.capitalisation}
            options={UNIT_CAPITALISATION_OPTIONS}
            onChange={(next) => patchUnits({ capitalisation: next })}
          />
          <PairListField
            label="Preferred symbol (one “unit name: symbol” per line)"
            hint="The named unit is what the rule looks for; the symbol is what it wants in its place."
            value={units.symbols}
            nouns={{ subject: "Preferred symbol", left: "unit name", right: "symbol" }}
            onChange={(next) => patchUnits({ symbols: next })}
          />
        </fieldset>

        <p className="tf-sub">
          Typography — dashes, quotes, ellipsis and the spacing conventions — is set in the
          Typography panel above. Every other convention this section governs has a control on this
          page.
        </p>
      </ProfileSection>

      <ProfileSection
        id="typography"
        title="Typography"
        summary="Dashes, quotes, ellipses, and the whitespace and spacing conventions this house prints in."
        supported={capabilities === null ? null : true}
      >
        <p className="tf-sub">
          The individual dash, quote and ellipsis controls are in the Typography panel above; this
          section is the normative summary the rules read.
        </p>
      </ProfileSection>

      <ProfileSection
        id="formatting"
        title="Document formatting"
        summary="The Word style each paragraph kind must carry, and the list, table, header/footer and page-setup standards."
        supported={capabilities === null ? null : true}
        uncheckedStandards={uncheckedStandards}
      >
        <label className="tf-field">
          <span>Body style</span>
          <input
            type="text"
            value={profile.formatting.bodyStyle.styleName}
            onChange={(event) =>
              patchFormatting({
                bodyStyle: { ...profile.formatting.bodyStyle, styleName: event.target.value },
              })
            }
          />
        </label>

        {/*
         * Marked "partly checked" rather than unsupported, because the body style
         * above is always readable. Marking the whole section from
         * `supportsTables` alone claimed the body editor was not checked on a
         * table-less host, which is false, and stayed silent about the table
         * editor on a host that has tables but no sections — also false, and in
         * the direction that produces the false-compliance conclusion.
         */}
        <fieldset className="tf-standard-block">
          <legend>Lists</legend>
          <StyleTextField
            label="List style"
            value={lists?.styleName}
            onChange={(next) => patchLists({ styleName: stringOrUndefined(next) })}
          />
          <NumberField
            label="List level"
            min={0}
            max={8}
            value={lists?.level}
            onChange={(next) => patchLists({ level: numberOrUndefined(next) })}
          />
          <CompareToggle
            what="lists"
            checked={lists?.supported === true}
            onChange={(next) => patchLists({ supported: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Tables</legend>
          <StyleTextField
            label="Table style"
            value={tables?.styleName}
            onChange={(next) => patchTables({ styleName: stringOrUndefined(next) })}
          />
          <StyleTextField
            label="Cell paragraph style"
            value={tables?.cellStyleName}
            onChange={(next) => patchTables({ cellStyleName: stringOrUndefined(next) })}
          />
          <label className="tf-field tf-field-inline">
            <input
              type="checkbox"
              checked={tables?.headerRow === true}
              onChange={(event) =>
                patchTables({ headerRow: event.target.checked ? true : undefined })
              }
            />
            <span>The first row is a header row</span>
          </label>
          <NumberField
            label="Header rows"
            min={0}
            max={10}
            value={tables?.headerRowCount}
            onChange={(next) => patchTables({ headerRowCount: numberOrUndefined(next) })}
          />
          <CompareToggle
            what="tables"
            checked={tables?.supported === true}
            onChange={(next) => patchTables({ supported: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Headers and footers</legend>
          <StyleTextField
            label="Header and footer style"
            value={headersFooters?.styleName}
            onChange={(next) => patchHeadersFooters({ styleName: stringOrUndefined(next) })}
          />
          <label className="tf-field tf-field-inline">
            <input
              type="checkbox"
              checked={headersFooters?.required === true}
              onChange={(event) =>
                patchHeadersFooters({ required: event.target.checked ? true : undefined })
              }
            />
            <span>Every section must have a header and a footer</span>
          </label>
          <CompareToggle
            what="headers and footers"
            checked={headersFooters?.supported === true}
            onChange={(next) => patchHeadersFooters({ supported: next })}
          />
        </fieldset>

        <fieldset className="tf-standard-block">
          <legend>Page setup</legend>
          <label className="tf-field">
            <span>Orientation</span>
            <select
              value={page?.orientation ?? ""}
              onChange={(event) =>
                patchPage({
                  orientation: event.target.value === "" ? undefined : event.target.value,
                })
              }
            >
              <option value="">Not specified</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          {(["top", "bottom", "left", "right"] as const).map((edge) => (
            <NumberField
              key={edge}
              label={`${edge.charAt(0).toUpperCase()}${edge.slice(1)} margin (points)`}
              min={0}
              max={500}
              value={page?.margins?.[edge]}
              onChange={(next) =>
                patchPage({ margins: { ...page?.margins, [edge]: numberOrUndefined(next) } })
              }
            />
          ))}
          <CompareToggle
            what="page setup"
            checked={page?.supported === true}
            onChange={(next) => patchPage({ supported: next })}
          />
        </fieldset>
      </ProfileSection>

      <ProfileSection
        id="structure"
        title="Document structure"
        summary="Whether a skipped heading level or an empty heading is a finding, and how deep the document may nest."
        supported={capabilities === null ? null : true}
      >
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.reportEmptyHeadings}
            onChange={(event) => patchStructure({ reportEmptyHeadings: event.target.checked })}
          />
          <span>Report empty headings</span>
        </label>
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.reportUnknownStyles}
            onChange={(event) => patchStructure({ reportUnknownStyles: event.target.checked })}
          />
          <span>Report styles ToneForge does not recognise</span>
        </label>
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.allowSkippedHeadingLevels}
            onChange={(event) =>
              patchStructure({ allowSkippedHeadingLevels: event.target.checked })
            }
          />
          <span>Allow a skipped heading level</span>
        </label>
      </ProfileSection>
    </div>
  );
}
