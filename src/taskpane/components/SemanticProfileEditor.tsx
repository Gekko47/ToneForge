/**
 * SemanticProfileEditor — the editable half of a style profile.
 *
 * The deterministic style tab deliberately does not own these fields any more.
 * It used to render them as disabled inputs, which looked read-only but was not:
 * `buildCandidate` wrote every one of them back on each save, so a profile's
 * learned tone and voice were silently reset to whatever a hidden field held.
 * A field whose state is never read is a live default, not a read-only view.
 *
 * Here the opposite rule applies: these fields are the point of the tab, and
 * they are saved explicitly. Measured style is displayed read-only on the
 * Deterministic Style Profile tab, where it belongs, because it is *derived* —
 * showing a derived number next to an editable one invites editing the number
 * that will be overwritten on the next scan.
 */

import React from "react";
import { Dropdown, type IDropdownOption, TextField } from "@fluentui/react";
import { SemanticProfileSchema, type StyleProfile } from "../../core/domain/StyleProfile";

const REGISTERS: IDropdownOption[] = [
  { key: "simple", text: "Simple" },
  { key: "standard", text: "Standard" },
  { key: "technical", text: "Technical" },
  { key: "academic", text: "Academic" },
];

export interface SemanticProfileEditorProps {
  /** The semantic half of the profile being edited. */
  semantic: StyleProfile["semantic"];
  /** Persists an edit. Receives the whole semantic block, never a partial. */
  onSave: (semantic: StyleProfile["semantic"]) => void;
  disabled?: boolean;
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SemanticProfileEditor({
  semantic,
  onSave,
  disabled = false,
}: SemanticProfileEditorProps): React.ReactNode {
  const [tone, setTone] = React.useState(semantic.tone);
  const [voice, setVoice] = React.useState(semantic.voice);
  const [rhetoricalStyle, setRhetoricalStyle] = React.useState(semantic.rhetoricalStyle);
  const [formality, setFormality] = React.useState(String(semantic.formality));
  const [readingGrade, setReadingGrade] = React.useState(
    semantic.readingGradeTarget === null ? "" : String(semantic.readingGradeTarget),
  );
  const [sentenceLength, setSentenceLength] = React.useState(
    String(semantic.preferredSentenceLength),
  );
  const [avoidWords, setAvoidWords] = React.useState(semantic.avoidWords.join("\n"));

  // Re-seed when the parent swaps in a different profile. Without this the form
  // would keep showing the previously edited profile's values, and saving would
  // write them onto the new one.
  React.useEffect(() => {
    setTone(semantic.tone);
    setVoice(semantic.voice);
    setRhetoricalStyle(semantic.rhetoricalStyle);
    setFormality(String(semantic.formality));
    setReadingGrade(
      semantic.readingGradeTarget === null ? "" : String(semantic.readingGradeTarget),
    );
    setSentenceLength(String(semantic.preferredSentenceLength));
    setAvoidWords(semantic.avoidWords.join("\n"));
  }, [semantic]);

  function save(overrides: {
    vocabularyRegister?: StyleProfile["semantic"]["vocabularyRegister"];
    avoidWords?: string[];
  }): void {
    const candidate = {
      ...semantic,
      tone: tone.trim() === "" ? semantic.tone : tone,
      voice: voice.trim() === "" ? semantic.voice : voice,
      rhetoricalStyle: rhetoricalStyle.trim() === "" ? semantic.rhetoricalStyle : rhetoricalStyle,
      vocabularyRegister: overrides.vocabularyRegister ?? semantic.vocabularyRegister,
      avoidWords: overrides.avoidWords ?? semantic.avoidWords,
      formality: toNumber(formality, semantic.formality),
      readingGradeTarget:
        readingGrade.trim() === "" ? null : toNumber(readingGrade, semantic.formality),
      preferredSentenceLength: toNumber(sentenceLength, semantic.preferredSentenceLength),
    };
    // Parsed before it leaves: a form value that does not satisfy the schema
    // would otherwise be persisted and fail to load on the next session.
    onSave(SemanticProfileSchema.parse(candidate));
  }

  return (
    <section aria-labelledby="semantic-heading" className="tf-card">
      <h2 id="semantic-heading">Semantic style</h2>
      <p className="tf-sub">
        How the writing sounds rather than how it is punctuated. These values are what the
        consistency check and semantic rewrite reason about; the measured metrics on the
        Deterministic Style Profile tab are derived from text and cannot be edited here.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <TextField
          label="Tone"
          value={tone}
          disabled={disabled}
          onChange={(_event, next) => setTone(next ?? "")}
          onBlur={() => save({})}
        />
        <TextField
          label="Voice"
          value={voice}
          disabled={disabled}
          onChange={(_event, next) => setVoice(next ?? "")}
          onBlur={() => save({})}
        />
        <TextField
          label="Rhetorical style"
          value={rhetoricalStyle}
          disabled={disabled}
          onChange={(_event, next) => setRhetoricalStyle(next ?? "")}
          onBlur={() => save({})}
        />
        <Dropdown
          label="Vocabulary register"
          selectedKey={semantic.vocabularyRegister}
          options={REGISTERS}
          disabled={disabled}
          onChange={(_event, option) =>
            option !== undefined &&
            save({
              vocabularyRegister: option.key as StyleProfile["semantic"]["vocabularyRegister"],
            })
          }
        />
        <TextField
          label="Formality (0-100)"
          value={formality}
          disabled={disabled}
          onChange={(_event, next) => setFormality(next ?? "")}
          onBlur={() => save({})}
        />
        <TextField
          label="Reading grade target (blank for none)"
          value={readingGrade}
          disabled={disabled}
          onChange={(_event, next) => setReadingGrade(next ?? "")}
          onBlur={() => save({})}
        />
        <TextField
          label="Preferred sentence length (words)"
          value={sentenceLength}
          disabled={disabled}
          onChange={(_event, next) => setSentenceLength(next ?? "")}
          onBlur={() => save({})}
        />
      </div>

      <TextField
        label="Words to avoid (one per line)"
        multiline
        rows={3}
        value={avoidWords}
        disabled={disabled}
        onChange={(_event, next) => setAvoidWords(next ?? "")}
        onBlur={() => save({ avoidWords: splitLines(avoidWords) })}
        style={{ marginTop: 12 }}
      />
    </section>
  );
}

/** One word per line, blanks discarded, order kept. */
function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
