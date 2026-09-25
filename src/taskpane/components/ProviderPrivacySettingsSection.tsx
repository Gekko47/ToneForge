import React from "react";
import {
  DefaultButton,
  Dropdown,
  MessageBar,
  MessageBarType,
  TextField,
  Toggle,
} from "@fluentui/react";
import {
  clearPersistedCredentials,
  loadState,
  saveState,
  type PersistedState,
} from "../../core/state/index";
import { logger } from "../../shared/utils/logger";
import {
  applyLlmDraft,
  INITIAL_SECTION_STATUS,
  isLlmDraftDirty,
  markDirty,
  markError,
  markSaved,
  normalizeLlmDraft,
  toLlmDraft,
  validateBrokerBaseUrl,
  type LlmSettingsDraft,
  type SectionStatus,
} from "../settings/settingsModel";
import SettingsSectionCard from "./SettingsSectionCard";

/**
 * Provider connection and document-content consent.
 *
 * Credential custody is never handled here: no API key field exists, and the
 * broker URL must be a loopback URL so a production endpoint cannot be
 * persisted by accident.
 */
export default function ProviderPrivacySettingsSection(): React.ReactNode {
  const [baseline, setBaseline] = React.useState<LlmSettingsDraft>(() =>
    toLlmDraft(loadState().settings),
  );
  const [draft, setDraft] = React.useState<LlmSettingsDraft>(baseline);
  const [status, setStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);

  function patch(partial: Partial<LlmSettingsDraft>): void {
    setDraft((current) => ({ ...current, ...partial }));
    setStatus(markDirty());
  }

  function save(): void {
    const error = validateBrokerBaseUrl(draft.openAiBaseUrl);
    if (error) {
      setStatus((current) => markError(current, error));
      return;
    }
    const current = loadState();
    const next: PersistedState = { ...current, settings: applyLlmDraft(current.settings, draft) };
    saveState(next);
    // Baseline and draft must reflect what was actually persisted, otherwise
    // untrimmed input leaves the section falsely dirty after a save.
    const saved = normalizeLlmDraft(draft);
    setBaseline(saved);
    setDraft(saved);
    logger.info("LLM settings saved", {
      model: saved.openAiModel || "deployment default",
      provider: saved.llmProvider,
      credentialMode: "broker",
    });
    setStatus(markSaved());
  }

  function clearLegacyCredential(): void {
    clearPersistedCredentials();
    const cleared = toLlmDraft(loadState().settings);
    setBaseline(cleared);
    setDraft(cleared);
    setStatus(markSaved());
  }

  return (
    <SettingsSectionCard
      title="Provider and privacy"
      description="Choose the provider, model, and which document content may be sent for review."
      status={{ ...status, dirty: status.dirty || isLlmDraftDirty(draft, baseline) }}
      saveLabel="Save provider and privacy"
      onSave={save}
      onCancel={() => {
        setDraft(baseline);
        setStatus(INITIAL_SECTION_STATUS);
      }}
    >
      <Dropdown
        label="Provider"
        selectedKey={draft.llmProvider}
        options={[
          { key: "mock", text: "Mock (offline)" },
          { key: "openai", text: "OpenAI" },
        ]}
        onChange={(_event, option) => {
          if (option?.key === "mock" || option?.key === "openai") {
            patch({ llmProvider: option.key });
          }
        }}
      />
      <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
        Credentials are never stored in ordinary settings or browser bundles. Local development uses
        the same-origin broker; production credential custody remains an explicit release decision.
      </MessageBar>
      <DefaultButton text="Clear legacy stored credential" onClick={clearLegacyCredential} />
      <TextField
        label="Broker base URL"
        value={draft.openAiBaseUrl}
        onChange={(_event, value) => patch({ openAiBaseUrl: value ?? "" })}
        placeholder="https://localhost:3000/__toneforge/llm/v1"
        description="Use the development broker URL. Do not enter an API key here."
      />
      <TextField
        label="Model"
        value={draft.openAiModel}
        onChange={(_event, value) => patch({ openAiModel: value ?? "" })}
        placeholder="gpt-4o-mini"
      />
      <Toggle
        label="Allow semantic analysis"
        checked={draft.semanticOptIn}
        onChange={(_event, value) => patch({ semanticOptIn: value ?? false })}
        onText="Enabled"
        offText="Disabled"
      />
      <Toggle
        label="Allow review of selected or paragraph text"
        checked={draft.spotReviewConsent}
        onChange={(_event, value) => patch({ spotReviewConsent: value ?? false })}
        onText="Enabled"
        offText="Disabled"
      />
      <Toggle
        label="Allow full-document review"
        checked={draft.fullDocumentReviewConsent}
        onChange={(_event, value) => patch({ fullDocumentReviewConsent: value ?? false })}
        onText="Enabled"
        offText="Disabled"
      />
    </SettingsSectionCard>
  );
}
