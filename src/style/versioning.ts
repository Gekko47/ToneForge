/**
 * Profile revision diffing engine.
 *
 * Deterministic helpers for diffing two `StyleProfile` snapshots into a
 * human-readable changelog. Pure functions: no Office.js, no LLM, no UI
 * imports. Revision numbers are assigned by ProfileRecord, so nothing here
 * creates or bumps one.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils`. It must not import `ai`, `word`, or `ui`.
 */

import { type Revision, type StyleProfile } from "../core/domain/StyleProfile";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";

/** A single recorded change between two profile snapshots. */
export interface ProfileChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** Result of comparing two profile snapshots. */
export interface ProfileDiff {
  readonly fromRevision: Revision;
  readonly toRevision: Revision;
  readonly changes: readonly ProfileChange[];
  readonly changedCount: number;
}

export interface GovernanceProfileDiff {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly changes: readonly ProfileChange[];
  readonly changedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => normalize(item));
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (isRecord(current)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (Array.isArray(value)) {
    /*
     * Each item formatted, not the array stringified.
     *
     * `Array.prototype.join` calls `String()` on each element, so a record in
     * the list came out as `[object Object]` — a changelog line reading
     * "colour: [object Object], [object Object] -> colour: [object Object]" for
     * a terminology list that had simply gained a term. The record branch below
     * already formats its values recursively; an array of records needs the same
     * treatment, and `formatValue` is the one function that knows how.
     */
    return value.length === 0 ? "None" : value.map((item: unknown) => formatValue(item)).join(", ");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length === 0
      ? "None"
      : entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(", ");
  }
  return String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/** Fields compared when diffing two profiles. */
const diffFields: readonly { label: string; path: readonly string[] }[] = [
  { label: "Profile name", path: ["name"] },
  /*
   * The sixteen semantic dimensions, each diffed as a whole group.
   *
   * V1 listed its eight flat fields here individually. V2 nests them, so
   * `["semantic", "tone"]` is now an object rather than a string — `formatValue`
   * renders it as a readable line either way, and a per-leaf diff of sixteen
   * groups would emit a changelog nobody reads. `readingGradeTarget`,
   * `vocabularyRegister` and `avoidWords` are gone from this list because V2 has
   * no such fields: the first two are carried in `legacyV1` for display only, and
   * the third became `lexicalPreferences.toneAvoid`. A diff entry for a field
   * that can no longer be edited is a line that can never change.
   */
  { label: "Tone", path: ["semantic", "tone"] },
  { label: "Voice", path: ["semantic", "voice"] },
  { label: "Formality", path: ["semantic", "formality"] },
  { label: "Register", path: ["semantic", "register"] },
  { label: "Assertion style", path: ["semantic", "assertionStyle"] },
  { label: "Qualification style", path: ["semantic", "qualificationStyle"] },
  { label: "Evidence framing", path: ["semantic", "evidenceFraming"] },
  { label: "Uncertainty style", path: ["semantic", "uncertaintyStyle"] },
  { label: "Sentence architecture", path: ["semantic", "sentenceArchitecture"] },
  { label: "Paragraph architecture", path: ["semantic", "paragraphArchitecture"] },
  { label: "Transitions", path: ["semantic", "transitions"] },
  { label: "Agency", path: ["semantic", "agency"] },
  { label: "Technicality", path: ["semantic", "technicality"] },
  { label: "Rhetorical style", path: ["semantic", "rhetoricalStyle"] },
  { label: "Conclusion style", path: ["semantic", "conclusionStyle"] },
  { label: "Lexical preferences", path: ["semantic", "lexicalPreferences"] },
  { label: "Em dash", path: ["typography", "emDash"] },
  { label: "En dash spacing", path: ["typography", "enDashSpacing"] },
  { label: "Double quotes", path: ["typography", "doubleQuotes"] },
  { label: "Single quotes", path: ["typography", "singleQuotes"] },
  { label: "Apostrophes", path: ["typography", "apostrophes"] },
  { label: "Decimal separator", path: ["typography", "decimalSeparator"] },
  { label: "Thousands separator", path: ["typography", "thousandsSeparator"] },
  { label: "Ellipsis", path: ["typography", "ellipsis"] },
  // ND-13: the flat `houseStyle.preferredTerminology` / `houseStyle.bannedTerms`
  // diff entries are gone with the fields. Wording is diffed through the
  // `language` section's own entries below, so a terminology edit still appears
  // in the changelog.
  { label: "Preferred terminology", path: ["language", "terminology"] },
  { label: "Banned terms", path: ["language", "bannedTerms"] },
  /*
   * `houseStyle.capitalization.sentenceCase` was removed here in ADR-0125, and it
   * was the more important of the two changes. A label list is not a declaration:
   * a path left in it produces no error, and the diff engine would go on
   * reporting "Sentence case: true to false" for a field that no longer exists.
   * A user reading that would conclude the product changed a setting it cannot
   * show them.
   */
  { label: "Title-case words", path: ["houseStyle", "capitalization", "titleCaseWords"] },
  /*
   * The spelling variant is the one house-style field deliberately *not* wired
   * to a rule (spec §4.3 removed the scanner; the value stays as metadata). It is
   * listed here so a revision that changes it still reports a change: a field a
   * user can edit and that a revision diff cannot see is indistinguishable from
   * a field the editor never saved. A diff entry is not a claim that a rule
   * reads the field — the opposite, in this case.
   */
  { label: "Spelling variant", path: ["houseStyle", "spellingVariant"] },
  /*
   * The three sections spec section 6 adds, diffed as whole sections rather
   * than field by field.
   *
   * Whole sections deliberately. These are large nested records whose leaves
   * are mostly lists, and a per-leaf diff of a terminology list would emit one
   * line per term — a changelog nobody reads. A reviewer asking "did the house
   * style change" wants one line per section, and the value formatter already
   * summarises a list as its length with its distinct values.
   */
  { label: "Language conventions", path: ["language"] },
  { label: "Document formatting", path: ["formatting"] },
  { label: "Document structure", path: ["structure"] },
];

/**
 * Diff two profile snapshots and produce a changelog of changed fields.
 * Measured metrics are intentionally excluded: they are derived from the
 * captured writing sample and are not user-edited.
 */
export function diffProfiles(from: StyleProfile, to: StyleProfile): ProfileDiff {
  const changes: ProfileChange[] = [];
  diffFields.forEach((field) => {
    const oldValue = readPath(from, field.path);
    const newValue = readPath(to, field.path);
    if (!sameValue(oldValue, newValue)) {
      changes.push({
        field: field.label,
        from: formatValue(oldValue),
        to: formatValue(newValue),
      });
    }
  });
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    changes,
    changedCount: changes.length,
  };
}

/** Diff governance policy fields independently from the wrapped style profile. */
export function diffGovernanceProfiles(
  from: GovernanceProfile,
  to: GovernanceProfile,
): GovernanceProfileDiff {
  const changes: ProfileChange[] = [];
  const fields: readonly { label: string; path: readonly string[] }[] = [
    { label: "Policy revision", path: ["version"] },
    { label: "Rules", path: ["rules"] },
    { label: "Terminology", path: ["terminology"] },
    { label: "Scope", path: ["scope"] },
    { label: "Protection", path: ["protection"] },
    { label: "Editorial policy", path: ["editorial"] },
  ];
  fields.forEach((field) => {
    const oldValue = readPath(from, field.path);
    const newValue = readPath(to, field.path);
    if (!sameValue(oldValue, newValue)) {
      changes.push({ field: field.label, from: formatValue(oldValue), to: formatValue(newValue) });
    }
  });
  return {
    fromRevision: from.version,
    toRevision: to.version,
    changes,
    changedCount: changes.length,
  };
}

/** Format a governance policy diff as a plain-text changelog. */
export function formatGovernanceChangelog(diff: GovernanceProfileDiff): string {
  if (diff.changedCount === 0) {
    return `No governance policy changes between revisions ${diff.fromRevision} and ${diff.toRevision}.`;
  }
  return [
    `Governance policy changes from revision ${diff.fromRevision} to ${diff.toRevision}:`,
    ...diff.changes.map((change) => `- ${change.field}: ${change.from} -> ${change.to}`),
  ].join("\n");
}

/** Format a profile diff as a plain-text changelog. */
export function formatChangelog(diff: ProfileDiff): string {
  if (diff.changedCount === 0) {
    return `No changes between revision ${diff.fromRevision} and revision ${diff.toRevision}.`;
  }
  const lines = [
    `Profile changes from revision ${diff.fromRevision} to revision ${diff.toRevision}:`,
  ];
  diff.changes.forEach((change) => {
    lines.push(`- ${change.field}: ${change.from} -> ${change.to}`);
  });
  return lines.join("\n");
}
