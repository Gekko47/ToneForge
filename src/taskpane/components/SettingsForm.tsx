import React from "react";
import ProviderPrivacySettingsSection from "./ProviderPrivacySettingsSection";
import StylingSettingsSection from "./StylingSettingsSection";
import TelemetrySettingsSection from "./TelemetrySettingsSection";

/**
 * Settings composition shell.
 *
 * Each section owns its own draft, baseline, validation, and save, so a failed
 * save in one section never discards unsaved edits in another. Provider and
 * privacy consent are one section because they share a single save transaction.
 */
export default function SettingsForm(): React.ReactNode {
  return (
    <div className="tf-settings-page">
      <div>
        <h1 className="tf-title">Settings</h1>
        <p className="tf-sub">Changes are saved independently for each settings section.</p>
      </div>

      <StylingSettingsSection />
      <ProviderPrivacySettingsSection />
      <TelemetrySettingsSection />
    </div>
  );
}
