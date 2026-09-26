import React from "react";
import ProfileEditor from "../components/ProfileEditor";
import ProfileRecordSection from "../components/ProfileRecordSection";
import { getDocumentSnapshot, getSelectionText } from "../../word/documentReader";
import {
  createRegistryFromSettings,
  isRemoteProviderConfigured,
} from "../settings/providerComposition";
import { captureSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import {
  createProfileRecord,
  loadProfileRecord,
  loadState,
  saveProfileRecord,
  setActiveProfile,
} from "../../core/state/persistence";
import type { ProfileRecord } from "../../core/domain/ProfileRecord";

export interface ProfileProps {
  onBack: () => void;
}

export default function Profile({ onBack }: ProfileProps): React.ReactNode {
  const [learnStatus, setLearnStatus] = React.useState<string | null>(null);
  const [learnError, setLearnError] = React.useState<string | null>(null);
  const [learning, setLearning] = React.useState(false);
  const [record, setRecord] = React.useState<ProfileRecord | null>(null);

  React.useEffect(() => {
    const state = loadState();
    setRecord(state.activeProfileId ? loadProfileRecord(state.activeProfileId) : null);
  }, []);

  async function learnFromCurrentDocument(): Promise<void> {
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    try {
      const state = loadState();
      const [snapshot, selection] = await Promise.all([getDocumentSnapshot(), getSelectionText()]);
      const sample = captureSample(selection, snapshot);
      // Semantic learning needs a configured remote provider, not a specific
      // one — every remote adapter speaks the same gateway contract.
      const includeSemantic =
        state.settings.semanticOptIn &&
        isRemoteProviderConfigured(state.settings, state.providerConnections);
      const result = await learnStyleDraft(sample, {
        name: "Learned style profile",
        includeSemantic,
        ...(includeSemantic
          ? { registry: createRegistryFromSettings(state.settings, state.providerConnections) }
          : {}),
      });

      // Learn Style always creates a new record: a learned draft is a distinct
      // profile, not an edit of whichever profile happens to be active.
      const created = createProfileRecord(
        result.draft.name,
        new Date().toISOString(),
        result.draft,
      );
      setActiveProfile(created.id);
      setRecord(created);
      setLearnStatus(
        `Learned from ${result.evidence.source} sample (${result.evidence.wordCount} words). The draft is editable below.`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  function applyRecord(next: ProfileRecord): void {
    saveProfileRecord(next);
    setRecord(next);
  }

  // The editor persists the record itself, so the page re-reads it rather than
  // keeping a copy that could overwrite the freshly saved draft later.
  function refreshRecord(saved: ProfileRecord): void {
    setRecord(loadProfileRecord(saved.id) ?? saved);
  }

  return (
    <div className="tf-card" data-page="profile">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Document Governance
        </button>
      </nav>
      <h1 className="tf-title">Style profile</h1>
      <p className="tf-sub">Manage the active profile, its revision, and applied document scope.</p>
      <section aria-labelledby="learn-style-heading" className="tf-collapsible">
        <h2 id="learn-style-heading">Learn Style</h2>
        <p className="tf-sub">
          Capture the current selection when present, otherwise the eligible document text, check
          sample quality, and create a new editable profile. AI interpretation is used only when
          consent and a configured provider are available.
        </p>
        <button type="button" onClick={() => void learnFromCurrentDocument()} disabled={learning}>
          {learning ? "Learning style…" : "Learn from current document"}
        </button>
        {learnStatus && (
          <p role="status" className="tf-sub">
            {learnStatus}
          </p>
        )}
        {learnError && (
          <p role="alert" className="tf-error">
            {learnError}
          </p>
        )}
      </section>
      {record && <ProfileRecordSection record={record} onChange={applyRecord} />}
      <ProfileEditor onRecordSaved={refreshRecord} />
    </div>
  );
}
