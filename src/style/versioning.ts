/**
 * Profile versioning engine.
 *
 * Deterministic helpers for bumping `ProfileVersion` and diffing two
 * `StyleProfile` instances into a human-readable changelog. Pure functions:
 * no Office.js, no LLM, no UI imports.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils`. It must not import `ai`, `word`, or `ui`.
 */

import { type ProfileVersion, type StyleProfile } from "../core/domain/StyleProfile";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";

/** Bump types supported by `bumpProfileVersion`. */
export type BumpType = "major" | "minor" | "patch";

/** A single recorded change between two profile snapshots. */
export interface ProfileChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** Result of comparing two profiles. */
export interface ProfileDiff {
  readonly fromVersion: ProfileVersion;
  readonly toVersion: ProfileVersion;
  readonly changes: readonly ProfileChange[];
  readonly changedCount: number;
}

export interface GovernanceProfileDiff {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly changes: readonly ProfileChange[];
  readonly changedCount: number;
}

/** Bump a version according to semantic-versioning rules. */
export function bumpProfileVersion(version: ProfileVersion, type: BumpType): ProfileVersion {
  switch (type) {
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "patch":
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
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
    return value.length === 0 ? "None" : value.join(", ");
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
  { label: "Version", path: ["version"] },
  { label: "Profile name", path: ["name"] },
  { label: "Tone", path: ["semantic", "tone"] },
  { label: "Voice", path: ["semantic", "voice"] },
  { label: "Formality", path: ["semantic", "formality"] },
  { label: "Reading grade target", path: ["semantic", "readingGradeTarget"] },
  { label: "Preferred sentence length", path: ["semantic", "preferredSentenceLength"] },
  { label: "Vocabulary register", path: ["semantic", "vocabularyRegister"] },
  { label: "Rhetorical style", path: ["semantic", "rhetoricalStyle"] },
  { label: "Avoid words", path: ["semantic", "avoidWords"] },
  { label: "Em dash", path: ["typography", "emDash"] },
  { label: "Em dash spacing", path: ["typography", "emDashSpacing"] },
  { label: "En dash spacing", path: ["typography", "enDashSpacing"] },
  { label: "Double quotes", path: ["typography", "doubleQuotes"] },
  { label: "Single quotes", path: ["typography", "singleQuotes"] },
  { label: "Apostrophes", path: ["typography", "apostrophes"] },
  { label: "Decimal separator", path: ["typography", "decimalSeparator"] },
  { label: "Thousands separator", path: ["typography", "thousandsSeparator"] },
  { label: "Ellipsis", path: ["typography", "ellipsis"] },
  { label: "Preferred terminology", path: ["houseStyle", "preferredTerminology"] },
  { label: "Banned terms", path: ["houseStyle", "bannedTerms"] },
  { label: "Sentence case", path: ["houseStyle", "capitalization", "sentenceCase"] },
  { label: "Title-case words", path: ["houseStyle", "capitalization", "titleCaseWords"] },
  { label: "Spelling variant", path: ["houseStyle", "spellingVariant"] },
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
    fromVersion: from.version,
    toVersion: to.version,
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
    return `No changes between v${formatVersion(diff.fromVersion)} and v${formatVersion(diff.toVersion)}.`;
  }
  const lines = [
    `Profile changes from v${formatVersion(diff.fromVersion)} to v${formatVersion(diff.toVersion)}:`,
  ];
  diff.changes.forEach((change) => {
    lines.push(`- ${change.field}: ${change.from} -> ${change.to}`);
  });
  return lines.join("\n");
}

function formatVersion(version: ProfileVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
