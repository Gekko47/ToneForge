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
 * Every control is a dropdown or a bounded numeric field over a **closed enum or
 * a ranged number** — never a free-form prompt. The one free-text area is Notes,
 * and it is length-capped for a stated reason: a `description` or note is exactly
 * where a model, or a user, parks a project name and a figure, and those are the
 * fields P2's factual-leakage check reads. A field that cannot hold a sentence
 * cannot leak a paragraph.
 *
 * Sixteen dimensions is a lot of controls, so they are grouped into the sections
 * the specification names and rendered as a `<details>` disclosure each. The
 * section heading is the accessible name; the summary line states the current
 * value so a collapsed section is still informative rather than a blind spot.
 */

import React from "react";
import { Dropdown, TextField, type IDropdownOption } from "@fluentui/react";
import {
  SemanticStyleProfileSchema,
  type SemanticStyleProfile,
} from "../../core/domain/SemanticStyleProfile";

export interface SemanticProfileEditorProps {
  /** The semantic half of the profile being edited. */
  semantic: SemanticStyleProfile;
  /** Persists an edit. Receives the whole semantic block, never a partial. */
  onSave: (semantic: SemanticStyleProfile) => void;
}

/** Options for a closed enum, labelled for a person. */
function options<T extends string>(values: readonly T[]): IDropdownOption[] {
  return values.map((value) => ({ key: value, text: label(value) }));
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
const ASSERTION_STRENGTHS = ["categorical", "qualified", "conditional", "provisional"] as const;
const EVIDENCE_PROGRESSIONS = [
  "source-analysis-conclusion",
  "claim-evidence",
  "narrative",
] as const;
const RHETORICAL_STYLES = [
  "direct-analytical",
  "narrative",
  "forensic",
  "comparative",
  "argumentative",
  "explanatory",
] as const;

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

/** One labelled dropdown bound to a leaf of the profile. */
function EnumField<T extends string>(props: {
  id: string;
  label: string;
  value: T;
  values: readonly T[];
  onChange: (next: T) => void;
}): React.ReactNode {
  return (
    <Dropdown
      id={props.id}
      label={props.label}
      selectedKey={props.value}
      options={options(props.values)}
      onChange={(_event, option) => {
        if (option !== undefined) props.onChange(option.key as T);
      }}
    />
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
    <TextField
      id={props.id}
      label={`${props.label} (${props.min}-${props.max})`}
      value={draft}
      onChange={(_event, next) => setDraft(next ?? "")}
      onBlur={() => {
        const parsed = toNumber(draft, props.value, props.min, props.max);
        if (parsed !== props.value) props.onChange(parsed);
      }}
    />
  );
}

/** One collapsible group of controls. */
function Section(props: {
  title: string;
  summary: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <details className="tf-collapsible">
      <summary className="tf-sub">{props.title}</summary>
      <p className="tf-sub">{props.summary}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{props.children}</div>
    </details>
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
   * `Dropdown.onChange`, so a `ZodError` would escape an event handler with
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
    <section aria-labelledby="semantic-heading" className="tf-card">
      <h2 id="semantic-heading">Semantic style</h2>
      <p className="tf-sub">
        How the writing sounds rather than how it is punctuated. These values are what the semantic
        review reasons about and what a proposed rewrite is asked to match. Punctuation, spacing and
        house terminology are deterministic rules measured on the Deterministic Style Profile tab.
      </p>

      <Section
        title="Voice and tone"
        summary={`${label(semantic.tone.primary)} tone, ${label(semantic.voice.person)} voice, ${label(
          semantic.formality.label === "" ? semantic.register.primary : semantic.formality.label,
        )} register`}
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
        <EnumField
          id="sem-voice-person"
          label="Person"
          value={semantic.voice.person}
          values={["first", "third", "mixed", "impersonal"] as const}
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
          values={["active", "passive", "balanced"] as const}
          onChange={(next) =>
            edit((draft) => {
              draft.voice.construction = next;
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
          id="sem-qualification-frequency"
          label="Qualification frequency"
          value={semantic.qualificationStyle.frequency}
          values={["rare", "occasional", "frequent"] as const}
          onChange={(next) =>
            edit((draft) => {
              draft.qualificationStyle.frequency = next;
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
          id="sem-uncertainty"
          label="Incomplete evidence"
          value={semantic.uncertaintyStyle.incompleteEvidence}
          values={["stated", "implied", "suppressed"] as const}
          onChange={(next) =>
            edit((draft) => {
              draft.uncertaintyStyle.incompleteEvidence = next;
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
          id="sem-transitions"
          label="Transitions"
          value={semantic.transitions}
          values={["restrained", "explicit", "rhetorical"] as const}
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
          values={["named", "role", "impersonal", "mixed"] as const}
          onChange={(next) =>
            edit((draft) => {
              draft.agency.actorNaming = next;
            })
          }
        />
        <EnumField
          id="sem-conclusion"
          label="Conclusion form"
          value={semantic.conclusionStyle.form}
          values={["concise", "qualified", "recap", "opinion", "none"] as const}
          onChange={(next) =>
            edit((draft) => {
              draft.conclusionStyle.form = next;
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
        <TextField
          id="sem-tone-avoid"
          label="Words to avoid for tone (one per line)"
          multiline
          rows={3}
          value={semantic.lexicalPreferences.toneAvoid.join("\n")}
          onChange={(_event, next) =>
            edit((draft) => {
              draft.lexicalPreferences.toneAvoid = (next ?? "")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .slice(0, 100);
            })
          }
        />
        <TextField
          id="sem-notes"
          label="Notes"
          multiline
          rows={2}
          maxLength={240}
          value={semantic.notes.join("\n")}
          onChange={(_event, next) =>
            edit((draft) => {
              draft.notes = (next ?? "")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .slice(0, 20);
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
