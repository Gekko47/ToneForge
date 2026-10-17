/**
 * SemanticProfileEditor — the editable half of a semantic style profile.
 *
 * The deterministic style tab deliberately does not own these fields. It used to
 * render them as disabled inputs, which looked read-only but was not:
 * `buildCandidate` wrote every one of them back on each save, so a profile's
 * learned tone and voice were silently reset by an unrelated edit to a dash rule.
 * A field whose state is never read is a live default, not a read-only view.
 *
 * **Consent never disables this component.** Sending text to a provider is what
 * consent governs; typing a tone into a local field sends nothing. Disabling the
 * editor on missing consent locked out exactly the user who had declined
 * (ADR-0068), so there is no `disabled` prop and no gate here.
 *
 * Every enum control is a **combobox** — searchable, with the generic options the
 * schema names — and every boolean is a checkbox. The free-text areas are the
 * three description fields and Notes, each length-capped for a stated reason: a
 * `description` or note is exactly where a model, or a user, parks a project name
 * and a figure, and those are the fields the factual-leakage check reads. A field
 * that cannot hold a sentence cannot leak a paragraph.
 *
 * All 48 editable leaves of the sixteen dimensions are exposed here, grouped into
 * the sections the specification names and rendered as a `<details>` disclosure
 * each. The section heading is the accessible name; the summary line states the
 * current value so a collapsed section is still informative rather than a blind
 * spot. `formality.label` is derived from the score (R14) and is not a separate
 * control; the score field covers it.
 */

import React from "react";
import {
  Checkbox,
  Combobox,
  Field,
  Input,
  Option,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  SemanticStyleProfileSchema,
  type SemanticStyleProfile,
} from "../../core/domain/SemanticStyleProfile";
import { DisclosurePanel } from "./common";

export interface SemanticProfileEditorProps {
  /** The semantic half of the profile being edited. */
  semantic: SemanticStyleProfile;
  /** Persists an edit. Receives the whole semantic block, never a partial. */
  onSave: (semantic: SemanticStyleProfile) => void;
}

/** Options for a closed enum, labelled for a person. */
function options<T extends string>(values: readonly T[]): readonly [T, string][] {
  return values.map((value) => [value, label(value)]);
}

/** `direct-analytical` reads as `Direct analytical`. */
function label(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const TONE_TRAITS = [
  "restrained",
  "neutral",
  "assertive",
  "cautious",
  "analytical",
  "forensic",
  "explanatory",
  "persuasive",
] as const;
const REGISTERS = [
  "plain",
  "professional",
  "technical",
  "expert",
  "academic",
  "legal-technical",
] as const;
const VOICE_PERSONS = ["first", "third", "mixed", "impersonal"] as const;
const VOICE_CONSTRUCTIONS = ["active", "passive", "balanced"] as const;
const VOICE_PRESENCE = ["absent", "restrained", "explicit"] as const;
const ASSERTION_STRENGTHS = ["categorical", "qualified", "conditional", "provisional"] as const;
const ASSERTION_ORDERINGS = ["evidence-first", "conclusion-first", "interleaved"] as const;
const ASSERTION_DIRECTNESSES = ["direct", "measured", "indirect"] as const;
const QUALIFICATION_FREQUENCIES = ["rare", "occasional", "frequent"] as const;
const QUALIFICATION_STRENGTHS = ["light", "moderate", "heavy"] as const;
const QUALIFICATION_EXCEPTIONS = ["none", "inline", "dedicated"] as const;
const EVIDENCE_ATTRIBUTIONS = ["none", "occasional", "systematic"] as const;
const EVIDENCE_QUOTATIONS = ["rare", "selective", "frequent"] as const;
const EVIDENCE_PROGRESSIONS = [
  "source-analysis-conclusion",
  "claim-evidence",
  "narrative",
] as const;
const UNCERTAINTY_INCOMPLETE = ["stated", "implied", "suppressed"] as const;
const UNCERTAINTY_CONFIDENCE = ["explicit", "implicit", "absent"] as const;
const UNCERTAINTY_MODALITY = ["frequent", "occasional", "rare"] as const;
const SENTENCE_COMPLEXITIES = ["simple", "moderate", "complex"] as const;
const SENTENCE_VARIABILITIES = ["low", "medium", "high"] as const;
const SENTENCE_COORDINATIONS = ["coordination", "subordination", "mixed"] as const;
const PARAGRAPH_FUNCTIONS = ["topic", "evidence", "analysis", "conclusion", "mixed"] as const;
const PARAGRAPH_ORDERINGS = [
  "topic-evidence-conclusion",
  "conclusion-evidence",
  "chronological",
  "comparative",
] as const;
const PARAGRAPH_VARIABILITIES = ["low", "medium", "high"] as const;
const PARAGRAPH_PROPOSITIONS = ["single", "multiple"] as const;
const TRANSITIONS = ["restrained", "explicit", "rhetorical"] as const;
const AGENCY_ACTORS = ["named", "role", "impersonal", "mixed"] as const;
const AGENCY_PRECISIONS = ["exact", "general", "unspecified"] as const;
const TECHNICALITY_DENSITIES = ["low", "medium", "high"] as const;
const TECHNICALITY_ABBREVIATIONS = ["none", "first-use", "permissive"] as const;
const RHETORICAL_STYLES = [
  "direct-analytical",
  "narrative",
  "forensic",
  "comparative",
  "argumentative",
  "explanatory",
] as const;
const CONCLUSION_FORMS = ["concise", "qualified", "recap", "opinion", "none"] as const;
const LEXICAL_EVALUATIVE = ["none", "restrained", "explicit"] as const;

/**
 * Parse a bounded number, or keep the stored value when the input is unusable.
 *
 * A fallback to the *same field's* stored value and never to a neighbouring one.
 * The old editor fell back to `semantic.formality` when reading grade could not be
 * parsed, so typing "abc" silently saved formality's value there — an invalid
 * entry that became a plausible wrong one and gave the user no reason to distrust
 * it.
 */
function toNumber(value: string, stored: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return stored;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * One searchable combobox bound to a single enum leaf of the profile.
 *
 * The user can type to filter the generic options, then click one to commit.
 * `freeform` keeps the input editable for filtering; only `onOptionSelect`
 * commits a value, so a partial keystroke never reaches the schema.
 */
function EnumField<T extends string>(props: {
  id: string;
  label: string;
  value: T;
  values: readonly T[];
  onChange: (next: T) => void;
}): React.ReactNode {
  return (
    <Field label={props.label}>
      <Combobox
        id={props.id}
        value={label(props.value)}
        selectedOptions={[props.value]}
        freeform
        autoComplete="off"
        onOptionSelect={(_event, data) => {
          if (data.optionValue) props.onChange(data.optionValue as T);
        }}
      >
        {options(props.values).map(([value, text]) => (
          <Option key={value} value={value}>
            {text}
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}

/** One checkbox bound to a boolean leaf of the profile. */
function BooleanField(props: {
  id: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): React.ReactNode {
  return (
    <Checkbox
      id={props.id}
      label={props.label}
      checked={props.value}
      onChange={(_event, data) => props.onChange(data.checked === true)}
    />
  );
}

/**
 * One free-text field bound to a description leaf, committed on blur.
 *
 * The raw draft is what the user sees while typing; trim happens once on blur,
 * matching the pattern of `NumberField` and `LinesField`.
 */
function TextField(props: {
  id: string;
  label: string;
  rows: number;
  maxLength?: number;
  value: string;
  onChange: (next: string) => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(props.value);
  React.useEffect(() => setDraft(props.value), [props.value]);
  return (
    <Field label={props.label}>
      <Textarea
        id={props.id}
        rows={props.rows}
        maxLength={props.maxLength}
        value={draft}
        onChange={(_event, data) => setDraft(data.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed !== props.value) props.onChange(trimmed);
        }}
      />
    </Field>
  );
}

/**
 * One multi-select combobox bound to an array enum leaf (tone.secondary).
 *
 * Non-selected options are disabled once the limit is reached, so the user
 * cannot add a value the schema would refuse.
 */
function MultiSelectField<T extends string>(props: {
  id: string;
  label: string;
  value: readonly T[];
  values: readonly T[];
  limit: number;
  onChange: (next: T[]) => void;
}): React.ReactNode {
  return (
    <Field label={props.label}>
      <Combobox
        id={props.id}
        selectedOptions={[...props.value]}
        multiselect
        autoComplete="off"
        placeholder={`Select up to ${props.limit}`}
        onOptionSelect={(_event, data) => {
          if (!data.optionValue) return;
          const value = data.optionValue as T;
          const next = props.value.includes(value)
            ? props.value.filter((v) => v !== value)
            : [...props.value, value];
          props.onChange(next);
        }}
      >
        {options(props.values).map(([value, text]) => (
          <Option
            key={value}
            value={value}
            disabled={!props.value.includes(value) && props.value.length >= props.limit}
          >
            {text}
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}

/** One bounded numeric field bound to a leaf of the profile. */
function NumberField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(String(props.value));
  React.useEffect(() => setDraft(String(props.value)), [props.value]);
  return (
    <Field label={`${props.label} (${props.min}-${props.max})`}>
      <Input
        id={props.id}
        value={draft}
        onChange={(_event, data) => setDraft(data.value)}
        onBlur={() => {
          const parsed = toNumber(draft, props.value, props.min, props.max);
          if (parsed !== props.value) props.onChange(parsed);
        }}
      />
    </Field>
  );
}

/**
 * A multiline list field, committed on blur.
 *
 * **The raw draft is what the user sees, not the normalised value.** Committing on
 * every keystroke round-tripped the text through trim/filter, so a blank line
 * entered to separate two entries and the space typed at the end of a line both
 * vanished mid-typing — the caret jumped and the list the user was building
 * reshaped itself under them. Normalisation happens once, on blur, which is where
 * the existing trimming, empty-line filtering and item limit apply.
 *
 * Draft state and its reset follow `NumberField`, so the two text-entry patterns
 * in this editor cannot drift.
 */
function LinesField(props: {
  id: string;
  label: string;
  rows: number;
  maxLength?: number;
  value: readonly string[];
  limit: number;
  onChange: (next: string[]) => void;
}): React.ReactNode {
  const joined = props.value.join("\n");
  const [draft, setDraft] = React.useState(joined);
  React.useEffect(() => setDraft(joined), [joined]);
  const commit = (): void => {
    const lines = draft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, props.limit);
    if (lines.join("\n") === joined) return;
    props.onChange(lines);
  };
  return (
    <Field label={props.label}>
      <Textarea
        id={props.id}
        rows={props.rows}
        maxLength={props.maxLength}
        value={draft}
        onChange={(_event, data) => setDraft(data.value)}
        onBlur={commit}
      />
    </Field>
  );
}

const useSectionStyles = makeStyles({
  body: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
  },
  summary: {
    color: tokens.colorNeutralForeground2,
  },
  fields: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
  },
});

/** One collapsible group of controls. */
function Section(props: {
  title: string;
  summary: string;
  children: React.ReactNode;
}): React.ReactNode {
  const styles = useSectionStyles();
  return (
    <DisclosurePanel title={props.title} className="tf-section">
      <div className={styles.body}>
        <p className={styles.summary}>{props.summary}</p>
        <div className={styles.fields}>{props.children}</div>
      </div>
    </DisclosurePanel>
  );
}

export default function SemanticProfileEditor({
  semantic,
  onSave,
}: SemanticProfileEditorProps): React.ReactNode {
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Apply one leaf edit and save.
   *
   * Checked rather than parsed-and-thrown. This runs from `onBlur` and a
   * `Combobox.onOptionSelect`, so a `ZodError` would escape an event handler with
   * nothing to catch it: the value would not be saved and the user would be told
   * nothing at all. A refusal that is invisible is the defect this replaces.
   */
  function edit(mutate: (draft: SemanticStyleProfile) => void): void {
    const draft = structuredClone(semantic);
    mutate(draft);
    const parsed = SemanticStyleProfileSchema.safeParse(draft);
    if (!parsed.success) {
      setError("These values are not a valid semantic style profile, so nothing was saved.");
      return;
    }
    setError(null);
    onSave(parsed.data);
  }

  return (
    <section aria-labelledby="semantic-heading">
      <h2 id="semantic-heading">Semantic style</h2>
      <p className="tf-sub">
        How the writing sounds rather than how it is punctuated. These values are what the semantic
        review reasons about and what a proposed rewrite is asked to match. Punctuation, spacing and
        house terminology are deterministic rules measured on the Deterministic Style Profile tab.
      </p>

      <Section
        title="Voice and tone"
        summary={`${label(semantic.tone.primary)} tone, ${label(semantic.voice.person)} voice, formality ${semantic.formality.score}`}
      >
        <EnumField
          id="sem-tone-primary"
          label="Primary tone"
          value={semantic.tone.primary}
          values={TONE_TRAITS}
          onChange={(next) =>
            edit((draft) => {
              draft.tone.primary = next;
            })
          }
        />
        <MultiSelectField
          id="sem-tone-secondary"
          label="Secondary tones"
          value={semantic.tone.secondary}
          values={TONE_TRAITS}
          limit={2}
          onChange={(next) =>
            edit((draft) => {
              draft.tone.secondary = next;
            })
          }
        />
        <TextField
          id="sem-tone-description"
          label="Tone description"
          rows={2}
          maxLength={240}
          value={semantic.tone.description}
          onChange={(next) =>
            edit((draft) => {
              draft.tone.description = next;
            })
          }
        />
        <EnumField
          id="sem-voice-person"
          label="Person"
          value={semantic.voice.person}
          values={VOICE_PERSONS}
          onChange={(next) =>
            edit((draft) => {
              draft.voice.person = next;
            })
          }
        />
        <EnumField
          id="sem-voice-construction"
          label="Active or passive"
          value={semantic.voice.construction}
          values={VOICE_CONSTRUCTIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.voice.construction = next;
            })
          }
        />
        <EnumField
          id="sem-voice-presence"
          label="Authorial presence"
          value={semantic.voice.authorialPresence}
          values={VOICE_PRESENCE}
          onChange={(next) =>
            edit((draft) => {
              draft.voice.authorialPresence = next;
            })
          }
        />
        <TextField
          id="sem-voice-description"
          label="Voice description"
          rows={2}
          maxLength={240}
          value={semantic.voice.description}
          onChange={(next) =>
            edit((draft) => {
              draft.voice.description = next;
            })
          }
        />
        <EnumField
          id="sem-register"
          label="Register"
          value={semantic.register.primary}
          values={REGISTERS}
          onChange={(next) =>
            edit((draft) => {
              draft.register.primary = next;
            })
          }
        />
        <TextField
          id="sem-register-description"
          label="Register description"
          rows={2}
          maxLength={240}
          value={semantic.register.description}
          onChange={(next) =>
            edit((draft) => {
              draft.register.description = next;
            })
          }
        />
        <NumberField
          id="sem-formality"
          label="Formality"
          value={semantic.formality.score}
          min={0}
          max={100}
          onChange={(next) =>
            edit((draft) => {
              draft.formality.score = next;
            })
          }
        />
      </Section>

      <Section
        title="Assertions and qualification"
        summary={`${label(semantic.assertionStyle.strength)} assertions, ${label(
          semantic.qualificationStyle.frequency,
        )} qualification`}
      >
        <EnumField
          id="sem-assertion-strength"
          label="Assertion strength"
          value={semantic.assertionStyle.strength}
          values={ASSERTION_STRENGTHS}
          onChange={(next) =>
            edit((draft) => {
              draft.assertionStyle.strength = next;
            })
          }
        />
        <EnumField
          id="sem-assertion-ordering"
          label="Assertion ordering"
          value={semantic.assertionStyle.ordering}
          values={ASSERTION_ORDERINGS}
          onChange={(next) =>
            edit((draft) => {
              draft.assertionStyle.ordering = next;
            })
          }
        />
        <EnumField
          id="sem-assertion-directness"
          label="Assertion directness"
          value={semantic.assertionStyle.directness}
          values={ASSERTION_DIRECTNESSES}
          onChange={(next) =>
            edit((draft) => {
              draft.assertionStyle.directness = next;
            })
          }
        />
        <EnumField
          id="sem-qualification-frequency"
          label="Qualification frequency"
          value={semantic.qualificationStyle.frequency}
          values={QUALIFICATION_FREQUENCIES}
          onChange={(next) =>
            edit((draft) => {
              draft.qualificationStyle.frequency = next;
            })
          }
        />
        <EnumField
          id="sem-qualification-strength"
          label="Qualification strength"
          value={semantic.qualificationStyle.strength}
          values={QUALIFICATION_STRENGTHS}
          onChange={(next) =>
            edit((draft) => {
              draft.qualificationStyle.strength = next;
            })
          }
        />
        <EnumField
          id="sem-qualification-exceptions"
          label="Qualification exceptions"
          value={semantic.qualificationStyle.exceptions}
          values={QUALIFICATION_EXCEPTIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.qualificationStyle.exceptions = next;
            })
          }
        />
        <BooleanField
          id="sem-qualification-conditionals"
          label="Uses conditionals"
          value={semantic.qualificationStyle.conditionals}
          onChange={(next) =>
            edit((draft) => {
              draft.qualificationStyle.conditionals = next;
            })
          }
        />
      </Section>

      <Section
        title="Evidence and uncertainty"
        summary={
          semantic.evidenceFraming.recordFirst
            ? "Record first, then analysis"
            : "Conclusion before evidence"
        }
      >
        <BooleanField
          id="sem-evidence-record-first"
          label="Record evidence first"
          value={semantic.evidenceFraming.recordFirst}
          onChange={(next) =>
            edit((draft) => {
              draft.evidenceFraming.recordFirst = next;
            })
          }
        />
        <EnumField
          id="sem-evidence-attribution"
          label="Attribution"
          value={semantic.evidenceFraming.attribution}
          values={EVIDENCE_ATTRIBUTIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.evidenceFraming.attribution = next;
            })
          }
        />
        <EnumField
          id="sem-evidence-quotation"
          label="Quotation"
          value={semantic.evidenceFraming.quotation}
          values={EVIDENCE_QUOTATIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.evidenceFraming.quotation = next;
            })
          }
        />
        <BooleanField
          id="sem-evidence-explicit-refs"
          label="Explicit references"
          value={semantic.evidenceFraming.explicitReferences}
          onChange={(next) =>
            edit((draft) => {
              draft.evidenceFraming.explicitReferences = next;
            })
          }
        />
        <EnumField
          id="sem-evidence-progression"
          label="Evidence progression"
          value={semantic.evidenceFraming.progression}
          values={EVIDENCE_PROGRESSIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.evidenceFraming.progression = next;
            })
          }
        />
        <EnumField
          id="sem-uncertainty-incomplete"
          label="Incomplete evidence"
          value={semantic.uncertaintyStyle.incompleteEvidence}
          values={UNCERTAINTY_INCOMPLETE}
          onChange={(next) =>
            edit((draft) => {
              draft.uncertaintyStyle.incompleteEvidence = next;
            })
          }
        />
        <EnumField
          id="sem-uncertainty-confidence"
          label="Confidence language"
          value={semantic.uncertaintyStyle.confidenceLanguage}
          values={UNCERTAINTY_CONFIDENCE}
          onChange={(next) =>
            edit((draft) => {
              draft.uncertaintyStyle.confidenceLanguage = next;
            })
          }
        />
        <EnumField
          id="sem-uncertainty-modality"
          label="Modality"
          value={semantic.uncertaintyStyle.modality}
          values={UNCERTAINTY_MODALITY}
          onChange={(next) =>
            edit((draft) => {
              draft.uncertaintyStyle.modality = next;
            })
          }
        />
        <BooleanField
          id="sem-uncertainty-avoids-certainty"
          label="Avoids unsupported certainty"
          value={semantic.uncertaintyStyle.avoidsUnsupportedCertainty}
          onChange={(next) =>
            edit((draft) => {
              draft.uncertaintyStyle.avoidsUnsupportedCertainty = next;
            })
          }
        />
      </Section>

      <Section
        title="Structure"
        summary={`${semantic.sentenceArchitecture.targetWords}-word sentences, ${label(
          semantic.paragraphArchitecture.ordering,
        )} paragraphs`}
      >
        <EnumField
          id="sem-sentence-complexity"
          label="Sentence complexity"
          value={semantic.sentenceArchitecture.complexity}
          values={SENTENCE_COMPLEXITIES}
          onChange={(next) =>
            edit((draft) => {
              draft.sentenceArchitecture.complexity = next;
            })
          }
        />
        <NumberField
          id="sem-sentence-target"
          label="Sentence length"
          value={semantic.sentenceArchitecture.targetWords}
          min={5}
          max={60}
          onChange={(next) =>
            edit((draft) => {
              draft.sentenceArchitecture.targetWords = next;
            })
          }
        />
        <EnumField
          id="sem-sentence-variability"
          label="Sentence variability"
          value={semantic.sentenceArchitecture.sentenceVariability}
          values={SENTENCE_VARIABILITIES}
          onChange={(next) =>
            edit((draft) => {
              draft.sentenceArchitecture.sentenceVariability = next;
            })
          }
        />
        <EnumField
          id="sem-sentence-coordination"
          label="Coordination"
          value={semantic.sentenceArchitecture.coordination}
          values={SENTENCE_COORDINATIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.sentenceArchitecture.coordination = next;
            })
          }
        />
        <BooleanField
          id="sem-sentence-short-closing"
          label="Short closing sentence"
          value={semantic.sentenceArchitecture.shortClosingSentence}
          onChange={(next) =>
            edit((draft) => {
              draft.sentenceArchitecture.shortClosingSentence = next;
            })
          }
        />
        <EnumField
          id="sem-paragraph-function"
          label="Paragraph function"
          value={semantic.paragraphArchitecture.function}
          values={PARAGRAPH_FUNCTIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.paragraphArchitecture.function = next;
            })
          }
        />
        <EnumField
          id="sem-paragraph-ordering"
          label="Paragraph ordering"
          value={semantic.paragraphArchitecture.ordering}
          values={PARAGRAPH_ORDERINGS}
          onChange={(next) =>
            edit((draft) => {
              draft.paragraphArchitecture.ordering = next;
            })
          }
        />
        <NumberField
          id="sem-paragraph-target"
          label="Paragraph length"
          value={semantic.paragraphArchitecture.targetWords}
          min={20}
          max={400}
          onChange={(next) =>
            edit((draft) => {
              draft.paragraphArchitecture.targetWords = next;
            })
          }
        />
        <EnumField
          id="sem-paragraph-variability"
          label="Paragraph variability"
          value={semantic.paragraphArchitecture.paragraphVariability}
          values={PARAGRAPH_VARIABILITIES}
          onChange={(next) =>
            edit((draft) => {
              draft.paragraphArchitecture.paragraphVariability = next;
            })
          }
        />
        <EnumField
          id="sem-paragraph-propositions"
          label="Propositions per paragraph"
          value={semantic.paragraphArchitecture.propositions}
          values={PARAGRAPH_PROPOSITIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.paragraphArchitecture.propositions = next;
            })
          }
        />
        <EnumField
          id="sem-transitions"
          label="Transitions"
          value={semantic.transitions}
          values={TRANSITIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.transitions = next;
            })
          }
        />
      </Section>

      <Section
        title="Agency, register and conclusions"
        summary={`${label(semantic.agency.actorNaming)} actors, ${label(
          semantic.rhetoricalStyle,
        )} rhetoric`}
      >
        <EnumField
          id="sem-rhetorical"
          label="Rhetorical style"
          value={semantic.rhetoricalStyle}
          values={RHETORICAL_STYLES}
          onChange={(next) =>
            edit((draft) => {
              draft.rhetoricalStyle = next;
            })
          }
        />
        <EnumField
          id="sem-agency-actor"
          label="Actor naming"
          value={semantic.agency.actorNaming}
          values={AGENCY_ACTORS}
          onChange={(next) =>
            edit((draft) => {
              draft.agency.actorNaming = next;
            })
          }
        />
        <EnumField
          id="sem-agency-precision"
          label="Attribution precision"
          value={semantic.agency.attributionPrecision}
          values={AGENCY_PRECISIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.agency.attributionPrecision = next;
            })
          }
        />
        <EnumField
          id="sem-conclusion"
          label="Conclusion form"
          value={semantic.conclusionStyle.form}
          values={CONCLUSION_FORMS}
          onChange={(next) =>
            edit((draft) => {
              draft.conclusionStyle.form = next;
            })
          }
        />
        <BooleanField
          id="sem-conclusion-avoids-repetition"
          label="Avoids repetition in conclusions"
          value={semantic.conclusionStyle.avoidsRepetition}
          onChange={(next) =>
            edit((draft) => {
              draft.conclusionStyle.avoidsRepetition = next;
            })
          }
        />
      </Section>

      <Section
        title="Technicality"
        summary={`${label(semantic.technicality.density)} technicality`}
      >
        <EnumField
          id="sem-technicality-density"
          label="Technicality density"
          value={semantic.technicality.density}
          values={TECHNICALITY_DENSITIES}
          onChange={(next) =>
            edit((draft) => {
              draft.technicality.density = next;
            })
          }
        />
        <BooleanField
          id="sem-technicality-explains"
          label="Explains technical terms"
          value={semantic.technicality.explainsTerms}
          onChange={(next) =>
            edit((draft) => {
              draft.technicality.explainsTerms = next;
            })
          }
        />
        <EnumField
          id="sem-technicality-abbreviation"
          label="Abbreviation tendency"
          value={semantic.technicality.abbreviationTendency}
          values={TECHNICALITY_ABBREVIATIONS}
          onChange={(next) =>
            edit((draft) => {
              draft.technicality.abbreviationTendency = next;
            })
          }
        />
      </Section>

      <Section
        title="Lexical preferences and notes"
        summary={`${semantic.lexicalPreferences.toneAvoid.length} tone-avoided word${
          semantic.lexicalPreferences.toneAvoid.length === 1 ? "" : "s"
        }`}
      >
        <LinesField
          id="sem-tone-avoid"
          label="Words to avoid for tone (one per line)"
          rows={3}
          value={semantic.lexicalPreferences.toneAvoid}
          limit={100}
          onChange={(next) =>
            edit((draft) => {
              draft.lexicalPreferences.toneAvoid = next;
            })
          }
        />
        <BooleanField
          id="sem-lexical-neutral-verbs"
          label="Prefers neutral verbs"
          value={semantic.lexicalPreferences.prefersNeutralVerbs}
          onChange={(next) =>
            edit((draft) => {
              draft.lexicalPreferences.prefersNeutralVerbs = next;
            })
          }
        />
        <EnumField
          id="sem-lexical-evaluative"
          label="Evaluative language"
          value={semantic.lexicalPreferences.evaluativeLanguage}
          values={LEXICAL_EVALUATIVE}
          onChange={(next) =>
            edit((draft) => {
              draft.lexicalPreferences.evaluativeLanguage = next;
            })
          }
        />
        <LinesField
          id="sem-notes"
          label="Notes"
          rows={2}
          maxLength={240}
          value={semantic.notes}
          limit={20}
          onChange={(next) =>
            edit((draft) => {
              draft.notes = next;
            })
          }
        />
      </Section>

      {/*
        The form's own error, in the same voice as the control it is about. A
        value that did not save and a form that says nothing reads as the app
        having lost the edit.
      */}
      {error !== null && (
        <p className="tf-debug-warning" role="alert">
          {error}
        </p>
      )}

      {/*
        A migrated profile's unmapped V1 values, stated rather than hidden.

        A V1 store could hold a reading-grade target and a vocabulary register,
        and V2 has no home for either. The migration carries them in
        `legacyV1` instead of dropping them, and this is where the user learns
        that — a value the editor cannot show is a value that would otherwise look
        as though it had never existed.
      */}
      {semantic.legacyV1 !== undefined && (
        <p className="tf-sub">
          Carried from an earlier style profile: reading grade target{" "}
          {semantic.legacyV1.readingGradeTarget ?? "none"}, vocabulary register{" "}
          {label(semantic.legacyV1.vocabularyRegister)}. These have no equivalent in the current set
          of dimensions, so nothing reads them.
        </p>
      )}
    </section>
  );
}
