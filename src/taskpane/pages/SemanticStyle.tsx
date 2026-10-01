import React from "react";
import SemanticProfileEditor from "../components/SemanticProfileEditor";
import SemanticProfilePicker from "../components/SemanticProfilePicker";
import {
  createSemanticProfileRecord,
  loadSemanticProfileRecord,
  loadState,
  removeSemanticProfile,
  saveSemanticProfileRecord,
  setActiveSemanticProfile,
} from "../../core/state/persistence";
import { selectKindRecordList } from "../../core/state/profileSelectors";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import { captureFromText, captureSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import { updateDraft, effectiveProfile, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { createEmptyProfile, type StyleProfile } from "../../core/domain/StyleProfile";
import { getDocumentSnapshot, getSelectionText } from "../../word/documentReader";
import { semanticGate, type SemanticGateInput } from "../semantic/gates";
import { deriveSemanticAnnouncement } from "../state/semanticAnnouncement";
import { syncSemanticRibbon } from "../../commands/ribbonState";

/**
 * The semantic style page: what the writing should sound like, and how you know.
 *
 * **Separate from Semantic Review, and not as a subsection of it.** The old tab
 * carried the profile, the measured context and the rewrite in one page, and the
 * rewrite was the page's headline — so the thing the product is for read as a
 * feature of style management. They are two decisions with two different costs:
 * learning a style sends a sample once and is then local, while a review sends the
 * user's own paragraph on every press. Putting them behind one heading made the
 * second look like the first.
 *
 * The learning inputs, the sample-quality badge and the profile history are P8;
 * what is here is the profile itself — picker, diagnostics, editor — moved whole
 * out of the old page so the split changes no behaviour.
 */
export interface SemanticStyleProps {
  onBack: () => void;
  onOpenSettings: () => void;
  /** Told when the active semantic profile changes, so Review can re-gate. */
  onProfileChanged?: (hasProfile: boolean) => void;
}

export default function SemanticStyle({
  onBack,
  onOpenSettings,
  onProfileChanged,
}: SemanticStyleProps): React.ReactNode {
  /*
   * One read of the store, in a lazy initialiser. Reading it again in an effect
   * would pair this component with a second snapshot of the state; reading it in
   * the render body would re-read on every keystroke for no benefit.
   */
  const [initial] = React.useState(() => {
    const state = loadState();
    const active = state.activeSemanticProfileId;
    return {
      state,
      record: active === null ? null : loadSemanticProfileRecord(active),
      records: selectKindRecordList(state, "semantic"),
    };
  });

  const [record, setRecord] = React.useState<ProfileRecord | null>(initial.record);
  const [records, setRecords] = React.useState(initial.records);
  const [activeId, setActiveId] = React.useState(initial.state.activeSemanticProfileId);
  const [learnStatus, setLearnStatus] = React.useState<string | null>(null);
  const [learnError, setLearnError] = React.useState<string | null>(null);
  const [learning, setLearning] = React.useState(false);
  const [pastedSample, setPastedSample] = React.useState("");

  const state = initial.state;
  const settings = state.settings;
  const profile: StyleProfile | null = record === null ? null : effectiveProfile(record);

  /*
   * Keep the ribbon button honest. It is declared disabled in the manifest and
   * enabled only from here, so a profile coming into existence is what turns it
   * on — which is why the *active* profile matters and not merely any profile.
   */
  React.useEffect(() => {
    void syncSemanticRibbon(profile !== null);
    onProfileChanged?.(profile !== null);
  }, [profile, onProfileChanged]);

  /**
   * Re-read the picker list after a write, so the list cannot disagree with what is
   * stored — the same rule the ignore path settled on, and for the same reason.
   */
  function refreshRecords(): void {
    setRecords(selectKindRecordList(loadState(), "semantic"));
  }

  function selectProfile(id: string): void {
    setActiveSemanticProfile(id);
    setActiveId(id);
    setRecord(loadSemanticProfileRecord(id));
    refreshRecords();
  }

  /**
   * A blank semantic profile, with no sample behind it.
   *
   * Learning needs a sample that passes the quality gate, so without this the
   * page is unreachable for anyone whose document is too short — and the only
   * route in runs a model over their prose. The `kind` is passed explicitly
   * because the record rewrites it on save anyway, and a default of
   * "deterministic" would be a typo waiting to happen.
   */
  function createBlankProfile(): void {
    const created = createSemanticProfileRecord(
      "New semantic style",
      new Date().toISOString(),
      createEmptyProfile("New semantic style", 1, "semantic"),
    );
    setRecord(created);
    setActiveId(created.id);
    // Stored as active as well as selected locally: the ribbon button is enabled by
    // the *active* profile's existence, and a selected-but-inactive profile leaves
    // it greyed out with nothing saying why.
    setActiveSemanticProfile(created.id);
    refreshRecords();
    setLearnStatus("Created an empty semantic profile. Set its voice below, or delete it here.");
  }

  function deleteProfile(id: string): void {
    removeSemanticProfile(id);
    const active = loadState().activeSemanticProfileId;
    setActiveId(active);
    setRecord(active === null ? null : loadSemanticProfileRecord(active));
    refreshRecords();
  }

  function persistSemantic(semantic: StyleProfile["semantic"]): void {
    if (record === null) return;
    /*
     * The published version is a valid base. A record whose draft has been
     * published and discarded has no draft, and returning here dropped every edit
     * made to it — the editor showed a profile that could not be saved.
     */
    const base = record.draft ?? effectiveProfile(record);
    if (base === null) return;
    // Through `updateDraft`, not around it: the record is the audit trail, and it
    // assigns the revision number and the timestamp that make the edit attributable.
    const { record: updated } = updateDraft(
      record,
      { ...base, semantic },
      new Date().toISOString(),
    );
    // The semantic writer, so the edit cannot land in the deterministic record
    // under the same id and quietly diverge from it.
    saveSemanticProfileRecord(updated);
    setRecord(updated);
  }

  async function learnFromCurrentDocument(): Promise<void> {
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    try {
      const [snapshot, text] = await Promise.all([getDocumentSnapshot(), getSelectionText()]);
      const sample = captureSample(text, snapshot);
      const includeSemantic =
        settings.semanticOptIn && isRemoteProviderConfigured(settings, state.providerConnections);
      const result = await learnStyleDraft(sample, {
        name: "Learned semantic style",
        includeSemantic,
        ...(includeSemantic
          ? { registry: createRegistryFromSettings(settings, state.providerConnections) }
          : {}),
      });
      const created = createSemanticProfileRecord(
        result.draft.name,
        new Date().toISOString(),
        result.draft,
      );
      setRecord(created);
      setActiveSemanticProfile(created.id);
      setActiveId(created.id);
      refreshRecords();
      setLearnStatus(
        `Learned from ${result.evidence.source} sample (${result.evidence.wordCount} words).`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  /**
   * Learn from text the user pasted.
   *
   * The other route onto this page. Learning from the open document alone left a
   * user whose document was too short with no way to create a profile from their
   * own writing at all. It is the same `learnStyleDraft` call, so the quality gate,
   * the profiler and the provider consent are identical — pasting is not a way
   * around any of them.
   */
  async function learnFromPastedText(): Promise<void> {
    const text = pastedSample.trim();
    if (text === "") return;
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    try {
      const includeSemantic =
        settings.semanticOptIn && isRemoteProviderConfigured(settings, state.providerConnections);
      const result = await learnStyleDraft(captureFromText(text, { source: "pasted_text" }), {
        name: "Learned semantic style",
        includeSemantic,
        ...(includeSemantic
          ? { registry: createRegistryFromSettings(settings, state.providerConnections) }
          : {}),
      });
      const created = createSemanticProfileRecord(
        result.draft.name,
        new Date().toISOString(),
        result.draft,
      );
      setRecord(created);
      setActiveSemanticProfile(created.id);
      setActiveId(created.id);
      refreshRecords();
      setPastedSample("");
      setLearnStatus(
        `Learned from pasted text (${result.evidence.wordCount} words). The box has been cleared.`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  const gateInput: SemanticGateInput = {
    consent: settings.semanticOptIn === true,
    providerConfigured: isRemoteProviderConfigured(settings, state.providerConnections),
    hasProfile: profile !== null,
    hasSelection: false,
    reviewing: false,
    applying: false,
    hasProposal: false,
    preservationPassed: false,
    warningsAcknowledged: false,
    selectionChars: 0,
  };
  const learnGate = semanticGate(gateInput, "learn");

  const announcement = deriveSemanticAnnouncement({
    status: learnStatus,
    error: learnError,
    selection: null,
  });

  return (
    <div className="tf-card" data-page="semantic-style">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Semantic Review
        </button>
      </nav>

      <h1 className="tf-title">Semantic Style</h1>
      <p className="tf-sub">
        How the writing should sound, rather than how it is punctuated. These values are what a
        semantic review reasons about. Editing them here sends nothing anywhere.
      </p>

      <section aria-labelledby="learn-style-heading" className="tf-collapsible">
        <h2 id="learn-style-heading">Learn a style</h2>
        <p className="tf-sub">
          Capture the current selection when present, otherwise the eligible document text, check
          sample quality, and create a new semantic profile. AI interpretation is used only when
          consent and a configured provider are available.
        </p>
        <button
          type="button"
          onClick={() => void learnFromCurrentDocument()}
          disabled={learning || !learnGate.allowed}
        >
          {learning ? "Learning style…" : "Use current document"}
        </button>

        <div>
          <label htmlFor="tf-learn-pasted">Or paste a sample of your writing</label>
          <textarea
            id="tf-learn-pasted"
            value={pastedSample}
            rows={5}
            onChange={(event) => setPastedSample(event.target.value)}
            placeholder="Paste a few paragraphs you have written."
          />
          <button
            type="button"
            onClick={() => void learnFromPastedText()}
            disabled={learning || pastedSample.trim() === "" || !learnGate.allowed}
          >
            Learn from pasted text
          </button>
          <p className="tf-sub">
            The same quality checks apply, and pasted text is only sent to a provider if you have
            given consent.
          </p>
        </div>

        {!learnGate.allowed && learnGate.blocker !== null && (
          <p className="tf-debug-warning">
            {learnGate.blocker}
            {learnGate.remedy?.destination === "settings" && (
              <>
                {" "}
                <button type="button" onClick={onOpenSettings}>
                  {learnGate.remedy.label}
                </button>
              </>
            )}
          </p>
        )}
      </section>

      {/*
        The page's one live region, for the learning outcomes. The review page has
        its own; ADR-0062's rule is one region per page, not one per pane, because
        these are different destinations and only one is ever on screen.
      */}
      <p
        role={announcement?.assertive === true ? "alert" : "status"}
        className={announcement?.assertive === true ? "tf-error" : "tf-sub"}
      >
        {announcement?.text ?? ""}
      </p>

      {/*
        Above everything that depends on a profile existing, because it is also how
        one comes into existence.
      */}
      <SemanticProfilePicker
        records={records}
        activeId={activeId}
        activeRecord={record}
        onSelect={selectProfile}
        onCreateEmpty={createBlankProfile}
        onDelete={deleteProfile}
      />

      {profile === null ? (
        <section aria-labelledby="no-profile-heading" className="tf-card">
          <h2 id="no-profile-heading">No semantic profile is active</h2>
          <p className="tf-sub">
            There is nothing to review against yet. A semantic profile says how the writing should
            sound, so without one there is no style to match against and nothing for Semantic Review
            to compare. Learn one above, or create an empty profile and set its voice.
          </p>
        </section>
      ) : (
        <>
          {/*
            Every measured metric, not a selection of them.

            The deterministic profile editor used to render all eight as a read-only
            list and the Semantic tab rendered four. Moving the block without the
            other four would have deleted them from the interface entirely — em dash,
            en dash and curly quote frequency and capitalization consistency would
            have become invisible numbers the engine still used.

            Read-only and labelled as derived: the next scan overwrites anything
            typed here, so an editable-looking field would be a value that silently
            does not stick.
          */}
          <section aria-labelledby="measured-heading" className="tf-card">
            <h2 id="measured-heading">Measured style</h2>
            <p className="tf-sub">
              Derived from your writing on every scan, so it is shown rather than edited. The rules
              these numbers were measured from are on the Deterministic Style Profile tab.
            </p>
            <dl>
              <dt>Average sentence length</dt>
              <dd>{count(profile.measured.avgSentenceLength, "words")}</dd>
              <dt>Sentence length spread</dt>
              <dd>{count(profile.measured.sentenceLengthStdDev, "words")}</dd>
              <dt>Average paragraph length</dt>
              <dd>{count(profile.measured.paragraphLengthAvg, "words")}</dd>
              <dt>Em dash frequency</dt>
              <dd>{rate(profile.measured.emDashFrequency)}</dd>
              <dt>En dash frequency</dt>
              <dd>{rate(profile.measured.enDashFrequency)}</dd>
              <dt>Curly quote frequency</dt>
              <dd>{rate(profile.measured.curlyQuoteFrequency)}</dd>
              <dt>Capitalization consistency</dt>
              <dd>{percent(profile.measured.capitalizationConsistency)}</dd>
              <dt>Sample size</dt>
              <dd>{count(profile.measured.sampleWordCount, "words")}</dd>
            </dl>
          </section>

          {/*
            Not disabled by missing consent. Consent governs sending the user's text
            to a provider; typing a tone into a local field sends nothing. Refusing
            to let someone edit their own style is a different rule from the one
            that protects their prose, and conflating them locks out exactly the
            user who declined.
          */}
          <SemanticProfileEditor semantic={profile.semantic} onSave={persistSemantic} />
        </>
      )}
    </div>
  );
}

/**
 * A measured value, or a stated absence.
 *
 * Every field in `measured` is nullable because a profile learned from too short a
 * sample has no value for it. Printing "0" or a bare blank for a missing
 * measurement reads as a real zero, which is a different claim.
 */
function count(value: number | null, unit: string): string {
  return value === null ? "not measured yet" : `${Math.round(value)} ${unit}`;
}

/**
 * A per-100-words rate, to one decimal.
 *
 * `count` rounds to a whole number, which is right for a sentence length and wrong
 * here: these rates are typically single digits, so rounding 3.1 to 3 throws away a
 * third of the value and 0.4 to 0 reports a real occurrence as none at all.
 */
function rate(value: number | null): string {
  return value === null ? "not measured yet" : `${value.toFixed(1)} per 100 words`;
}

/**
 * A proportion, as a percentage.
 *
 * `capitalizationConsistency` is `capitalized / sentences.length` — between 0 and
 * 1, not between 0 and 100. It needs its own formatter precisely because it does
 * not share a scale with anything else on this list, and rounding it as though it
 * did turns 96.5% into "1".
 */
function percent(value: number | null): string {
  return value === null ? "not measured yet" : `${Math.round(value * 100)}%`;
}
