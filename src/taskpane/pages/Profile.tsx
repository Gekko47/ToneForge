import React from "react";
import ProfileEditor from "../components/ProfileEditor";
import { getDocumentSnapshot, getSelectionText } from "../../word/documentReader";
import { createLlmRegistry } from "../../ai/providers/registry";
import { captureSample } from "../../style/sampleCapture";
import { learnStyleDraft } from "../../style/learnStyle";
import { loadState, setActiveProfile, upsertProfile } from "../../core/state/persistence";

export interface ProfileProps {
  onBack: () => void;
}

export default function Profile({ onBack }: ProfileProps): React.ReactNode {
  const [learnStatus, setLearnStatus] = React.useState<string | null>(null);
  const [learnError, setLearnError] = React.useState<string | null>(null);
  const [learning, setLearning] = React.useState(false);

  async function learnFromCurrentDocument(): Promise<void> {
    setLearning(true);
    setLearnError(null);
    setLearnStatus(null);
    try {
      const state = loadState();
      const [snapshot, selection] = await Promise.all([getDocumentSnapshot(), getSelectionText()]);
      const sample = captureSample(selection, snapshot);
      const includeSemantic =
        state.settings.semanticOptIn && state.settings.llmProvider === "openai";
      const result = await learnStyleDraft(sample, {
        name: "Learned style profile",
        includeSemantic,
        ...(includeSemantic
          ? {
              registry: createLlmRegistry({
                provider: "openai",
                openai: {
                  credentialMode: "broker" as const,
                  ...(state.settings.openAiBaseUrl
                    ? { baseUrl: state.settings.openAiBaseUrl }
                    : {}),
                  ...(state.settings.openAiModel ? { model: state.settings.openAiModel } : {}),
                },
              }),
            }
          : {}),
      });
      upsertProfile(result.draft);
      setActiveProfile(result.draft.id);
      setLearnStatus(
        `Learned from ${result.evidence.source} sample (${result.evidence.wordCount} words). The draft is editable below.`,
      );
    } catch (error: unknown) {
      setLearnError(error instanceof Error ? error.message : String(error));
    } finally {
      setLearning(false);
    }
  }

  return (
    <div className="tf-card" data-page="profile">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Document Governance
        </button>
      </nav>
      <h1 className="tf-title">Style profile</h1>
      <p className="tf-sub">Manage the active profile, its version, and applied document scope.</p>
      <section aria-labelledby="learn-style-heading" className="tf-collapsible">
        <h2 id="learn-style-heading">Learn Style</h2>
        <p className="tf-sub">
          Capture the current selection when present, otherwise the eligible document text, check
          sample quality, and create an editable draft. AI interpretation is used only when consent
          and a configured provider are available.
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
      <ProfileEditor />
    </div>
  );
}
