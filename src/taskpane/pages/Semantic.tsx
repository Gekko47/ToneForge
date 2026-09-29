import React from "react";
import SemanticProfileEditor from "../components/SemanticProfileEditor";
import SemanticProfilePicker from "../components/SemanticProfilePicker";
import FindingDetail from "../components/FindingDetail";
import {
  getDocumentSnapshot,
  getSelectionText,
  getStructuredSnapshot,
} from "../../word/documentReader";
import {
  createSemanticProfileRecord,
  loadSemanticProfileRecord,
  loadState,
  removeSemanticProfile,
  saveSemanticProfileRecord,
  setActiveSemanticProfile,
} from "../../core/state/persistence";
import { applySemanticRewrite } from "../../reformat/semanticApply";
import { selectKindRecordList } from "../../core/state/profileSelectors";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import { captureSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import { updateDraft, effectiveProfile, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { proposeSemanticRewrite } from "../../analysis/rewriteEngine";
import { createEmptyProfile, type StyleProfile } from "../../core/domain/StyleProfile";
import { type Finding } from "../../core/domain/Finding";
import { type TaskpaneNavigation } from "../../shared/office/taskpaneNavigation";
import { syncSemanticRibbon } from "../../commands/ribbonState";

export interface SemanticProps {
  onBack: () => void;
  onOpenSettings: () => void;
  /**
   * The instruction that brought the pane here, already consumed.
   *
   * `read-selection` arrives from the context menu, where the user right-clicked
   * one specific piece of text. Reading a selection is a local Word call and
   * sends nothing anywhere; the rewrite still needs its own click, so arriving
   * here has not started a request.
   */
  navigation?: TaskpaneNavigation | null;
}

type RewriteStage = "idle" | "proposing" | "proposed" | "failed";

/**
 * What applying the proposal did.
 *
 * Three outcomes the user must be able to tell apart: it was written, it was
 * refused, or it is being written right now. A single boolean cannot carry all
 * three, and collapsing "refused" into "nothing happened" is what made the old
 * flow a dead end — a button that reported failure with nothing to act on.
 */
type ApplyStage = "idle" | "applying" | "applied" | "refused";

/** The one message this pane speaks, and whether it is an error. */
export interface SemanticAnnouncement {
  text: string;
  assertive: boolean;
}

/**
 * Which of the tab's outcomes should be spoken.
 *
 * The tab has three message sources — style learning and the rewrite, each with a
 * success and a failure — and each used to render its own live region. A learn
 * finishing while a rewrite error was still on screen would update two regions in
 * one tick, and a screen reader would read them in DOM order rather than in the
 * order the events happened. Same defect the Dashboard fixed in ADR-0062, so the
 * fix is the same shape: the surfaces stay visible as ordinary text and one
 * derived sentence is the only thing that speaks.
 *
 * Pure, so the priority order is testable without rendering anything. An error
 * outranks a success: the user pressed a button that did not do what it said, and
 * that is the more urgent thing to hear.
 */
export function deriveSemanticAnnouncement(input: {
  learnStatus: string | null;
  learnError: string | null;
  rewriteError: string | null;
  selection: string | null;
}): SemanticAnnouncement | null {
  if (input.learnError !== null && input.learnError.length > 0) {
    return { text: input.learnError, assertive: true };
  }
  if (input.rewriteError !== null && input.rewriteError.length > 0) {
    return { text: input.rewriteError, assertive: true };
  }
  if (input.learnStatus !== null && input.learnStatus.length > 0) {
    return { text: input.learnStatus, assertive: false };
  }
  if (input.selection !== null && input.selection.length > 0) {
    return {
      text: `Selection read: ${input.selection}`,
      assertive: false,
    };
  }
  return null;
}

/**
 * The Semantic tab.
 *
 * Three things live here, together on purpose:
 *
 * 1. **Learned semantic style**, editable. It moved off the style tab, which
 *    cannot own it: those fields used to be rendered read-only there while
 *    `buildCandidate` wrote them back on every save, so a learned tone was
 *    silently reset by an unrelated edit to a dash rule.
 * 2. **Measured style**, read-only, because it is derived. Shown so the semantic
 *    values have something to be compared against, and labelled as derived so
 *    nobody types into a number the next scan overwrites.
 * 3. **The semantic rewrite**, the one place a model proposes a change to the
 *    user's own prose. It proposes; it never applies. The result goes to the
 *    Deterministic Review review gate, so it meets the same approval and
 *    precondition checks as every other change in the product.
 */
export default function Semantic({
  onBack,
  onOpenSettings,
  navigation,
}: SemanticProps): React.ReactNode {
  /*
   * One read of the store, in a lazy initialiser. Reading it again in an effect
   * would pair this component with a second snapshot of the state, and reading it
   * in the render body would re-read on every keystroke for no benefit: nothing
   * here subscribes to changes made elsewhere.
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
  /**
   * The picker list, held rather than derived from `initial.state`.
   *
   * `initial.state` is a snapshot taken once, so deriving from it would leave the
   * list showing a profile the user had just deleted and refusing to show one they
   * had just created. Every mutation below re-reads instead.
   */
  const [records, setRecords] = React.useState(initial.records);
  /**
   * The active profile's id, held for the same reason.
   *
   * `initial.state` is read once, so reading the active id from it would leave
   * the picker marking the *previous* profile active after a create or a delete —
   * telling the user their rewrite is matching a voice they just switched away
   * from.
   */
  const [activeId, setActiveId] = React.useState(initial.state.activeSemanticProfileId);
  const [learnStatus, setLearnStatus] = React.useState<string | null>(null);
  const [learnError, setLearnError] = React.useState<string | null>(null);
  const [learning, setLearning] = React.useState(false);

  const [selection, setSelection] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<RewriteStage>("idle");
  const [proposal, setProposal] = React.useState<Finding | null>(null);
  const [rewriteError, setRewriteError] = React.useState<string | null>(null);
  const [applyStage, setApplyStage] = React.useState<ApplyStage>("idle");
  const [applyMessage, setApplyMessage] = React.useState<string | null>(null);

  const state = initial.state;
  const settings = state.settings;

  const profile: StyleProfile | null = record === null ? null : effectiveProfile(record);

  /*
   * Arriving from the context menu. The user right-clicked a specific piece of
   * text, so reading that text is completing the gesture they started rather
   * than starting new work — and it is a local Word call, so nothing is sent.
   * The rewrite itself still waits for a click.
   */
  React.useEffect(() => {
    if (navigation?.action !== "read-selection") return;
    void (async () => {
      try {
        const text = (await getSelectionText()).trim();
        setSelection(text.length === 0 ? null : text);
      } catch (error: unknown) {
        setRewriteError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [navigation]);

  /*
   * Keep the ribbon button honest. It is declared disabled in the manifest and
   * enabled only here, so learning a profile on this tab is what turns it on.
   */
  React.useEffect(() => {
    void syncSemanticRibbon(profile !== null);
  }, [profile]);

  /**
   * Re-read the picker list after a write.
   *
   * Every mutation goes through here rather than patching the held list, so the
   * list cannot disagree with what is actually stored — the same rule the ignore
   * path settled on, and for the same reason.
   */
  function refreshRecords(): void {
    setRecords(selectKindRecordList(loadState(), "semantic"));
  }

  function selectProfile(id: string): void {
    setActiveSemanticProfile(id);
    setActiveId(id);
    setRecord(loadSemanticProfileRecord(id));
    refreshRecords();
    // The pending proposal was made against the previous profile, so carrying it
    // across would offer a rewrite that matches a voice the user just switched
    // away from.
    setProposal(null);
    setStage("idle");
  }

  /**
   * A blank semantic profile, with no sample behind it.
   *
   * Learn Style needs a sample that passes the quality gate, so without this the
   * tab is unreachable for anyone whose document is too short — and the only
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
    refreshRecords();
    // Same rule as `selectProfile` and `deleteProfile`: a proposal made against
    // the previous profile says nothing about the blank one now on screen.
    setProposal(null);
    setStage("idle");
    setLearnStatus("Created an empty semantic profile. Set its voice below, or delete it here.");
  }

  function deleteProfile(id: string): void {
    removeSemanticProfile(id);
    const active = loadState().activeSemanticProfileId;
    setActiveId(active);
    setRecord(active === null ? null : loadSemanticProfileRecord(active));
    refreshRecords();
    setProposal(null);
    setStage("idle");
  }

  function persistSemantic(semantic: StyleProfile["semantic"]): void {
    if (record === null || record.draft === null) return;
    // Through `updateDraft`, not around it: the record is the audit trail, and
    // it assigns the revision number and the timestamp that make the edit
    // attributable later.
    const { record: updated } = updateDraft(
      record,
      { ...record.draft, semantic },
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
      // The learned profile becomes the active one. Creating a profile that is
      // not in effect left the Semantic tab showing nothing, and the ribbon
      // button — which is enabled by the *active* profile's existence — stayed
      // greyed out with no way to tell why.
      setActiveSemanticProfile(created.id);
      refreshRecords();
      // A proposal is an answer about the previous voice, not this one.
      setProposal(null);
      setStage("idle");
      setLearnStatus(
        `Learned from ${result.evidence.source} sample (${result.evidence.wordCount} words).`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  const consentMissing = settings.semanticOptIn !== true;
  const providerMissing = !isRemoteProviderConfigured(settings, state.providerConnections);

  /**
   * Read the current selection for a rewrite.
   *
   * Failing to read is a refusal, not a silent no-op: an unhandled rejection
   * here left the button looking inert, with no message anywhere. Routed to
   * `rewriteError` exactly as the arrival effect above does, so both paths
   * speak the same way.
   */
  async function readSelection(): Promise<void> {
    try {
      const text = (await getSelectionText()).trim();
      setSelection(text.length === 0 ? null : text);
      setRewriteError(null);
      setProposal(null);
      setStage("idle");
    } catch (error: unknown) {
      setRewriteError(error instanceof Error ? error.message : String(error));
    }
  }

  async function proposeRewrite(): Promise<void> {
    if (selection === null || profile === null) return;
    setStage("proposing");
    setRewriteError(null);
    setProposal(null);
    try {
      // Acquired after the request and before it is applied: the anchor is
      // verified against this snapshot, and a document that moved in between
      // would make that a check against stale text.
      const snapshot = await getStructuredSnapshot();
      setProposal(
        await proposeSemanticRewrite(selection, profile, { includeRawText: true }, snapshot.nodes),
      );
      setStage("proposed");
    } catch (error: unknown) {
      setRewriteError(error instanceof Error ? error.message : String(error));
      setStage("failed");
    }
  }

  /**
   * Ask the model again, with the same paragraph and the same profile.
   *
   * There is no new prompt and no new selection: `proposeRewrite` closes over
   * the current `selection` and `profile`, so pressing this sends exactly what
   * the previous press sent. That is the point — "regenerate" that quietly
   * re-read the selection, or that prompted differently, would be a second
   * request the user did not ask for and could not reproduce.
   */
  function regenerateReview(): void {
    // The apply outcome is about the previous proposal. Leaving it on screen
    // while a new one is fetched would read as a verdict on the new one.
    setApplyStage("idle");
    setApplyMessage(null);
    void proposeRewrite();
  }

  /**
   * Write the proposed paragraph into the document, as a tracked change.
   *
   * The document is re-read here rather than reusing the hash from when the
   * proposal was made: the model call and this click are separated by however
   * long the user spent reading the result, and the precondition is only
   * meaningful against the document as it is now.
   */
  async function applyRevision(): Promise<void> {
    if (proposal === null) return;
    setApplyStage("applying");
    setApplyMessage(null);
    try {
      const snapshot = await getStructuredSnapshot();
      const result = await applySemanticRewrite({
        finding: proposal,
        documentId: snapshot.documentId,
        currentDocHash: snapshot.contentHash,
      });
      if (result.verified) {
        setApplyStage("applied");
        setApplyMessage(
          "The revision was written as a tracked change. Reject it in Word to undo it.",
        );
        // The proposal described text that no longer exists, so it must not
        // survive the write: pressing Apply again would re-apply it.
        setProposal(null);
        setStage("idle");
        return;
      }
      setApplyStage("refused");
      setApplyMessage(result.refusal ?? "The revision was not written. Nothing has been changed.");
    } catch (error: unknown) {
      // A throw is a fault, not a refusal, and says so. Collapsing the two is
      // what left the old flow with a button that failed silently.
      setApplyStage("refused");
      setApplyMessage(
        `The revision could not be written: ${
          error instanceof Error ? error.message : String(error)
        }. Nothing has been changed.`,
      );
    }
  }

  const announcement = deriveSemanticAnnouncement({
    learnStatus,
    learnError,
    rewriteError,
    selection,
  });

  return (
    <div className="tf-card" data-page="semantic">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>

      <h1 className="tf-title">Semantic</h1>
      <p className="tf-sub">
        How the writing sounds, rather than how it is punctuated. These values are what the
        consistency check reasons about and what a semantic rewrite is asked to match.
      </p>

      <section aria-labelledby="learn-style-heading" className="tf-collapsible">
        <h2 id="learn-style-heading">Learn Style</h2>
        <p className="tf-sub">
          Capture the current selection when present, otherwise the eligible document text, check
          sample quality, and create a new semantic profile. AI interpretation is used only when
          consent and a configured provider are available.
        </p>
        <button type="button" onClick={() => void learnFromCurrentDocument()} disabled={learning}>
          {learning ? "Learning style…" : "Learn from current document"}
        </button>
      </section>
      {/*
  The tab's one live region. Rendered near the top so it precedes the
  sections it reports on, and given a stable node identity so a changed
  sentence is re-announced rather than the region appearing from nothing.
*/}
      <p
        role={announcement?.assertive === true ? "alert" : "status"}
        className={announcement?.assertive === true ? "tf-error" : "tf-sub"}
      >
        {announcement?.text ?? ""}
      </p>

      {/*
  Above everything that depends on a profile existing, because it is also
  how one comes into existence. The "no profile" state below is otherwise a
  dead end with a single exit through Learn Style.
*/}
      <SemanticProfilePicker
        records={records}
        activeId={activeId}
        activeRecord={record}
        onSelect={selectProfile}
        onCreateEmpty={createBlankProfile}
        onDelete={deleteProfile}
      />

      {/*
        Measured style, read-only and labelled as derived. It sits here so the
        semantic values have something to be compared against, and it is not
        editable because the next scan overwrites anything typed into it.
      */}
      {profile === null ? (
        <section aria-labelledby="no-profile-heading" className="tf-card">
          <h2 id="no-profile-heading">No semantic profile is active</h2>
          <p className="tf-sub">
            There is nothing to match a rewrite against yet. A semantic profile says how the writing
            should sound, so without one there is no measured style to show, no values to edit, and
            nothing for the rewrite button on the ribbon to ask for. Use Learn Style above to create
            one.
          </p>
        </section>
      ) : (
        <>
          {/*
            Every measured metric, not a selection of them.

            The deterministic profile editor used to render all eight of these
            as a read-only list, and the Semantic tab rendered four. Moving the
            block here without moving the other four would have deleted them
            from the interface entirely — em dash, en dash and curly quote
            frequency and capitalization consistency would have become
            invisible numbers the engine still used and no one could see.

            Read-only, and labelled as derived: the next scan overwrites
            anything typed here, so an editable-looking field here would be a
            value that silently does not stick.
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
            Not disabled by missing consent. Consent governs sending the user's
            text to a provider; typing a tone into a local field sends nothing.
            Refusing to let someone edit their own profile is a different rule
            from the one that protects their prose, and conflating them locks
            out exactly the user who declined.
          */}
          <SemanticProfileEditor semantic={profile.semantic} onSave={persistSemantic} />
        </>
      )}

      {/*
        The rewrite. It proposes; it never applies. The finding goes to the
        Deterministic Review review gate rather than having a private route into
        the document.
      */}
      <section aria-labelledby="rewrite-heading" className="tf-card">
        <h2 id="rewrite-heading">Semantic rewrite</h2>
        <p className="tf-sub">
          Select text in the document, then ask for a rewrite that matches this semantic style. The
          selection is sent to your configured provider, the proposal is verified against the
          document before it is shown, and you approve it before anything is written.
        </p>

        {/*
          Blockers, not announcements. They are rendered on mount and stay put
          until settings change, so a live region would speak the pane's opening
          sentence before the user had done anything.
        */}
        {consentMissing && (
          <p className="tf-debug-warning">
            Semantic features need their own consent in Settings before any text can be sent. It is
            not covered by the other review permissions.{" "}
            <button type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          </p>
        )}
        {consentMissing === false && providerMissing && (
          <p className="tf-debug-warning">
            No AI provider is configured, so there is nothing to ask.{" "}
            <button type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          </p>
        )}

        <button type="button" onClick={() => void readSelection()} disabled={consentMissing}>
          Read current selection
        </button>

        {selection !== null && (
          <p className="tf-sub">
            Selected: <q>{selection}</q>
          </p>
        )}

        <button
          type="button"
          onClick={() => void proposeRewrite()}
          disabled={
            selection === null || profile === null || stage === "proposing" || consentMissing
          }
        >
          {stage === "proposing" ? "Proposing…" : "Propose rewrite"}
        </button>

        {proposal !== null && (
          <article className="tf-finding-card" aria-label="Proposed semantic rewrite">
            <FindingDetail
              finding={proposal}
              // The finding already knows its own location; the note says what
              // this card is and that nothing has been written yet.
              locationNote={`Proposed rewrite — nothing has been changed in the document. ${
                proposal.advisoryReason ?? ""
              }`}
            />

            {/*
              Side by side, which is the whole comparison.

              The original and the proposal are two paragraphs of the user's own
              writing, and the decision is whether the second says what they
              meant. A before/after table the reader has to hold in their head
              cannot support that; the model's rationale below it says why it
              changed the words, not whether it should have.
            */}
            <section aria-labelledby="rewrite-comparison-heading">
              <h3 id="rewrite-comparison-heading" className="tf-sub">
                Your paragraph and the proposed revision
              </h3>
              <div className="tf-evidence-split">
                <div>
                  <h4 className="tf-sub">Yours</h4>
                  <p>{proposal.actual ?? proposal.evidence}</p>
                </div>
                <div>
                  <h4 className="tf-sub">Proposed</h4>
                  <p>{proposal.expected ?? ""}</p>
                </div>
              </div>
            </section>

            {/*
              Two controls, and both are decisions the user can make here.

              Apply writes the revision as a tracked change. Regenerate asks the
              model again with the same paragraph and the same profile — it is
              not a retry of a failed call, it is a second sample from the same
              request, which is how a user who dislikes the first answer gets
              another without re-selecting and re-prompting.

              There is no handoff to the deterministic review. That gate resolves
              a finding against a deterministic plan, and a semantic proposal is
              not in one, so it refused every rewrite with "the planner proposes
              no correction for this finding" — leaving a paragraph the user had
              asked for and could neither use nor refine.
            */}
            <div className="tf-pending-actions">
              <button
                type="button"
                disabled={!proposal.actionable || applyStage === "applying"}
                onClick={() => void applyRevision()}
              >
                {applyStage === "applying" ? "Applying…" : "Apply revision"}
              </button>
              <button
                type="button"
                disabled={stage === "proposing" || applyStage === "applying"}
                onClick={regenerateReview}
              >
                {stage === "proposing" ? "Asking again…" : "Regenerate review"}
              </button>
            </div>

            {proposal.actionable === false && (
              <p className="tf-sub">
                This rewrite cannot be applied — see the reason above. Regenerating asks the model
                again.
              </p>
            )}
          </article>
        )}

        {/*
          Outside the proposal, deliberately.

          A successful apply clears the proposal, because it described text that
          no longer exists. The confirmation lived inside the proposal card, so
          clearing it removed the only sentence saying the write had happened —
          and the user was left with a paragraph disappearing and no outcome at
          all. The outcome outlives the thing it is about.
        */}
        {applyMessage !== null && (
          <p className={applyStage === "refused" ? "tf-debug-warning" : "tf-sub"}>{applyMessage}</p>
        )}
      </section>
    </div>
  );
}

/**
 * A measured value, or a stated absence.
 *
 * Every field in `measured` is nullable because a profile learned from too short
 * a sample has no value for it. Printing "0" or a bare blank for a missing
 * measurement reads as a real zero, which is a different claim.
 */
function count(value: number | null, unit: string): string {
  return value === null ? "not measured yet" : `${Math.round(value)} ${unit}`;
}

/**
 * A per-100-words rate, to one decimal.
 *
 * `count` rounds to a whole number, which is right for a sentence length and
 * wrong here: these rates are typically single digits, so rounding 3.1 to 3
 * throws away a third of the value and 0.4 to 0 reports a real occurrence as
 * none at all.
 */
function rate(value: number | null): string {
  return value === null ? "not measured yet" : `${value.toFixed(1)} per 100 words`;
}

/**
 * A proportion, as a percentage.
 *
 * `capitalizationConsistency` is `capitalized / sentences.length` — a value
 * between 0 and 1, not between 0 and 100. It needs its own formatter precisely
 * because it does not share a scale with anything else on this list, and
 * rounding it as though it were one turns 96.5% into "1".
 */
function percent(value: number | null): string {
  return value === null ? "not measured yet" : `${Math.round(value * 100)}%`;
}
