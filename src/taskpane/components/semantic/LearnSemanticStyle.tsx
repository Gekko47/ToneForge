import React from "react";
import { evaluateSampleQuality, type SampleQuality } from "../../../style/sampleQuality";
import {
  MAX_TEXT_FILE_BYTES,
  TEXT_FILE_EXTENSION,
  captureFromFileText,
  validateImportedText,
  validateTextFile,
} from "../../../style/textFileImport";
import { captureFromText, type CapturedSample } from "../../../style/sampleCapture";
import { getDocumentSnapshot, getSelectionText } from "../../../word/documentReader";
import { semanticGate, type SemanticGateInput } from "../../semantic/gates";

/**
 * The three ways a sample arrives: the open document, the user's selection, or a
 * `.txt` they picked — plus the disclosure of what leaves the machine.
 *
 * **The quality level is a persistent badge, not a warning.** A sample of 120
 * words is eligible; it just cannot support a confident profile. Rendering that as
 * a transient warning trains users to dismiss the one signal that would matter at
 * 40 words, so the badge carries the count, the level and the consequence, and
 * stays on screen after the acknowledgement (D7).
 *
 * **The disclosure is above the controls, not in Settings.** Spec §10 asks for it
 * before the send, and a disclosure the user has to go and find is not one: the
 * sentence that says what is about to leave is in the same place as the button
 * that sends it.
 *
 * **Reading the file is this component's job and the module's is not.** The pure
 * validator has no `File`, so the `File.text()` read lives here where the DOM is.
 */
export interface LearnSemanticStyleProps {
  gateInput: Omit<SemanticGateInput, "hasSelection" | "selectionChars">;
  onOpenSettings: () => void;
  /** Called with the captured sample the user chose, once it has been validated. */
  onLearn: (sample: CapturedSample) => void;
  busy: boolean;
}

type Source = "pasted" | "file" | "document";

export default function LearnSemanticStyle({
  gateInput,
  onOpenSettings,
  onLearn,
  busy,
}: LearnSemanticStyleProps): React.ReactNode {
  const [pasted, setPasted] = React.useState("");
  const [sample, setSample] = React.useState<CapturedSample | null>(null);
  const [source, setSource] = React.useState<Source>("pasted");
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const gate = semanticGate({ ...gateInput, hasSelection: false, selectionChars: 0 }, "learn");
  const quality: SampleQuality | null = sample === null ? null : evaluateSampleQuality(sample);
  /*
   * Acknowledgement is required only for the bands that are genuinely thin, and
   * only when the sample has not already been acknowledged. Recomputed from the
   * sample rather than stored per sample, so re-running the check on the same
   * text does not silently keep the previous answer.
   */
  const needsAcknowledgement =
    quality !== null &&
    quality.eligible &&
    (quality.level === "insufficient" || quality.level === "limited") &&
    !acknowledged;

  function offer(next: CapturedSample, from: Source): void {
    setSample(next);
    setSource(from);
    setRefusal(null);
    setAcknowledged(false);
  }

  function learnFromPasted(): void {
    const text = pasted.trim();
    if (text === "") return;
    offer(captureFromText(text, { source: "pasted_text" }), "pasted");
  }

  async function learnFromDocument(): Promise<void> {
    try {
      const [snapshot, selection] = await Promise.all([getDocumentSnapshot(), getSelectionText()]);
      /*
       * The selection wins when there is one, and the document is the fallback —
       * the same rule `captureSample` applies, spelled out here because this route
       * builds from text rather than from a snapshot.
       */
      const trimmed = selection.trim();
      const captured =
        trimmed.length > 0
          ? captureFromText(trimmed, { source: "word_selection" })
          : captureFromText(snapshot.analysisText ?? snapshot.text, { source: "word_document" });
      offer({ ...captured, documentId: snapshot.id }, "document");
    } catch (error: unknown) {
      setRefusal(
        `The document could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared either way: leaving the chosen filename in the control makes a
    // second press of the same button a no-op in some browsers.
    event.target.value = "";
    if (file === undefined) return;

    const validated = validateTextFile({ name: file.name, size: file.size, type: file.type });
    if (!validated.ok) {
      setRefusal(validated.rejection.sentence);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (error: unknown) {
      // A read can be refused after the size and type passed — a locked file, a
      // revoked permission, an I/O failure — and an unhandled rejection here would
      // leave the user with a control that did nothing and said nothing.
      setRefusal(
        `The file could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const content = validateImportedText(text);
    if (!content.ok) {
      setRefusal(content.rejection.sentence);
      return;
    }
    offer(captureFromFileText(text, validated.name), "file");
  }

  function submit(): void {
    if (sample === null || !gate.allowed || needsAcknowledgement) return;
    onLearn(sample);
  }

  const SOURCE_LABEL: Record<Source, string> = {
    pasted: "pasted text",
    file: sample?.filename ?? "a .txt file",
    document: sample?.source === "word_selection" ? "your selection" : "the open document",
  };

  return (
    <section aria-labelledby="learn-style-heading" className="tf-collapsible">
      <h2 id="learn-style-heading">Learn a style</h2>

      {/*
        The disclosure, before the controls. What leaves the machine is the sample
        and nothing else: the profile, the settings and the document never go.
      */}
      <p className="tf-sub">
        Learning sends <strong>your sample text</strong> — and nothing else — to the provider you
        have configured. The profile it produces, its history and your document stay on this
        machine. The sample itself is never stored: the profile records where it came from, how many
        words it held, and a hash that lets two samples be compared without keeping either.
      </p>

      <div>
        <label htmlFor="tf-learn-pasted">Paste a sample of your writing</label>
        <textarea
          className="tf-native"
          id="tf-learn-pasted"
          value={pasted}
          rows={5}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="Paste a few paragraphs you have written."
        />
        <button type="button" onClick={learnFromPasted} disabled={pasted.trim() === ""}>
          Use this text
        </button>
      </div>

      <div>
        <label htmlFor="tf-learn-file">Or choose a plain-text file</label>
        <input
          className="tf-native"
          id="tf-learn-file"
          type="file"
          accept={TEXT_FILE_EXTENSION}
          onChange={(event) => void onFileChosen(event)}
        />
        <p className="tf-sub">
          Up to {Math.round(MAX_TEXT_FILE_BYTES / 1024)} KB, read on this machine. Document formats
          are not accepted: a .docx is a binary archive, and reading it as text would send the
          file's internal structure rather than your writing.
        </p>
      </div>

      {/*
        The document route is last and behind its own control. Spec §6.4 makes the
        whole document optional and not the primary route, and learning from it
        sends more of someone's writing than any other route here.
      */}
      <button type="button" onClick={() => void learnFromDocument()} disabled={busy}>
        Use the current document
      </button>

      {refusal !== null && <p className="tf-debug-warning">{refusal}</p>}

      {sample !== null && quality !== null && (
        <div className="tf-card">
          <p data-testid="sample-quality" className="tf-sub">
            {quality.wordCount} {quality.wordCount === 1 ? "word" : "words"} — {quality.level}, from{" "}
            {SOURCE_LABEL[source]}.
          </p>
          {quality.warnings.map((warning) => (
            <p key={warning} className="tf-sub">
              {warning}
            </p>
          ))}
          {!quality.eligible && (
            <p className="tf-debug-warning">
              This sample cannot be learned from yet. {quality.reasons.join(" ")}
            </p>
          )}
          {needsAcknowledgement && (
            <label htmlFor="tf-learn-acknowledge">
              <input
                className="tf-native"
                id="tf-learn-acknowledge"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              Learn from this sample anyway.
            </label>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!gate.allowed || sample === null || needsAcknowledgement || busy}
      >
        {busy ? "Learning…" : "Learn style"}
      </button>

      {!gate.allowed && gate.blocker !== null && (
        <p className="tf-debug-warning">
          {gate.blocker}
          {gate.remedy?.destination === "settings" && (
            <>
              {" "}
              <button type="button" onClick={onOpenSettings}>
                {gate.remedy.label}
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
