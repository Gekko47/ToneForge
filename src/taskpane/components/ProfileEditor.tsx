import React from "react";
import {
  ComboBox,
  DefaultButton,
  Dropdown,
  type IComboBoxOption,
  type IDropdownOption,
  MessageBar,
  MessageBarType,
  PrimaryButton,
  TextField,
  Toggle,
} from "@fluentui/react";
import {
  createEmptyProfile,
  StyleProfileSchema,
  type HouseStyle,
  type ProfileVersion,
  type StyleProfile,
  type TypographyRules,
} from "../../core/domain/StyleProfile";
import { loadState, setActiveProfile, upsertProfile } from "../../core/state/index";
import { bumpProfileVersion, diffProfiles, type BumpType } from "../../style/versioning";
import VersionDiff from "./VersionDiff";

interface ProfileFormValues {
  name: string;
  tone: string;
  voice: string;
  formality: string;
  readingGradeTarget: string;
  preferredSentenceLength: string;
  vocabularyRegister: SemanticProfile["vocabularyRegister"];
  rhetoricalStyle: string;
  avoidWords: string;
  emDash: TypographyRules["emDash"];
  emDashSpacing: TypographyRules["emDashSpacing"];
  enDashSpacing: TypographyRules["enDashSpacing"];
  doubleQuotes: TypographyRules["doubleQuotes"];
  singleQuotes: TypographyRules["singleQuotes"];
  apostrophes: TypographyRules["apostrophes"];
  decimalSeparator: TypographyRules["decimalSeparator"];
  thousandsSeparator: TypographyRules["thousandsSeparator"];
  ellipsis: TypographyRules["ellipsis"];
  preferredTerminology: string;
  bannedTerms: string;
  capitalizationSentenceCase: boolean;
  titleCaseWords: string;
  spellingVariant: HouseStyle["spellingVariant"];
}

interface ProfileEditorState {
  baseProfile: StyleProfile;
  draftBaseProfile: StyleProfile;
  savedProfile: StyleProfile | null;
  profiles: StyleProfile[];
  history: StyleProfile[];
  values: ProfileFormValues;
  dirty: boolean;
  savedAt: string | null;
  fieldErrors: Record<string, string>;
  error: string | null;
}

interface ProfileValidation {
  candidate: StyleProfile;
  profile: StyleProfile | null;
  errors: Record<string, string>;
}

interface TerminologyParse {
  values: Record<string, string>;
  error: string | null;
}

type SemanticProfile = StyleProfile["semantic"];

const sectionStyle: React.CSSProperties = {
  border: "1px solid #edebe9",
  borderRadius: 4,
  marginBottom: 20,
  padding: 16,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 20,
  margin: "0 0 12px",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const measuredGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "8px 24px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  margin: 0,
};

const buttonStyle: React.CSSProperties = {
  marginTop: 16,
};

const vocabularyRegisters = ["simple", "standard", "technical", "academic"] as const;
const spellingVariants = ["en-US", "en-GB", "au"] as const;
const toneSuggestions = [
  "neutral",
  "formal",
  "conversational",
  "friendly",
  "authoritative",
  "empathetic",
  "persuasive",
  "instructional",
] as const;
const voiceSuggestions = ["first-person", "second-person", "third-person", "impersonal"] as const;
const rhetoricalStyleSuggestions = [
  "direct",
  "narrative",
  "analytical",
  "descriptive",
  "argumentative",
  "explanatory",
] as const;

function dropdownValue(option: IDropdownOption | undefined): string | null {
  return option && typeof option.key === "string" ? option.key : null;
}

function comboBoxOptions(values: readonly string[]): IComboBoxOption[] {
  return values.map((value) => ({ key: value, text: value }));
}

function comboBoxValue(option: IComboBoxOption | undefined, value: string | undefined): string {
  return value ?? (option && typeof option.key === "string" ? option.key : "");
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseTerminology(value: string): TerminologyParse {
  const values: Record<string, string> = {};
  const lines = value.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      return {
        values,
        error: `Terminology line ${index + 1} must use "term: replacement".`,
      };
    }
    const term = line.slice(0, separatorIndex).trim();
    const replacement = line.slice(separatorIndex + 1).trim();
    if (term.length === 0 || replacement.length === 0) {
      return {
        values,
        error: `Terminology line ${index + 1} needs both a term and a replacement.`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(values, term)) {
      return {
        values,
        error: `Terminology term "${term}" is listed more than once.`,
      };
    }
    values[term] = replacement;
  }
  return { values, error: null };
}

function numberOrNaN(value: string): number {
  return value.trim().length === 0 ? Number.NaN : Number(value.trim());
}

function nullableNumber(value: string): number | null {
  return value.trim().length === 0 ? null : Number(value.trim());
}

function profileToValues(profile: StyleProfile): ProfileFormValues {
  return {
    name: profile.name,
    tone: profile.semantic.tone,
    voice: profile.semantic.voice,
    formality: String(profile.semantic.formality),
    readingGradeTarget:
      profile.semantic.readingGradeTarget === null
        ? ""
        : String(profile.semantic.readingGradeTarget),
    preferredSentenceLength: String(profile.semantic.preferredSentenceLength),
    vocabularyRegister: profile.semantic.vocabularyRegister,
    rhetoricalStyle: profile.semantic.rhetoricalStyle,
    avoidWords: profile.semantic.avoidWords.join("\n"),
    emDash: profile.typography.emDash,
    emDashSpacing: profile.typography.emDashSpacing,
    enDashSpacing: profile.typography.enDashSpacing,
    doubleQuotes: profile.typography.doubleQuotes,
    singleQuotes: profile.typography.singleQuotes,
    apostrophes: profile.typography.apostrophes,
    decimalSeparator: profile.typography.decimalSeparator,
    thousandsSeparator: profile.typography.thousandsSeparator,
    ellipsis: profile.typography.ellipsis,
    preferredTerminology: Object.entries(profile.houseStyle.preferredTerminology)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([term, replacement]) => `${term}: ${replacement}`)
      .join("\n"),
    bannedTerms: profile.houseStyle.bannedTerms.join("\n"),
    capitalizationSentenceCase: profile.houseStyle.capitalization.sentenceCase,
    titleCaseWords: profile.houseStyle.capitalization.titleCaseWords.join("\n"),
    spellingVariant: profile.houseStyle.spellingVariant,
  };
}

function buildCandidate(values: ProfileFormValues, baseProfile: StyleProfile): StyleProfile {
  const terminology = parseTerminology(values.preferredTerminology);
  return {
    ...baseProfile,
    name: values.name,
    semantic: {
      tone: values.tone,
      voice: values.voice,
      formality: numberOrNaN(values.formality),
      readingGradeTarget: nullableNumber(values.readingGradeTarget),
      preferredSentenceLength: numberOrNaN(values.preferredSentenceLength),
      vocabularyRegister: values.vocabularyRegister,
      rhetoricalStyle: values.rhetoricalStyle,
      avoidWords: parseLines(values.avoidWords),
    },
    typography: {
      emDash: values.emDash,
      emDashSpacing: values.emDashSpacing,
      enDashSpacing: values.enDashSpacing,
      doubleQuotes: values.doubleQuotes,
      singleQuotes: values.singleQuotes,
      apostrophes: values.apostrophes,
      decimalSeparator: values.decimalSeparator,
      thousandsSeparator: values.thousandsSeparator,
      ellipsis: values.ellipsis,
    },
    houseStyle: {
      preferredTerminology: terminology.values,
      bannedTerms: parseLines(values.bannedTerms),
      capitalization: {
        sentenceCase: values.capitalizationSentenceCase,
        titleCaseWords: parseLines(values.titleCaseWords),
      },
      spellingVariant: values.spellingVariant,
    },
  };
}

function fieldFromPath(path: readonly (string | number)[]): string {
  const [section, field, nestedField] = path;
  if (section === "houseStyle" && field === "capitalization" && nestedField !== undefined) {
    return `capitalization.${String(nestedField)}`;
  }
  return path.map(String).join(".");
}

function validateValues(values: ProfileFormValues, baseProfile: StyleProfile): ProfileValidation {
  const terminology = parseTerminology(values.preferredTerminology);
  const candidate = buildCandidate(values, baseProfile);
  const errors: Record<string, string> = {};
  if (terminology.error) {
    errors["houseStyle.preferredTerminology"] = terminology.error;
  }

  const result = StyleProfileSchema.safeParse(candidate);
  if (!result.success) {
    result.error.issues.forEach((issue) => {
      const field = fieldFromPath(issue.path);
      if (!errors[field]) {
        errors[field] = issue.message;
      }
    });
  }

  return {
    candidate,
    profile: result.success ? result.data : null,
    errors,
  };
}

function initialContext(): ProfileEditorState {
  const state = loadState();
  const profile =
    state.profiles.find((item: StyleProfile) => item.id === state.activeProfileId) ??
    state.profiles[0] ??
    createEmptyProfile("Untitled style profile");
  const persisted =
    state.profiles.find((item: StyleProfile) => item.id === state.activeProfileId) ??
    state.profiles[0] ??
    null;

  return {
    baseProfile: profile,
    draftBaseProfile: profile,
    savedProfile: persisted,
    profiles: state.profiles,
    history: persisted ? (state.profileHistory[persisted.id] ?? [persisted]) : [],
    values: profileToValues(profile),
    dirty: false,
    savedAt: null,
    fieldErrors: {},
    error: null,
  };
}

function formatMetric(value: number | null): string {
  if (value === null) {
    return "Not available";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function sameSnapshot(left: StyleProfile, right: StyleProfile): boolean {
  return JSON.stringify({ ...left, updatedAt: "" }) === JSON.stringify({ ...right, updatedAt: "" });
}

function sameEditableSnapshot(left: StyleProfile, right: StyleProfile): boolean {
  return diffProfiles(left, right).changedCount === 0;
}

function sameVersion(left: ProfileVersion, right: ProfileVersion): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

function appendSnapshot(history: readonly StyleProfile[], profile: StyleProfile): StyleProfile[] {
  const latest = history[history.length - 1];
  return latest && sameSnapshot(latest, profile) ? [...history] : [...history, profile];
}

function appendHistory(
  history: readonly StyleProfile[],
  previous: StyleProfile,
  next: StyleProfile,
): StyleProfile[] {
  const withPrevious = appendSnapshot(history, previous);
  const latest = withPrevious[withPrevious.length - 1];
  return latest && sameSnapshot(latest, next) ? withPrevious : [...withPrevious, next];
}

function option(key: string, text: string): IDropdownOption {
  return { key, text };
}

function formatVersionLabel(version: ProfileVersion): string {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export default function ProfileEditor(): React.ReactNode {
  const [context, setContext] = React.useState<ProfileEditorState>(initialContext);
  const { baseProfile, savedProfile, profiles, history, values, savedAt, fieldErrors, error } =
    context;
  const validation = validateValues(values, baseProfile);
  const draftProfile = validation.profile ?? validation.candidate;
  const derivedDirty = !sameEditableSnapshot(draftProfile, savedProfile ?? baseProfile);

  function patch(partial: Partial<ProfileFormValues>): void {
    setContext((prev) => {
      const nextValues = { ...prev.values, ...partial };
      const nextValidation = validateValues(nextValues, prev.baseProfile);
      const nextDraft = nextValidation.profile ?? nextValidation.candidate;
      const nextDirty = !sameEditableSnapshot(nextDraft, prev.savedProfile ?? prev.baseProfile);
      return {
        ...prev,
        values: nextValues,
        dirty: nextDirty,
        savedAt: null,
        error: null,
        fieldErrors: nextValidation.errors,
      };
    });
  }

  function reset(): void {
    setContext((prev) => ({
      ...prev,
      baseProfile: prev.draftBaseProfile,
      values: profileToValues(prev.draftBaseProfile),
      dirty: false,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function createNewProfile(): void {
    const profile = createEmptyProfile("Untitled style profile");
    setContext((prev) => ({
      ...prev,
      baseProfile: profile,
      draftBaseProfile: profile,
      savedProfile: null,
      profiles: [...prev.profiles, profile],
      history: [],
      values: profileToValues(profile),
      dirty: false,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function bumpVersion(type: BumpType): void {
    setContext((prev) => ({
      ...prev,
      baseProfile: {
        ...prev.baseProfile,
        version: bumpProfileVersion(prev.baseProfile.version, type),
      },
      dirty: true,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function selectProfile(profileId: string): void {
    const selected = profiles.find((item) => item.id === profileId);
    if (!selected) {
      return;
    }
    setActiveProfile(selected.id);
    const state = loadState();
    const nextHistory = state.profileHistory[selected.id] ?? [selected];
    setContext((prev) => ({
      ...prev,
      baseProfile: selected,
      draftBaseProfile: selected,
      savedProfile: selected,
      history: nextHistory,
      values: profileToValues(selected),
      dirty: false,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function restoreHistorySnapshot(snapshot: StyleProfile): void {
    setContext((prev) => ({
      ...prev,
      baseProfile: snapshot,
      draftBaseProfile: snapshot,
      values: profileToValues(snapshot),
      dirty: !sameEditableSnapshot(snapshot, prev.savedProfile ?? prev.baseProfile),
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function save(): void {
    if (!validation.profile) {
      setContext((prev) => ({
        ...prev,
        error: "Resolve the profile validation errors before saving.",
      }));
      return;
    }

    const contentChanged = !sameEditableSnapshot(validation.profile, context.draftBaseProfile);
    const versionChanged = !sameVersion(
      validation.profile.version,
      context.draftBaseProfile.version,
    );

    if (!contentChanged && !versionChanged) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const shouldAutoPatch = contentChanged && !versionChanged && savedProfile !== null;
    const profile: StyleProfile = shouldAutoPatch
      ? {
          ...validation.profile,
          version: bumpProfileVersion(validation.profile.version, "patch"),
          updatedAt,
        }
      : { ...validation.profile, updatedAt };

    upsertProfile(profile);
    setActiveProfile(profile.id);

    const nextHistory = savedProfile
      ? appendHistory(history, savedProfile, profile)
      : appendSnapshot(history, profile);
    setContext((prev) => ({
      ...prev,
      baseProfile: profile,
      draftBaseProfile: profile,
      savedProfile: profile,
      profiles: prev.savedProfile
        ? prev.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...prev.profiles, profile],
      history: nextHistory,
      values: profileToValues(profile),
      dirty: false,
      savedAt: updatedAt,
      fieldErrors: {},
      error: null,
    }));
  }

  function renderMessageBar(): React.ReactNode {
    if (error) {
      return (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          <span data-testid="profile-editor-error">{error}</span>
        </MessageBar>
      );
    }
    if (savedAt) {
      return (
        <MessageBar messageBarType={MessageBarType.success} role="status" aria-live="polite">
          <span data-testid="profile-editor-success">Profile saved.</span>
        </MessageBar>
      );
    }
    return null;
  }

  const version = baseProfile.version;
  const versionLabel = formatVersionLabel(version);
  const hasHistory = history.length > 0;
  const historyCount = history.length;

  return (
    <div className="tf-card">
      <h1 className="tf-title">Style Profile</h1>
      <p className="tf-sub">
        Edit the active profile. Measured metrics are read-only because they are derived from the
        captured writing sample.
      </p>

      {renderMessageBar()}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <Dropdown
          label="Saved profiles"
          selectedKey={baseProfile.id}
          options={profiles.map((item) => ({
            key: item.id,
            text: `${item.name} ${formatVersionLabel(item.version)}`,
          }))}
          onChange={(_event, optionValue) => {
            const nextValue = dropdownValue(optionValue);
            if (nextValue) {
              selectProfile(nextValue);
            }
          }}
        />
        <TextField
          label="Profile name"
          required
          value={values.name}
          errorMessage={fieldErrors.name ?? ""}
          onChange={(_event, value) => patch({ name: value ?? "" })}
        />
        <TextField label="Version" disabled readOnly value={versionLabel} />
      </div>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "flex-end" }}
      >
        <DefaultButton text="Major" onClick={() => bumpVersion("major")} />
        <DefaultButton text="Minor" onClick={() => bumpVersion("minor")} />
        <DefaultButton text="Patch" onClick={() => bumpVersion("patch")} />
        <span className="tf-sub" style={{ padding: "6px 0" }}>
          {hasHistory
            ? `${historyCount} historical snapshot(s) recorded.`
            : "No historical snapshots yet — save to record the first baseline."}
        </span>
      </div>
      {hasHistory && (
        <details style={{ marginTop: 12 }}>
          <summary className="tf-sub">Version history</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {history.map((snapshot, index) => (
              <li key={`${snapshot.id}-${snapshot.updatedAt}-${index}`}>
                {formatVersionLabel(snapshot.version)} —{" "}
                {new Date(snapshot.updatedAt).toLocaleString()}{" "}
                <DefaultButton
                  text={`Restore ${formatVersionLabel(snapshot.version)}`}
                  onClick={() => restoreHistorySnapshot(snapshot)}
                />
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="measured-heading" style={sectionStyle}>
        <h2 id="measured-heading" style={sectionHeadingStyle}>
          Measured style
        </h2>
        <dl style={measuredGridStyle}>
          <div>
            <dt>Average sentence length</dt>
            <dd>{formatMetric(baseProfile.measured.avgSentenceLength)}</dd>
          </div>
          <div>
            <dt>Sentence length standard deviation</dt>
            <dd>{formatMetric(baseProfile.measured.sentenceLengthStdDev)}</dd>
          </div>
          <div>
            <dt>Em dash frequency / 100 words</dt>
            <dd>{formatMetric(baseProfile.measured.emDashFrequency)}</dd>
          </div>
          <div>
            <dt>En dash frequency / 100 words</dt>
            <dd>{formatMetric(baseProfile.measured.enDashFrequency)}</dd>
          </div>
          <div>
            <dt>Curly quote frequency / 100 words</dt>
            <dd>{formatMetric(baseProfile.measured.curlyQuoteFrequency)}</dd>
          </div>
          <div>
            <dt>Average paragraph length</dt>
            <dd>{formatMetric(baseProfile.measured.paragraphLengthAvg)}</dd>
          </div>
          <div>
            <dt>Capitalization consistency</dt>
            <dd>{formatMetric(baseProfile.measured.capitalizationConsistency)}</dd>
          </div>
          <div>
            <dt>Sample word count</dt>
            <dd>{formatMetric(baseProfile.measured.sampleWordCount)}</dd>
          </div>
        </dl>
        <p className="tf-sub">
          {baseProfile.sourceSampleIds.length === 0
            ? "No source samples are linked to this profile."
            : `${baseProfile.sourceSampleIds.length} source sample(s) linked.`}
        </p>
      </section>

      <section aria-labelledby="semantic-heading" style={sectionStyle}>
        <h2 id="semantic-heading" style={sectionHeadingStyle}>
          Semantic style
        </h2>
        <div style={gridStyle}>
          <ComboBox
            label="Tone"
            required
            text={values.tone}
            allowFreeform
            autoComplete="on"
            options={comboBoxOptions(toneSuggestions)}
            errorMessage={fieldErrors["semantic.tone"] ?? ""}
            onInputValueChange={(value) => patch({ tone: value ?? "" })}
            onChange={(_event, optionValue, _index, value) =>
              patch({ tone: comboBoxValue(optionValue, value) })
            }
          />
          <ComboBox
            label="Voice"
            required
            text={values.voice}
            allowFreeform
            autoComplete="on"
            options={comboBoxOptions(voiceSuggestions)}
            errorMessage={fieldErrors["semantic.voice"] ?? ""}
            onInputValueChange={(value) => patch({ voice: value ?? "" })}
            onChange={(_event, optionValue, _index, value) =>
              patch({ voice: comboBoxValue(optionValue, value) })
            }
          />
          <TextField
            label="Formality (0–100)"
            required
            type="number"
            value={values.formality}
            errorMessage={fieldErrors["semantic.formality"] ?? ""}
            onChange={(_event, value) => patch({ formality: value ?? "" })}
          />
          <TextField
            label="Reading grade target (0–20, optional)"
            type="number"
            value={values.readingGradeTarget}
            errorMessage={fieldErrors["semantic.readingGradeTarget"] ?? ""}
            onChange={(_event, value) => patch({ readingGradeTarget: value ?? "" })}
          />
          <TextField
            label="Preferred sentence length (5–60)"
            required
            type="number"
            value={values.preferredSentenceLength}
            errorMessage={fieldErrors["semantic.preferredSentenceLength"] ?? ""}
            onChange={(_event, value) => patch({ preferredSentenceLength: value ?? "" })}
          />
          <Dropdown
            label="Vocabulary register"
            selectedKey={values.vocabularyRegister}
            options={vocabularyRegisters.map((value) => option(value, value))}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue) {
                patch({ vocabularyRegister: nextValue as ProfileFormValues["vocabularyRegister"] });
              }
            }}
          />
          <ComboBox
            label="Rhetorical style"
            required
            text={values.rhetoricalStyle}
            allowFreeform
            autoComplete="on"
            options={comboBoxOptions(rhetoricalStyleSuggestions)}
            errorMessage={fieldErrors["semantic.rhetoricalStyle"] ?? ""}
            onInputValueChange={(value) => patch({ rhetoricalStyle: value ?? "" })}
            onChange={(_event, optionValue, _index, value) =>
              patch({ rhetoricalStyle: comboBoxValue(optionValue, value) })
            }
          />
          <TextField
            label="Avoid words (one per line)"
            multiline
            rows={4}
            value={values.avoidWords}
            errorMessage={fieldErrors["semantic.avoidWords"] ?? ""}
            onChange={(_event, value) => patch({ avoidWords: value ?? "" })}
          />
        </div>
      </section>

      <section aria-labelledby="typography-heading" style={sectionStyle}>
        <h2 id="typography-heading" style={sectionHeadingStyle}>
          Typography
        </h2>
        <div style={gridStyle}>
          <Dropdown
            label="Em dash"
            selectedKey={values.emDash}
            options={[
              option("em", "Em dash (—)"),
              option("hyphen", "Double hyphen (-- )"),
              option("space", "Space"),
            ]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue) patch({ emDash: nextValue as ProfileFormValues["emDash"] });
            }}
          />
          <Dropdown
            label="Em dash spacing"
            selectedKey={values.emDashSpacing}
            options={[option("spaced", "Spaced"), option("tight", "Tight")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ emDashSpacing: nextValue as ProfileFormValues["emDashSpacing"] });
            }}
          />
          <Dropdown
            label="En dash spacing"
            selectedKey={values.enDashSpacing}
            options={[option("spaced", "Spaced"), option("tight", "Tight")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ enDashSpacing: nextValue as ProfileFormValues["enDashSpacing"] });
            }}
          />
          <Dropdown
            label="Double quotes"
            selectedKey={values.doubleQuotes}
            options={[option("curly", "Curly"), option("straight", "Straight")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ doubleQuotes: nextValue as ProfileFormValues["doubleQuotes"] });
            }}
          />
          <Dropdown
            label="Single quotes"
            selectedKey={values.singleQuotes}
            options={[option("curly", "Curly"), option("straight", "Straight")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ singleQuotes: nextValue as ProfileFormValues["singleQuotes"] });
            }}
          />
          <Dropdown
            label="Apostrophes"
            selectedKey={values.apostrophes}
            options={[option("curly", "Curly"), option("straight", "Straight")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue) patch({ apostrophes: nextValue as ProfileFormValues["apostrophes"] });
            }}
          />
          <Dropdown
            label="Decimal separator"
            selectedKey={values.decimalSeparator}
            options={[option("dot", "Dot"), option("comma", "Comma")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ decimalSeparator: nextValue as ProfileFormValues["decimalSeparator"] });
            }}
          />
          <Dropdown
            label="Thousands separator"
            selectedKey={values.thousandsSeparator}
            options={[option("none", "None"), option("space", "Space"), option("comma", "Comma")]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ thousandsSeparator: nextValue as ProfileFormValues["thousandsSeparator"] });
            }}
          />
          <Dropdown
            label="Ellipsis"
            selectedKey={values.ellipsis}
            options={[
              option("ellipsis", "Single character (… )"),
              option("three-dots", "Three dots (... )"),
              option("spaced-dots", "Spaced dots (. . .)"),
            ]}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue) patch({ ellipsis: nextValue as ProfileFormValues["ellipsis"] });
            }}
          />
        </div>
      </section>

      <section aria-labelledby="house-style-heading" style={sectionStyle}>
        <h2 id="house-style-heading" style={sectionHeadingStyle}>
          House style
        </h2>
        <div style={gridStyle}>
          <TextField
            label="Preferred terminology (one “term: replacement” per line)"
            multiline
            rows={5}
            value={values.preferredTerminology}
            errorMessage={fieldErrors["houseStyle.preferredTerminology"] ?? ""}
            onChange={(_event, value) => patch({ preferredTerminology: value ?? "" })}
          />
          <TextField
            label="Banned terms (one per line)"
            multiline
            rows={4}
            value={values.bannedTerms}
            errorMessage={fieldErrors["houseStyle.bannedTerms"] ?? ""}
            onChange={(_event, value) => patch({ bannedTerms: value ?? "" })}
          />
          <TextField
            label="Title-case words (one per line)"
            multiline
            rows={4}
            value={values.titleCaseWords}
            errorMessage={fieldErrors["capitalization.titleCaseWords"] ?? ""}
            onChange={(_event, value) => patch({ titleCaseWords: value ?? "" })}
          />
          <Dropdown
            label="Spelling variant"
            selectedKey={values.spellingVariant}
            options={spellingVariants.map((value) => option(value, value))}
            onChange={(_event, optionValue) => {
              const nextValue = dropdownValue(optionValue);
              if (nextValue)
                patch({ spellingVariant: nextValue as ProfileFormValues["spellingVariant"] });
            }}
          />
          <Toggle
            label="Use sentence case by default"
            checked={values.capitalizationSentenceCase}
            onText="Sentence case on"
            offText="Sentence case off"
            onChange={(_event, value) => patch({ capitalizationSentenceCase: value ?? false })}
          />
        </div>
      </section>

      <VersionDiff savedProfile={savedProfile} currentProfile={validation.profile} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <PrimaryButton
          text="Save profile"
          onClick={save}
          disabled={!derivedDirty}
          style={buttonStyle}
        />
        <DefaultButton
          text="Reset changes"
          onClick={reset}
          disabled={!derivedDirty}
          style={buttonStyle}
        />
        <DefaultButton text="New profile" onClick={createNewProfile} style={buttonStyle} />
      </div>
    </div>
  );
}
