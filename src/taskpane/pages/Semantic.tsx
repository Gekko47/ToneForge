import React from "react";
import SemanticProfileEditor from "../components/SemanticProfileEditor";
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
  saveSemanticProfileRecord,
} from "../../core/state/persistence";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import { captureSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import { updateDraft, effectiveProfile, type ProfileRecord } from "../../core/domain/ProfileRecord";
import { proposeSemanticRewrite } from "../../analysis/rewriteEngine";
import { type StyleProfile } from "../../core/domain/StyleProfile";
import { type Finding } from "../../core/domain/Finding";

export interface SemanticProps {
  onBack: () => void;
  onOpenSettings: () => void;
  /** Hands a reviewed finding to the pending-changes flow on Document Governance. */
  onSendToPendingChanges: (finding: Finding) => void;
}

type RewriteStage = "idle" | "proposing" | "proposed" | "failed";

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
 *    Document Governance review gate, so it meets the same approval and
 *    precondition checks as every other change in the product.
 */
export default function Semantic({
  onBack,
  onOpenSettings,
  onSendToPendingChanges,
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
    };
  });

  const [record, setRecord] = React.useState<ProfileRecord | null>(initial.record);
  const [learnStatus, setLearnStatus] = React.useState<string | null>(null);
  const [learnError, setLearnError] = React.useState<string | null>(null);
  const [learning, setLearning] = React.useState(false);

  const [selection, setSelection] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<RewriteStage>("idle");
  const [proposal, setProposal] = React.useState<Finding | null>(null);
  const [rewriteError, setRewriteError] = React.useState<string | null>(null);

  const state = initial.state;
  const settings = state.settings;

  const profile: StyleProfile | null = record === null ? null : effectiveProfile(record);

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

  async function readSelection(): Promise<void> {
    const text = (await getSelectionText()).trim();
    setSelection(text.length === 0 ? null : text);
    setProposal(null);
    setRewriteError(null);
    setStage("idle");
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
          Back to Document Governance
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
        Measured style, read-only and labelled as derived. It sits here so the
        semantic values have something to be compared against, and it is not
        editable because the next scan overwrites anything typed into it.
      */}
      {profile === null ? (
        <p className="tf-sub">
          No semantic profile yet, so there is no measured style to show. Use Learn Style above to
          create one.
        </p>
      ) : (
        <>
          <section aria-labelledby="measured-heading" className="tf-card">
            <h2 id="measured-heading">Measured style</h2>
            <p className="tf-sub">
              Derived from your writing on every scan. Shown for reference; the rules themselves are
              edited on the Deterministic Style Profile tab.
            </p>
            <dl>
              <dt>Average sentence length</dt>
              <dd>{count(profile.measured.avgSentenceLength, "words")}</dd>
              <dt>Sentence length spread</dt>
              <dd>{count(profile.measured.sentenceLengthStdDev, "words")}</dd>
              <dt>Average paragraph length</dt>
              <dd>{count(profile.measured.paragraphLengthAvg, "words")}</dd>
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
        Document Governance review gate rather than having a private route into
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
            <button
              type="button"
              disabled={!proposal.actionable}
              onClick={() => onSendToPendingChanges(proposal)}
            >
              Review in Document Governance
            </button>
            {proposal.actionable === false && (
              <p className="tf-sub">This rewrite cannot be applied yet — see the reason above.</p>
            )}
          </article>
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
