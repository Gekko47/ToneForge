import React from "react";
import {
  DefaultButton,
  Dropdown,
  type IDropdownOption,
  MessageBar,
  MessageBarType,
  PrimaryButton,
  TextField,
  Toggle,
} from "@fluentui/react";
import type { DeterministicStyleProfile } from "../../core/domain/StyleProfile";
import {
  createEmptyProfile,
  formatRevision,
  StyleProfileSchema,
  type HouseStyle,
  type Revision,
  type StyleProfile,
  type TerminologyRule,
  type TypographyRules,
} from "../../core/domain/StyleProfile";
import {
  createProfileRecord,
  loadProfileRecord,
  loadState,
  saveProfileRecord,
  setActiveProfile,
} from "../../core/state/index";
import { effectiveProfile, updateDraft, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { selectAllProfiles } from "../../core/state/profileSelectors";
import { diffProfiles } from "../../style/versioning";
import VersionDiff from "./VersionDiff";
import DeterministicStyleSections from "./DeterministicStyleSections";
import { parseTerminology } from "../settings/terminologyText";
import type { WordCapabilities } from "../../word/capabilityProbe";

/**
 * The deterministic style fields this editor owns.
 *
 * There is deliberately no `semantic` here. This tab is the deterministic style
 * profile; semantic style is authored on the Semantic tab. `buildCandidate`
 * carries `baseProfile.semantic` through untouched rather than rebuilding it,
 * so editing a dash rule cannot silently reset the profile's learned tone and
 * voice to whatever a hidden form field happened to hold.
 */
interface ProfileFormValues {
  name: string;
  emDash: TypographyRules["emDash"];
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
  /** Editable draft this editor is bound to, when the profile has a record. */
  recordId: string | null;
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

// The `term: replacement` parser lives in `settings/terminologyText` so the
// governance policy editor cannot ship a second, subtly different one.

/*
 * The four layout objects that used to live here are gone (S6).
 *
 * `sectionStyle` and `sectionHeadingStyle` were the D-5 defect in miniature: an
 * inline `fontSize: 20` that no theme token could reach, no stylesheet rule could
 * override on load order, and the lint guard did not catch — it bans colour
 * literals, and a font size is not a colour. The border had already been fixed
 * once, from a pasted `#edebe9` to `var(--tf-border)`, and the fix only reached
 * that one declaration because the other three lived in JavaScript where the
 * stylesheet could not see them.
 *
 * They are now `.tf-editor-panel`, `.tf-editor-grid` and `.tf-editor-actions` in
 * `taskpane.css`, so the type ramp (S7) can reach them and a theme can re-skin
 * them without a component change.
 */

function dropdownValue(option: IDropdownOption | undefined): string | null {
  return option && typeof option.key === "string" ? option.key : null;
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function profileToValues(profile: StyleProfile): ProfileFormValues {
  return {
    name: profile.name,
    emDash: profile.typography.emDash,
    enDashSpacing: profile.typography.enDashSpacing,
    doubleQuotes: profile.typography.doubleQuotes,
    singleQuotes: profile.typography.singleQuotes,
    apostrophes: profile.typography.apostrophes,
    decimalSeparator: profile.typography.decimalSeparator,
    thousandsSeparator: profile.typography.thousandsSeparator,
    ellipsis: profile.typography.ellipsis,
    preferredTerminology: profile.language.terminology
      .filter((rule) => rule.replacement !== undefined)
      .slice()
      .sort((left, right) => left.source.localeCompare(right.source))
      .map((rule) => `${rule.source}: ${rule.replacement}`)
      .join("\n"),
    bannedTerms: profile.language.bannedTerms.join("\n"),
    capitalizationSentenceCase: profile.houseStyle.capitalization.sentenceCase,
    titleCaseWords: profile.houseStyle.capitalization.titleCaseWords.join("\n"),
    spellingVariant: profile.houseStyle.spellingVariant,
  };
}

/**
 * Build the edited profile from the form values.
 *
 * The typography block is rebuilt from `baseProfile.typography` rather than
 * enumerated field by field, so a setting this form does not yet expose keeps
 * whatever the profile already had instead of being reset to the schema default
 * by an unrelated edit. That was a real failure mode once: adding a typography
 * field to the schema meant every save through this editor silently reverted it
 * until someone remembered to add a control for it.
 */
/**
 * Fold `term: replacement` lines into `language.terminology` rules.
 *
 * **Why this exists at all (ND-13).** These two controls used to write
 * `houseStyle.preferredTerminology` and `houseStyle.bannedTerms`, and neither
 * field produced a single finding — the registry filtered both checks out in
 * favour of the `language` rules. The fields looked authoritative, validated on
 * save, round-tripped through storage, and governed nothing.
 *
 * Rather than delete the capability, this writes to the live record. The
 * deterministic style section offers a richer per-rule editor for the same data
 * (severity, whole-word, case sensitivity, scope); this form remains the compact
 * `term: replacement` view of it.
 *
 * **Merging, not replacing.** A rule the form does not show — one with a scope,
 * or a severity the author chose in the per-rule editor — is preserved. Only a
 * rule whose `source` appears on a line is rewritten, so editing this form cannot
 * silently downgrade a mandatory term to advisory. That is the whole reason the
 * merge is written as a merge.
 */
function foldTerminology(
  parsed: Record<string, string>,
  existing: readonly TerminologyRule[],
): TerminologyRule[] {
  const authored = new Map(Object.entries(parsed));
  const retained = existing.filter((rule) => !authored.has(rule.source));
  const rewritten = [...authored.entries()].map(([source, replacement], index): TerminologyRule => {
    const match = existing.find((rule) => rule.source === source);
    if (match) return { ...match, replacement };
    return {
      id: `house:${index + 1}-${source}`,
      source,
      replacement,
      caseSensitive: false,
      wholeWord: true,
      severity: "advisory",
      scope: {},
    };
  });
  return [...retained, ...rewritten];
}

function buildCandidate(values: ProfileFormValues, baseProfile: StyleProfile): StyleProfile {
  const terminology = parseTerminology(values.preferredTerminology);
  return {
    ...baseProfile,
    name: values.name,
    typography: {
      ...baseProfile.typography,
      emDash: values.emDash,
      enDashSpacing: values.enDashSpacing,
      doubleQuotes: values.doubleQuotes,
      singleQuotes: values.singleQuotes,
      apostrophes: values.apostrophes,
      decimalSeparator: values.decimalSeparator,
      thousandsSeparator: values.thousandsSeparator,
      ellipsis: values.ellipsis,
    },
    language: {
      ...baseProfile.language,
      terminology: foldTerminology(terminology.values, baseProfile.language.terminology),
      bannedTerms: parseLines(values.bannedTerms),
    },
    houseStyle: {
      ...baseProfile.houseStyle,
      capitalization: {
        ...baseProfile.houseStyle.capitalization,
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
    // The form writes `language.terminology`, so that is the path a message must
    // name. Reporting the old `houseStyle` path would point at a field that no
    // longer exists.
    errors["language.terminology"] = terminology.error;
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
  const recordId = state.activeProfileId;
  const record = recordId ? loadProfileRecord(recordId) : null;
  const persisted = record ? effectiveProfile(record) : null;
  const profile =
    persisted ?? selectAllProfiles(state)[0] ?? createEmptyProfile("Untitled style profile");

  return {
    baseProfile: profile,
    draftBaseProfile: profile,
    savedProfile: persisted,
    recordId: record?.id ?? null,
    profiles: selectAllProfiles(state),
    // The audit trail is owned by the record; the editor only reads snapshots.
    history: record?.revisions.map((entry) => entry.profile) ?? [],
    values: profileToValues(profile),
    dirty: false,
    savedAt: null,
    fieldErrors: {},
    error: null,
  };
}

function sameEditableSnapshot(left: StyleProfile, right: StyleProfile): boolean {
  return diffProfiles(left, right).changedCount === 0;
}

/*
 * `option` is gone.
 *
 * It existed to build the `IDropdownOption` list for the Typography panel, which
 * moved into `DeterministicStyleSections` — there, a closed set is rendered by
 * `EnumSelect` as plain `[value, label]` pairs and needs no Fluent option object.
 * The House style panel's `TextField`s and `Toggle` never used it.
 */

export interface ProfileEditorProps {
  /** Called after a save so the page can refresh its own record state. */
  onRecordSaved?: (record: ProfileRecord) => void;
  /**
   * The probed capabilities, forwarded to the deterministic sections.
   *
   * They mark each section with whether *this* host can read the content it
   * governs. Passing `null` is the honest "not probed yet" state, and it was the
   * permanent answer here, so no section could ever carry its marking.
   */
  capabilities?: WordCapabilities | null;
}

export default function ProfileEditor({
  onRecordSaved,
  capabilities = null,
}: ProfileEditorProps = {}): React.ReactNode {
  const [context, setContext] = React.useState<ProfileEditorState>(initialContext);
  const {
    baseProfile,
    draftBaseProfile,
    savedProfile,
    profiles,
    history,
    values,
    savedAt,
    fieldErrors,
    error,
  } = context;
  const validation = validateValues(values, baseProfile);
  const draftProfile = validation.profile ?? validation.candidate;
  /*
   * `draftBaseProfile`, not `baseProfile`, when nothing is saved.
   *
   * `baseProfile` moves with the deterministic-section editor, so comparing a
   * draft against it makes an unsaved profile look clean the moment one of
   * those sections changes — and the edit is then unsaveable. `draftBaseProfile`
   * is the last persisted snapshot and only moves on save, reset or select.
   */
  const derivedDirty = !sameEditableSnapshot(draftProfile, savedProfile ?? draftBaseProfile);

  function patch(partial: Partial<ProfileFormValues>): void {
    setContext((prev) => {
      const nextValues = { ...prev.values, ...partial };
      const nextValidation = validateValues(nextValues, prev.baseProfile);
      const nextDraft = nextValidation.profile ?? nextValidation.candidate;
      const nextDirty = !sameEditableSnapshot(
        nextDraft,
        prev.savedProfile ?? prev.draftBaseProfile,
      );
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

  /**
   * Apply a change to the four deterministic sections.
   *
   * Written to `baseProfile` and then re-projected through `profileToValues`,
   * rather than patched into the form state directly. That is what makes the
   * section editor and the named controls below it two *views of one record*:
   * a term typed in either place is in the same object, and a save carries
   * whichever the user touched last. Patching the form state directly would
   * have left the two views able to disagree, and whichever was saved would
   * silently win.
   */
  function patchDeterministicSections(next: DeterministicStyleProfile): void {
    setContext((prev) => {
      /*
       * Built from the *current values*, not from `prev.baseProfile`.
       *
       * `patch` writes the flat controls into `values` and leaves `baseProfile`
       * alone, so merging onto `baseProfile` silently reverted every typography
       * and house-style edit the user had typed but not saved. Rebuilding through
       * `buildCandidate` keeps those edits and replaces only the four deterministic
       * sections the caller actually changed.
       */
      const fromValues = buildCandidate(prev.values, prev.baseProfile);
      const merged: StyleProfile = {
        ...fromValues,
        language: next.language,
        typography: next.typography,
        formatting: next.formatting,
        structure: next.structure,
      };
      const nextValues = profileToValues(merged);
      const nextValidation = validateValues(nextValues, merged);
      const nextDraft = nextValidation.profile ?? nextValidation.candidate;
      const nextDirty = !sameEditableSnapshot(
        nextDraft,
        prev.savedProfile ?? prev.draftBaseProfile,
      );
      return {
        ...prev,
        baseProfile: merged,
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
      // Detach from the previously selected record: the first save of this new
      // profile must create a record, never update the one that was open.
      recordId: null,
      profiles: [...prev.profiles, profile],
      history: [],
      values: profileToValues(profile),
      dirty: false,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function selectProfile(profileId: string): void {
    const record = loadProfileRecord(profileId);
    const selected = record ? effectiveProfile(record) : null;
    if (!selected) {
      return;
    }
    setActiveProfile(selected.id);
    setContext((prev) => ({
      ...prev,
      baseProfile: selected,
      draftBaseProfile: selected,
      savedProfile: selected,
      recordId: record?.id ?? null,
      history: record?.revisions.map((entry) => entry.profile) ?? [],
      values: profileToValues(selected),
      dirty: false,
      savedAt: null,
      fieldErrors: {},
      error: null,
    }));
  }

  function restoreHistorySnapshot(snapshot: StyleProfile): void {
    setContext((prev) => {
      // Restore content only. The revision number is assigned by the record when
      // the draft is saved, so loading an old snapshot as an unsaved draft can
      // never forge a revision, and VersionDiff shows content changes alone.
      const latest = prev.savedProfile ?? prev.draftBaseProfile;
      const restored: StyleProfile = {
        ...snapshot,
        id: latest.id,
        revision: latest.revision,
        createdAt: latest.createdAt,
        measured: latest.measured,
        sourceSampleIds: latest.sourceSampleIds,
      };
      return {
        ...prev,
        baseProfile: restored,
        values: profileToValues(restored),
        dirty: !sameEditableSnapshot(restored, prev.savedProfile ?? prev.baseProfile),
        savedAt: null,
        fieldErrors: {},
        error: null,
      };
    });
  }

  function save(): void {
    if (!validation.profile) {
      setContext((prev) => ({
        ...prev,
        error: "Resolve the profile validation errors before saving.",
      }));
      return;
    }

    if (!context.dirty && !derivedDirty) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const recordId = context.recordId;
    let record = recordId ? loadProfileRecord(recordId) : null;

    if (!record) {
      // No record yet: the first save creates one, so the profile always has a
      // revision audit trail from the moment it exists. `createProfileRecord`
      // persists it, so saving again here would write the record twice.
      record = createProfileRecord(validation.profile.name, updatedAt, validation.profile);
    } else {
      record = updateDraft(record, validation.profile, updatedAt).record;
      saveProfileRecord(record);
    }
    setActiveProfile(record.id);
    onRecordSaved?.(record);

    const profile = record.draft ?? effectiveProfile(record);
    if (!profile) return;

    setContext((prev) => ({
      ...prev,
      baseProfile: profile,
      draftBaseProfile: profile,
      savedProfile: profile,
      recordId: record?.id ?? null,
      profiles: selectAllProfiles(loadState()),
      history: record?.revisions.map((entry) => entry.profile) ?? [],
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

  const revision: Revision = baseProfile.revision;
  const hasHistory = history.length > 0;
  const historyCount = history.length;

  return (
    <div className="tf-card">
      {/*
        No heading here.

        The editor used to open with its own `<h1>Style Profile</h1>`, directly
        under the page's `<h1>Deterministic Style Profile</h1>`. Two competing
        h1s on one screen, the second naming the same thing less precisely, and
        a page header that is the one the navigation and the tests address. The
        page owns the heading; a component embedded in it does not add another.
      */}
      <p className="tf-sub">
        Edit the deterministic rules below. They are measured against the captured writing sample,
        so a change here changes what every later check compares against.
      </p>

      {renderMessageBar()}

      <div className="tf-editor-actions tf-editor-actions-spaced">
        <Dropdown
          label="Saved profiles"
          selectedKey={baseProfile.id}
          options={profiles.map((item) => ({
            key: item.id,
            text: `${item.name} ${formatRevision(item.revision)}`,
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
        <TextField
          label="Revision"
          disabled
          readOnly
          value={formatRevision(revision)}
          description="Assigned automatically when a draft is saved."
        />
      </div>

      {/*
        One place that talks about revisions.

        The revision number, the count of recorded revisions, and the history
        list were three separate statements of the same fact, in three places,
        with the count and the number disagreeing in wording. They are now one
        disclosure: the sentence carries the state, the list carries the
        history, and the field above carries the number.
      */}
      <p className="tf-sub tf-editor-note">
        {hasHistory
          ? `${historyCount} revision(s) recorded. Saving assigns the next revision.`
          : "No revisions yet — save to record the first revision."}
      </p>
      {hasHistory && (
        <details className="tf-editor-note">
          <summary className="tf-sub">Revision history</summary>
          <ul className="tf-editor-list">
            {history.map((snapshot, index) => (
              <li key={`${snapshot.id}-${snapshot.updatedAt}-${index}`}>
                {formatRevision(snapshot.revision)} —{" "}
                {new Date(snapshot.updatedAt).toLocaleString()}{" "}
                <DefaultButton
                  text={`Restore ${formatRevision(snapshot.revision)}`}
                  onClick={() => restoreHistorySnapshot(snapshot)}
                />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        Measured style and Semantic style are not shown here.

        Both were rendered as read-only definition lists, which made the
        deterministic tab look like it owned a semantic profile and a metrics
        view it cannot edit and does not own. The Semantic tab displays the
        measured values and hosts the editable semantic editor; the Governance
        Policy tab decides which rules may be applied without asking.

        The values are still carried, not dropped: `buildCandidate` spreads
        `baseProfile`, so a deterministic edit here cannot reset the learned
        tone, voice, vocabulary or metrics. This note says so, because a
        section that disappeared with no explanation reads as data loss.
      */}
      <p className="tf-sub tf-editor-note">
        {baseProfile.sourceSampleIds.length === 0
          ? "No source samples are linked to this profile."
          : `${baseProfile.sourceSampleIds.length} source sample(s) linked.`}{" "}
        Measured style and semantic style are on the Semantic tab; saving here does not change them.
      </p>

      {/*
        Spec §21. The four deterministic sections as collapsible blocks, each
        marked with whether *this* Word host can read the content it governs.

        Mounted above the flat controls rather than replacing them: the flat
        Typography and House style panels are the named controls the existing
        tests and the muscle memory of this pane both address, and the sections
        are the normative view of the same profile. Two views of one record, not
        two records — `DeterministicStyleSections` patches the same object the
        panel below edits.
      */}
      <DeterministicStyleSections
        profile={{
          language: draftProfile.language,
          typography: draftProfile.typography,
          formatting: draftProfile.formatting,
          structure: draftProfile.structure,
        }}
        capabilities={capabilities}
        onChange={(next) => patchDeterministicSections(next)}
      />
      {/*
       * What is left here, and why so little (D-2, S3/S4).
       *
       * This panel used to hold four controls. Two of them — preferred
       * terminology and banned terms — were a *second* editor for fields the
       * Language section already owned, in a lossy format: a line can express a
       * substitution and none of `severity`, `caseSensitive`, `wholeWord` or
       * `scope`. That is the two-owners defect, and it is why the terminology
       * editor was replaced by a bulk paste that produces real rows (ADR-0123).
       *
       * The two that remain are genuinely different behaviours from the
       * similarly-named ones under Language:
       *
       *   houseStyle.capitalization.sentenceCase  -> houseStyle.ts `checkSentenceCase`
       *   language.capitalisation.sentenceCase    -> language.ts  `findCapitalisationIssues`
       *
       * Both are live and both are registered, so neither control can be deleted.
       * They were left in place deliberately (owner decision) rather than merged,
       * because merging them would change which rules fire — a product change,
       * not a tidy-up. What was fixed is the *labelling*: two toggles reading
       * almost the same were the real hazard, and the one below now says which
       * rule it belongs to.
       */}
      <section aria-labelledby="house-style-heading" className="tf-editor-panel">
        <h3 id="house-style-heading">Capital case defaults</h3>
        <p className="tf-sub">
          Two house-style capitalisation rules. They are separate from the capitalisation settings
          under Language, which are checked by different rules.
        </p>
        <div className="tf-editor-grid">
          <TextField
            label="Title-case words (one per line)"
            multiline
            rows={4}
            value={values.titleCaseWords}
            errorMessage={fieldErrors["capitalization.titleCaseWords"] ?? ""}
            onChange={(_event, value) => patch({ titleCaseWords: value ?? "" })}
          />
          {/*
           * No spelling-variant control, deliberately (spec §4.3).
           *
           * A control here would be a promise the product does not keep: the
           * field round-trips through the form and is written back unchanged,
           * but no rule reads it, so choosing "en-GB" changes nothing a user can
           * observe. The value stays in `ProfileFormValues` so a profile written
           * before the rule was removed is not silently reset on save.
           */}
          <Toggle
            label="House-style rule: flag a sentence that does not open with a capital letter"
            checked={values.capitalizationSentenceCase}
            onText="Checked"
            offText="Not checked"
            onChange={(_event, value) => patch({ capitalizationSentenceCase: value ?? false })}
          />
        </div>
      </section>

      <VersionDiff savedProfile={savedProfile} currentProfile={validation.profile} />

      <div className="tf-editor-actions">
        <PrimaryButton
          text="Save profile"
          onClick={save}
          disabled={!derivedDirty}
          className="tf-editor-action"
        />
        <DefaultButton
          text="Reset changes"
          onClick={reset}
          disabled={!derivedDirty}
          className="tf-editor-action"
        />
        <DefaultButton text="New profile" onClick={createNewProfile} className="tf-editor-action" />
      </div>
    </div>
  );
}
