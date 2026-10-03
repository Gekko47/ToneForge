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
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
  HeaderFooterStandardSchema,
  LanguageConventionProfileSchema,
  ListFormattingStandardSchema,
  PageStandardSchema,
  TableFormattingStandardSchema,
  type DeterministicStyleProfile,
  type TerminologyRule,
} from "../../core/domain/StyleProfile";
import type { WordCapabilities } from "../../word/capabilityProbe";
import { formatTermList, parseTermList } from "../settings/terminologyText";

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

        <h4 className="tf-subheading">Banned terms</h4>
        <p className="tf-sub">One per line. Flagged, never rewritten.</p>
        <textarea
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
        <label className="tf-field">
          <span>Locale metadata (recorded, not enforced)</span>
          <input
            type="text"
            value={profile.language.locale}
            onChange={(event) => patchLanguage({ locale: event.target.value })}
          />
        </label>
        <p className="tf-sub">
          Abbreviations, and the number, date, currency and unit conventions are set in the House
          style panel; typography is set in the Typography panel. Every field a rule reads has a
          control here or in one of those two.
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
