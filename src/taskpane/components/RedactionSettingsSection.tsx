import React from "react";
import { Switch } from "@fluentui/react-components";
import type { PersistedState } from "../../core/state/persistence";
import { DecisionFallbackPolicyControl } from "./DecisionFallbackPolicyControl";
import { CONSISTENCY_CONSENT_EXPLANATION } from "../settings/settingsModel";

export interface RedactionSettingsSectionProps {
  state: PersistedState;
  onChange: (next: PersistedState) => void;
}

/**
 * Consent and redaction controls for AI-powered features.
 *
 * Each consent is independent and never implied by another. The fallback
 * policy controls what happens when the decision LLM is unavailable.
 */
export function RedactionSettingsSection({
  state,
  onChange,
}: RedactionSettingsSectionProps): React.ReactNode {
  const settings = state.settings;

  return (
    <section className="tf-settings-section" aria-label="Redaction and consent">
      <h3 className="tf-role-title">Redaction and consent</h3>
      <p className="tf-sub">
        AI Review is the only review that can send document text to a provider. Consent is
        per-feature and never implied by another.
      </p>
      <Switch
        label="Allow semantic analysis"
        checked={settings.semanticOptIn}
        onChange={(_event, data) => {
          onChange({ ...state, settings: { ...settings, semanticOptIn: data.checked } });
        }}
      />
      <Switch
        label="Allow AI Review to send this document for consistency checking"
        checked={settings.consistencyReviewConsent}
        onChange={(_event, data) => {
          onChange({
            ...state,
            settings: { ...settings, consistencyReviewConsent: data.checked },
          });
        }}
      />
      <p className="tf-settings-note">{CONSISTENCY_CONSENT_EXPLANATION}</p>
      <DecisionFallbackPolicyControl
        value={settings.decisionFallbackPolicy}
        onChange={(next) => {
          onChange({
            ...state,
            settings: { ...settings, decisionFallbackPolicy: next },
          });
        }}
      />
    </section>
  );
}
