import React from "react";
import { Dropdown } from "@fluentui/react";
import { useTheme, type ThemePreference } from "../theme";
import {
  INITIAL_SECTION_STATUS,
  markDirty,
  markSaved,
  type SectionStatus,
} from "../settings/settingsModel";
import SettingsSectionCard from "./SettingsSectionCard";

/** Appearance only. No document or provider behaviour is affected here. */
export default function StylingSettingsSection(): React.ReactNode {
  const { themePreference: committed, setThemePreference } = useTheme();
  const [draft, setDraft] = React.useState<ThemePreference>(committed);
  const [status, setStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);
  const dirty = status.dirty || draft !== committed;

  return (
    <SettingsSectionCard
      title="Styling"
      description="Choose how ToneForge follows the current Office or system appearance."
      status={{ ...status, dirty }}
      saveLabel="Save styling"
      onSave={() => {
        setThemePreference(draft);
        setStatus(markSaved());
      }}
      onCancel={() => {
        setDraft(committed);
        setStatus(INITIAL_SECTION_STATUS);
      }}
    >
      <Dropdown
        label="Theme"
        selectedKey={draft}
        options={[
          { key: "system", text: "Use system setting" },
          { key: "light", text: "Light" },
          { key: "dark", text: "Dark" },
        ]}
        onChange={(_event, option) => {
          const value = option?.key;
          if (value === "system" || value === "light" || value === "dark") {
            setDraft(value);
            setStatus(markDirty());
          }
        }}
      />
    </SettingsSectionCard>
  );
}
