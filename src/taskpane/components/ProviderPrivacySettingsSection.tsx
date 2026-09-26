import React from "react";
import {
  DefaultButton,
  Dropdown,
  MessageBar,
  MessageBarType,
  TextField,
  Toggle,
} from "@fluentui/react";
import { env } from "../../core/config/env";
import type { ModelCatalog, ProviderConnection } from "../../core/domain/index";
import { ProviderIdSchema } from "../../core/domain/index";
import { invalidateCatalogOnProviderChange } from "../../ai/gateway/modelCatalog";
import {
  clearPersistedCredentials,
  loadState,
  saveState,
  type PersistedState,
} from "../../core/state/index";
import { logger } from "../../shared/utils/logger";
import {
  applyLlmDraft,
  buildModelOptions,
  INITIAL_SECTION_STATUS,
  isLlmDraftDirty,
  markDirty,
  markError,
  markSaved,
  normalizeLlmDraft,
  PROVIDER_OPTIONS,
  providerAcceptsUserApiKey,
  CONSISTENCY_CONSENT_EXPLANATION,
  providerOption,
  toLlmDraft,
  validateBrokerBaseUrl,
  type LlmSettingsDraft,
  type SectionStatus,
} from "../settings/settingsModel";
import OpenRouterConnectionSettings from "./OpenRouterConnectionSettings";
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
  // The catalog is session state, not persisted state: it belongs to a
  // connection that the user may disconnect at any moment.
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null);
  // The persisted connection lives in state, initialized once. Reading it with a
  // bare `loadState()` during render would return the pre-connect value forever:
  // nothing re-renders when the child saves, so a successful connect would leave
  // the pane still showing the API key field.
  const [openRouterConnection, setOpenRouterConnection] = React.useState<
    ProviderConnection | undefined
  >(() => loadState().providerConnections?.openrouter);

  const connectedConnection = providerAcceptsUserApiKey(draft.llmProvider)
    ? openRouterConnection
    : undefined;
  const modelOptions = catalog === null ? [] : buildModelOptions(catalog.models);

  function patch(partial: Partial<LlmSettingsDraft>): void {
    setDraft((current) => ({ ...current, ...partial }));
    setStatus(markDirty());
  }

  function changeProvider(next: unknown): void {
    const parsed = ProviderIdSchema.safeParse(next);
    if (!parsed.success) return;
    // Switching provider invalidates the previous provider's model list, so the
    // dropdown can never offer a model the new credential cannot serve.
    setCatalog((current) => invalidateCatalogOnProviderChange(current, parsed.data));
    patch({ llmProvider: parsed.data });
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
    // Only the baseline moves: unsaved model and consent edits are the user's
    // work and must survive a credential purge.
    const cleared = toLlmDraft(loadState().settings);
    setBaseline(cleared);
    setStatus(isLlmDraftDirty(normalizeLlmDraft(draft), cleared) ? markDirty() : markSaved());
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
        options={PROVIDER_OPTIONS.map((option) => ({ key: option.key, text: option.text }))}
        onChange={(_event, option) => changeProvider(option?.key)}
      />
      <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
        {providerOption(draft.llmProvider).authNote}
      </MessageBar>
      {providerAcceptsUserApiKey(draft.llmProvider) ? (
        <OpenRouterConnectionSettings
          gatewayOrigin={env.LLM_BROKER_URL ?? ""}
          connection={connectedConnection}
          onConnectionChange={setOpenRouterConnection}
          catalog={catalog}
          models={modelOptions}
          onCatalogChange={setCatalog}
          selectedModel={draft.openAiModel}
          onSelectModel={(modelId) => patch({ openAiModel: modelId })}
        />
      ) : null}
      <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
        Credentials are never stored in ordinary settings or browser bundles. Local development uses
        the same-origin broker; production credential custody remains an explicit release decision.
      </MessageBar>
      <DefaultButton text="Clear legacy stored credential" onClick={clearLegacyCredential} />
      {draft.llmProvider === "mock" ? null : (
        <TextField
          label="Broker base URL"
          value={draft.openAiBaseUrl}
          onChange={(_event, value) => patch({ openAiBaseUrl: value ?? "" })}
          placeholder="https://localhost:3000/__toneforge/llm/v1"
          description="Use the development broker URL. Do not enter an API key here."
        />
      )}
      {connectedConnection !== undefined && modelOptions.length > 0 ? null : (
        <TextField
          label="Model"
          value={draft.openAiModel}
          onChange={(_event, value) => patch({ openAiModel: value ?? "" })}
          placeholder="gpt-4o-mini"
          description="Leave blank to use the provider's default model."
        />
      )}
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
      {/* The third consent, in its own block with its own explanation. Grouping it
          visually with the two above it would imply it is covered by them, which is
          the one thing it must never be. */}
      <div className="tf-consent-block">
        <Toggle
          label="Allow cross-report consistency review"
          checked={draft.consistencyReviewConsent}
          onChange={(_event, value) => patch({ consistencyReviewConsent: value ?? false })}
          onText="Enabled"
          offText="Disabled"
        />
        <p className="tf-settings-note">{CONSISTENCY_CONSENT_EXPLANATION}</p>
      </div>
    </SettingsSectionCard>
  );
}
