import React from "react";
import {
  PrimaryButton,
  DefaultButton,
  TextField,
  Toggle,
  MessageBar,
  MessageBarType,
} from "@fluentui/react";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { redact } from "../../core/config/env";
import { logger } from "../../shared/utils/logger";

interface SettingsFormState {
  openAiApiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  llmProvider: "openai" | "mock";
  spotReviewConsent: boolean;
  fullDocumentReviewConsent: boolean;
  telemetryDisabled: boolean;
  semanticOptIn: boolean;
  dirty: boolean;
  savedAt: string | null;
  error: string | null;
}

/** Mask an API key for display; returns "***" when empty or too short. */
function maskKey(value: string): string {
  if (!value) return "";
  return redact(value);
}

export default function SettingsForm(): React.ReactNode {
  const persisted = loadState();
  const [state, setState] = React.useState<SettingsFormState>({
    openAiApiKey: persisted.settings.openAiApiKey ?? "",
    openAiBaseUrl: persisted.settings.openAiBaseUrl ?? "",
    openAiModel: persisted.settings.openAiModel ?? "",
    llmProvider: persisted.settings.llmProvider ?? "mock",
    spotReviewConsent: persisted.settings.spotReviewConsent ?? false,
    fullDocumentReviewConsent: persisted.settings.fullDocumentReviewConsent ?? false,
    telemetryDisabled: persisted.settings.telemetryDisabled ?? true,
    semanticOptIn: false,
    dirty: false,
    savedAt: null,
    error: null,
  });

  function patch(partial: Partial<SettingsFormState>): void {
    setState((prev) => ({ ...prev, ...partial, dirty: true, error: null }));
  }

  function validate(): string | null {
    if (state.openAiBaseUrl && state.openAiBaseUrl.trim().length > 0) {
      try {
        new URL(state.openAiBaseUrl.trim());
      } catch {
        return "Base URL is not a valid URL.";
      }
    }
    return null;
  }

  function save(): void {
    const validationError = validate();
    if (validationError) {
      setState((prev) => ({ ...prev, error: validationError }));
      return;
    }

    const current = loadState();
    const next: PersistedState = {
      ...current,
      settings: {
        ...current.settings,
        openAiApiKey: state.openAiApiKey.trim(),
        openAiBaseUrl: state.openAiBaseUrl.trim(),
        openAiModel: state.openAiModel.trim(),
        llmProvider: state.llmProvider,
        spotReviewConsent: state.spotReviewConsent,
        fullDocumentReviewConsent: state.fullDocumentReviewConsent,
        telemetryDisabled: state.telemetryDisabled,
      },
    };
    saveState(next);

    // Log only the redacted key — never the raw value.
    logger.info("Settings saved", {
      key: maskKey(state.openAiApiKey),
      model: state.openAiModel,
      telemetryDisabled: state.telemetryDisabled,
    });

    setState((prev) => ({
      ...prev,
      dirty: false,
      savedAt: new Date().toISOString(),
      error: null,
    }));
  }

  /** Cancel restores the values that were loaded at mount time. */
  function reset(): void {
    setState({
      openAiApiKey: persisted.settings.openAiApiKey ?? "",
      openAiBaseUrl: persisted.settings.openAiBaseUrl ?? "",
      openAiModel: persisted.settings.openAiModel ?? "",
      llmProvider: persisted.settings.llmProvider ?? "mock",
      spotReviewConsent: persisted.settings.spotReviewConsent ?? false,
      fullDocumentReviewConsent: persisted.settings.fullDocumentReviewConsent ?? false,
      telemetryDisabled: persisted.settings.telemetryDisabled ?? true,
      semanticOptIn: false,
      dirty: false,
      savedAt: null,
      error: null,
    });
  }

  return (
    <div className="tf-card">
      <h2 className="tf-title">Settings</h2>
      <p className="tf-sub">
        Provider configuration. API keys are stored in Office roamingSettings.
      </p>

      {state.error && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {state.error}
        </MessageBar>
      )}
      {state.savedAt && (
        <MessageBar messageBarType={MessageBarType.success} role="status" aria-live="polite">
          Settings saved.
        </MessageBar>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
        <TextField
          label="OpenAI API key"
          type="password"
          value={state.openAiApiKey}
          onChange={(_e, v) => patch({ openAiApiKey: v ?? "" })}
          placeholder={state.openAiApiKey ? maskKey(state.openAiApiKey) : "sk-…"}
          description="Stored in Office roamingSettings. Never committed to source."
        />
        <TextField
          label="Base URL"
          value={state.openAiBaseUrl}
          onChange={(_e, v) => patch({ openAiBaseUrl: v ?? "" })}
          placeholder="https://api.openai.com/v1"
        />
        <TextField
          label="Model"
          value={state.openAiModel}
          onChange={(_e, v) => patch({ openAiModel: v ?? "" })}
          placeholder="gpt-4o-mini"
        />
        <div>
          <Toggle
            label="Disable telemetry"
            checked={state.telemetryDisabled}
            onChange={(_e, v) => patch({ telemetryDisabled: v ?? false })}
            onText="Telemetry off"
            offText="Telemetry on"
          />
          <span className="tf-sub">No analytics endpoint is configured.</span>
        </div>
        <div>
          <label htmlFor="llm-provider">Provider</label>
          <select
            id="llm-provider"
            value={state.llmProvider}
            onChange={(event) => patch({ llmProvider: event.target.value as "openai" | "mock" })}
          >
            <option value="mock">Mock (offline)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div>
          <Toggle
            label="Allow spot review of selected or paragraph text (opt-in)"
            checked={state.spotReviewConsent}
            onChange={(_e, v) => patch({ spotReviewConsent: v ?? false })}
            onText="Spot review allowed"
            offText="Spot review blocked"
          />
        </div>
        <div>
          <Toggle
            label="Allow full-document review (separate opt-in)"
            checked={state.fullDocumentReviewConsent}
            onChange={(_e, v) => patch({ fullDocumentReviewConsent: v ?? false })}
            onText="Full-document review allowed"
            offText="Full-document review blocked"
          />
        </div>
        <div>
          <Toggle
            label="Allow semantic analysis (opt-in)"
            checked={state.semanticOptIn}
            onChange={(_e, v) => patch({ semanticOptIn: v ?? false })}
            onText="Opted in"
            offText="Opted out"
          />
          <span className="tf-sub">
            When enabled, document text may be sent to the LLM for semantic profiling. Disabled by
            default.
          </span>
        </div>
      </div>

      <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
        <PrimaryButton text="Save" onClick={save} disabled={!state.dirty} />
        <DefaultButton text="Cancel" onClick={reset} disabled={!state.dirty} />
      </div>
    </div>
  );
}
