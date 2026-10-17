/**
 * SelectedTextStyle — a read-only summary of a learned semantic profile.
 *
 * Renders the same sixteen dimensions as `SemanticProfileEditor` but as text
 * boxes (read-only `<Input>` and `<Textarea>`) rather than dropdowns. This
 * is the "Selected Text Style" section the user sees after learning a style
 * from a sample — it shows what the model produced before the user decides
 * to edit or activate it.
 *
 * The component is purely presentational: it receives a `SemanticStyleProfile`
 * and renders it. No state, no callbacks, no side effects.
 */

import React from "react";
import { Button, Input, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { DisclosurePanel } from "../common";
import {
  isDefaultSemanticStyle,
  type SemanticStyleProfile,
} from "../../../core/domain/SemanticStyleProfile";

/** `direct-analytical` reads as `Direct analytical`. */
function label(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
  field: {
    flex: "1 1 280px",
    minWidth: "240px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalM,
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

/** One read-only text box bound to a leaf of the profile. */
function TextField(props: { id: string; label: string; value: string }): React.ReactNode {
  const styles = useSectionStyles();
  return (
    <div className={styles.field}>
      <label htmlFor={props.id}>{props.label}</label>
      <Input id={props.id} value={props.value} readOnly />
    </div>
  );
}

/** One read-only numeric text box bound to a leaf of the profile. */
function NumberField(props: { id: string; label: string; value: number }): React.ReactNode {
  const styles = useSectionStyles();
  return (
    <div className={styles.field}>
      <label htmlFor={props.id}>{props.label}</label>
      <Input id={props.id} value={String(props.value)} readOnly />
    </div>
  );
}

/** One read-only boolean text box bound to a leaf of the profile. */
function BooleanField(props: { id: string; label: string; value: boolean }): React.ReactNode {
  const styles = useSectionStyles();
  return (
    <div className={styles.field}>
      <label htmlFor={props.id}>{props.label}</label>
      <Input id={props.id} value={props.value ? "Yes" : "No"} readOnly />
    </div>
  );
}

/** One read-only multiline text box bound to a list leaf of the profile. */
function LinesField(props: {
  id: string;
  label: string;
  value: readonly string[];
}): React.ReactNode {
  const styles = useSectionStyles();
  return (
    <div className={styles.field}>
      <label htmlFor={props.id}>{props.label}</label>
      <Textarea id={props.id} value={props.value.join("\n")} readOnly rows={2} />
    </div>
  );
}

export interface SelectedTextStyleProps {
  /** The semantic profile to display. */
  semantic: SemanticStyleProfile;
  /** Empties every field. The page persists the result. */
  onClear: () => void;
  /** Copies these values into the editable semantic style section. */
  onUse: () => void;
}

/**
 * Render a semantic profile as read-only text boxes.
 *
 * The section heading is "Selected Text Style" per the user's requirement.
 * Every field from the sixteen dimensions is shown, grouped into the same
 * sections the editor uses, so the user can see exactly what the model
 * produced.
 */
export default function SelectedTextStyle({
  semantic,
  onClear,
  onUse,
}: SelectedTextStyleProps): React.ReactNode {
  /*
   * Both buttons act on the identified values, so both are meaningless once
   * there are none. `isDefaultSemanticStyle` is the same predicate the
   * extraction path uses to refuse an empty analysis, so "nothing identified"
   * means one thing here and there.
   */
  const empty = isDefaultSemanticStyle(semantic);

  return (
    <section aria-labelledby="selected-text-style-heading">
      <h2 id="selected-text-style-heading">Selected Text Style</h2>
      <p className="tf-sub">
        What the model identified from your sample. These values are a starting point — edit them
        below to match your voice.
      </p>

      <Section
        title="Voice and tone"
        summary={`${label(semantic.tone.primary)} tone, ${label(semantic.voice.person)} voice, ${label(
          semantic.formality.label === "" ? semantic.register.primary : semantic.formality.label,
        )} register`}
      >
        <TextField
          id="sts-tone-primary"
          label="Primary tone"
          value={label(semantic.tone.primary)}
        />
        <LinesField
          id="sts-tone-secondary"
          label="Secondary tones"
          value={semantic.tone.secondary}
        />
        <TextField
          id="sts-tone-description"
          label="Tone description"
          value={semantic.tone.description}
        />
        <TextField id="sts-voice-person" label="Person" value={label(semantic.voice.person)} />
        <TextField
          id="sts-voice-construction"
          label="Active or passive"
          value={label(semantic.voice.construction)}
        />
        <TextField
          id="sts-voice-authorial"
          label="Authorial presence"
          value={label(semantic.voice.authorialPresence)}
        />
        <TextField
          id="sts-voice-description"
          label="Voice description"
          value={semantic.voice.description}
        />
        <TextField id="sts-register" label="Register" value={label(semantic.register.primary)} />
        <TextField
          id="sts-register-description"
          label="Register description"
          value={semantic.register.description}
        />
        <NumberField id="sts-formality" label="Formality" value={semantic.formality.score} />
        <TextField
          id="sts-formality-label"
          label="Formality label"
          value={semantic.formality.label}
        />
      </Section>

      <Section
        title="Assertions and qualification"
        summary={`${label(semantic.assertionStyle.strength)} assertions, ${label(
          semantic.qualificationStyle.frequency,
        )} qualification`}
      >
        <TextField
          id="sts-assertion-strength"
          label="Assertion strength"
          value={label(semantic.assertionStyle.strength)}
        />
        <TextField
          id="sts-assertion-ordering"
          label="Assertion ordering"
          value={label(semantic.assertionStyle.ordering)}
        />
        <TextField
          id="sts-assertion-directness"
          label="Assertion directness"
          value={label(semantic.assertionStyle.directness)}
        />
        <TextField
          id="sts-qualification-frequency"
          label="Qualification frequency"
          value={label(semantic.qualificationStyle.frequency)}
        />
        <TextField
          id="sts-qualification-strength"
          label="Qualification strength"
          value={label(semantic.qualificationStyle.strength)}
        />
        <TextField
          id="sts-qualification-exceptions"
          label="Qualification exceptions"
          value={label(semantic.qualificationStyle.exceptions)}
        />
        <BooleanField
          id="sts-qualification-conditionals"
          label="Uses conditionals"
          value={semantic.qualificationStyle.conditionals}
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
          id="sts-evidence-record-first"
          label="Record first"
          value={semantic.evidenceFraming.recordFirst}
        />
        <TextField
          id="sts-evidence-attribution"
          label="Attribution"
          value={label(semantic.evidenceFraming.attribution)}
        />
        <TextField
          id="sts-evidence-quotation"
          label="Quotation"
          value={label(semantic.evidenceFraming.quotation)}
        />
        <BooleanField
          id="sts-evidence-explicit-refs"
          label="Explicit references"
          value={semantic.evidenceFraming.explicitReferences}
        />
        <TextField
          id="sts-evidence-progression"
          label="Evidence progression"
          value={label(semantic.evidenceFraming.progression)}
        />
        <TextField
          id="sts-uncertainty-incomplete"
          label="Incomplete evidence"
          value={label(semantic.uncertaintyStyle.incompleteEvidence)}
        />
        <TextField
          id="sts-uncertainty-confidence"
          label="Confidence language"
          value={label(semantic.uncertaintyStyle.confidenceLanguage)}
        />
        <TextField
          id="sts-uncertainty-modality"
          label="Modality"
          value={label(semantic.uncertaintyStyle.modality)}
        />
        <BooleanField
          id="sts-uncertainty-avoids-certainty"
          label="Avoids unsupported certainty"
          value={semantic.uncertaintyStyle.avoidsUnsupportedCertainty}
        />
      </Section>

      <Section
        title="Structure"
        summary={`${semantic.sentenceArchitecture.targetWords}-word sentences, ${label(
          semantic.paragraphArchitecture.ordering,
        )} paragraphs`}
      >
        <TextField
          id="sts-sentence-complexity"
          label="Sentence complexity"
          value={label(semantic.sentenceArchitecture.complexity)}
        />
        <NumberField
          id="sts-sentence-target"
          label="Sentence length"
          value={semantic.sentenceArchitecture.targetWords}
        />
        <TextField
          id="sts-sentence-variability"
          label="Sentence variability"
          value={label(semantic.sentenceArchitecture.sentenceVariability)}
        />
        <TextField
          id="sts-sentence-coordination"
          label="Coordination"
          value={label(semantic.sentenceArchitecture.coordination)}
        />
        <BooleanField
          id="sts-sentence-short-closing"
          label="Short closing sentence"
          value={semantic.sentenceArchitecture.shortClosingSentence}
        />
        <TextField
          id="sts-paragraph-function"
          label="Paragraph function"
          value={label(semantic.paragraphArchitecture.function)}
        />
        <TextField
          id="sts-paragraph-ordering"
          label="Paragraph ordering"
          value={label(semantic.paragraphArchitecture.ordering)}
        />
        <NumberField
          id="sts-paragraph-target"
          label="Paragraph length"
          value={semantic.paragraphArchitecture.targetWords}
        />
        <TextField
          id="sts-paragraph-variability"
          label="Paragraph variability"
          value={label(semantic.paragraphArchitecture.paragraphVariability)}
        />
        <TextField
          id="sts-paragraph-propositions"
          label="Propositions"
          value={label(semantic.paragraphArchitecture.propositions)}
        />
        <TextField id="sts-transitions" label="Transitions" value={label(semantic.transitions)} />
      </Section>

      <Section
        title="Agency, register and conclusions"
        summary={`${label(semantic.agency.actorNaming)} actors, ${label(
          semantic.rhetoricalStyle,
        )} rhetoric`}
      >
        <TextField
          id="sts-rhetorical"
          label="Rhetorical style"
          value={label(semantic.rhetoricalStyle)}
        />
        <TextField
          id="sts-agency-actor"
          label="Actor naming"
          value={label(semantic.agency.actorNaming)}
        />
        <TextField
          id="sts-agency-attribution"
          label="Attribution precision"
          value={label(semantic.agency.attributionPrecision)}
        />
        <TextField
          id="sts-technicality-density"
          label="Technicality density"
          value={label(semantic.technicality.density)}
        />
        <BooleanField
          id="sts-technicality-explains"
          label="Explains terms"
          value={semantic.technicality.explainsTerms}
        />
        <TextField
          id="sts-technicality-abbreviations"
          label="Abbreviation tendency"
          value={label(semantic.technicality.abbreviationTendency)}
        />
        <TextField
          id="sts-conclusion-form"
          label="Conclusion form"
          value={label(semantic.conclusionStyle.form)}
        />
        <BooleanField
          id="sts-conclusion-avoids-repetition"
          label="Avoids repetition"
          value={semantic.conclusionStyle.avoidsRepetition}
        />
      </Section>

      <Section
        title="Lexical preferences and notes"
        summary={`${semantic.lexicalPreferences.toneAvoid.length} tone-avoided word${
          semantic.lexicalPreferences.toneAvoid.length === 1 ? "" : "s"
        }`}
      >
        <LinesField
          id="sts-tone-avoid"
          label="Words to avoid for tone (one per line)"
          value={semantic.lexicalPreferences.toneAvoid}
        />
        <BooleanField
          id="sts-prefers-neutral-verbs"
          label="Prefers neutral verbs"
          value={semantic.lexicalPreferences.prefersNeutralVerbs}
        />
        <TextField
          id="sts-evaluative-language"
          label="Evaluative language"
          value={label(semantic.lexicalPreferences.evaluativeLanguage)}
        />
      </Section>

      {/*
        Two decisions, deliberately separate.

        Discarding is local and free: the identified values live in the page's
        own state and nothing has been written, so a mis-identified sample costs
        one press rather than a re-learn. Importing is the opposite — it carries
        the identified values into a profile, which is where a user goes to
        change them, and the page then moves them to the publish control.

        Neither activates anything. Activation stays the explicit press in "Use
        this style" below, because a profile that starts steering every review
        is a decision the user has to make on purpose.
      */}
      <div className={useSectionStyles().actions}>
        <Button onClick={onClear} disabled={empty}>
          Clear identified style
        </Button>
        <Button appearance="primary" onClick={onUse} disabled={empty}>
          Use as preferred style
        </Button>
      </div>
    </section>
  );
}
