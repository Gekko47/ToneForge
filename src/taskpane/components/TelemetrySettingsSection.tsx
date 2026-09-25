import React from "react";
import { MessageBar, MessageBarType, Toggle } from "@fluentui/react";
import { loadState, saveState } from "../../core/state/index";
import {
  INITIAL_SECTION_STATUS,
  markDirty,
  markSaved,
  type SectionStatus,
} from "../settings/settingsModel";
import SettingsSectionCard from "./SettingsSectionCard";

export default function TelemetrySettingsSection(): React.ReactNode {
  const [baseline, setBaseline] = React.useState<boolean>(
    () => loadState().settings.telemetryDisabled,
  );
  const [draft, setDraft] = React.useState<boolean>(baseline);
  const [status, setStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);
  const dirty = status.dirty || draft !== baseline;

  return (
    <SettingsSectionCard
      title="Telemetry"
      description="Control whether the add-in may report usage telemetry."
      status={{ ...status, dirty }}
      saveLabel="Save telemetry"
      onSave={() => {
        const current = loadState();
        saveState({ ...current, settings: { ...current.settings, telemetryDisabled: draft } });
        setBaseline(draft);
        setStatus(markSaved());
      }}
      onCancel={() => {
        setDraft(baseline);
        setStatus(INITIAL_SECTION_STATUS);
      }}
    >
      <Toggle
        label="Disable telemetry"
        checked={draft}
        onChange={(_event, value) => {
          setDraft(value ?? false);
          setStatus(markDirty());
        }}
        onText="Disabled"
        offText="Enabled"
      />
      <MessageBar messageBarType={MessageBarType.info}>
        No analytics endpoint is configured in this release. This preference is stored for future
        use.
      </MessageBar>
    </SettingsSectionCard>
  );
}
