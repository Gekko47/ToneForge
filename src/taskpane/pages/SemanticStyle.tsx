import React from "react";
// Button import removed — the "Use this style" section that was its only
// consumer was removed (R13).
// DisclosurePanel import removed — the "Sample diagnostics" section that was its
// only consumer in this file was removed (R12).
import SemanticProfileEditor from "../components/SemanticProfileEditor";
import { Breadcrumb } from "../shell";
import { parentRoute } from "../routes";
import SemanticProfilePicker from "../components/SemanticProfilePicker";
import ProfileRecordSection from "../components/ProfileRecordSection";
import LearnSemanticStyle from "../components/semantic/LearnSemanticStyle";
import SelectedTextStyle from "../components/semantic/SelectedTextStyle";
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
import { generalRegistryFromState, isGeneralRoleConfigured } from "../settings/providerComposition";
import type { CapturedSample } from "../../style/sampleCapture";
import { learnStyleDraft, type LearnStyleEvidence } from "../../style/learnStyle";
import { updateDraft, effectiveProfile, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { createEmptyProfile, type StyleProfile } from "../../core/domain/StyleProfile";
import type { SemanticStyleProfile } from "../../core/domain/SemanticStyleProfile";
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
  // diagnosticsOpen state removed — the "Sample diagnostics" section was removed (R12).
  /*
   * The record section's own sentence, routed here rather than into a second
   * live region. `ProfileRecordSection` renders one of its own on the Profile
   * page, where nothing else speaks; here this page already has a region, and
   * ADR-0062's rule is one per pane.
   */
  const [recordAnnouncement, setRecordAnnouncement] = React.useState<string | null>(null);
  /**
   * The publish control, so "Use as preferred style" can move the user to it.
   *
   * A ref rather than a scroll-into-view on a queried element: the section is
   * rendered conditionally, and a query would have to re-run on every render to
   * stay honest about which one is mounted.
   */
  const publishRef = React.useRef<HTMLDivElement>(null);
  /*
   * The identified style, held apart from every profile.
   *
   * Identification is its own stage: it reads a sample and produces a voice, and
   * it stops there. Writing the result straight into a record made the two stages
   * one, so a user who identified a style they did not want had already created a
   * profile to hold it — and the only way back was to delete the profile.
   *
   * Holding it here is also what makes the next step possible: the identifier is
   * going to find more than one voice in the same body of text, and a list of
   * candidates cannot be expressed as "whichever record is selected".
   */
  const [identified, setIdentified] = React.useState<{
    semantic: SemanticStyleProfile;
    evidence: LearnStyleEvidence;
  } | null>(null);

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

  /**
   * Write the semantic half of a record, through the record's own audit trail.
   *
   * `target` defaults to the selected record and exists for the one caller that
   * has just created one: `setRecord` is asynchronous, so a write issued in the
   * same tick would otherwise read the previous `record` — null, on the first
   * import — and silently drop the edit.
   */
  function persistSemantic(
    semantic: StyleProfile["semantic"],
    target: ProfileRecord | null = record,
  ): void {
    if (target === null) return;
    /*
     * The published version is a valid base. A record whose draft has been
     * published and discarded has no draft, and returning here dropped every edit
     * made to it — the editor showed a profile that could not be saved.
     */
    const base = target.draft ?? effectiveProfile(target);
    if (base === null) return;
    // Through `updateDraft`, not around it: the record is the audit trail, and it
    // assigns the revision number and the timestamp that make the edit attributable.
    const { record: updated } = updateDraft(
      target,
      { ...base, semantic },
      new Date().toISOString(),
    );
    // The semantic writer, so the edit cannot land in the deterministic record
    // under the same id and quietly diverge from it.
    saveSemanticProfileRecord(updated);
    setRecord(updated);
  }

  /**
   * Identify the style of a sample the user chose, and stop there.
   *
   * This is the first of two stages. It reads the sample and produces a voice,
   * and it writes nothing: no record, no evidence, no active profile. The old
   * path created a record here, which made identification and profile creation
   * one step — so a user who identified a style they did not want had already
   * made a profile to hold it, and the only way back was to delete it.
   *
   * The evidence is carried in state alongside the voice rather than persisted,
   * because it describes a sample that has not been committed to anything yet.
   * It is written when the user imports the voice, under the id of the record
   * that now holds it.
   */
  async function learn(sample: CapturedSample): Promise<void> {
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    setRecordAnnouncement(null);
    try {
      const includeSemantic = settings.semanticOptIn && isGeneralRoleConfigured(state);
      const result = await learnStyleDraft(sample, {
        name: "Identified semantic style",
        includeSemantic,
        ...(includeSemantic ? { registry: generalRegistryFromState(state) } : {}),
      });
      setIdentified({ semantic: result.draft.semantic, evidence: result.evidence });
      setLearnStatus(
        `Identified a style from ${result.evidence.wordCount} words of ${result.evidence.source}. Review it below, then import it into a profile to edit it.`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  // activateDraft removed — the "Use this style" section was removed (R13).
  // Activation is handled by ProfileRecordSection's publish button.
  /**
   * Discard the identified style, and nothing else.
   *
   * Nothing is written, because nothing was: identification holds its result in
   * component state, so a mis-identified sample costs one press and leaves no
   * record behind to clean up. The old path emptied the semantic half of a
   * record here, which meant a user who identified a style they did not want had
   * to have created a profile first.
   */
  function clearIdentified(): void {
    setIdentified(null);
    setLearnStatus("Discarded the identified style. Nothing was saved.");
  }

  /**
   * Import the identified style into a profile, for editing.
   *
   * The second of the two stages. The identified voice is carried into the
   * record the user is already working in — or into a new one when there is no
   * record yet — through `persistSemantic`, the same write path the editor uses,
   * so the import is auditable like any other edit and lands in the revision
   * trail rather than beside it.
   *
   * The evidence is written here rather than at identification, because it
   * describes a sample that has now been committed to a profile. It is keyed by
   * the record that holds it, and it is metadata only: no text, by construction
   * of the schema.
   *
   * The scroll is guarded on the method existing, not on the ref.
   * `scrollIntoView` is a real DOM API that jsdom does not implement and that a
   * host WebView may lack, and an unguarded call would take down the page on a
   * host that has it missing. Losing the scroll degrades the convenience; the
   * status sentence below still says where to go.
   */
  function useIdentified(): void {
    if (identified === null) return;

    const target = record === null ? createImportedRecord() : record;
    persistSemantic(identified.semantic, target);
    saveSemanticSampleEvidence({
      id: target.id,
      source: identified.evidence.source,
      ...(identified.evidence.filename === undefined
        ? {}
        : { filename: identified.evidence.filename }),
      ...(identified.evidence.documentId === undefined
        ? {}
        : { documentId: identified.evidence.documentId }),
      wordCount: identified.evidence.wordCount,
      sentenceCount: identified.evidence.sentenceCount,
      paragraphCount: identified.evidence.paragraphCount,
      capturedAt: identified.evidence.capturedAt,
      sampleHash: identified.evidence.sampleHash,
    });

    const publish = publishRef.current;
    if (typeof publish?.scrollIntoView === "function") {
      publish.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setLearnStatus(
      "Imported the identified style into the profile. Edit it below, then publish it when you are ready.",
    );
  }

  /**
   * A record to hold an imported style, when the user has none yet.
   *
   * Created inactive, for the same reason learning never activated: a profile
   * that starts steering every review is a decision the user makes on purpose,
   * and importing a voice is not that decision.
   */
  function createImportedRecord(): ProfileRecord {
    const created = createSemanticProfileRecord(
      "Identified semantic style",
      new Date().toISOString(),
      createEmptyProfile("Identified semantic style", 1, "semantic"),
      { activate: false },
    );
    /*
     * `activeId` is deliberately left alone. It tracks the profile reviews
     * actually use, and setting it here would make a record the user has not
     * approved read as active — which is the one thing this page exists to
     * prevent. `isActive` compares it against the selected record, so leaving it
     * is what keeps "Make this active" available after an import.
     */
    setRecord(created);
    refreshRecords();
    return created;
  }

  const gateInput: SemanticGateInput = {
    consent: settings.semanticOptIn === true,
    providerConfigured: isGeneralRoleConfigured(state),
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
    <div data-page="semantic-style">
      <Breadcrumb parent={parentRoute("semantic-style")} onBack={onBack} />

      <LearnSemanticStyle
        gateInput={gateInput}
        onOpenSettings={onOpenSettings}
        onLearn={(sample) => void learn(sample)}
        busy={learning}
      />

      {/*
        The identified style, shown as read-only text boxes before the user
        decides what to do with it.

        Rendered from the identification stage's own state rather than from a
        profile, because that is the whole point of the split: what the model
        found is not yet part of any profile, and the two buttons below are the
        choice of whether it becomes one.
      */}
      {identified !== null && (
        <SelectedTextStyle
          semantic={identified.semantic}
          onClear={clearIdentified}
          onUse={useIdentified}
        />
      )}

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
        <section aria-labelledby="no-profile-heading">
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
          // "Use this style" section removed (R13). Activation is handled by //
          ProfileRecordSection's publish button, which publishes and activates together.
          {evidence !== null && (
            <section aria-labelledby="evidence-heading">
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
          // "Sample diagnostics" section removed (R12). Measured metrics are available on // the
          Deterministic Style Profile tab.
          {/*
            The semantic record's own revision history, which existed but were never
            rendered here: the section was wired only on the deterministic Profile
            page, so a learned profile had publish, activate and recall controls
            the user could not reach (spec §31).
          */}
          {/*
            The scroll target for "Use as preferred style". A plain wrapper
            rather than a prop on the section, because the section is shared with
            the deterministic Profile page and has no reason to know about a
            button on this one.
          */}
          <div ref={publishRef}>
            <ProfileRecordSection
              record={record}
              onChange={setRecord}
              onAnnounce={(message) => {
                setLearnStatus(null);
                setRecordAnnouncement(message);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// count/rate/percent helpers removed — they were only used by the "Sample
// diagnostics" section, which was removed (R12).
