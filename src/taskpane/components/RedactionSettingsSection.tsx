import React from "react";
import { Toggle } from "@fluentui/react";
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
      <Toggle
        label="Allow semantic analysis"
        checked={settings.semanticOptIn}
        onChange={(_event, value) => {
          onChange({ ...state, settings: { ...settings, semanticOptIn: value ?? false } });
        }}
        onText="Enabled"
        offText="Disabled"
      />
      <Toggle
        label="Allow AI Review to send this document for consistency checking"
        checked={settings.consistencyReviewConsent}
        onChange={(_event, value) => {
          onChange({
            ...state,
            settings: { ...settings, consistencyReviewConsent: value ?? false },
          });
        }}
        onText="Enabled"
        offText="Disabled"
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
