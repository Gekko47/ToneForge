import React from "react";
import type { StyleProfile } from "../../core/domain/StyleProfile";

interface DiffField {
  label: string;
  path: readonly string[];
}

const diffFields: readonly DiffField[] = [
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

interface VersionDiffProps {
  savedProfile: StyleProfile | null;
  currentProfile: StyleProfile | null;
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

function readPath(profile: StyleProfile, path: readonly string[]): unknown {
  return path.reduce<unknown>((value, key) => {
    if (isRecord(value)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, profile);
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

function diffNotice(message: string): React.ReactNode {
  return (
    <p className="tf-sub" role="status" aria-live="polite" data-testid="version-diff-message-text">
      {message}
    </p>
  );
}

export default function VersionDiff({
  savedProfile,
  currentProfile,
}: VersionDiffProps): React.ReactNode {
  if (!savedProfile) {
    return diffNotice("Save this profile to establish a baseline for change previews.");
  }

  if (!currentProfile) {
    return diffNotice("Resolve validation errors to preview profile changes.");
  }

  const changes = diffFields.filter(
    (field: DiffField) =>
      !sameValue(readPath(savedProfile, field.path), readPath(currentProfile, field.path)),
  );

  if (changes.length === 0) {
    return diffNotice("No unsaved profile changes.");
  }

  return (
    <section aria-labelledby="version-diff-heading" aria-live="polite">
      <h2 id="version-diff-heading">Unsaved profile changes</h2>
      <p className="tf-sub">
        This preview compares the current draft with the last saved profile. Persistent version
        history and version bumps are introduced in Stage 12.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Last saved</th>
            <th scope="col">Current draft</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((field: DiffField) => (
            <tr key={field.label}>
              <th scope="row">{field.label}</th>
              <td>{formatValue(readPath(savedProfile, field.path))}</td>
              <td>{formatValue(readPath(currentProfile, field.path))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
