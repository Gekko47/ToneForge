import React from "react";
import SemanticProfileEditor from "../components/SemanticProfileEditor";
import SemanticProfilePicker from "../components/SemanticProfilePicker";
import ProfileRecordSection from "../components/ProfileRecordSection";
import LearnSemanticStyle from "../components/semantic/LearnSemanticStyle";
import {
  createSemanticProfileRecord,
  loadSemanticProfileRecord,
  loadSemanticSampleEvidence,
  loadState,
  removeSemanticProfile,
  saveSemanticProfileRecord,
  saveSemanticSampleEvidence,
  setActiveSemanticProfile,
} from "../../core/state/persistence";
import { selectKindRecordList } from "../../core/state/profileSelectors";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import type { CapturedSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import { updateDraft, effectiveProfile, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { createEmptyProfile, type StyleProfile } from "../../core/domain/StyleProfile";
import type { SemanticGateInput } from "../semantic/gates";
import { deriveSemanticAnnouncement } from "../state/semanticAnnouncement";
import { syncSemanticRibbon } from "../../commands/ribbonState";

/**
 * The semantic style page: what the writing should sound like, and how you know.
 *
 * **Separate from Semantic Review, and not as a subsection of it.** The old tab
 * carried the profile, the measured context and the rewrite in one page, and the
 * rewrite was the page's headline — so the thing the product is for read as a
 * feature of style management. They are two decisions with two different costs:
 * learning a style sends a sample once and is then local, while a review sends
 * the user's own paragraph on every press. Putting them behind one heading made
 * the second look like the first.
 *
 * **Learning does not activate.** It produces a draft, and "Make this active" is
 * a second, explicit press (spec §11). The old path activated whatever it
 * learned, so the review pipeline switched to a voice the user had not looked at
 * yet — and "Save" and "Save and set active" were the same button.
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
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  /*
   * The record section's own sentence, routed here rather than into a second
   * live region. `ProfileRecordSection` renders one of its own on the Profile
   * page, where nothing else speaks; here this page already has a region, and
   * ADR-0062's rule is one per pane.
   */
  const [recordAnnouncement, setRecordAnnouncement] = React.useState<string | null>(null);

  const state = initial.state;
  const settings = state.settings;
  const profile: StyleProfile | null = record === null ? null : effectiveProfile(record);
  const evidence = record === null ? null : loadSemanticSampleEvidence(record.id);

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
   * Re-read the picker list after a write, so the list cannot disagree with what
   * is stored — the same rule the ignore path settled on, and for the same reason.
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

  /**
   * Learn from a sample the user chose, and stop short of activating it.
   *
   * `activate: false` is the whole of §11: the draft is created, the evidence is
   * recorded, and the profile becomes the one reviews use only when the user says
   * so. Activating here would switch the review pipeline to a voice nobody has
   * read yet.
   */
  async function learn(sample: CapturedSample): Promise<void> {
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    setRecordAnnouncement(null);
    try {
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
        { activate: false },
      );
      /*
       * The evidence is recorded as the sample is learned, not when the profile
       * is activated — the sample is what the evidence describes, and a user who
       * learns, reviews and then discards has still learned from something.
       * Metadata only: no text, by construction of the schema.
       */
      saveSemanticSampleEvidence({
        id: created.id,
        source: result.evidence.source,
        ...(result.evidence.filename === undefined ? {} : { filename: result.evidence.filename }),
        ...(result.evidence.documentId === undefined
          ? {}
          : { documentId: result.evidence.documentId }),
        wordCount: result.evidence.wordCount,
        sentenceCount: result.evidence.sentenceCount,
        paragraphCount: result.evidence.paragraphCount,
        capturedAt: result.evidence.capturedAt,
        sampleHash: result.evidence.sampleHash,
      });
      setRecord(created);
      refreshRecords();
      setLearnStatus(
        `Learned a draft from ${result.evidence.wordCount} words of ${result.evidence.source}. Edit it below, then make it active when you are ready.`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  /** The explicit second press: this draft becomes the profile reviews use. */
  function activateDraft(): void {
    if (record === null) return;
    setActiveSemanticProfile(record.id);
    setActiveId(record.id);
    refreshRecords();
    setLearnStatus("This style is now active for Semantic Review.");
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

  /*
   * One sentence from one place. The record section's announcement is folded in
   * here rather than rendered beside it, so a publish and a learn cannot both
   * speak in the same tick and be read in DOM order instead of in the order they
   * happened. The record section clears the learning status on every action, so
   * whichever is set is whichever happened last.
   */
  const announcement = deriveSemanticAnnouncement({
    status: recordAnnouncement ?? learnStatus,
    error: learnError,
    selection: null,
  });

  const isActive = record !== null && activeId === record.id;

  return (
    <div className="tf-card" data-page="semantic-style">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Semantic Review
        </button>
      </nav>

      <h1 className="tf-title">Semantic Style</h1>
      <p className="tf-sub">
        How the writing should sound, rather than how it is punctuated. These values are what a
        semantic review reasons about. Editing them here sends nothing anywhere.
      </p>

      <LearnSemanticStyle
        gateInput={gateInput}
        onOpenSettings={onOpenSettings}
        onLearn={(sample) => void learn(sample)}
        busy={learning}
      />

      {/*
        This page's one live region, for the learning outcomes. The review page has
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

      {record === null || profile === null ? (
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
            Save and Save-and-set-active are one control until they are two.

            `ProfileRecordSection` publishes a draft and activates it together,
            which is right for the deterministic profile — one thing a user does
            to that profile. Here it is two decisions, because the draft is what a
            just-learned profile is: something to read before it starts steering
            every review.
          */}
          {!isActive && (
            <p className="tf-sub">
              This draft is not active yet, so Semantic Review still uses the profile you chose
              before.
            </p>
          )}

          {/*
            Not disabled by missing consent. Consent governs sending the user's
            text to a provider; typing a tone into a local field sends nothing.
            Refusing to let someone edit their own style is a different rule from
            the one that protects their prose, and conflating them locks out
            exactly the user who declined.
          */}
          <SemanticProfileEditor semantic={profile.semantic} onSave={persistSemantic} />

          <section aria-labelledby="draft-actions-heading" className="tf-card">
            <h2 id="draft-actions-heading">Use this style</h2>
            <p className="tf-sub">
              Saving keeps it as a draft. Making it active changes what every Semantic Review is
              measured against, so it is a separate press.
            </p>
            <div className="tf-actions">
              <button
                className="tf-native-button"
                type="button"
                disabled={isActive}
                onClick={activateDraft}
              >
                {isActive ? "Active" : "Make this active"}
              </button>
            </div>
          </section>

          {evidence !== null && (
            <section aria-labelledby="evidence-heading" className="tf-card">
              <h2 id="evidence-heading">Where this style came from</h2>
              <p className="tf-sub">
                {evidence.wordCount} {evidence.wordCount === 1 ? "word" : "words"} from{" "}
                {evidence.source === "text_file"
                  ? (evidence.filename ?? "a .txt file")
                  : evidence.source === "pasted_text"
                    ? "text you pasted"
                    : evidence.source === "word_selection"
                      ? "your selection"
                      : "the open document"}
                , captured {evidence.capturedAt.slice(0, 10)}. The sample itself is not stored.
              </p>
            </section>
          )}

          {/*
            Sample diagnostics, collapsed by default.

            Every measured metric, not a selection of them — the deterministic
            profile editor rendered all eight and the Semantic tab four, and
            moving four would have deleted the other four from the interface while
            the engine kept using them. They are labelled as derived, because the
            next scan overwrites anything typed here, and collapsed, because they
            do not govern Semantic Review and a reader who has to pass them to
            reach the editor has been told they matter (D9, ADR-0076).
          */}
          <section aria-labelledby="diagnostics-heading" className="tf-card">
            <h2 id="diagnostics-heading">Sample diagnostics</h2>
            <p className="tf-sub">
              Measured from your writing on every scan. These numbers do not control Semantic
              Review; they are here so you can see what the measured half of this profile holds.
            </p>
            <button
              type="button"
              className="tf-native-button tf-collapsible-header"
              aria-expanded={diagnosticsOpen}
              onClick={() => setDiagnosticsOpen((open) => !open)}
            >
              {diagnosticsOpen ? "Hide diagnostics" : "Show diagnostics"}
            </button>
            {diagnosticsOpen && (
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
            )}
          </section>

          {/*
            The semantic record's own revision history, which existed but were never
            rendered here: the section was wired only on the deterministic Profile
            page, so a learned profile had publish, activate and recall controls
            the user could not reach (spec §31).
          */}
          <ProfileRecordSection
            record={record}
            onChange={setRecord}
            onAnnounce={(message) => {
              setLearnStatus(null);
              setRecordAnnouncement(message);
            }}
          />
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
 * `count` rounds to a whole number, which is right for a sentence length and
 * wrong here: these rates are typically single digits, so rounding 3.1 to 3 throws
 * away a third of the value and 0.4 to 0 reports a real occurrence as none at all.
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
