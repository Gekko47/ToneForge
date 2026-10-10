import React from "react";
import { Dropdown, Field, Option } from "@fluentui/react-components";
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
      <Field label="Theme">
        <Dropdown
          value={draft === "system" ? "Use system setting" : draft === "light" ? "Light" : "Dark"}
          selectedOptions={[draft]}
          onOptionSelect={(_event, data) => {
            const value = data.optionValue;
            if (value === "system" || value === "light" || value === "dark") {
              setDraft(value);
              setStatus(markDirty());
            }
          }}
        >
          <Option value="system">Use system setting</Option>
          <Option value="light">Light</Option>
          <Option value="dark">Dark</Option>
        </Dropdown>
      </Field>
    </SettingsSectionCard>
  );
}
