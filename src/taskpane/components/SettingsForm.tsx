import React from "react";
import { useTheme, type ThemePreference } from "../theme";
import {
  DefaultButton,
  Dropdown,
  MessageBar,
  MessageBarType,
  PrimaryButton,
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

interface LlmDraft {
  openAiBaseUrl: string;
  openAiModel: string;
  llmProvider: "openai" | "mock";
  spotReviewConsent: boolean;
  fullDocumentReviewConsent: boolean;
  semanticOptIn: boolean;
}

interface SectionStatus {
  dirty: boolean;
  error: string | null;
  savedAt: string | null;
}

const INITIAL_SECTION_STATUS: SectionStatus = {
  dirty: false,
  error: null,
  savedAt: null,
};

function SectionCard(props: {
  title: string;
  description: string;
  children: React.ReactNode;
  dirty: boolean;
  error: string | null;
  savedAt: string | null;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}): React.ReactNode {
  return (
    <section className="tf-settings-section" aria-labelledby={`${props.title}-heading`}>
      <h2 id={`${props.title}-heading`}>{props.title}</h2>
      <p className="tf-sub">{props.description}</p>
      {props.error && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {props.error}
        </MessageBar>
      )}
      {props.savedAt && (
        <MessageBar messageBarType={MessageBarType.success} role="status" aria-live="polite">
          {props.title} settings saved.
        </MessageBar>
      )}
      <div className="tf-settings-fields">{props.children}</div>
      <div className="tf-settings-actions">
        <PrimaryButton text={props.saveLabel} onClick={props.onSave} disabled={!props.dirty} />
        <DefaultButton text="Cancel" onClick={props.onCancel} disabled={!props.dirty} />
      </div>
    </section>
  );
}

export default function SettingsForm(): React.ReactNode {
  const initial = loadState();
  const { themePreference: committedTheme, setThemePreference } = useTheme();
  const [styleDraft, setStyleDraft] = React.useState<ThemePreference>(committedTheme);
  const [styleStatus, setStyleStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);
  const [llmBaseline, setLlmBaseline] = React.useState<LlmDraft>(() => ({
    openAiBaseUrl: initial.settings.openAiBaseUrl ?? "",
    openAiModel: initial.settings.openAiModel ?? "",
    llmProvider: initial.settings.llmProvider,
    spotReviewConsent: initial.settings.spotReviewConsent,
    fullDocumentReviewConsent: initial.settings.fullDocumentReviewConsent,
    semanticOptIn: initial.settings.semanticOptIn,
  }));
  const [llmDraft, setLlmDraft] = React.useState<LlmDraft>(llmBaseline);
  const [llmStatus, setLlmStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);
  const [telemetryBaseline, setTelemetryBaseline] = React.useState<boolean>(
    initial.settings.telemetryDisabled,
  );
  const [telemetryDraft, setTelemetryDraft] = React.useState<boolean>(telemetryBaseline);
  const [telemetryStatus, setTelemetryStatus] =
    React.useState<SectionStatus>(INITIAL_SECTION_STATUS);

  const styleDirty = styleDraft !== committedTheme;
  const llmDirty = JSON.stringify(llmDraft) !== JSON.stringify(llmBaseline);
  const telemetryDirty = telemetryDraft !== telemetryBaseline;

  function patchLlm(partial: Partial<LlmDraft>): void {
    setLlmDraft((current) => ({ ...current, ...partial }));
    setLlmStatus((current) => ({ ...current, dirty: true, error: null, savedAt: null }));
  }

  function validateLlm(): string | null {
    const value = llmDraft.openAiBaseUrl.trim();
    if (value.length === 0) return null;
    try {
      const url = new URL(value);
      const loopback =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1";
      if (
        !loopback ||
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== ""
      ) {
        return "Broker base URL must be an HTTP(S) loopback URL without credentials or a fragment.";
      }
      return null;
    } catch {
      return "Broker base URL is not a valid URL.";
    }
  }

  function saveStyling(): void {
    setThemePreference(styleDraft);
    setStyleStatus({
      dirty: false,
      error: null,
      savedAt: new Date().toISOString(),
    });
  }

  function cancelStyling(): void {
    setStyleDraft(committedTheme);
    setStyleStatus(INITIAL_SECTION_STATUS);
  }

  function saveLlm(): void {
    const error = validateLlm();
    if (error) {
      setLlmStatus((current) => ({ ...current, error }));
      return;
    }
    const current = loadState();
    const baseUrl = llmDraft.openAiBaseUrl.trim();
    const model = llmDraft.openAiModel.trim();
    const settings = {
      ...current.settings,
      llmProvider: llmDraft.llmProvider,
      spotReviewConsent: llmDraft.spotReviewConsent,
      fullDocumentReviewConsent: llmDraft.fullDocumentReviewConsent,
      semanticOptIn: llmDraft.semanticOptIn,
    };
    if (baseUrl) settings.openAiBaseUrl = baseUrl;
    else delete settings.openAiBaseUrl;
    if (model) settings.openAiModel = model;
    else delete settings.openAiModel;
    const next: PersistedState = { ...current, settings };
    saveState(next);
    // Baseline and draft must reflect the values that were actually persisted,
    // otherwise untrimmed input leaves the section falsely dirty after a save.
    const saved: LlmDraft = { ...llmDraft, openAiBaseUrl: baseUrl, openAiModel: model };
    setLlmBaseline(saved);
    setLlmDraft(saved);
    logger.info("LLM settings saved", {
      model: saved.openAiModel || "deployment default",
      provider: saved.llmProvider,
      credentialMode: "broker",
    });
    setLlmStatus({ dirty: false, error: null, savedAt: new Date().toISOString() });
  }

  function cancelLlm(): void {
    setLlmDraft(llmBaseline);
    setLlmStatus(INITIAL_SECTION_STATUS);
  }

  function clearLegacyCredential(): void {
    clearPersistedCredentials();
    const cleared = loadState();
    setLlmDraft({
      openAiBaseUrl: cleared.settings.openAiBaseUrl ?? "",
      openAiModel: cleared.settings.openAiModel ?? "",
      llmProvider: cleared.settings.llmProvider,
      spotReviewConsent: cleared.settings.spotReviewConsent,
      fullDocumentReviewConsent: cleared.settings.fullDocumentReviewConsent,
      semanticOptIn: cleared.settings.semanticOptIn,
    });
    setLlmBaseline({
      openAiBaseUrl: cleared.settings.openAiBaseUrl ?? "",
      openAiModel: cleared.settings.openAiModel ?? "",
      llmProvider: cleared.settings.llmProvider,
      spotReviewConsent: cleared.settings.spotReviewConsent,
      fullDocumentReviewConsent: cleared.settings.fullDocumentReviewConsent,
      semanticOptIn: cleared.settings.semanticOptIn,
    });
    setLlmStatus({
      dirty: false,
      error: null,
      savedAt: new Date().toISOString(),
    });
  }

  function saveTelemetry(): void {
    const current = loadState();
    saveState({
      ...current,
      settings: { ...current.settings, telemetryDisabled: telemetryDraft },
    });
    setTelemetryBaseline(telemetryDraft);
    setTelemetryStatus({ dirty: false, error: null, savedAt: new Date().toISOString() });
  }

  function cancelTelemetry(): void {
    setTelemetryDraft(telemetryBaseline);
    setTelemetryStatus(INITIAL_SECTION_STATUS);
  }

  return (
    <div className="tf-settings-page">
      <div>
        <h1 className="tf-title">Settings</h1>
        <p className="tf-sub">Changes are saved independently for each settings section.</p>
      </div>

      <SectionCard
        title="Styling"
        description="Choose how ToneForge follows the current Office or system appearance."
        dirty={styleDirty}
        error={styleStatus.error}
        savedAt={styleStatus.savedAt}
        onSave={saveStyling}
        onCancel={cancelStyling}
        saveLabel="Save styling"
      >
        <Dropdown
          label="Theme"
          selectedKey={styleDraft}
          options={[
            { key: "system", text: "Use system setting" },
            { key: "light", text: "Light" },
            { key: "dark", text: "Dark" },
          ]}
          onChange={(_event, option) => {
            const value = option?.key;
            if (value === "system" || value === "light" || value === "dark") {
              setStyleDraft(value);
              setStyleStatus({ dirty: true, error: null, savedAt: null });
            }
          }}
        />
      </SectionCard>

      <SectionCard
        title="LLM"
        description="Configure the provider, model, and document-content review permissions."
        dirty={llmDirty}
        error={llmStatus.error}
        savedAt={llmStatus.savedAt}
        onSave={saveLlm}
        onCancel={cancelLlm}
        saveLabel="Save LLM"
      >
        <Dropdown
          label="Provider"
          selectedKey={llmDraft.llmProvider}
          options={[
            { key: "mock", text: "Mock (offline)" },
            { key: "openai", text: "OpenAI" },
          ]}
          onChange={(_event, option) => {
            if (option?.key === "mock" || option?.key === "openai") {
              patchLlm({ llmProvider: option.key });
            }
          }}
        />
        <MessageBar messageBarType={MessageBarType.info} delayedRender={false}>
          Credentials are never stored in ordinary settings or browser bundles. Local development
          uses the same-origin broker; production credential custody remains an explicit release
          decision.
        </MessageBar>
        <DefaultButton text="Clear legacy stored credential" onClick={clearLegacyCredential} />
        <TextField
          label="Broker base URL"
          value={llmDraft.openAiBaseUrl}
          onChange={(_event, value) => patchLlm({ openAiBaseUrl: value ?? "" })}
          placeholder="https://localhost:3000/__toneforge/llm/v1"
          description="Use the development broker URL. Do not enter an API key here."
        />
        <TextField
          label="Model"
          value={llmDraft.openAiModel}
          onChange={(_event, value) => patchLlm({ openAiModel: value ?? "" })}
          placeholder="gpt-4o-mini"
        />
        <Toggle
          label="Allow semantic analysis"
          checked={llmDraft.semanticOptIn}
          onChange={(_event, value) => patchLlm({ semanticOptIn: value ?? false })}
          onText="Enabled"
          offText="Disabled"
        />
        <Toggle
          label="Allow review of selected or paragraph text"
          checked={llmDraft.spotReviewConsent}
          onChange={(_event, value) => patchLlm({ spotReviewConsent: value ?? false })}
          onText="Enabled"
          offText="Disabled"
        />
        <Toggle
          label="Allow full-document review"
          checked={llmDraft.fullDocumentReviewConsent}
          onChange={(_event, value) => patchLlm({ fullDocumentReviewConsent: value ?? false })}
          onText="Enabled"
          offText="Disabled"
        />
      </SectionCard>

      <SectionCard
        title="Telemetry"
        description="Control whether the add-in may report usage telemetry."
        dirty={telemetryDirty}
        error={telemetryStatus.error}
        savedAt={telemetryStatus.savedAt}
        onSave={saveTelemetry}
        onCancel={cancelTelemetry}
        saveLabel="Save telemetry"
      >
        <Toggle
          label="Disable telemetry"
          checked={telemetryDraft}
          onChange={(_event, value) => {
            setTelemetryDraft(value ?? false);
            setTelemetryStatus({ dirty: true, error: null, savedAt: null });
          }}
          onText="Disabled"
          offText="Enabled"
        />
        <MessageBar messageBarType={MessageBarType.info}>
          No analytics endpoint is configured in this release. This preference is stored for future
          use.
        </MessageBar>
      </SectionCard>
    </div>
  );
}
